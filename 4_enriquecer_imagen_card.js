const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function descargarBlob(did, cid, outputPath) {
    try {
        const url = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(outputPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(true));
            writer.on('error', (err) => reject(err));
        });
    } catch (error) {
        console.error(`❌ Error descargando blob de Bandcamp (CID: ${cid}):`, error.message);
        return false;
    }
}

async function procesarArchivoJson(filePath) {
    if (!fs.existsSync(filePath)) return false;

    const rawData = fs.readFileSync(filePath, 'utf-8');
    let data = JSON.parse(rawData);
    let modificado = false;

    async function enriquecerPost(post) {
        const esBandcamp = post.externalLink && 
                           post.externalLink.uri && 
                           post.externalLink.uri.includes('bandcamp.com');

        const thumbCid = post.externalLink?.thumb?.ref?.$link || 
                         post.externalLink?.thumb?.ref || 
                         post.externalLink?.thumb;

        if (esBandcamp && thumbCid) {
            let did = post.authorDid;
            if (!did && post.uri && post.uri.startsWith('at://')) {
                did = post.uri.split('/')[2];
            }

            if (!did) {
                console.log("⚠️ No se pudo determinar el DID para descargar la miniatura de Bandcamp.");
                return;
            }

            const tempDir = path.join(__dirname, 'temp_media');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const fileName = `bandcamp_${post.rkey || Date.now()}.jpg`;
            const absolutePath = path.join(tempDir, fileName);
            const relativePath = `temp_media/${fileName}`;

            console.log(`🎵 [BANDCAMP] Descargando miniatura de card desde PDS...`);
            const exito = await descargarBlob(did, thumbCid, absolutePath);

            if (exito) {
                console.log(`✅ Miniatura de Bandcamp guardada correctamente.`);
                
                post.hasMedia = true;
                if (!Array.isArray(post.mediaUrls)) {
                    post.mediaUrls = [];
                }
                
                if (!post.mediaUrls.includes(relativePath)) {
                    post.mediaUrls.push(relativePath);
                }
                
                modificado = true;
            }
        }
    }

    if (Array.isArray(data)) {
        for (let post of data) {
            await enriquecerPost(post);
        }
    } else {
        await enriquecerPost(data);
    }

    if (modificado) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`💾 Archivo ${path.basename(filePath)} actualizado con la ruta relativa.`);
    }
}

(async () => {
    console.log("🔍 [ENRIQUECIDOR BC] Buscando posts o hilos para procesar...");

    const postPath = path.join(__dirname, 'post.json');
    const threadPath = path.join(__dirname, 'thread.json');

    if (fs.existsSync(postPath)) {
        await procesarArchivoJson(postPath);
    }

    if (fs.existsSync(threadPath)) {
        await procesarArchivoJson(threadPath);
    }

    console.log("🏁 Proceso de enriquecimiento de Bandcamp finalizado.");
})();