// setup_login.mjs — EJECUTAR UNA SOLA VEZ, EN LOCAL, PARA CREAR EL PERFIL AUTENTICADO
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
    const browser = await puppeteer.launch({
        headless: false, // con ventana visible, para que puedas loguearte tú
        userDataDir: path.join(__dirname, 'chrome_profile'),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.goto('https://substack.com/sign-in', { waitUntil: 'networkidle2' });

    console.log("👉 Loguéate manualmente en la ventana que se ha abierto.");
    console.log("👉 Cuando veas tu feed de Substack Notes normal, cierra esta ventana o espera.");
    console.log("⏳ Tienes 3 minutos.");

    await new Promise(r => setTimeout(r, 180000)); // 3 minutos para loguearte con calma
    await browser.close();

    console.log("✅ Perfil guardado en la carpeta 'chrome_profile'. Ya puedes subirla al servidor.");
})();