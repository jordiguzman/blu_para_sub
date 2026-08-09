const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log("🔍 [ORQUESTADOR - MODO DIAGNÓSTICO] Iniciando prueba de extracción...");

    try {
        console.log("Step 1: Ejecutando extractor de Bluesky...");
        execSync('node 1_extraer_bluesky.js', { stdio: 'inherit', cwd: __dirname });

        const jsonPath = path.join(__dirname, 'post.json');
        
        if (!fs.existsSync(jsonPath)) {
            console.log("📭 El extractor no ha generado ningún post.json.");
            process.exit(0);
        }

        console.log("\n📦 Leyendo el post.json generado para validación:");
        const postData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        console.log(JSON.stringify(postData, null, 2));
        console.log("\n--------------------------------------------------");
        console.log("🛑 Diagnóstico finalizado. No se llama a Substack. ¿Coincide este JSON con el que funcionaba?");

    } catch (error) {
        console.error("❌ Error en el diagnóstico del orquestador:", error);
        process.exit(1);
    }
})();