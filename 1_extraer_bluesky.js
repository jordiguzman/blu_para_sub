const { BskyAgent } = require('@atproto/api');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const HISTORY_FILE = path.join(__dirname, 'history.json');
const POST_JSON_FILE = path.join(__dirname, 'post.json');
const SCRIPT_2_PATH = path.join(__dirname, '2_publicar_substack.js');

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

        const targetPostInfo = pendingPosts[0];
        
        console.log(`🎯 ¡Post pendiente NUEVO encontrado! rkey: ${targetPostInfo.rkey}`);
        console.log(`📄 Texto: "${targetPostInfo.post.record.text || ""}"`);

        console.log(`📡 Obteniendo datos detallados...`);
        const response = await agent.getPosts({
            uris: [targetPostInfo.uri],
        });

        const post = response.data.posts[0];
        if (!post) {
            console.error("❌ No se ha podido recuperar el detalle del post.");
            return;
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
            externalLink: null
        };

        if (postRecord.embed) {
            postData.hasMedia = true;
            postData.mediaType = postRecord.embed.$type;

            if (postRecord.embed.images && postRecord.embed.images.length > 0) {
                const images = post.embed?.images || [];
                postData.mediaUrls = images.map(img => img.fullsize || img.thumb).filter(Boolean);
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

        fs.writeFileSync(POST_JSON_FILE, JSON.stringify(postData, null, 2), 'utf-8');
        console.log(`💾 Archivo post.json generado con éxito.`);

        history.push({
            rkey: targetPostInfo.rkey,
            uri: targetPostInfo.uri,
            createdAt: postRecord.createdAt || new Date().toISOString()
        });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
        console.log(`📝 history.json actualizado correctamente.`);

        // --- DISPARAR EL SCRIPT 2 (PUBLICADOR EN SUBS) ---
        console.log("🚀 Disparando script de publicación en Substack...");
        exec(`node "${SCRIPT_2_PATH}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Error al ejecutar el publicador: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`⚠️ Avisos del publicador: ${stderr}`);
            }
            console.log(stdout);
            console.log("🏁 Proceso completo finalizado.");
        });

    } catch (error) {
        console.error("❌ Error al extraer el post de Bluesky:", error);
    }
})();