const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

(async () => {
    console.log("🚀 Iniciando navegador para Substack...");

    const browser = await puppeteer.launch({ 
        headless: false, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'] 
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    try {
        const connectSid = process.env.SUBSTACK_CONNECT_SID;
        if (!connectSid) {
            console.error("❌ Error: No se encuentra SUBSTACK_CONNECT_SID en el archivo .env");
            await browser.close();
            process.exit(1);
        }

        await page.setCookie({
            name: 'connect.sid',
            value: connectSid,
            domain: '.substack.com',
            path: '/',
            httpOnly: true,
            secure: true
        });

        console.log("🍪 Cookie inyectada. Abriendo Substack Notes...");
        await page.goto('https://substack.com/notes', { waitUntil: 'networkidle2' });

        if (page.url().includes('/sign-in')) {
            console.error("❌ Error: La sesión ha caducado o la cookie no es válida.");
            await browser.close();
            process.exit(1);
        }

        console.log("✅ ¡Acceso concedido! Esperando a que cargue la interfaz...");
        await new Promise(r => setTimeout(r, 4000));

        console.log("🔍 Buscando el botón 'Crear'...");

        const clickedCrear = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find(el => {
                const text = el.textContent ? el.textContent.trim().toLowerCase() : '';
                return text === 'crear' || text.startsWith('crear');
            });
            if (target) {
                target.click();
                return true;
            }
            return false;
        });

        if (!clickedCrear) {
            console.log("⚠️ No se encontró el botón 'Crear'.");
            await browser.close();
            process.exit(1);
        }

        console.log("🖱️ Botón 'Crear' pulsado. Esperando a ver qué aparece...");
        await new Promise(r => setTimeout(r, 1500));

        const screenshotPath1 = path.join(__dirname, 'debug_screenshot_crear.png');
        await page.screenshot({ path: screenshotPath1, fullPage: false });
        console.log(`📸 Captura tras pulsar 'Crear' guardada en: ${screenshotPath1}`);

        console.log("🔍 Buscando la caja '¿En qué estás pensando?'...");
        const clickedBox = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('div, span, button'));
            const target = elements.find(el => {
                const text = el.textContent ? el.textContent.trim() : '';
                return text === '¿En qué estás pensando?' || text.includes('¿En qué estás pensando?');
            });
            if (target) {
                target.click();
                return true;
            }
            return false;
        });

        if (!clickedBox) {
            console.log("⚠️ No se encontró la caja del composer tras pulsar Crear.");
            await browser.close();
            process.exit(1);
        }

        console.log("🖱️ Caja del composer pulsada. Escribiendo texto de prueba...");
        await new Promise(r => setTimeout(r, 1500));

        const textoPrueba = "Hola Substack. Automatización completada desde la caja superior. ¡Objetivo conseguido! 🚀";
        await page.keyboard.type(textoPrueba, { delay: 40 });
        console.log("✅ Texto escrito.");
        await new Promise(r => setTimeout(r, 2000));

        const screenshotPath2 = path.join(__dirname, 'debug_screenshot_composer.png');
        await page.screenshot({ path: screenshotPath2, fullPage: false });
        console.log(`📸 Captura del compositor expandido guardada en: ${screenshotPath2}`);
        console.log("⏸️ Deteniendo aquí a propósito para revisar la captura antes de buscar el botón de publicar.");

        await new Promise(r => setTimeout(r, 4000));
        await browser.close();
        process.exit(0);

    } catch (error) {
        console.error("❌ Error durante la automatización:", error);
    } finally {
        await browser.close();
        console.log("🔒 Navegador cerrado.");
    }
})();