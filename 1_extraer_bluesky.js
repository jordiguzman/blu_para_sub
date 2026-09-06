const { BskyAgent } = require('@atproto/api');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, exec } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const HISTORY_FILE = path.join(__dirname, 'history.json');
const POST_JSON_FILE = path.join(__dirname, 'post.json');
const SCRIPT_2_PATH = path.join(__dirname, '2_publicar_substack.js');
const SCRIPT_4_PATH = path.join(__dirname, '4_enriquecer_imagen_card.js');
const TEMP_MEDIA_DIR = path.join(__dirname, 'temp_media');

const downloadImageFromUrl = (url, destinationPath) => {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Status Code: ${response.statusCode}`));
            }
            const fileStream = fs.createWriteStream(destinationPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => { fileStream.close(); resolve(destinationPath); });
            fileStream.on('error', (err) => { fs.unlink(destinationPath, () => {}); reject(err); });
        }).on('error', reject);
    });
};

const runStandardPublisher = () => {
    return new Promise((resolve, reject) => {
        exec(`node "${SCRIPT_2_PATH}"`, (error, stdout, stderr) => {
            if (error) return reject(error);
            if (stderr) console.error(`⚠️ Avisos: ${stderr}`);
            console.log(stdout);
            resolve();
        });
    });
};

const runBandcampPublisher = () => {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT_4_PATH], { stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Script 4 finalizó con código ${code}`));
        });
        child.on('error', reject);
    });
};

(async () => {
    console.log("🚀 [EXTRACTOR BLUESKY] Conectando...");
    const agent = new BskyAgent({ service: 'https://bsky.social' });

    try {
        await agent.login({ identifier: process.env.BSKY_HANDLE, password: process.env.BSKY_APP_PASSWORD });
        
        const profile = await agent.getProfile({ actor: "juanmentat.bsky.social" });
        const feedRes = await agent.getAuthorFeed({ actor: profile.data.did, filter: 'posts_no_replies', limit: 10 });
        const ownPosts = feedRes.data.feed.filter(item => !item.reason && item.post.author.did === profile.data.did);

        if (!ownPosts.length) {
            console.log("✅ No hay posts.");
            process.exit(0);
        }

        let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) : [];
        if (history.length === 0) {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(ownPosts.map(p => ({ rkey: p.post.uri.split('/').pop(), uri: p.post.uri })), null, 2));
            console.log("🔒 Historial inicializado.");
            process.exit(0);
        }

        const publishedRkeys = new Set(history.map(h => h.rkey));
        const pending = ownPosts.filter(p => !publishedRkeys.has(p.post.uri.split('/').pop())).reverse();

        if (!pending.length) {
            console.log("✅ Todo al día.");
            process.exit(0);
        }

        for (const item of pending) {
            const rkey = item.post.uri.split('/').pop();
            const record = item.post.record;
            
            history.push({ rkey, uri: item.post.uri, createdAt: record.createdAt || new Date().toISOString() });
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');

            const postData = {
                uri: item.post.uri,
                text: record.text || "",
                hashtags: (record.text.match(/#[^\s#]+/g) || []).map(t => t.replace(/[\.,\/#!$%\^&\*;:{}=\-_`~()]$/, "")),
                mediaUrls: [],
                externalLink: null
            };

            if (record.embed?.$type === 'app.bsky.embed.external' && record.embed.external) {
                console.log("🔍 [INSPECCIÓN] Estructura completa del embed:", JSON.stringify(record.embed, null, 2));
                const ext = record.embed.external;
                console.log("🔍 INSPECCIÓN DE EMBED EXTERNAL:", JSON.stringify(ext, null, 2));
                const thumbRef = ext.thumb?.ref?.toString() || ext.thumb?.ref;
                const thumbUrl = thumbRef ? `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${profile.data.did}&cid=${thumbRef}` : null;
                postData.externalLink = { 
                    uri: ext.uri, 
                    title: ext.title, 
                    description: ext.description, 
                    thumbUrl 
                };

                if (thumbUrl) {
                    if (!fs.existsSync(TEMP_MEDIA_DIR)) fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
                    const localPath = path.join(TEMP_MEDIA_DIR, `bsky_ext_${rkey}.jpg`);
                    
                    try {
                        await downloadImageFromUrl(thumbUrl, localPath);
                        postData.mediaUrls = [localPath];
                        console.log(`🖼️ Imagen descargada correctamente: ${localPath}`);
                    } catch (e) {
                        console.warn(`⚠️ Aviso: No se pudo descargar la miniatura (${e.message}), continuando sin imagen...`);
                    }
                }
            }

            fs.writeFileSync(POST_JSON_FILE, JSON.stringify(postData, null, 2), 'utf-8');

            if (postData.externalLink?.uri?.includes('bandcamp.com')) {
                console.log("🎵 Ejecutando Script de Bandcamp (Script 4)...");
                await runBandcampPublisher();
            } else {
                console.log("📄 Ejecutando Script estándar...");
                await runStandardPublisher();
            }
        }

        console.log("🏁 Proceso completado.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Error crítico:", e);
        process.exit(1);
    }
})();