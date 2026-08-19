const { BskyAgent } = require('@atproto/api');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const HISTORY_FILE = path.join(__dirname, 'history.json');
const POST_JSON_FILE = path.join(__dirname, 'post.json');
const POSTS_ARCHIVE_FILE = path.join(__dirname, 'posts_archive.json');
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

    try {
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

                let remoteImageUrls = [];

                // Capturar URLs remotas originales
                if (postRecord.embed.images && postRecord.embed.images.length > 0) {
                    remoteImageUrls = postRecord.embed.images.map(img => {
                        const ref = img.image?.ref?.toString() || img.image?.ref;
                        if (ref) {
                            return `https://cdn.bsky.social/img/feed_fullsize/plain/${repoDid}/${ref}@jpeg`;
                        }
                        return img.fullsize || img.thumb;
                    }).filter(Boolean);
                } else if (post.embed?.images && post.embed.images.length > 0) {
                    remoteImageUrls = post.embed.images.map(img => img.fullsize || img.thumb).filter(Boolean);
                }

                // Descargar las imágenes localmente para evitar fallos del CDN en Substack
                if (remoteImageUrls.length > 0) {
                    if (!fs.existsSync(TEMP_MEDIA_DIR)) {
                        fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
                    }

                    const localImagePaths = [];
                    for (let imgIdx = 0; imgIdx < remoteImageUrls.length; imgIdx++) {
                        const imgUrl = remoteImageUrls[imgIdx];
                        try {
                            console.log(`📥 Descargando imagen localmente: ${imgUrl}`);
                            const imgRes = await fetch(imgUrl);
                            if (imgRes.ok) {
                                const buffer = Buffer.from(await imgRes.arrayBuffer());
                                const localFileName = `bsky_${targetPostInfo.rkey}_${imgIdx}.jpg`;
                                const localFilePath = path.join(TEMP_MEDIA_DIR, localFileName);
                                
                                fs.writeFileSync(localFilePath, buffer);
                                localImagePaths.push(localFilePath);
                                console.log(`✅ Imagen guardada en disco: ${localFilePath}`);
                            } else {
                                console.error(`⚠️ Error al descargar imagen (Status: ${imgRes.status})`);
                            }
                        } catch (imgErr) {
                            console.error(`⚠️ Excepción descargando imagen: ${imgErr.message}`);
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

            // --- ARCHIVO DE ACUMULACIÓN NUEVO ---
            try {
                let archiveList = [];
                if (fs.existsSync(POSTS_ARCHIVE_FILE)) {
                    archiveList = JSON.parse(fs.readFileSync(POSTS_ARCHIVE_FILE, 'utf-8'));
                }
                archiveList.push(postData);
                fs.writeFileSync(POSTS_ARCHIVE_FILE, JSON.stringify(archiveList, null, 2), 'utf-8');
                console.log(`📦 posts_archive.json actualizado con el nuevo post.`);
            } catch (archiveErr) {
                console.error(`⚠️ No se pudo actualizar posts_archive.json: ${archiveErr.message}`);
            }

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
    }
})();