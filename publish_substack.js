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

        console.log("🔍 Buscando la caja superior '¿En qué estás pensando?'...");
        
        const clickedBox = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('div, span'));
            const target = elements.find(el => {
                const text = el.textContent ? el.textContent.trim() : '';
                return text.includes('¿En qué estás pensando?') || text.includes('What\'s on your mind?');
            });

            if (target) {
                target.click();
                return true;
            }

            const topBox = document.querySelector('.pudgy-input, [class*="input"], [class*="composer"]');
            if (topBox) {
                topBox.click();
                return true;
            }

            return false;
        });

        if (!clickedBox) {
            console.log("⚠️ No se pudo pulsar la caja superior.");
            await browser.close();
            process.exit(1);
        }

        console.log("🖱️ ¡Caja superior localizada y pulsada correctamente!");
        await new Promise(r => setTimeout(r, 2000));

        console.log("⌨️ Escribiendo el texto de la nota...");
        const textoPrueba = "Hola Substack. Automatización completada desde la caja superior. ¡Objetivo conseguido! 🚀";
        
        await page.keyboard.type(textoPrueba, { delay: 40 });
        console.log("✅ Texto escrito correctamente.");

        // Damos un respiro para que el botón de publicar se active tras detectar texto
        console.log("⏳ Esperando a que el botón de publicar se active...");
        await new Promise(r => setTimeout(r, 3000));

        console.log("📤 Buscando y pulsando el botón de publicar...");
        
        const published = await page.evaluate(() => {
            // Buscamos botones o elementos interactivos que cumplan con la acción de postear
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const postBtn = buttons.find(el => {
                const text = el.textContent ? el.textContent.trim().toLowerCase() : '';
                const aria = el.getAttribute('aria-label') ? el.getAttribute('aria-label').toLowerCase() : '';
                return text === 'post' || text === 'publish' || text === 'publicar' || aria.includes('post') || aria.includes('publish');
            });

            if (postBtn && !postBtn.disabled) {
                postBtn.click();
                return true;
            }
            return false;
        });

        if (published) {
            console.log("🎉 ¡Nota enviada y publicada con éxito automáticamente!");
        } else {
            console.log("⚠️ El botón de publicar seguía deshabilitado o no se encontró.");
        }

        await new Promise(r => setTimeout(r, 5000));

    } catch (error) {
        console.error("❌ Error durante la automatización:", error);
    } finally {
        await browser.close();
        console.log("🔒 Navegador cerrado.");
    }
})();