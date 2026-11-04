# Деплой «Суровой премии»

## Куда заливаем

- Дубль для согласования: **https://marketingawards.ru/new/**
- Каталог на хостинге Beget: `/home/n/natafrj5/marketingawards.ru/public_html/new/`
- Основной сайт `marketingawards.ru` (React-сборка в корне) не трогаем — только `/new/`.

## Что заливать

```
index.html
jury.html
css/tokens.css
css/style.css
css/tariffs.css         (тарифы-постеры в разделе «Стоимость»)
css/fire.css            (сцена с огнём на первых двух экранах)
css/scroll-burn.css     (кромка прожига между секциями)
css/partners-form.css     (стили формы «Стать партнёром»)
js/                       (если менялся)
js/fire.js                (огонь, искры, пауза, скорость)
js/slogan.js              (слоган на телефоне +7 %)
js/partners-form.js       (логика формы)
media/fire/               (ролики огня: 4K 26 МБ, 1440 3,4 МБ, телефон 0,4 МБ;
                          на /new/ подключён 1440 — он легче для скролла)
mail/                     (обработчик формы, PHPMailer, config.local.php)
docs/                     (постоянные адреса документов → 302 на PDF с Яндекс.Диска)
img/                      (rumantsev.jpg, topor.png, characters/*.webp, illustrations/*.webp)
logo.svg                  (если менялся)
fonts/                    (только 5 подключённых файлов Dela / Involve / Golos)
```

Шрифты и `js/` обычно уже лежат на сервере — перед заливкой сверить версии
`?v=` в HTML.

Огонь грузится через `fetch` и играет из `blob:`, поэтому в CSP сайта для
`/new/` должны быть разрешены `media-src 'self' blob:` и `connect-src 'self'`.

Форма работает на **PHP 8.5** (выбран в настройках сайта Beget). В корневом
`.htaccess` сайта должны быть разрешены PHP и POST для `/new/mail/`, а в CSP
добавлены домены SmartCaptcha — подробности в `mail/README.md`.

## Как заходить

Доступ — SFTP на Beget, порт 22.

| Параметр | Значение |
|---|---|
| Профиль в ftp-mcp | `marketingawards` |
| Хост | `natafrj5.beget.tech` |
| Пользователь | `natafrj5_opencode16` |
| Пароль | хранится в профиле ftp-mcp, в git не коммитить |
| Каталог | `/home/n/natafrj5/marketingawards.ru/public_html/new` |

Подключение в агенте:

```
ftp_connect({ name: "ma", site: "marketingawards" })
```

Профили `surconf`, `surconf7`, `spbprompt`, `online15` и др. к каталогу
`marketingawards.ru` на запись доступа **не имеют** (Permission denied) —
использовать только профиль `marketingawards`.

Пароли в репозиторий не коммитить. Если нужен локальный файл с доступом —
держать рядом `.env.local` (он в `.gitignore`), в этой заметке — только имя профиля.

Секреты формы (`mail/config.local.php`: пароль SMTP и серверный ключ SmartCaptcha)
тоже не коммитятся, но заливаются на сервер вместе с папкой `mail/`.

## Проверка после заливки

```bash
curl -s https://marketingawards.ru/new/ | grep -E 'style.css\?v=|tokens.css\?v='
curl -s -o /dev/null -w '%{http_code}\n' https://marketingawards.ru/new/jury.html
```

Версии `?v=` должны совпасть с локальными в `index.html` и `jury.html`.
Дополнительно открыть страницу в браузере и проверить консоль и картинки
`img/rumantsev.jpg`, `img/characters/1-web-developer.webp`, `img/illustrations/1-briefcase.webp`.
