const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function descargarImagenUrl(url, outputPath) {
    try {
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
        console.error(`❌ Error descargando miniatura de Bandcamp desde URL:`, error.message);
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

        const thumbUrl = post.externalLink?.thumbUrl;

        if (esBandcamp && thumbUrl) {
            const tempDir = path.join(__dirname, 'temp_media');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const fileName = `bandcamp_${post.rkey || Date.now()}.jpg`;
            const absolutePath = path.join(tempDir, fileName);
            const relativePath = path.join('temp_media', fileName);

            console.log(`🎵 [BANDCAMP] Descargando miniatura de card desde CDN...`);
            const exito = await descargarImagenUrl(thumbUrl, absolutePath);

            if (exito) {
                console.log(`✅ Miniatura de Bandcamp guardada correctamente.`);
                
                post.hasMedia = true;
                if (!Array.isArray(post.mediaUrls)) {
                    post.mediaUrls = [];
                }
                
                if (!post.mediaUrls.includes(absolutePath) && !post.mediaUrls.includes(relativePath)) {
                    post.mediaUrls.push(absolutePath);
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
        console.log(`💾 Archivo ${path.basename(filePath)} actualizado con la ruta.`);
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