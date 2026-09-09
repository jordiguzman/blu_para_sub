const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HISTORY_FILE = path.join(__dirname, 'history.json');
const PROFILE_DIR = path.join(__dirname, 'chrome_profile'); // NUEVO: mismo perfil que usa 2_publicar_substack.mjs

function marcarComoExitoso(uri, createdAt) {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        } catch (e) {
            history = [];
        }
    }
    history.push({
        uri,
        status: 'SUCCESS',
        createdAt,
        timestamp: new Date().toISOString()
    });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

(async () => {
    console.log("🧵 [PUBLICADOR DE HILOS] Iniciando navegador...");

    const threadJsonPath = path.join(__dirname, 'thread.json');
    if (!fs.existsSync(threadJsonPath)) {
        console.error("❌ Error: No se encuentra el archivo thread.json.");
        process.exit(1);
    }

    const threadPosts = JSON.parse(fs.readFileSync(threadJsonPath, 'utf-8'));
    if (!threadPosts || threadPosts.length === 0) {
        console.error("❌ Error: El archivo thread.json está vacío.");
        process.exit(1);
    }

    console.log(`📋 Se han encontrado ${threadPosts.length} eslabones para publicar en hilo.`);

    const browser = await puppeteer.launch({
        headless: 'new',
        userDataDir: PROFILE_DIR, // NUEVO: reutiliza sesión guardada, sin cookies sueltas
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    let todosPublicadosOk = true;

    try {
        console.log("🔐 Reutilizando sesión guardada. Abriendo Substack Notes...");
        await page.goto('https://substack.com/notes', { waitUntil: 'networkidle2' });
        await sleep(5000);

        for (let i = 0; i < threadPosts.length; i++) {
            const postData = threadPosts[i];
            console.log(`\n--- Publicando eslabón [${i + 1} de ${threadPosts.length}] (rkey: ${postData.rkey}) ---`);

            console.log("🔍 Abriendo el editor...");
            const composerSelector = 'div.inlineComposer-v8PLSi';

            // NUEVO: si esto falla, la sesión guardada probablemente ya no vale
            try {
                await page.waitForSelector(composerSelector, { visible: true, timeout: 8000 });
            } catch (e) {
                console.error("❌ No se encontró el editor. Probablemente la sesión guardada ha caducado o Substack pide verificación.");
                console.error("   Vuelve a ejecutar setup_login.mjs en local y sube 'chrome_profile' actualizada al servidor.");
                todosPublicadosOk = false;
                break; // NUEVO: cortamos el hilo aquí, no seguimos intentando eslabones a ciegas
            }

            await page.click(composerSelector);
            await sleep(1500);

            let tieneImagenes = postData.hasMedia && postData.mediaUrls && postData.mediaUrls.length > 0;
            let textoFinal = postData.text.trim();
            let enlaceParaAlFinal = null;

            if (tieneImagenes && postData.mediaType === 'app.bsky.embed.external' && postData.externalLink && postData.externalLink.uri) {
                enlaceParaAlFinal = postData.externalLink.uri;
                textoFinal = textoFinal.replace(enlaceParaAlFinal, '').trim();
            }

            console.log("📝 Escribiendo texto en el editor de forma limpia...");
            await page.click(composerSelector);
            await new Promise(r => setTimeout(r, 500));

            await page.evaluate((texto) => {
                const activeEl = document.activeElement;
                if (activeEl) {
                    if (activeEl.isContentEditable) {
                        activeEl.textContent = texto;
                    } else if (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') {
                        activeEl.value = texto;
                    }
                    activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                    activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, textoFinal);

            await new Promise(r => setTimeout(r, 1500));

            if (tieneImagenes) {
                const localImagePaths = postData.mediaUrls.filter(filePath => fs.existsSync(filePath));

                if (localImagePaths.length > 0) {
                    console.log(`📁 Subiendo ${localImagePaths.length} imágenes para este eslabón...`);
                    const fileInputHandles = await page.$$('input[type="file"]');
                    if (fileInputHandles.length > 0) {
                        const targetInput = fileInputHandles[fileInputHandles.length - 1];
                        await targetInput.uploadFile(...localImagePaths);
                        await sleep(8000);
                    }
                }
            }

            if (enlaceParaAlFinal) {
                console.log(`🔗 Añadiendo enlace externo: ${enlaceParaAlFinal}`);
                await page.keyboard.type('\n\n' + enlaceParaAlFinal, { delay: 40 });
                await sleep(3000);
            } else if (!tieneImagenes && postData.mediaType === 'app.bsky.embed.external' && postData.externalLink && postData.externalLink.uri) {
                console.log(`🔗 Añadiendo enlace externo: ${postData.externalLink.uri}`);
                await page.keyboard.type('\n\n' + postData.externalLink.uri, { delay: 40 });
                await sleep(3000);
            }

            console.log("🖱️ Buscando botón 'Post' para este eslabón...");
            const publishResponsePromise = page.waitForResponse(
                response => response.request().method() === 'POST'
                    && (response.url().includes('comment') || response.url().includes('note') || response.url().includes('feed')),
                { timeout: 15000 }
            ).catch(() => null);

            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const el = buttons.find(b => b.textContent.trim() === 'Post');
                if (el) el.click();
            });

            const publishResponse = await publishResponsePromise;
            if (publishResponse && publishResponse.ok()) {
                console.log(`🎉 Eslabón ${i + 1} publicado correctamente.`);
                marcarComoExitoso(postData.uri, postData.createdAt);
            } else {
                console.log(`⚠️ Eslabón ${i + 1} enviado, revisa visualmente.`);
                todosPublicadosOk = false;
            }

            if (i < threadPosts.length - 1) {
                console.log("⏳ Esperando 5 segundos antes de publicar el siguiente eslabón del hilo...");
                await sleep(5000);
            }
        }

        if (todosPublicadosOk) {
            console.log("\n🏁 ¡Hilo completo publicado con éxito en Substack!");
            const threadJsonPath = path.join(__dirname, 'thread.json');
            if (fs.existsSync(threadJsonPath)) fs.unlinkSync(threadJsonPath);
        } else {
            console.log("\n⚠️ El hilo no se completó del todo. thread.json se conserva para revisar antes de reintentar."); // NUEVO
        }

        await sleep(5000);

    } catch (error) {
        console.error("❌ Error durante la publicación del hilo:", error);
    } finally {
        await browser.close();
    }
})();