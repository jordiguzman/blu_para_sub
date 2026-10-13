<?php
/**
 * Script para publicar en Substack (como Note) los posts nuevos de Bluesky.
 *
 * Ubicación esperada: D:\PHP\Scripts en Hosting\blu_para_sub\publish_to_substack.php
 * Configuración esperada: D:\PHP\Scripts en Hosting\config\.env
 *
 * Variables nuevas que hay que añadir al .env existente:
 *   SUBSTACK_CONNECT_SID=valor_de_la_cookie_connect.sid
 *
 * ⚠️ IMPORTANTE — API no oficial:
 * Substack no publica una API oficial. Este script usa el mismo endpoint interno
 * que utiliza el propio navegador cuando publicas una Note (descubierto por la
 * comunidad, no documentado por Substack). Puede dejar de funcionar sin aviso si
 * Substack cambia su frontend. Si un día falla, abre substack.com/notes en tu
 * navegador con las herramientas de desarrollador (pestaña Network) abiertas,
 * publica una Note a mano, y compara la petición real con la de este script
 * para ajustar la URL/payload.
 *
 * Cómo obtener SUBSTACK_CONNECT_SID:
 * 1. Inicia sesión en substack.com desde el navegador.
 * 2. Abre las herramientas de desarrollador → Application/Storage → Cookies.
 * 3. Copia el valor de la cookie "connect.sid" (empieza por "s%3A...").
 * 4. Pégalo en el .env. Caduca cada cierto tiempo (semanas/meses); si el script
 *    empieza a fallar con error 401/403, repite este proceso.
 */

require_once __DIR__ . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';

use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use Dotenv\Dotenv;

// --- 1. CARGAR CONFIGURACIÓN ---
$configDir = __DIR__ . DIRECTORY_SEPARATOR . 'config';

if (file_exists($configDir . DIRECTORY_SEPARATOR . '.env')) {
    $dotenv = Dotenv::createImmutable($configDir);
    $dotenv->load();
} else {
    die("❌ Error crítico: No encuentro el archivo .env en: " . $configDir);
}

$handle = $_ENV['BSKY_HANDLE'] ?? null;
$password = $_ENV['BSKY_APP_PASSWORD'] ?? null;
$connectSid = $_ENV['SUBSTACK_CONNECT_SID'] ?? null;

if (!$handle || !$password || !$connectSid) {
    die("❌ Error: Faltan variables en el .env (BSKY_HANDLE, BSKY_APP_PASSWORD, SUBSTACK_CONNECT_SID)");
}

// Registro local de posts ya publicados en Substack, para no duplicar
$logFile = __DIR__ . DIRECTORY_SEPARATOR . 'published.json';
$published = file_exists($logFile) ? json_decode(file_get_contents($logFile), true) : [];
if (!is_array($published)) {
    $published = [];
}

// --- 2. OBTENER POSTS DE BLUESKY ---
$bsky = new Client(['base_uri' => 'https://bsky.social']);

try {
    $response = $bsky->post('/xrpc/com.atproto.server.createSession', [
        'json' => ['identifier' => $handle, 'password' => $password]
    ]);
    $data = json_decode($response->getBody(), true);
    $token = $data['accessJwt'];

    $response = $bsky->get('/xrpc/app.bsky.feed.getAuthorFeed', [
        'headers' => ['Authorization' => 'Bearer ' . $token],
        'query' => ['actor' => $handle, 'limit' => 15]
    ]);
    $data = json_decode($response->getBody(), true);
} catch (Exception $e) {
    die("❌ Error al leer Bluesky: " . $e->getMessage() . "\n");
}

// --- 3. FILTRAR SOLO LOS POSTS NUEVOS (no publicados aún en Substack) ---
$nuevos = [];
foreach (array_reverse($data['feed']) as $item) { // orden cronológico ascendente
    if (!isset($item['post']['author']['handle']) || $item['post']['author']['handle'] !== $handle) {
        continue;
    }

    $post = $item['post'];
    $uri = $post['uri'];

    if (in_array($uri, $published, true)) {
        continue; // ya publicado, saltar
    }

    $text = $post['record']['text'] ?? '';
    if (isset($post['embed']['external'])) {
        $text .= "\n\n🔗 " . $post['embed']['external']['uri'];
    }

    $nuevos[] = ['uri' => $uri, 'text' => $text];
}

if (empty($nuevos)) {
    echo "ℹ️ No hay posts nuevos que publicar en Substack.\n";
    exit(0);
}

// --- 4. PUBLICAR CADA POST NUEVO COMO NOTE EN SUBSTACK ---
$substack = new Client([
    'base_uri' => 'https://substack.com',
    'headers' => [
        'Cookie'       => 'connect.sid=' . $connectSid,
        'Content-Type' => 'application/json',
        'User-Agent'   => 'Mozilla/5.0 (compatible; blu-para-sub script)',
    ]
]);

foreach ($nuevos as $post) {
    // Substack representa el contenido en formato ProseMirror; un párrafo por
    // cada línea del texto original de Bluesky.
    $parrafos = [];
    foreach (explode("\n", $post['text']) as $linea) {
        $parrafos[] = $linea !== ''
            ? ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $linea]]]
            : ['type' => 'paragraph'];
    }

    $body = [
        'bodyJson' => [
            'type'    => 'doc',
            'attrs'   => ['schemaVersion' => 'v1'],
            'content' => $parrafos,
        ],
        'tabId' => 'for-you',
    ];

    try {
        $response = $substack->post('/api/v1/comment/feed', ['json' => $body]);

        if ($response->getStatusCode() === 200) {
            echo "✅ Publicado en Substack: " . mb_substr($post['text'], 0, 50) . "...\n";
            $published[] = $post['uri'];
        } else {
            echo "⚠️ Respuesta inesperada (" . $response->getStatusCode() . ") para: " . mb_substr($post['text'], 0, 50) . "\n";
        }
    } catch (RequestException $e) {
        $status = $e->hasResponse() ? $e->getResponse()->getStatusCode() : 'sin respuesta';
        echo "❌ Error al publicar en Substack (HTTP $status): " . $e->getMessage() . "\n";
        // Si es 401/403, probablemente la cookie connect.sid ha caducado.
    }

    sleep(2); // pausa breve entre publicaciones, por prudencia
}

// --- 5. GUARDAR REGISTRO ACTUALIZADO ---
file_put_contents($logFile, json_encode($published, JSON_PRETTY_PRINT));

echo "✅ Proceso completado.\n";