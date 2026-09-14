// 4_enriquecer_bandcamp.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_MEDIA_DIR = path.join(__dirname, 'temp_media');
const POST_FILE = path.join(__dirname, 'post.json');
const THREAD_FILE = path.join(__dirname, 'thread.json');

async function obtenerPortadaGrande(bandcampUrl) {
    try {
        const res = await fetch(bandcampUrl);
        if (!res.ok) return null;
        const html = await res.text();
        const match = html.match(/<meta property="og:image" content="([^"]+)"/i);
        if (!match) return null;
        return match[1];
    } catch (err) {
        console.log(`⚠️ [BANDCAMP] No se pudo leer la página del álbum: ${err.message}`);
        return null;
    }
}

async function descargarImagen(url, nombreArchivo) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        const localPath = path.join(TEMP_MEDIA_DIR, nombreArchivo);
        fs.writeFileSync(localPath, buffer);
        return localPath;
    } catch (err) {
        console.log(`⚠️ [BANDCAMP] Error descargando portada grande: ${err.message}`);
        return null;
    }
}

async function enriquecerContrato(contractPath, esHilo) {
    if (!fs.existsSync(contractPath)) {
        console.log(`ℹ️ No existe ${path.basename(contractPath)}, nada que hacer.`);
        return;
    }

    let data;
    try {
        data = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    } catch (e) {
        console.log(`⚠️ No se pudo leer ${path.basename(contractPath)}, se deja intacto.`);
        return;
    }

    const items = esHilo ? data : [data];
    let cambios = false;

    for (const item of items) {
        const tipo = esHilo ? item.mediaType : item.type;
        const esBandcamp = esHilo
            ? (item.externalLink?.uri || '').toLowerCase().includes('bandcamp.com')
            : tipo === 'bandcamp';

        if (!esBandcamp || !item.externalLink?.uri) continue;

        console.log(`🎵 [BANDCAMP] Buscando portada grande para: ${item.externalLink.uri}`);
        const imagenGrande = await obtenerPortadaGrande(item.externalLink.uri);
        if (!imagenGrande) {
            console.log("ℹ️ [BANDCAMP] No se encontró portada grande, se conserva la miniatura original.");
            continue;
        }

        const nombreArchivo = `bandcamp_grande_${item.rkey}.jpg`;
        const rutaLocal = await descargarImagen(imagenGrande, nombreArchivo);
        if (rutaLocal) {
            item.mediaUrls = [rutaLocal];
            cambios = true;
            console.log(`✅ [BANDCAMP] Portada grande descargada para ${item.rkey}: ${rutaLocal}`);
        }
    }

    if (cambios) {
        const salida = esHilo ? items : items[0];
        fs.writeFileSync(contractPath, JSON.stringify(salida, null, 2), 'utf8');
        console.log(`💾 ${path.basename(contractPath)} actualizado con la(s) portada(s) grande(s).`);
    } else {
        console.log("ℹ️ Sin cambios — se mantiene el contrato tal cual estaba.");
    }
}

(async () => {
    try {
        await enriquecerContrato(POST_FILE, false);
        await enriquecerContrato(THREAD_FILE, true);
    } catch (err) {
        console.log(`⚠️ [BANDCAMP] Enriquecimiento omitido por error inesperado: ${err.message}`);
    }
})();