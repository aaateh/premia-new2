<?php
declare(strict_types=1);

// Запасной вход для /docs/consent/ без mod_rewrite (локальный предпросмотр).
$_GET['doc'] = 'consent';

require __DIR__ . '/../index.php';
