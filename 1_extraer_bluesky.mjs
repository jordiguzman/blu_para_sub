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

const LOCK_FILE = path.join(process.cwd(), 'process.lock');
const HISTORY_FILE = path.join(process.cwd(), 'history.json');
const POST_FILE = path.join(process.cwd(), 'post.json');
const TEMP_MEDIA_DIR = path.join(process.cwd(), 'temp_media');

if (fs.existsSync(LOCK_FILE)) {
    const lockStats = fs.statSync(LOCK_FILE);
    const lockAgeMs = Date.now() - lockStats.mtimeMs;
    if (lockAgeMs < 15 * 60 * 1000) {
        console.log("🔒 [LOCK] Otra instancia está en ejecución. Abortando.");
        process.exit(0);
    }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));

async function run() {
    try {
        console.log("🚀 [EXTRACTOR BLUESKY] Conectando...");
        const agent = new BskyAgent({ service: 'https://bsky.social' });
        
        await agent.login({
            identifier: process.env.BSKY_HANDLE,
            password: process.env.BSKY_APP_PASSWORD
        });

        const feedResponse = await agent.getAuthorFeed({
            actor: process.env.BSKY_HANDLE,
            filter: 'posts_no_replies',
            limit: 30
        });

        const profile = await agent.getProfile({ actor: process.env.BSKY_HANDLE });
        const myDid = profile.data.did;

        const posts = feedResponse.data.feed
            .map(item => item.post)
            .filter(post => post.author.did === myDid);

        let history = [];
        let historyExists = fs.existsSync(HISTORY_FILE);
        if (historyExists) {
            try {
                history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            } catch (e) {
                history = [];
            }
        }

        if (!historyExists || history.length === 0) {
            console.log("🌟 [BASELINE] Arranque en frío detectado. Registrando historial inicial...");
            const baselineHistory = posts.map(post => ({
                uri: post.uri,
                status: 'INITIAL_BASELINE',
                createdAt: post.record.createdAt,
                timestamp: new Date().toISOString()
            }));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(baselineHistory, null, 2), 'utf8');
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            console.log(`✅ Historial inicial establecido con ${baselineHistory.length} elementos.`);
            return;
        }

        const successfulUris = new Set(
            history.filter(h => h.status === 'SUCCESS').map(h => h.uri)
        );
        const baselineUris = new Set(
            history.filter(h => h.status === 'INITIAL_BASELINE').map(h => h.uri)
        );

        const pendingPosts = posts
            .filter(post => !successfulUris.has(post.uri) && !baselineUris.has(post.uri))
            .sort((a, b) => new Date(a.record.createdAt) - new Date(b.record.createdAt));

        if (pendingPosts.length === 0) {
            console.log("✅ Todo al día. No hay posts pendientes.");
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            return;
        }

        const targetPost = pendingPosts[0];
        const record = targetPost.record;
        console.log(`📝 Procesando post seleccionado: "${record.text?.substring(0, 40)}..." (rkey: ${targetPost.uri.split('/').pop()})`);

        if (!fs.existsSync(TEMP_MEDIA_DIR)) {
            fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
        } else {
            fs.readdirSync(TEMP_MEDIA_DIR).forEach(file => {
                fs.unlinkSync(path.join(TEMP_MEDIA_DIR, file));
            });
        }

        let postType = 'text';
        let mediaUrls = [];
        let externalLink = null;

        if (record.embed?.$type === 'app.bsky.embed.external' && record.embed.external) {
            const ext = record.embed.external;
            const uriLower = ext.uri.toLowerCase();
            
            if (uriLower.includes('bandcamp.com')) {
                postType = 'bandcamp';
            } else {
                postType = 'link';
            }

            let thumbUrl = null;
            const thumbRef = ext.thumb?.ref?.$link || ext.thumb?.ref;
            if (thumbRef) {
                thumbUrl = `https://cdn.bsky.social/img/feed_thumbnail/plain/${targetPost.author.did}/${thumbRef}`;
                try {
                    const res = await fetch(thumbUrl);
                    if (res.ok) {
                        const buffer = Buffer.from(await res.arrayBuffer());
                        const localPath = path.join(TEMP_MEDIA_DIR, `thumb_${Date.now()}.jpg`);
                        fs.writeFileSync(localPath, buffer);
                        mediaUrls.push(localPath);
                    }
                } catch (err) {
                    console.log(`⚠️ Error descargando miniatura: ${err.message}`);
                }
            }

            externalLink = {
                uri: ext.uri,
                title: ext.title || '',
                description: ext.description || '',
                thumbUrl: thumbUrl
            };
        }

        const postContract = {
            uri: targetPost.uri,
            rkey: targetPost.uri.split('/').pop(),
            createdAt: record.createdAt,
            type: postType,
            text: record.text || '',
            mediaUrls: mediaUrls,
            externalLink: externalLink
        };

        fs.writeFileSync(POST_FILE, JSON.stringify(postContract, null, 2), 'utf8');
        console.log(`✅ Contrato post.json generado correctamente para el post ${postContract.rkey}`);

        console.log("🚀 [EXTRACTOR] Lanzando el script de publicación...");
        try {
            execSync('node 2_publicar_substack.mjs', { stdio: 'inherit', cwd: __dirname });
        } catch (pubError) {
            console.error(`❌ [PUBLICADOR] Error al ejecutar el script de publicación: ${pubError.message}`);
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