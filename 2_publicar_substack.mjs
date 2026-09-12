import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, 'config', '.env') });

const HISTORY_FILE = path.join(__dirname, 'history.json');

(async () => {

    // ============================================================
    // SECCIÓN 1: COMPROBACIÓN INICIAL
    // Si no hay post.json, no hay nada que publicar. Se para aquí.
    // ============================================================
    const jsonPath = path.join(__dirname, 'post.json');
    if (!fs.existsSync(jsonPath)) {
        console.log("ℹ️ No se encuentra el archivo post.json. No hay nada pendiente de publicar.");
        process.exit(0);
    }

    console.log("🚀 [PUBLICADOR] Iniciando navegador...");

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {

        // ============================================================
        // SECCIÓN 2: LOGIN EN SUBSTACK (cookies de sesión)
        // ============================================================
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

        console.log("🍪 Cookies inyectadas (sin __cf_bm). Abriendo Substack Notes...");
        await page.goto('https://substack.com/notes', { waitUntil: 'networkidle2' });

        console.log("⏳ Esperando 5 segundos a que cargue la interfaz por completo...");
        await new Promise(r => setTimeout(r, 5000));

        // ============================================================
        // SECCIÓN 3: ABRIR EL EDITOR DE SUBSTACK
        // ============================================================
        console.log("🔍 Abriendo el editor...");
        const composerSelector = 'div.inlineComposer-v8PLSi';
        await page.waitForSelector(composerSelector, { visible: true, timeout: 8000 });
        await page.click(composerSelector);
        console.log("🖱️ ¡Editor abierto!");

        await new Promise(r => setTimeout(r, 1500));

        // ============================================================
        // SECCIÓN 4: LEER EL CONTRATO (post.json) Y DECIDIR QUÉ HACER
        // Aquí se decide: ¿tiene imágenes? ¿el enlace va suelto en el
        // texto o se separa para añadirlo al final?
        // ============================================================
        console.log("✍️ Leyendo post.json...");
        const postData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

        const tieneImagenes = postData.mediaUrls && postData.mediaUrls.length > 0;
        let textoFinal = postData.text.trim();
        let enlaceParaAlFinal = null;

        // Caso actual: posts de tipo "link" CON imagen -> se saca el enlace
        // del texto para añadirlo aparte, al final, después de subir la foto.
        if (tieneImagenes && postData.type === 'link' && postData.externalLink && postData.externalLink.uri) {
            enlaceParaAlFinal = postData.externalLink.uri;
            textoFinal = textoFinal.replace(enlaceParaAlFinal, '').trim();
        }

        // ============================================================
        // SECCIÓN 5: ESCRIBIR EL TEXTO EN EL EDITOR
        // ============================================================
        console.log("📝 Asegurando foco y escribiendo texto en el editor...");
        const editorHandle = await page.$('div.inlineComposer-v8PLSi [contenteditable="true"]');
        if (editorHandle) {
            await editorHandle.click();
        }
        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.type(textoFinal, { delay: 40 });
        await new Promise(r => setTimeout(r, 2000));

        // ============================================================
        // SECCIÓN 6: SUBIR IMÁGENES (si el post.json trae mediaUrls)
        // Esto es lo que ya usan las imágenes nativas (arte, APOD, etc.)
        // y sería lo que reutilizaría Bandcamp con portada grande.
        // ============================================================
        if (tieneImagenes) {
            const localImagePaths = postData.mediaUrls.filter(filePath => fs.existsSync(filePath));

            if (localImagePaths.length === 0) {
                console.error("❌ ERROR CRÍTICO: El post debía tener imágenes pero no se encuentran los ficheros locales.");
                await browser.close();
                return;
            }

            console.log(`📁 Usando ${localImagePaths.length} imágenes preparadas localmente.`);
            const inputsInfo = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                return inputs.map((el, i) => ({
                    index: i,
                    accept: el.getAttribute('accept'),
                    visible: el.offsetParent !== null,
                }));
            });

            if (inputsInfo.length > 0) {
                const targetIndex = inputsInfo.findIndex(i => i.accept && i.accept.includes('image'));
                const chosenIndex = targetIndex !== -1 ? targetIndex : 0;
                const fileInputHandles = await page.$$('input[type="file"]');
                const targetInput = fileInputHandles[chosenIndex];

                await targetInput.uploadFile(...localImagePaths);
                console.log(`📤 ${localImagePaths.length} archivos entregados al input.`);
                await new Promise(r => setTimeout(r, 8000));
            }
        }

        // ============================================================
        // SECCIÓN 7: AÑADIR EL ENLACE EXTERNO AL TEXTO (si corresponde)
        //
        // Aquí es EXACTAMENTE donde iría el cambio de Bandcamp+portada
        // grande, cuando lo hagamos. Ahora mismo hay dos casos (los dos
        // "if / else if" de abajo). El cambio futuro añadiría un TERCER
        // caso en medio de estos dos, sin tocarlos:
        //
        //   👉 PUNTO DE INSERCIÓN FUTURA (todavía no añadido) 👈
        //   "Si es Bandcamp Y tiene imagen (portada grande) -> añadir
        //    el enlace igualmente, para conservar la tarjeta pequeña
        //    de Substack A LA VEZ que la foto grande subida arriba."
        // ============================================================
        if (enlaceParaAlFinal) {
            // CASO A (ya existe): posts "link" con imagen -> el enlace
            // se escribe al final, después de la foto.
            console.log(`🔗 Añadiendo enlace externo al final: ${enlaceParaAlFinal}`);
            await page.keyboard.type('\n\n' + enlaceParaAlFinal, { delay: 40 });
            await new Promise(r => setTimeout(r, 4000));

        // <<< AQUÍ, entre este "if" y el "else if" de abajo, iría el nuevo
        //     bloque para "Bandcamp CON imagen" cuando lo añadamos >>>

        } else if (!tieneImagenes && (postData.type === 'bandcamp' || postData.type === 'link') && postData.externalLink && postData.externalLink.uri) {
            // CASO B (ya existe, es el que se usa siempre hoy para Bandcamp):
            // no hay imagen -> se añade el enlace suelto, y Substack genera
            // su tarjetita pequeña automática. Esto es lo que ves ahora
            // mismo en tus posts de Bandcamp.
            console.log(`🔗 Añadiendo enlace externo (${postData.type}): ${postData.externalLink.uri}`);
            await page.keyboard.type('\n\n' + postData.externalLink.uri, { delay: 40 });
            await new Promise(r => setTimeout(r, 4000));
        }

        // ============================================================
        // SECCIÓN 8: BUSCAR Y PULSAR EL BOTÓN "POST"
        // ============================================================
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
            console.log("⚠️ El botón 'Post' no está disponible o sigue deshabilitado.");
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

        // ============================================================
        // SECCIÓN 9: CONFIRMAR PUBLICACIÓN Y ACTUALIZAR HISTORY.JSON
        // ============================================================
        const publishResponse = await publishResponsePromise;
        if (publishResponse && publishResponse.ok()) {
            console.log(`🎉 Confirmado por red: la nota se publicó correctamente (HTTP ${publishResponse.status()})`);

            let history = [];
            if (fs.existsSync(HISTORY_FILE)) {
                try {
                    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                } catch (e) {
                    history = [];
                }
            }

            history.push({
                uri: postData.uri,
                status: 'SUCCESS',
                createdAt: postData.createdAt,
                timestamp: new Date().toISOString()
            });

            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
            console.log("✨ [HISTORIAL] Post registrado como SUCCESS en history.json");

            if (fs.existsSync(jsonPath)) {
                fs.unlinkSync(jsonPath);
            }
        } else {
            console.log("⚠️ No se pudo confirmar por red de forma estricta, revisa visualmente el navegador.");
        }

        console.log("🛑 Dejando el navegador abierto 10 segundos para verificar el resultado.");
        await new Promise(r => setTimeout(r, 10000));

    } catch (error) {
        console.error("❌ Error durante la ejecución:", error);
    } finally {
        // ============================================================
        // SECCIÓN 10: LIMPIEZA FINAL (pase lo que pase, éxito o error)
        // ============================================================
        await browser.close();
        try {
            const tempDir = path.join(__dirname, 'temp_media');
            if (fs.existsSync(tempDir)) {
                fs.readdirSync(tempDir).forEach(file => {
                    fs.unlinkSync(path.join(tempDir, file));
                });
                console.log("🧹 Carpeta temp_media limpiada correctamente.");
            }
        } catch (cleanErr) {
            console.error("⚠️ No se pudo limpiar la carpeta temp_media:", cleanErr.message);
        }
    }
})();