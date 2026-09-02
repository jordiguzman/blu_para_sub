const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const THREAD_JSON_FILE = path.join(__dirname, 'thread.json');
const COOKIES_PATH = path.join(__dirname, 'config', 'cookies.json');
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

    console.log(`🎯 Se procesarán ${threadPosts.length} eslabones del hilo de forma independiente.`);

    for (let i = 0; i < threadPosts.length; i++) {
        const postData = threadPosts[i];
        console.log(`\n--- Publicando eslabón [${i + 1} de ${threadPosts.length}] rkey: ${postData.rkey} ---`);

        let browser;
        try {
            browser = await puppeteer.launch({
                executablePath: CHROME_PATH,
                headless: false,
                defaultViewport: null,
                args: ['--start-maximized']
            });

            const page = await browser.newPage();

            if (fs.existsSync(COOKIES_PATH)) {
                const cookiesString = fs.readFileSync(COOKIES_PATH, 'utf8');
                const cookies = JSON.parse(cookiesString);
                await page.setCookie(...cookies);
            }

            console.log("🌐 Navegando a Substack Notes...");
            await page.goto('https://substack.com/notes', { waitUntil: 'networkidle2' });
            await sleep(5000);

            console.log("✍️ Buscando el campo de texto...");
            const editorSelector = 'div[contenteditable="true"]';
            await page.waitForSelector(editorSelector, { timeout: 15000 });
            
            const editor = await page.$(editorSelector);
            
            if (!editor) {
                throw new Error("No se encontró el editor editable en Substack.");
            }

            await editor.click();
            await sleep(1000);

            let finalText = postData.text;
            if (postData.hashtags && postData.hashtags.length > 0) {
                const tagsString = postData.hashtags.join(' ');
                finalText = `${finalText}\n\n${tagsString}`;
            }

            console.log("⌨️ Escribiendo contenido...");
            await page.keyboard.type(finalText, { delay: 20 });
            await sleep(2000);

            if (postData.hasMedia && postData.mediaUrls && postData.mediaUrls.length > 0) {
                console.log(`🖼️ Adjuntando ${postData.mediaUrls.length} imagen(es)...`);
                const fileInput = await page.$('input[type="file"]');
                if (fileInput) {
                    await fileInput.uploadFile(...postData.mediaUrls);
                    console.log("⏳ Esperando a que las imágenes se procesen...");
                    await sleep(8000);
                } else {
                    console.warn("⚠️ No se encontró el input de ficheros para adjuntar la imagen.");
                }
            }

            console.log("🚀 Publicando nota...");
            const publishButtonSelector = 'button.primary.button';
            await page.waitForSelector(publishButtonSelector, { timeout: 10000 });
            
            const publishButton = await page.$(publishButtonSelector);
            if (publishButton) {
                await publishButton.click();
                console.log("✅ Eslabón publicado con éxito.");
                await sleep(5000);
            } else {
                throw new Error("No se pudo localizar el botón de publicación.");
            }

            await browser.close();

        } catch (error) {
            console.error(`❌ Error publicando el eslabón [${i + 1}]: ${error.message}`);
            if (browser) {
                await browser.close().catch(() => {});
            }
            throw error; 
        }

        if (i < threadPosts.length - 1) {
            console.log("⏳ Esperando 60 segundos antes de publicar el siguiente eslabón del hilo...");
            await sleep(60000);
        }
    }

    console.log("\n🎉 ¡Todos los eslabones del hilo han sido publicados correctamente!");
    process.exit(0);
})();