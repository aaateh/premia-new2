<?php
declare(strict_types=1);

/**
 * Постоянные адреса документов «Суровой премии».
 *
 * /docs/oferta  -> 302 -> PDF публичной оферты
 * /docs/privacy -> 302 -> PDF политики обработки персональных данных
 * /docs/consent -> 302 -> PDF согласия на обработку персональных данных
 *
 * Прямые ссылки downloader.disk.yandex.ru подписаны и действуют несколько
 * часов, поэтому при каждом переходе запрашиваем у API Диска свежую ссылку.
 * Если API недоступен — уводим на страницу файла в публичной папке.
 */

const YANDEX_PUBLIC_KEY = 'https://disk.yandex.ru/d/yL8YoRoXtVvT7w';
const YANDEX_FOLDER_URL = 'https://disk.yandex.ru/d/yL8YoRoXtVvT7w';
const YANDEX_DOWNLOAD_API = 'https://cloud-api.yandex.net/v1/disk/public/resources/download';

/** @var array<string, array{path: string, title: string}> */
const DOCUMENTS = [
    'oferta' => [
        'path' => '/ПУБЛИЧНАЯ ОФЕРТА НА ЗАКЛЮЧЕНИЕ ДОГОВОРА от 30.10.2026.pdf',
        'title' => 'Публичная оферта',
    ],
    'privacy' => [
        'path' => '/Политика в отношении обработки персональных данных 20.10.2026.pdf',
        'title' => 'Политика обработки персональных данных',
    ],
    'consent' => [
        'path' => '/Согласие на обработку и передачу персональных данных.pdf',
        'title' => 'Согласие на обработку и передачу персональных данных',
    ],
];

/**
 * Возвращает свежую прямую ссылку на файл из публичной папки Яндекс.Диска.
 */
function fetch_download_url(string $path): ?string
{
    $url = YANDEX_DOWNLOAD_API . '?' . http_build_query(
        [
            'public_key' => YANDEX_PUBLIC_KEY,
            'path' => $path,
        ],
        '',
        '&',
        PHP_QUERY_RFC3986
    );

    $raw = null;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_USERAGENT => 'SurovayaPremiyaDocs/1.0',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);

        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($status === 200 && is_string($response)) {
            $raw = $response;
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 5,
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\nUser-Agent: SurovayaPremiyaDocs/1.0\r\n",
            ],
        ]);

        $response = @file_get_contents($url, false, $context);
        if (is_string($response)) {
            $raw = $response;
        }
    }

    if ($raw === null) {
        return null;
    }

    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['href']) || !is_string($data['href'])) {
        return null;
    }

    $href = trim($data['href']);

    return str_starts_with($href, 'https://') ? $href : null;
}

$slug = isset($_GET['doc']) ? strtolower(trim((string) $_GET['doc'])) : '';

header('X-Robots-Tag: noindex');

if (!array_key_exists($slug, DOCUMENTS)) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    ?>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Документ не найден — Суровая премия</title>
    <style>
        :root { color-scheme: dark; }
        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            background: #0d0b0a;
            color: #f5f0eb;
            font: 16px/1.6 Arial, sans-serif;
        }
        main { max-width: 520px; }
        h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.2; }
        p { margin: 0 0 20px; color: rgba(245, 240, 235, .7); }
        a { color: #f56624; }
    </style>
</head>
<body>
<main>
    <h1>Документ не найден</h1>
    <p>Такого документа нет. Все актуальные документы премии лежат в общей папке.</p>
    <a href="<?= htmlspecialchars(YANDEX_FOLDER_URL, ENT_QUOTES, 'UTF-8') ?>">Открыть папку с документами</a>
</main>
</body>
</html>
    <?php
    exit;
}

$document = DOCUMENTS[$slug];
$downloadUrl = fetch_download_url($document['path']);

header('Cache-Control: no-store, max-age=0');
header('Referrer-Policy: no-referrer');

if ($downloadUrl === null) {
    // Запасной вариант: постоянная страница файла в публичной папке.
    $fallback = YANDEX_FOLDER_URL . '?' . http_build_query(
        ['path' => $document['path']],
        '',
        '&',
        PHP_QUERY_RFC3986
    );

    header('Location: ' . $fallback, true, 302);
    exit;
}

header('Location: ' . $downloadUrl, true, 302);
exit;
