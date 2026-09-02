const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

(async () => {
    console.log("🚀 [PUBLICADOR] Iniciando navegador...");

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

        console.log("⏳ Esperando 5 segundos a que cargue la interfaz por completo...");
        await new Promise(r => setTimeout(r, 5000));

        console.log("🔍 Abriendo el editor...");
        const composerSelector = 'div.inlineComposer-v8PLSi';
        await page.waitForSelector(composerSelector, { visible: true, timeout: 5000 });
        await page.click(composerSelector);
        console.log("🖱️ ¡Editor abierto!");

        await new Promise(r => setTimeout(r, 1500));

        console.log("✍️ Leyendo post.json...");
        const jsonPath = path.join(__dirname, 'post.json');
        if (!fs.existsSync(jsonPath)) {
            console.error("❌ Error: No se encuentra el archivo post.json.");
            await browser.close();
            process.exit(1);
        }
        const postData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

        // --- LÓGICA DE PRIORIZACIÓN DE IMÁGENES VS CARDS ---
        const tieneImagenes = postData.hasMedia && postData.mediaUrls && postData.mediaUrls.length > 0;
        
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

        // --- GESTIÓN DE IMÁGENES LOCALES YA DESCARGADAS ---
        if (tieneImagenes) {
            const localImagePaths = postData.mediaUrls.filter(filePath => fs.existsSync(filePath));

            if (localImagePaths.length === 0) {
                console.error("❌ ERROR CRÍTICO: El post debía tener imágenes pero no se encuentran los ficheros locales en el servidor.");
                await browser.close();
                return;
            }

            console.log(`📁 Usando ${localImagePaths.length} imágenes preparadas localmente.`);

            console.log("🔍 Buscando el input de subida de archivo dentro del editor...");
            const inputsInfo = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                return inputs.map((el, i) => ({
                    index: i,
                    accept: el.getAttribute('accept'),
                    visible: el.offsetParent !== null,
                }));
            });

            if (inputsInfo.length === 0) {
                console.log("⚠️ No se encontró ningún input de tipo file en la página.");
            } else {
                const targetIndex = inputsInfo.findIndex(i => i.accept && i.accept.includes('image'));
                const chosenIndex = targetIndex !== -1 ? targetIndex : 0;
                console.log(`🎯 Usando el input número ${chosenIndex}`);

                const fileInputHandles = await page.$$('input[type="file"]');
                const targetInput = fileInputHandles[chosenIndex];

                await targetInput.uploadFile(...localImagePaths);
                console.log(`📤 ${localImagePaths.length} archivos entregados al input simultáneamente.`);

                console.log("⏳ Esperando a que Substack procese y suba las imágenes...");
                await new Promise(r => setTimeout(r, 8000));
            }

            const screenshotPath = path.join(__dirname, 'debug_imagenes_subidas.png');
            await page.screenshot({ path: screenshotPath, fullPage: false });
            console.log(`📸 Captura guardada en: ${screenshotPath}`);
        } else {
            console.log("ℹ️ Este post no tiene imágenes adjuntas.");
        }

        // --- ENLACE EXTERNO ---
        if (enlaceParaAlFinal) {
            console.log(`🔗 Añadiendo enlace externo al final: ${enlaceParaAlFinal}`);
            await page.keyboard.type('\n\n' + enlaceParaAlFinal, { delay: 40 });
            await new Promise(r => setTimeout(r, 4000));
        } else if (!tieneImagenes && postData.mediaType === 'app.bsky.embed.external' && postData.externalLink && postData.externalLink.uri) {
            console.log(`🔗 Añadiendo enlace externo (Bandcamp): ${postData.externalLink.uri}`);
            await page.keyboard.type('\n\n' + postData.externalLink.uri, { delay: 40 });
            await new Promise(r => setTimeout(r, 4000));
        }

        console.log("🔍 Buscando el botón 'Post'...");
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
            console.log("⚠️ El botón 'Post' no está disponible o sigue deshabilitado (las imágenes pueden seguir procesándose).");
            console.log("🛑 Dejando el navegador abierto 10 segundos para revisar.");
            await new Promise(r => setTimeout(r, 10000));
            await browser.close();
            return;
        }

        console.log("🖱️ Botón 'Post' localizado y habilitado. Haciendo clic...");

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
            console.log(`🎉 Confirmado por red: la nota se publicó correctamente (HTTP ${publishResponse.status()})`);
        } else {
            console.log("⚠️ No se pudo confirmar por red, revisa visualmente el navegador.");
        }

        console.log("🛑 Dejando el navegador abierto 10 segundos para verificar el resultado.");
        await new Promise(r => setTimeout(r, 10000));

    } catch (error) {
        console.error("❌ Error durante la ejecución:", error);
    } finally {
        await browser.close();
    }
})();