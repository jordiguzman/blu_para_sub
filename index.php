<?php
/**
 * Script para generar feed.xml desde Bluesky
 * Ubicación esperada: D:\PHP\Scripts en Hosting\blu_para_sub\index.php
 * Configuración esperada: D:\PHP\Scripts en Hosting\config\.env
 */

require_once __DIR__ . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';

use GuzzleHttp\Client;
use Dotenv\Dotenv;

// --- 1. CARGAR CONFIGURACIÓN ---
/// La ruta es: la carpeta actual + \config
$configDir = __DIR__ . DIRECTORY_SEPARATOR . 'config';

if (file_exists($configDir . DIRECTORY_SEPARATOR . '.env')) {
    $dotenv = Dotenv::createImmutable($configDir);
    $dotenv->load();
} else {
    die("❌ Error crítico: No encuentro el archivo .env en: " . $configDir);
}

$handle = $_ENV['BSKY_HANDLE'] ?? null;
$password = $_ENV['BSKY_APP_PASSWORD'] ?? null;

if (!$handle || !$password) {
    die("❌ Error: Faltan las variables BSKY_HANDLE o BSKY_APP_PASSWORD en tu .env");
}

// --- 2. CONEXIÓN Y EXTRACCIÓN ---
$client = new Client(['base_uri' => 'https://bsky.social']);

try {
    // Login
    $response = $client->post('/xrpc/com.atproto.server.createSession', [
        'json' => ['identifier' => $handle, 'password' => $password]
    ]);
    $data = json_decode($response->getBody(), true);
    $token = $data['accessJwt'];

    // Obtener posts del autor
    $response = $client->get('/xrpc/app.bsky.feed.getAuthorFeed', [
        'headers' => ['Authorization' => 'Bearer ' . $token],
        'query' => ['actor' => $handle, 'limit' => 15]
    ]);
    $data = json_decode($response->getBody(), true);

    // --- 3. GENERACIÓN DEL XML ---
    $xml = new SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"></rss>');
    $channel = $xml->addChild('channel');
    $channel->addChild('title', 'Juan Mentat Bluesky Feed');
    $channel->addChild('link', 'https://bsky.app/profile/' . $handle);
    $channel->addChild('description', 'Mis publicaciones de Bluesky automatizadas');

    foreach ($data['feed'] as $item) {
        // Filtro para asegurar que solo procesamos posts del autor
        if (!isset($item['post']['author']['handle']) || $item['post']['author']['handle'] !== $handle) continue;

        $post = $item['post'];
        $text = $post['record']['text'] ?? '';
        
        // Si el post tiene un enlace incrustado, lo añadimos al contenido
        if (isset($post['embed']['external'])) {
            $text .= "\n\n🔗 Enlace: " . $post['embed']['external']['uri'];
        }

        $rssItem = $channel->addChild('item');
        $rssItem->addChild('title', 'Post del ' . date('d/m/Y', strtotime($post['indexedAt'])));
        $rssItem->addChild('description', htmlspecialchars($text));
        $rssItem->addChild('pubDate', date('r', strtotime($post['indexedAt'])));
        $rssItem->addChild('link', 'https://bsky.app/profile/' . $handle . '/post/' . basename($post['uri']));
    }

    $xml->asXML(__DIR__ . DIRECTORY_SEPARATOR . 'feed.xml');
    echo "✅ feed.xml actualizado correctamente en " . __DIR__ . "\n";

} catch (Exception $e) {
    echo "❌ Error en el proceso: " . $e->getMessage() . "\n";
}