# Документы премии

Постоянные адреса на сайте:

| Адрес | Документ |
|---|---|
| `/docs/oferta` | Публичная оферта (PDF) |
| `/docs/privacy` | Политика обработки персональных данных (PDF) |
| `/docs/consent` | Согласие на обработку и передачу персональных данных (PDF) |

Те же адреса работают с `.pdf` на конце (через `.htaccess`):
`/docs/oferta.pdf` и т. д.

## Как это работает

`docs/.htaccess` принимает красивый адрес и передаёт его в `docs/index.php`.
Скрипт проверяет документ по белому списку, запрашивает у API Яндекс.Диска
свежую прямую ссылку на PDF и отвечает `302 Found` с этой ссылкой.

Прямые ссылки `downloader.disk.yandex.ru` подписаны и действуют несколько
часов, поэтому их нельзя прописывать в `.htaccess` навсегда. Скрипт берёт
новую при каждом переходе, а постоянными остаются адреса на сайте.

Если API недоступен, скрипт всё равно отвечает `302` — на постоянную
страницу файла в публичной папке Диска. Пользователь не увидит ошибку.

## Файлы

| Файл | Назначение |
|---|---|
| `docs/.htaccess` | Красивые адреса → `index.php` |
| `docs/index.php` | Белый список документов и 302-редирект |
| `docs/oferta/index.php` | Запасной вход `/docs/oferta/` без mod_rewrite |
| `docs/privacy/index.php` | Запасной вход `/docs/privacy/` |
| `docs/consent/index.php` | Запасной вход `/docs/consent/` |
| `docs/README.md` | Эта памятка |

Публичная папка: <https://disk.yandex.ru/d/yL8YoRoXtVvT7w>

## Деплой

Загрузить папку `docs/` в `/new/docs/` (рядом с `index.html` и `jury.html`)
вместе с подпапками `oferta/`, `privacy/`, `consent/`.
Ссылки в подвале и в форме согласия уже относительные (`docs/oferta`,
`docs/privacy`, `docs/consent`), поэтому при переносе сайта из `/new/`
в корень они продолжат работать. `RewriteBase` в `.htaccess` не задан —
правила тоже не зависят от места.

PHP должен быть включён (на Beget выбран PHP 8.5). В корневом `.htaccess`
сайта PHP разрешён только для `/new/mail/`; красивый адрес `/new/docs/oferta`
не содержит `.php`, поэтому правило его не блокирует, а внутренняя
подстановка `index.php` выполняется уже внутри `/new/docs/`.

Если хостинг всё же отдаст `403`, добавить `/new/docs/` в исключение
корневого `.htaccess`:

```apache
RewriteCond %{REQUEST_URI} !^/new/(?:mail|docs)/
RewriteRule "\.(?:php[0-9]?|phtml|pht|phar|cgi)(?:/|$)" - [F,L,NC]
```

## Проверка после заливки

```bash
curl -sI https://marketingawards.ru/new/docs/oferta  | grep -iE 'HTTP/|location'
curl -sI https://marketingawards.ru/new/docs/privacy | grep -iE 'HTTP/|location'
curl -sI https://marketingawards.ru/new/docs/consent | grep -iE 'HTTP/|location'
```

Ожидается `302 Found` и `Location:` на `downloader.disk.yandex.ru`
(или на страницу файла в папке Диска, если API временно недоступен).

## Как обновить документы

Если файл в папке переименован, поправить путь в массиве `DOCUMENTS`
в `docs/index.php`. Адреса на сайте при этом не меняются.
