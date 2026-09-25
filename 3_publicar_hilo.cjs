const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HISTORY_FILE = path.join(__dirname, 'history.json');

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

    let threadPosts = JSON.parse(fs.readFileSync(threadJsonPath, 'utf-8'));
    if (!threadPosts || threadPosts.length === 0) {
        console.error("❌ Error: El archivo thread.json está vacío.");
        process.exit(1);
    }

    // Invertimos el orden para publicar primero el último eslabón y terminar por el primero
    threadPosts = threadPosts.reverse();

    console.log(`📋 Se han encontrado ${threadPosts.length} eslabones para publicar en hilo (orden invertido para correcta jerarquía).`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    let todosPublicadosOk = true;

    try {
        const connectSid = process.env.SUBSTACK_CONNECT_SID;
        const cfClearance = process.env.SUBSTACK_CF_CLEARANCE;

        if (!connectSid || !cfClearance) {
            console.error("❌ Error: Faltan variables en el .env (SUBSTACK_CONNECT_SID, SUBSTACK_CF_CLEARANCE)");
            await browser.close();
            process.exit(1);
        }

        await page.setCookie(
            { name: 'substack.sid', value: connectSid, domain: '.substack.com', path: '/', httpOnly: true, secure: true },
            { name: 'cf_clearance', value: cfClearance, domain: '.substack.com', path: '/', httpOnly: true, secure: true }
        );

        console.log("🍪 Cookies inyectadas. Abriendo Substack Notes...");
        // Cambiamos a 'domcontentloaded' para que no espere a que terminen todas las peticiones secundarias de red
        await page.goto('https://substack.com/notes', { waitUntil: 'domcontentloaded' });
        
        // Reducimos la espera estática inicial de 5s a 2s, ya que el editor se busca mediante waitForSelector de todos modos
        await sleep(2000);

        for (let i = 0; i < threadPosts.length; i++) {
            const postData = threadPosts[i];
            console.log(`\n--- Publicando eslabón [${i + 1} de ${threadPosts.length}] (rkey: ${postData.rkey}) ---`);

            console.log("🔍 Abriendo el editor...");
            const composerSelector = 'div.inlineComposer-v8PLSi';

            try {
                await page.waitForSelector(composerSelector, { visible: true, timeout: 8000 });
            } catch (e) {
                console.error("❌ No se encontró el editor. Revisa si las cookies siguen siendo válidas.");
                todosPublicadosOk = false;
                break;
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

            console.log("📝 Escribiendo texto en el editor...");
            const editorHandle = await page.$('div.inlineComposer-v8PLSi [contenteditable="true"]');
            if (editorHandle) {
                await editorHandle.click();
            }
            await sleep(1000);
            await page.keyboard.type(textoFinal, { delay: 40 });
            await sleep(2000);

            if (tieneImagenes) {
                const localImagePaths = postData.mediaUrls.filter(filePath => fs.existsSync(filePath));

                if (localImagePaths.length > 0) {
                    console.log(`📁 Subiendo ${localImagePaths.length} imágenes para este eslabón...`);
                    try {
                        const fileInput = await page.$('input[type="file"]');                         if (fileInput) {                             await fileInput.uploadFile(...localImagePaths);                             console.log("⏳ Imagen adjuntada, esperando procesamiento en Substack...");                             await sleep(7000);                         } else {                             const fileInputHandles = await page.$$('input[type="file"]');
                            if (fileInputHandles.length > 0) {
                                await fileInputHandles[fileInputHandles.length - 1].uploadFile(...localImagePaths);
                                await sleep(7000);
                            }
                        }
                    } catch (err) {
                        console.log("⚠️ Error no crítico en la subida de imagen:", err.message);
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

            const postButtonInfo = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const candidatos = buttons.filter(el => el.textContent.trim() === 'Post');
                if (candidatos.length === 0) return { found: false };
                const el = candidatos.find(b => b.offsetParent !== null) || candidatos[0];
                const isDisabled = el.disabled === true
                    || el.getAttribute('aria-disabled') === 'true'
                    || el.classList.contains('disabled');
                return { found: true, disabled: isDisabled };
            });

            if (!postButtonInfo.found || postButtonInfo.disabled) {
                console.log(`⚠️ El botón 'Post' no está disponible para el eslabón ${i + 1}. Abortando el hilo.`);
                todosPublicadosOk = false;
                break;
            }

            console.log("🖱️ Pulsando el botón 'Post' para este eslabón...");
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
                marcarComoExitoso(postData.uri, postData.createdAt);
            }

            if (i < threadPosts.length - 1) {
                console.log("⏳ Esperando 6 segundos para estabilizar la interfaz antes del siguiente eslabón...");
                await sleep(6000);
            }
        }

        if (todosPublicadosOk) {
            console.log("\n🏁 ¡Hilo completo publicado con éxito en Substack!");
            if (fs.existsSync(threadJsonPath)) fs.unlinkSync(threadJsonPath);
        } else {
            console.log("\n⚠️ El hilo no se completó del todo. thread.json se conserva para revisar.");
        }

        await sleep(5000);

    } catch (error) {
        console.error("❌ Error durante la publicación del hilo:", error);
    } finally {
        await browser.close();
    }
})();