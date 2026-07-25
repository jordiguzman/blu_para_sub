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
        const rkey = "3mrih3akcza2b";

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
        
        // --- CONSTRUCCIÓN DEL JSON ---
        const postData = {
            uri: atUri,
            text: postRecord.text || "",
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