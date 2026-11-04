<?php
declare(strict_types=1);

// Запасной вход для /docs/oferta/ без mod_rewrite (локальный предпросмотр).
$_GET['doc'] = 'oferta';

require __DIR__ . '/../index.php';
