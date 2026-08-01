const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

// Descarga una URL a un archivo local, devuelve una Promise
function descargarImagen(url, destino) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destino);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Descarga falló con status ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (err) => {
            fs.unlink(destino, () => {});
            reject(err);
        });
    });
}

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

        // Solo quitamos URLs del cuerpo del texto cuando es un enlace externo
        // (tipo Bandcamp), porque en ese caso la añadimos aparte más abajo.
        // En cualquier otro caso, conservamos el texto tal cual -incluidas sus
        // URLs- para no perder enlaces que el propio Bluesky ya detectó dentro
        // del texto original.
        const esEnlaceExterno = postData.mediaType === 'app.bsky.embed.external';
        const textoCompleto = esEnlaceExterno
            ? postData.text.replace(/https?:\/\/[^\s]+/g, '').trim()
            : postData.text.trim();

        console.log("📝 Texto a escribir:\n", textoCompleto);
        await page.keyboard.type(textoCompleto, { delay: 40 });
        await new Promise(r => setTimeout(r, 2000));

        // --- ENLACE EXTERNO (Bandcamp, etc.): la URL no vive en el texto visible
        // del post original, solo en externalLink. Hay que teclearla para que el
        // editor de Substack la reconozca y genere la tarjeta automáticamente. ---
        if (postData.mediaType === 'app.bsky.embed.external' && postData.externalLink && postData.externalLink.uri) {
            console.log(`🔗 Añadiendo enlace externo: ${postData.externalLink.uri}`);
            await page.keyboard.type('\n\n' + postData.externalLink.uri, { delay: 40 });

            console.log("⏳ Esperando a que el editor genere la tarjeta de vista previa...");
            await new Promise(r => setTimeout(r, 4000));

            const screenshotPathLink = path.join(__dirname, 'debug_enlace_externo.png');
            await page.screenshot({ path: screenshotPathLink, fullPage: false });
            console.log(`📸 Captura tras añadir el enlace guardada en: ${screenshotPathLink}`);
        }

        // --- IMAGEN: si el post tiene mediaUrls, la descargamos y la subimos ---
        if (postData.hasMedia && postData.mediaUrls && postData.mediaUrls.length > 0) {
            const imageUrl = postData.mediaUrls[0];
            const tempDir = path.join(__dirname, 'temp_media');
            const imagePath = path.join(tempDir, 'imagen_temp.jpg');

            console.log(`⬇️ Descargando imagen desde: ${imageUrl}`);
            await descargarImagen(imageUrl, imagePath);
            console.log(`✅ Imagen descargada en: ${imagePath}`);

            console.log("🔍 Buscando el input de subida de archivo dentro del editor...");

            // Diagnóstico: listamos TODOS los inputs de tipo file de la página,
            // por si hay más de uno y hay que elegir el correcto.
            const inputsInfo = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                return inputs.map((el, i) => ({
                    index: i,
                    accept: el.getAttribute('accept'),
                    visible: el.offsetParent !== null,
                    clase: (el.className || '').toString().slice(0, 80),
                }));
            });
            console.log("ℹ️ Inputs de archivo encontrados:", inputsInfo);

            if (inputsInfo.length === 0) {
                console.log("⚠️ No se encontró ningún input de tipo file en la página. Puede que haga falta pulsar antes un icono de 'adjuntar imagen'.");
                console.log("🛑 Dejando el navegador abierto 10 segundos para revisar visualmente.");
                await new Promise(r => setTimeout(r, 10000));
                await browser.close();
                return;
            }

            // Nos quedamos con el primero que acepte imágenes, o el primero a secas.
            const targetIndex = inputsInfo.findIndex(i => i.accept && i.accept.includes('image'));
            const chosenIndex = targetIndex !== -1 ? targetIndex : 0;
            console.log(`🎯 Usando el input número ${chosenIndex} (accept="${inputsInfo[chosenIndex].accept}")`);

            const fileInputHandle = await page.$$('input[type="file"]');
            await fileInputHandle[chosenIndex].uploadFile(imagePath);
            console.log("📤 Archivo entregado al input. Esperando a que se procese...");

            // Esperamos a que aparezca en el DOM un <img> nuevo dentro del compositor,
            // como señal de que la subida terminó y se insertó en el documento.
            await new Promise(r => setTimeout(r, 5000));

            const screenshotPath = path.join(__dirname, 'debug_imagen_subida.png');
            await page.screenshot({ path: screenshotPath, fullPage: false });
            console.log(`📸 Captura tras subir la imagen guardada en: ${screenshotPath}`);
        } else {
            console.log("ℹ️ Este post no tiene imagen, se publica solo texto.");
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

        console.log("ℹ️ Resultado búsqueda botón 'Post':", postButtonInfo);

        if (!postButtonInfo.found || postButtonInfo.disabled) {
            console.log("⚠️ El botón 'Post' no está disponible o sigue deshabilitado (¿la imagen aún se está procesando?).");
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
