const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

(async () => {
    console.log("🚀 [PUBLICADOR] Iniciando navegador...");

    const browser = await puppeteer.launch({ 
        headless: false, 
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
            {
                name: 'substack.sid',
                value: connectSid,
                domain: '.substack.com',
                path: '/',
                httpOnly: true,
                secure: true
            },
            {
                name: 'cf_clearance',
                value: cfClearance,
                domain: '.substack.com',
                path: '/',
                httpOnly: true,
                secure: true
            },
            {
                name: '__cf_bm',
                value: cfBm,
                domain: '.substack.com',
                path: '/',
                httpOnly: true,
                secure: true
            }
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

       console.log("✍️ Leyendo el texto de Bluesky desde el post.json...");
        const fs = require('fs');
        const jsonPath = path.join(__dirname, 'post.json');
        
        if (!fs.existsSync(jsonPath)) {
            console.error("❌ Error: No se encuentra el archivo post.json.");
            await browser.close();
            process.exit(1);
        }

        const postData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        
        // --- LIMPIEZA DE URLS PARA EVITAR TARJETAS EN SUBASTACK ---
        // Expresión regular para quitar URLs del texto y que no salte el auto-embed
        let textoLimpio = postData.text.replace(/https?:\/\/[^\s]+/g, '').trim();
        
        console.log("📝 Texto limpio (sin URLs automáticas):\n", textoLimpio);

        await page.evaluate((textToInsert) => {
            const activeElement = document.activeElement;
            if (activeElement) {
                document.execCommand('insertText', false, textToInsert);
            }
        }, textoLimpio);

        console.log("📝 ¡Texto inyectado con éxito!");

        await new Promise(r => setTimeout(r, 2000));

        // --- Buscamos el botón "Post" directamente por su texto exacto, en el
        // momento en que ya debería estar habilitado (tras escribir el texto) ---
        console.log("🔍 Buscando el botón 'Post' entre todos los botones de la página...");

        const postButtonInfo = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const candidatos = buttons.filter(el => el.textContent.trim() === 'Post');

            if (candidatos.length === 0) {
                const parecidos = buttons
                    .filter(el => el.textContent.toLowerCase().includes('post'))
                    .map(el => ({
                        texto: JSON.stringify(el.textContent.trim()),
                        clase: (el.className || '').toString().slice(0, 80),
                        ariaDisabled: el.getAttribute('aria-disabled'),
                        disabled: el.disabled,
                    }));
                return { found: false, parecidos };
            }

            const el = candidatos.find(b => b.offsetParent !== null) || candidatos[0];

            const isDisabled = el.disabled === true
                || el.getAttribute('aria-disabled') === 'true'
                || el.classList.contains('disabled');

            return {
                found: true,
                disabled: isDisabled,
                clase: (el.className || '').toString().slice(0, 80),
            };
        });

        console.log("ℹ️ Resultado de la búsqueda del botón 'Post':", postButtonInfo);

        if (!postButtonInfo.found) {
            console.log("⚠️ No se encontró ningún botón con texto exacto 'Post'. Revisa 'parecidos' arriba.");
            console.log("🛑 Dejando el navegador abierto 10 segundos para verificar el resultado.");
            await new Promise(r => setTimeout(r, 10000));
            await browser.close();
            return;
        }

        if (postButtonInfo.disabled) {
            console.log("⚠️ El botón 'Post' existe pero está deshabilitado. No se pulsará.");
            console.log("🛑 Dejando el navegador abierto 10 segundos para verificar el resultado.");
            await new Promise(r => setTimeout(r, 10000));
            await browser.close();
            return;
        }

        console.log("🖱️ Botón 'Post' localizado y habilitado. Haciendo clic...");

        const publishResponsePromise = page.waitForResponse(
            response => response.request().method() === 'POST'
                && (response.url().includes('comment') || response.url().includes('note') || response.url().includes('feed')),
            { timeout: 10000 }
        ).catch(() => null);

        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const el = buttons.find(b => b.textContent.trim() === 'Post');
            if (el) el.click();
        });

        const publishResponse = await publishResponsePromise;

        if (publishResponse) {
            const status = publishResponse.status();
            if (publishResponse.ok()) {
                console.log(`🎉 Confirmado por red: la nota se publicó correctamente (HTTP ${status}, ${publishResponse.url()})`);
            } else {
                console.log(`❌ La petición de publicación respondió con error (HTTP ${status}, ${publishResponse.url()}). NO se publicó.`);
            }
        } else {
            console.log("⚠️ No se detectó ninguna petición de publicación tras el clic. Revisa la ventana del navegador para confirmar visualmente.");
        }

        console.log("🛑 Dejando el navegador abierto 10 segundos para verificar el resultado.");
        await new Promise(r => setTimeout(r, 10000));

    } catch (error) {
        console.error("❌ Error durante la ejecución:", error);
    } finally {
        await browser.close();
    }
})();