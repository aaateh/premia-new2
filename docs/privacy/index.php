<?php
declare(strict_types=1);

// Запасной вход для /docs/privacy/ без mod_rewrite (локальный предпросмотр).
$_GET['doc'] = 'privacy';

require __DIR__ . '/../index.php';
