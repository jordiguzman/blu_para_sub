const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        const connectSid = process.env.SUBSTACK_CONNECT_SID;
        const cfClearance = process.env.SUBSTACK_CF_CLEARANCE;
        const cfBm = process.env.SUBSTACK_CF_BM;

        if (!connectSid || !cfClearance || !cfBm) {
            console.error("❌ Error: Faltan variables en el .env (SUBSTACK_CONNECT_SID, SUBSTACK_CF_CLEARANCE, SUBSTACK_CF_BM)");
            await browser.close();
            process.exit(1);
        }

        await page.setCookie(
            { name: 'substack.sid', value: connectSid, domain: '.substack.com', path: '/', httpOnly: true, secure: true },
            { name: 'cf_clearance', value: cfClearance, domain: '.substack.com', path: '/', httpOnly: true, secure: true },
            { name: '__cf_bm', value: cfBm, domain: '.substack.com', path: '/', httpOnly: true, secure: true }
        );

        console.log("🍪 Cookies inyectadas. Abriendo Substack Notes...");
        await page.goto('https://substack.com/notes', { waitUntil: 'networkidle2' });
        await sleep(5000);

        for (let i = 0; i < threadPosts.length; i++) {
            const postData = threadPosts[i];
            console.log(`\n--- Publicando eslabón [${i + 1} de ${threadPosts.length}] (rkey: ${postData.rkey}) ---`);

            console.log("🔍 Abriendo el editor...");
            const composerSelector = 'div.inlineComposer-v8PLSi';
            await page.waitForSelector(composerSelector, { visible: true, timeout: 5000 });
            await page.click(composerSelector);
            await sleep(1500);

            // Si es una respuesta dentro del hilo, podemos simular la réplica o encadenado si la interfaz lo permite,
            // o publicar secuencialmente asegurando el texto y los enlaces correspondientes.
            let tieneImagenes = postData.hasMedia && postData.mediaUrls && postData.mediaUrls.length > 0;
            let textoFinal = postData.text.trim();
            let enlaceParaAlFinal = null;

            if (tieneImagenes && postData.mediaType === 'app.bsky.embed.external' && postData.externalLink && postData.externalLink.uri) {
                enlaceParaAlFinal = postData.externalLink.uri;
                textoFinal = textoFinal.replace(enlaceParaAlFinal, '').trim();
            }

            console.log("📝 Escribiendo texto en el editor de forma limpia...");
// Hacemos clic asegurando el foco
await page.click(composerSelector);
await new Promise(r => setTimeout(r, 500));

// Inyectamos el texto completo de golpe simulando pegado o asignación de valor al elemento activo,
// evitando por completo el desfase de pulsaciones de teclado que se come las primeras letras.
await page.evaluate((texto) => {
    const activeEl = document.activeElement;
    if (activeEl) {
        // Si es un div editable (contenteditable) de Substack
        if (activeEl.isContentEditable) {
            activeEl.textContent = texto;
        } else if (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') {
            activeEl.value = texto;
        }
        // Disparamos eventos de input para que Substack detecte el cambio de estado y active el botón Post
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
            } else {
                console.log(`⚠️ Eslabón ${i + 1} enviado, revisa visualmente.`);
            }

            // Pausa entre eslabones del hilo para evitar bloqueos por rate-limit
            if (i < threadPosts.length - 1) {
                console.log("⏳ Esperando 5 segundos antes de publicar el siguiente eslabón del hilo...");
                await sleep(5000);
            }
        }

        console.log("\n🏁 ¡Hilo completo publicado con éxito en Substack!");
        await sleep(5000);

    } catch (error) {
        console.error("❌ Error durante la publicación del hilo:", error);
    } finally {
        await browser.close();
    }
})();