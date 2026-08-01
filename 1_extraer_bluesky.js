const { BskyAgent } = require('@atproto/api');
const path = require('path');
const fs = require('fs'); // Añadimos el módulo de ficheros de Node.js
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

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
        const rkey = "3ms2dvqsgdk2a";

        console.log(`🔍 Resolviendo el perfil de ${handle}...`);
        const profile = await agent.getProfile({ actor: handle });
        const repoDid = profile.data.did;

        const atUri = `at://${repoDid}/app.bsky.feed.post/${rkey}`;

        console.log(`📡 Obteniendo datos del post...`);
        const response = await agent.getPosts({
            uris: [atUri],
        });

        const post = response.data.posts[0];
        
        if (!post) {
            console.error("❌ No se ha encontrado el post con ese URI.");
            return;
        }

        const postRecord = post.record;
        
       // --- EXTRACCIÓN DE HASHTAGS ---
        const textContent = postRecord.text || "";
        const hashtagMatches = textContent.match(/#[^\s#]+/g) || [];
        // Limpiamos posibles símbolos de puntuación pegados al final del hashtag
        const cleanHashtags = hashtagMatches.map(tag => tag.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]$/, ""));

        // --- CONSTRUCCIÓN DEL JSON ---
        const postData = {
            uri: atUri,
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

            // --- VÍDEO: se sirve como stream HLS (playlist .m3u8), no como
            // archivo descargable directo. Guardamos lo que la API nos dé para
            // decidir después cómo tratarlo. ---
            if (postRecord.embed.$type === 'app.bsky.embed.video') {
                postData.video = {
                    playlist: post.embed?.playlist || null, // URL del .m3u8
                    thumbnail: post.embed?.thumbnail || null,
                    alt: postRecord.embed.alt || null,
                    aspectRatio: postRecord.embed.aspectRatio || null,
                };
            }
        }

        // --- GUARDAR EN ARCHIVO JSON TEMPORAL ---
        const filePath = path.join(__dirname, 'post.json');
        fs.writeFileSync(filePath, JSON.stringify(postData, null, 2), 'utf-8');
        
        console.log("\n📦 --- JSON ESTRUCTURADO GENERADO Y GUARDADO ---");
        console.log(`💾 Archivo guardado con éxito en: ${filePath}`);
        console.log(JSON.stringify(postData, null, 2));
        console.log("--------------------------------------------------\n");

    } catch (error) {
        console.error("❌ Error al extraer el post de Bluesky:", error);
    }
})();