const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log("🤖 [ORQUESTADOR] Iniciando ciclo de revisión...");

    try {
        console.log("Step 1: Ejecutando extractor de Bluesky...");
        execSync('node 1_extraer_bluesky.js', { stdio: 'inherit', cwd: __dirname });

        const jsonPath = path.join(__dirname, 'post.json');
        
        // Comprobamos si el extractor ha generado un post para publicar
        if (!fs.existsSync(jsonPath)) {
            console.log("📭 No hay trabajo pendiente. Ciclo del orquestador finalizado.");
            process.exit(0);
        }

        console.log("Step 2: Ejecutando publicador en Substack...");
        execSync('node 2_publicar_substack.js', { stdio: 'inherit', cwd: __dirname });

        console.log("✅ Ciclo completado con éxito.");

    } catch (error) {
        console.error("❌ Error crítico en el orquestador:", error);
        process.exit(1);
    }
})();