const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const THREAD_JSON_FILE = path.join(__dirname, 'thread.json');
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [PUBLICADOR DE HILOS] Iniciando proceso secuencial...");

    if (!fs.existsSync(THREAD_JSON_FILE)) {
        console.error("❌ No se encontró el archivo thread.json.");
        process.exit(1);
    }

    let threadPosts = [];
    try {
        threadPosts = JSON.parse(fs.readFileSync(THREAD_JSON_FILE, 'utf-8'));
    } catch (err) {
        console.error("❌ Error al leer thread.json:", err.message);
        process.exit(1);
    }

    if (!threadPosts || threadPosts.length === 0) {
        console.log("📭 El archivo thread.json está vacío.");
        process.exit(0);
    }

    console.log(`🎯 Se procesarán ${threadPosts.length} eslabones del hilo secuencialmente.`);

    for (let i = 0; i < threadPosts.length; i++) {
        const postData = threadPosts[i];
        console.log(`\n--- Publicando eslabón [${i + 1} de ${threadPosts.length}] rkey: ${postData.rkey} ---`);

        let browser;
        try {
            browser = await puppeteer.launch({
                executablePath: CHROME_PATH,
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });

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

            console.log("🔍 Abriendo el editor...");
            const composerSelector = 'div.inlineComposer-v8PLSi';
            await page.waitForSelector(composerSelector, { visible: true, timeout: 5000 });
            await page.click(composerSelector);
            console.log("🖱️ ¡Editor abierto!");
            await sleep(1500);

            let finalText = postData.text.trim();
            if (postData.hashtags && postData.hashtags.length > 0) {
                const tagsString = postData.hashtags.join(' ');
                finalText = `${finalText}\n\n${tagsString}`;
            }

            console.log("📝 Asegurando foco y escribiendo texto en el editor...");
            const editorHandle = await page.$('div.inlineComposer-v8PLSi [contenteditable="true"]');
            if (editorHandle) {
                await editorHandle.click();
            }
            await sleep(1000);
            await page.keyboard.type(finalText, { delay: 40 });
            await sleep(2000);

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
                throw new Error("El botón 'Post' no está disponible o sigue deshabilitado.");
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
                console.log(`🎉 Confirmado por red: el eslabón se publicó correctamente (HTTP ${publishResponse.status()})`);
            } else {
                console.log("⚠️ No se pudo confirmar por red, pero el clic fue realizado.");
            }

            await sleep(5000);
            await browser.close();

        } catch (error) {
            console.error(`❌ Error publicando el eslabón [${i + 1}]: ${error.message}`);
            if (browser) {
                await browser.close().catch(() => {});
            }
            throw error;
        }

        if (i < threadPosts.length - 1) {
            console.log("⏳ Esperando 2 minutos antes de publicar el siguiente eslabón del hilo...");
            await sleep(120000);
        }
    }

    console.log("\n🎉 ¡Todos los eslabones del hilo han sido publicados correctamente!");
    process.exit(0);
})();