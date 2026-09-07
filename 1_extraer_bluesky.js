<<<<<<< Updated upstream
const { BskyAgent } = require('@atproto/api');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const HISTORY_FILE = path.join(__dirname, 'history.json');
const POST_JSON_FILE = path.join(__dirname, 'post.json');
const SCRIPT_2_PATH = path.join(__dirname, '2_publicar_substack.js');
const TEMP_MEDIA_DIR = path.join(__dirname, 'temp_media');

// Función auxiliar para crear pausas (en milisegundos)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función auxiliar para ejecutar el script 2 usando Promesas
const runPublisher = () => {
    return new Promise((resolve, reject) => {
        exec(`node "${SCRIPT_2_PATH}"`, (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            if (stderr) {
                console.error(`⚠️ Avisos del publicador: ${stderr}`);
            }
            console.log(stdout);
            resolve();
        });
    });
};

(async () => {
    console.log("🚀 [EXTRACTOR BLUESKY] Conectando a la API...");

    const agent = new BskyAgent({ service: 'https://bsky.social' });
=======
import { BskyAgent } from '@atproto/api';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Apuntar directamente usando la ruta del archivo actual como referencia
dotenv.config({ path: path.join(__dirname, 'config', '.env') });

const LOCK_FILE = path.join(process.cwd(), 'process.lock');
const HISTORY_FILE = path.join(process.cwd(), 'history.json');
const POST_FILE = path.join(process.cwd(), 'post.json');
const TEMP_MEDIA_DIR = path.join(process.cwd(), 'temp_media');

// 1. Control de exclusión mutua (Lockfile) para hosting / cron
if (fs.existsSync(LOCK_FILE)) {
    const lockStats = fs.statSync(LOCK_FILE);
    const lockAgeMs = Date.now() - lockStats.mtimeMs;
    // Si el lock tiene más de 15 minutos, se considera huérfano y se sobrescribe
    if (lockAgeMs < 15 * 60 * 1000) {
        console.log("🔒 [LOCK] Otra instancia está en ejecución. Abortando.");
        process.exit(0);
    }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));
>>>>>>> Stashed changes

async function run() {
    try {
<<<<<<< Updated upstream
        await agent.login({
            identifier: process.env.BSKY_HANDLE,
            password: process.env.BSKY_APP_PASSWORD,
        });
        console.log("✅ Sesión iniciada correctamente en Bluesky.");

        const handle = "juanmentat.bsky.social";
        
        console.log(`🔍 Resolviendo el perfil de ${handle}...`);
        const profile = await agent.getProfile({ actor: handle });
        const repoDid = profile.data.did;

        console.log(`📡 Obteniendo el timeline reciente...`);
        const feedResponse = await agent.getAuthorFeed({ actor: handle, filter: 'posts_no_replies', limit: 20 });
        const feedItems = feedResponse.data.feed;

        if (!feedItems || feedItems.length === 0) {
            console.log("📭 No se han encontrado posts en el timeline.");
            return;
        }

        const ownPosts = feedItems.filter(item => {
            if (item.reason) return false;
            if (item.post.author.did !== repoDid) return false;
            return true;
        });

        if (ownPosts.length === 0) {
            console.log("📭 No se han encontrado posts propios válidos.");
            return;
        }

        const posts = ownPosts.map(item => {
            const uri = item.post.uri;
            const rkey = uri.split('/').pop();
            return {
                uri,
                rkey,
                post: item.post,
                createdAt: item.post.record.createdAt || new Date().toISOString()
            };
        });

        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            try {
                history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
            } catch (e) {
                history = [];
            }
        }

        // CASO 1: Primer arranque (Cold Start)
        if (history.length === 0) {
            console.log("ℹ️ Primer arranque detectado (Historial vacío). Inicializando base con el timeline actual...");
            
            history = posts.map(p => ({
                rkey: p.rkey,
                uri: p.uri,
                createdAt: p.createdAt
            }));

            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
            console.log(`🔒 Base establecida. Se han registrado ${history.length} posts actuales en history.json.`);
            console.log("👉 Ejecuta de nuevo cuando publiques un post nuevo para verificar la generación de post.json.");
            return;
        }

        // CASO 2: Ejecuciones posteriores - Buscamos posts nuevos
        const publishedRkeys = new Set(history.map(h => h.rkey));
        const pendingPosts = posts.filter(p => !publishedRkeys.has(p.rkey));

        if (pendingPosts.length === 0) {
            console.log("✅ No hay posts nuevos pendientes de publicar. Todo está al día.");
            return;
        }

        console.log(`🎯 Se han encontrado ${pendingPosts.length} posts pendientes de publicar.`);

        // Invertimos para publicarlos del más antiguo al más nuevo de los acumulados
        pendingPosts.reverse();

        // Iteramos por cada post pendiente
        for (let i = 0; i < pendingPosts.length; i++) {
            const targetPostInfo = pendingPosts[i];
            
            console.log(`\n--- Procesando post [${i + 1} de ${pendingPosts.length}] rkey: ${targetPostInfo.rkey} ---`);
            console.log(`📄 Texto: "${targetPostInfo.post.record.text || ""}"`);

            console.log(`📡 Obteniendo datos detallados...`);
            const response = await agent.getPosts({
                uris: [targetPostInfo.uri],
            });

            const post = response.data.posts[0];
            if (!post) {
                console.error("❌ No se ha podido recuperar el detalle del post. Saltando al siguiente...");
                continue;
            }

            const postRecord = post.record;

            const textContent = postRecord.text || "";
            const hashtagMatches = textContent.match(/#[^\s#]+/g) || [];
            const cleanHashtags = hashtagMatches.map(tag => tag.replace(/[\.,\/#!$%\^&\*;:{}=\-_`~()]$/, ""));

            const postData = {
                uri: targetPostInfo.uri,
                text: textContent,
                hashtags: cleanHashtags,
                createdAt: postRecord.createdAt || "",
                hasMedia: false,
                mediaType: null,
                mediaUrls: [],
                externalLink: null,
                video: null
            };

            if (postRecord.embed) {
                postData.hasMedia = true;
                postData.mediaType = postRecord.embed.$type;

                let imageBlobs = [];

                if (postRecord.embed.images && postRecord.embed.images.length > 0) {
                    imageBlobs = postRecord.embed.images.map(img => {
                        return img.image?.ref?.toString() || img.image?.ref;
                    }).filter(Boolean);
                }

                // Descargar imágenes directamente desde el PDS usando getBlob (sin pasar por CDNs públicos)
                if (imageBlobs.length > 0) {
                    if (!fs.existsSync(TEMP_MEDIA_DIR)) {
                        fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
                    }

                    const localImagePaths = [];
                    for (let imgIdx = 0; imgIdx < imageBlobs.length; imgIdx++) {
                        const blobCid = imageBlobs[imgIdx];
                        let descargadoExitosamente = false;
                        let intentos = 0;
                        const maxIntentos = 3;

                        while (!descargadoExitosamente && intentos < maxIntentos) {
                            intentos++;
                            try {
                                console.log(`📥 [Intento ${intentos}/${maxIntentos}] Descargando blob desde PDS (CID: ${blobCid})...`);
                                const blobRes = await agent.com.atproto.sync.getBlob({
                                    did: repoDid,
                                    cid: blobCid
                                });

                                if (blobRes && blobRes.data) {
                                    const buffer = Buffer.from(blobRes.data);
                                    const localFileName = `bsky_${targetPostInfo.rkey}_${imgIdx}.jpg`;
                                    const localFilePath = path.join(TEMP_MEDIA_DIR, localFileName);
                                    
                                    fs.writeFileSync(localFilePath, buffer);
                                    localImagePaths.push(localFilePath);
                                    console.log(`✅ Imagen guardada en disco: ${localFilePath}`);
                                    descargadoExitosamente = true;
                                } else {
                                    console.warn(`⚠️ Intento ${intentos} fallido. Reintentando en 3 segundos...`);
                                    if (intentos < maxIntentos) await sleep(3000);
                                }
                            } catch (imgErr) {
                                console.warn(`⚠️ Excepción en intento ${intentos}: ${imgErr.message}. Reintentando en 3 segundos...`);
                                if (intentos < maxIntentos) await sleep(3000);
                            }
                        }

                        if (!descargadoExitosamente) {
                            console.error(`❌ No se pudo descargar el blob ${imgIdx + 1} tras ${maxIntentos} intentos.`);
                        }
                    }
                    postData.mediaUrls = localImagePaths;
                }

                if (postRecord.embed.$type === 'app.bsky.embed.external' && postRecord.embed.external) {
                    postData.externalLink = {
                        uri: postRecord.embed.external.uri,
                        title: postRecord.embed.external.title,
                        description: postRecord.embed.external.description,
                        thumbUrl: post.embed?.external?.thumb?.ref ? `https://cdn.bsky.social/img/feed_thumbnail/plain/${repoDid}/${post.embed.external.thumb.ref.toString()}` : null
                    };
                }

                if (postRecord.embed.$type === 'app.bsky.embed.video') {
                    postData.video = {
                        playlist: post.embed?.playlist || null,
                        thumbnail: post.embed?.thumbnail || null,
                        alt: postRecord.embed.alt || null,
                        aspectRatio: postRecord.embed.aspectRatio || null,
                    };
                }
            }

            // --- FILTRO DE VÍDEOS NATIVOS ---
            if (postData.mediaType === 'app.bsky.embed.video') {
                console.log("🎥 Detectado un vídeo nativo de Bluesky (formato m3u8). Omitiendo la publicación en Substack tal como solicitaste.");
                
                history.push({
                    rkey: targetPostInfo.rkey,
                    uri: targetPostInfo.uri,
                    createdAt: postRecord.createdAt || new Date().toISOString()
                });
                fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
                console.log(`📝 history.json actualizado (vídeo nativo omitido en Substack).`);
                
                continue;
            }

            fs.writeFileSync(POST_JSON_FILE, JSON.stringify(postData, null, 2), 'utf-8');
            console.log(`💾 Archivo post.json generado con éxito.`);

            history.push({
                rkey: targetPostInfo.rkey,
                uri: targetPostInfo.uri,
                createdAt: postRecord.createdAt || new Date().toISOString()
            });
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
            console.log(`📝 history.json actualizado correctamente.`);

            // --- DISPARAR EL SCRIPT 2 Y ESPERAR ---
            console.log("🚀 Disparando script de publicación en Substack...");
            try {
                await runPublisher();
                console.log("🏁 Publicación individual finalizada con éxito.");
            } catch (pubError) {
                console.error(`❌ Error al ejecutar el publicador para este post: ${pubError.message}`);
            }

            // Pausa de 2 minutos entre posts si hay más en la cola
            if (i < pendingPosts.length - 1) {
                console.log("⏳ Esperando 2 minutos antes de procesar el siguiente post...");
                await sleep(120000); 
            }
        }

        console.log("\n🎉 ¡Todos los posts pendientes han sido procesados en esta ejecución!");

    } catch (error) {
        console.error("❌ Error al extraer el post de Bluesky:", error);
=======
        console.log("🚀 [EXTRACTOR BLUESKY] Conectando...");
        const agent = new BskyAgent({ service: 'https://bsky.social' });
        
        await agent.login({
            identifier: process.env.BSKY_HANDLE,
            password: process.env.BSKY_APP_PASSWORD
        });

        // Obtener feed propio utilizando directamente el handle del archivo .env
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

        // 2. Gestión de historial y detección de arranque en frío (borrón y cuenta nueva)
        let history = [];
        let historyExists = fs.existsSync(HISTORY_FILE);
        if (historyExists) {
            try {
                history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            } catch (e) {
                history = [];
            }
        }

        // Si el historial no existe o está vacío, establecemos la línea de base inicial automáticamente
        if (!historyExists || history.length === 0) {
            console.log("🌟 [BASELINE] Arranque en frío detectado. Registrando historial inicial para ignorar publicaciones previas...");
            const baselineHistory = posts.map(post => ({
                uri: post.uri,
                status: 'INITIAL_BASELINE',
                createdAt: post.record.createdAt,
                timestamp: new Date().toISOString()
            }));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(baselineHistory, null, 2), 'utf8');
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            console.log(`✅ Historial inicial establecido con ${baselineHistory.length} elementos. No se procesarán posts en esta ejecución.`);
            return;
        }

        const successfulUris = new Set(
            history.filter(h => h.status === 'SUCCESS').map(h => h.uri)
        );
        const baselineUris = new Set(
            history.filter(h => h.status === 'INITIAL_BASELINE').map(h => h.uri)
        );

        // Filtrar posts que no tengan SUCCESS ni formen parte de la línea base inicial
        const pendingPosts = posts
            .filter(post => !successfulUris.has(post.uri) && !baselineUris.has(post.uri))
            .sort((a, b) => new Date(a.record.createdAt) - new Date(b.record.createdAt));

        if (pendingPosts.length === 0) {
            console.log("✅ Todo al día. No hay posts pendientes.");
            if (fs.existsSync(POST_FILE)) fs.unlinkSync(POST_FILE);
            return;
        }

        // Seleccionar estrictamente el más antiguo de los pendientes (procesamiento unitario)
        const targetPost = pendingPosts[0];
        const record = targetPost.record;
        console.log(`📝 Procesando post seleccionado: "${record.text?.substring(0, 40)}..." (rkey: ${targetPost.uri.split('/').pop()})`);

        // Preparar directorio temporal
        if (!fs.existsSync(TEMP_MEDIA_DIR)) {
            fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
        } else {
            // Limpiar archivos anteriores de temp_media
            fs.readdirSync(TEMP_MEDIA_DIR).forEach(file => {
                fs.unlinkSync(path.join(TEMP_MEDIA_DIR, file));
            });
        }

        let postType = 'text';
        let mediaUrls = [];
        let externalLink = null;

        // 4. Clasificación y extracción de metadatos/blobs
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
                // Intentar descargar la miniatura
                try {
                    const res = await fetch(thumbUrl);
                    if (res.ok) {
                        const buffer = Buffer.from(await res.arrayBuffer());
                        const localPath = path.join(TEMP_MEDIA_DIR, `thumb_${Date.now()}.jpg`);
                        fs.writeFileSync(localPath, buffer);
                        mediaUrls.push(localPath);
                    } else {
                        console.log(`⚠️ Aviso: No se pudo descargar la miniatura (Status Code: ${res.status})`);
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
        } else if (record.embed?.$type === 'app.bsky.embed.images' && record.embed.images) {
            postType = 'media';
            // Lógica para imágenes nativas si procede
        }

        // 5. Construcción del contrato unificado post.json
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

        // 6. Invocación automática del publicador tras generar el contrato con éxito
        console.log("🚀 [EXTRACTOR] Lanzando el script de publicación...");
        try {
            execSync('node 2_publicar_substack.js', { stdio: 'inherit', cwd: __dirname });
        } catch (pubError) {
            console.error(`❌ [PUBLICADOR] Error al ejecutar el script de publicación: ${pubError.message}`);
        }

    } catch (error) {
        console.error(`❌ Error en Extractor: ${error.message}`);
        process.exit(1);
    } finally {
        // Liberar bloqueo de forma segura
        if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE);
        }
>>>>>>> Stashed changes
    }
}

run();