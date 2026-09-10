import { BskyAgent } from '@atproto/api';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, 'config', '.env') });

const LOCK_FILE = path.join(__dirname, 'process.lock');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const POST_FILE = path.join(__dirname, 'post.json');
const THREAD_FILE = path.join(__dirname, 'thread.json');
const TEMP_MEDIA_DIR = path.join(__dirname, 'temp_media');
const ATTEMPTS_FILE = path.join(__dirname, 'attempts.json'); // NUEVO
const MAX_ATTEMPTS = 5; // NUEVO

if (fs.existsSync(LOCK_FILE)) {
    const lockStats = fs.statSync(LOCK_FILE);
    const lockAgeMs = Date.now() - lockStats.mtimeMs;
    if (lockAgeMs < 15 * 60 * 1000) {
        console.log("🔒 [LOCK] Otra instancia está en ejecución. Abortando.");
        process.exit(0);
    }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));

// NUEVO: helpers de conteo de intentos fallidos
function leerIntentos() {
    if (!fs.existsSync(ATTEMPTS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function guardarIntentos(intentos) {
    fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(intentos, null, 2), 'utf8');
}

// Descarga la miniatura de un embed externo (si existe) y devuelve la ruta local o null
async function descargarThumb(authorDid, thumbRef) {
    if (!thumbRef) return null;
    const thumbUrl = `https://cdn.bsky.social/img/feed_thumbnail/plain/${authorDid}/${thumbRef}`;
    try {
        const res = await fetch(thumbUrl);
        if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const localPath = path.join(TEMP_MEDIA_DIR, `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`);
            fs.writeFileSync(localPath, buffer);
            return localPath;
        }
    } catch (err) {
        console.log(`⚠️ Error descargando miniatura: ${err.message}`);
    }
    return null;
}

// Extrae los datos comunes de un post individual (texto, embed, media descargada)
async function extraerDatosPost(post) {
    const record = post.record;
    let mediaUrls = [];
    let externalLink = null;
    const embedType = record.embed?.$type || null;

    if (embedType === 'app.bsky.embed.external' && record.embed.external) {
        const ext = record.embed.external;
        const thumbRef = ext.thumb?.ref?.$link || ext.thumb?.ref;
        const localThumb = await descargarThumb(post.author.did, thumbRef);
        if (localThumb) mediaUrls.push(localThumb);

        externalLink = {
            uri: ext.uri,
            title: ext.title || '',
            description: ext.description || '',
            thumbUrl: thumbRef
                ? `https://cdn.bsky.social/img/feed_thumbnail/plain/${post.author.did}/${thumbRef}`
                : null
        };
    }

    return {
        uri: post.uri,
        rkey: post.uri.split('/').pop(),
        createdAt: record.createdAt,
        text: record.text || '',
        embedType,
        mediaUrls,
        externalLink
    };
}

async function run() {
    try {
        console.log("🚀 [EXTRACTOR BLUESKY] Conectando...");
        const agent = new BskyAgent({ service: 'https://bsky.social' });

        await agent.login({
            identifier: process.env.BSKY_HANDLE,
            password: process.env.BSKY_APP_PASSWORD
        });

        const profile = await agent.getProfile({ actor: process.env.BSKY_HANDLE });
        const myDid = profile.data.did;

        const feedResponse = await agent.getAuthorFeed({
            actor: process.env.BSKY_HANDLE,
            filter: 'posts_with_replies',
            limit: 30
        });

        const feedItems = feedResponse.data.feed;

        let history = [];
        let historyExists = fs.existsSync(HISTORY_FILE);
        if (historyExists) {
            try {
                history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            } catch (e) {
                history = [];
            }
        }

        const ownRootPosts = feedItems
            .map(item => item.post)
            .filter(post => post.author.did === myDid);

        if (!historyExists || history.length === 0) {
            console.log("🌟 [BASELINE] Arranque en frío detectado. Registrando historial inicial...");
            const baselineHistory = ownRootPosts.map(post => ({
                uri: post.uri,
                status: 'INITIAL_BASELINE',
                createdAt: post.record.createdAt,
                timestamp: new Date().toISOString()
            }));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(baselineHistory, null, 2), 'utf8');
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            if (fs.existsSync(THREAD_FILE)) fs.unlinkSync(THREAD_FILE);
            console.log(`✅ Historial inicial establecido con ${baselineHistory.length} elementos.`);
            return;
        }

        // NUEVO: SKIPPED_MANUAL_REVIEW cuenta como "ya hecho" (apartado, no se reintenta)
        const successfulUris = new Set(history.filter(h => h.status === 'SUCCESS').map(h => h.uri));
        const baselineUris = new Set(history.filter(h => h.status === 'INITIAL_BASELINE').map(h => h.uri));
        const skippedUris = new Set(history.filter(h => h.status === 'SKIPPED_MANUAL_REVIEW').map(h => h.uri));
        const yaHecho = (uri) => successfulUris.has(uri) || baselineUris.has(uri) || skippedUris.has(uri);

        const grupos = new Map();

        for (const item of feedItems) {
            const post = item.post;
            if (post.author.did !== myDid) continue;

            const reply = item.reply;
            let rootUri = post.uri;

            if (reply) {
                const parentAuthorDid = reply.parent?.author?.did;
                if (parentAuthorDid !== myDid) continue;
                rootUri = reply.root?.uri || post.uri;
            }

            if (yaHecho(post.uri)) continue;

            if (!grupos.has(rootUri)) grupos.set(rootUri, []);
            grupos.get(rootUri).push(post);
        }

        const unidades = Array.from(grupos.values())
            .filter(posts => posts.length > 0)
            .map(posts => posts.sort((a, b) => new Date(a.record.createdAt) - new Date(b.record.createdAt)));

        unidades.sort((a, b) => new Date(a[0].record.createdAt) - new Date(b[0].record.createdAt));

        if (unidades.length === 0) {
            console.log("✅ Todo al día. No hay posts pendientes.");
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            if (fs.existsSync(THREAD_FILE)) fs.unlinkSync(THREAD_FILE);
            return;
        }

        const unidadElegida = unidades[0];
        const claveUnidad = unidadElegida[0].uri; // NUEVO: identifica la unidad para contar intentos

        // NUEVO: control de intentos fallidos repetidos
        let intentos = leerIntentos();
        intentos[claveUnidad] = (intentos[claveUnidad] || 0) + 1;

        if (intentos[claveUnidad] > MAX_ATTEMPTS) {
            console.log(`🚫 "${claveUnidad}" ha fallado ${MAX_ATTEMPTS} veces seguidas. Se aparta para revisión manual, no se reintenta más.`);

            for (const post of unidadElegida) {
                history.push({
                    uri: post.uri,
                    status: 'SKIPPED_MANUAL_REVIEW',
                    createdAt: post.record.createdAt,
                    timestamp: new Date().toISOString()
                });
            }
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');

            delete intentos[claveUnidad];
            guardarIntentos(intentos);
            return;
        }
        guardarIntentos(intentos);

        if (!fs.existsSync(TEMP_MEDIA_DIR)) {
            fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
        } else {
            fs.readdirSync(TEMP_MEDIA_DIR).forEach(file => fs.unlinkSync(path.join(TEMP_MEDIA_DIR, file)));
        }

        if (unidadElegida.length === 1) {
            const post = unidadElegida[0];
            const datos = await extraerDatosPost(post);

            let postType = 'text';
            if (datos.embedType === 'app.bsky.embed.external' && datos.externalLink) {
                postType = datos.externalLink.uri.toLowerCase().includes('bandcamp.com') ? 'bandcamp' : 'link';
            }

            console.log(`📝 Procesando post seleccionado: "${datos.text.substring(0, 40)}..." (rkey: ${datos.rkey})`);

            const postContract = {
                uri: datos.uri,
                rkey: datos.rkey,
                createdAt: datos.createdAt,
                type: postType,
                text: datos.text,
                mediaUrls: datos.mediaUrls,
                externalLink: datos.externalLink
            };

            fs.writeFileSync(POST_FILE, JSON.stringify(postContract, null, 2), 'utf8');
            if (fs.existsSync(THREAD_FILE)) fs.unlinkSync(THREAD_FILE);
            console.log(`✅ Contrato post.json generado correctamente para el post ${postContract.rkey}`);

            console.log("🚀 [EXTRACTOR] Lanzando el script de publicación...");
            try {
                execSync('node 2_publicar_substack.mjs', { stdio: 'inherit', cwd: __dirname });
            } catch (pubError) {
                console.error(`❌ [PUBLICADOR] Error al ejecutar el script de publicación: ${pubError.message}`);
            }

        } else {
            console.log(`🧵 Hilo detectado con ${unidadElegida.length} eslabones pendientes.`);

            const threadContract = [];
            for (const post of unidadElegida) {
                const datos = await extraerDatosPost(post);
                threadContract.push({
                    uri: datos.uri,
                    rkey: datos.rkey,
                    text: datos.text,
                    hashtags: datos.text.match(/#\w+/g) || [],
                    createdAt: datos.createdAt,
                    hasMedia: datos.mediaUrls.length > 0,
                    mediaType: datos.embedType,
                    mediaUrls: datos.mediaUrls,
                    externalLink: datos.externalLink,
                    video: null
                });
            }

            fs.writeFileSync(THREAD_FILE, JSON.stringify(threadContract, null, 2), 'utf8');
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            console.log(`✅ Contrato thread.json generado correctamente con ${threadContract.length} eslabones.`);

            console.log("🚀 [EXTRACTOR] Lanzando el script de publicación de hilos...");
            try {
                execSync('node 3_publicar_hilo.cjs', { stdio: 'inherit', cwd: __dirname });
            } catch (pubError) {
                console.error(`❌ [PUBLICADOR DE HILOS] Error al ejecutar el script de publicación: ${pubError.message}`);
            }
        }

    } catch (error) {
        console.error(`❌ Error en Extractor: ${error.message}`);
        process.exit(1);
    } finally {
        if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE);
        }
    }
}

run();