/* ==========================================================================
   star-border.js — «горящая» рамка кнопки с marketingawards.ru
   Порт canvas-эффекта из бандла сайта (React-компонент StarBorder).
   Геометрия и математика сохранены: путь по скруглённому прямоугольнику,
   бегущий блик с градиентным хвостом, свечение головы, вспышка по клику,
   «лишний круг» по наведению.

   Оптимизация (v1.1):
   • анимация останавливается, когда кнопки нет в кадре (IntersectionObserver)
     и когда вкладка/окно неактивны (visibilitychange);
   • canvas выделяется только при первом появлении в кадре;
   • путь по рамке считается один раз на размер, а не каждый кадр;
   • свечение головы — заранее нарисованный спрайт вместо градиента на кадр;
   • хвост блика рисуется пакетами по прозрачности: ~24 stroke вместо ~180;
   • в простое 30 кадров/с, при наведении/фокусе/клике — 60.

   Использование:
     <a class="star-border" href="..." style="--star-border-radius:4px;--star-border-thickness:1px">
       <canvas class="star-border__light" aria-hidden="true"></canvas>
       <span>Заполнить</span>
     </a>
     <script src="star-border.js"></script>
     <script>StarBorder.initAll();</script>

   Или точечно: StarBorder.init(el, { duration: 4, thickness: 1, radius: 4, glow: .6 });
   ========================================================================== */

(function (global) {
    "use strict";

    var BLEED = 48;          // canvas выступает за кнопку на 48px с каждой стороны
    var LAP = 0.9;           // длительность «лишнего круга» при наведении, сек
    var TAU = Math.PI * 2;
    var WHITE = [255, 255, 255];

    var IDLE_FPS = 30;       // кадров в секунду в простое
    var ACTIVE_FPS = 60;     // при наведении, фокусе и вспышке
    var TRAIL_MAX_STEPS = 70;   // точек вдоль хвоста (шаг 3px)
    var TRAIL_BUCKETS = 12;     // пакетов прозрачности на хвост

    var THEMES = {
        dark: { light: "#ffffff" },
        light: { light: "#18181b" }
    };

    var clamp = function (v, min, max) { return Math.min(max, Math.max(min, v)); };
    var mod = function (v, m) { return ((v % m) + m) % m; };
    var easeInOut = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2; };
    var lerpColor = function (a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    };
    var rgba = function (c, a) {
        return "rgba(" + Math.round(c[0]) + ", " + Math.round(c[1]) + ", " + Math.round(c[2]) + ", " + clamp(a, 0, 1).toFixed(3) + ")";
    };
    /* ---------- разбор цвета ---------- */
    var colorCtx = null;
    function parseColor(value) {
        if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d");
        if (!colorCtx) return WHITE;
        colorCtx.fillStyle = "#000000";
        colorCtx.fillStyle = value;
        var out = String(colorCtx.fillStyle);
        if (out.charAt(0) === "#") {
            var n = parseInt(out.slice(1, 7), 16);
            return [n >> 16 & 255, n >> 8 & 255, n & 255];
        }
        var m = out.match(/[\d.]+/g);
        return m ? [+m[0], +m[1], +m[2]] : WHITE;
    }

    /* ---------- путь по скруглённому прямоугольнику ---------- */
    function buildPath(w, h, radius) {
        var r = Math.max(0, Math.min(radius, w / 2, h / 2));
        var arc = Math.PI * r / 2;
        var straightW = Math.max(0, w - 2 * r);
        var straightH = Math.max(0, h - 2 * r);
        var segments = [
            { length: straightW, x: r, y: 0, dx: 1, dy: 0, angle: null },
            { length: arc, x: w - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
            { length: straightH, x: w, y: r, dx: 0, dy: 1, angle: null },
            { length: arc, x: w - r, y: h - r, dx: 0, dy: 0, angle: 0 },
            { length: straightW, x: w - r, y: h, dx: -1, dy: 0, angle: null },
            { length: arc, x: r, y: h - r, dx: 0, dy: 0, angle: Math.PI / 2 },
            { length: straightH, x: 0, y: h - r, dx: 0, dy: -1, angle: null },
            { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI }
        ];
        var total = 0;
        for (var i = 0; i < segments.length; i++) total += segments[i].length;
        return { r: r, segments: segments, total: Math.max(1, total) };
    }

    function pointAt(path, pos, out) {
        var left = mod(pos, path.total);
        for (var i = 0; i < path.segments.length; i++) {
            var s = path.segments[i];
            if (s.length > 0 && left <= s.length) {
                if (s.angle === null) {
                    out.x = s.x + s.dx * left;
                    out.y = s.y + s.dy * left;
                    out.nx = s.dy;
                    out.ny = -s.dx;
                } else {
                    var a = s.angle + left / path.r;
                    out.nx = Math.cos(a);
                    out.ny = Math.sin(a);
                    out.x = s.x + out.nx * path.r;
                    out.y = s.y + out.ny * path.r;
                }
                return out;
            }
            left -= s.length;
        }
        return out;
    }

    function nearestOnPath(path, px, py) {
        var best = Infinity, bestPos = 0, acc = 0;
        for (var i = 0; i < path.segments.length; i++) {
            var s = path.segments[i];
            if (s.length <= 0) continue;
            var d = 0, x = 0, y = 0;
            if (s.angle === null) {
                d = clamp((px - s.x) * s.dx + (py - s.y) * s.dy, 0, s.length);
                x = s.x + s.dx * d;
                y = s.y + s.dy * d;
            } else {
                var rel = mod(Math.atan2(py - s.y, px - s.x) - s.angle, TAU);
                if (rel > Math.PI / 2) rel = rel > Math.PI * 1.25 ? 0 : Math.PI / 2;
                d = rel * path.r;
                x = s.x + Math.cos(s.angle + rel) * path.r;
                y = s.y + Math.sin(s.angle + rel) * path.r;
            }
            var dist = (px - x) * (px - x) + (py - y) * (py - y);
            if (dist < best) { best = dist; bestPos = acc + d; }
            acc += s.length;
        }
        return bestPos;
    }

    /* ---------- одна кнопка ---------- */
    function init(el, options) {
        if (!el || el.__starBorder) return el && el.__starBorder;

        var canvas = el.querySelector(".star-border__light");
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.className = "star-border__light";
            canvas.setAttribute("aria-hidden", "true");
            el.insertBefore(canvas, el.firstChild);
        }
        var ctx = canvas.getContext("2d");
        if (!ctx) return null;

        var opts = Object.assign({
            color: null,
            trailColor: null,
            duration: 4,
            thickness: 1,
            radius: 4,
            trailLength: .3,
            stars: 1,
            glow: .6,
            sparkle: false,
            direction: "clockwise",
            hover: "lap",
            clickPulse: true,
            paused: false,
            theme: "dark",
            respectReducedMotion: true
        }, options || {});

        var theme = THEMES[opts.theme] || THEMES.dark;
        var cfg = {
            light: opts.theme === "light",
            color: opts.color || theme.light,
            trailColor: opts.trailColor || opts.color || theme.light,
            duration: Math.max(.3, opts.duration),
            thickness: Math.max(.5, opts.thickness),
            radius: Math.max(0, opts.radius),
            trailLength: clamp(opts.trailLength, 0, 1),
            stars: clamp(Math.round(opts.stars), 1, 6),
            glow: clamp(opts.glow, 0, 1),
            sparkle: !!opts.sparkle,
            direction: opts.direction === "counterclockwise" ? -1 : 1,
            hover: opts.hover,
            clickPulse: opts.clickPulse,
            paused: opts.paused
        };

        var motionQuery = opts.respectReducedMotion && window.matchMedia
            ? window.matchMedia("(prefers-reduced-motion: reduce)")
            : null;
        var reduced = !!(motionQuery && motionQuery.matches);

        // тёплый цвет ореола берём из токена дизайн-системы
        var fireColor = WHITE;
        try {
            var fireValue = getComputedStyle(el).getPropertyValue("--fire-glow").trim();
            fireColor = parseColor(fireValue || "#FF7B39");
        } catch (e) { /* остаёмся на белом */ }

        var state = {
            width: 0, height: 0, dpr: 1,
            phase: 0, velocity: 0, motion: 0, lap: -1, time: 0,
            reveal: 0, boost: 0, flash: 0,
            hovered: false, focused: false, pointerX: 0, pointerY: 0,
            visible: !window.IntersectionObserver
        };

        var pulses = [];
        var sparks = [];
        var colors = { key: "", head: WHITE, tail: WHITE };
        var head = { x: 0, y: 0, nx: 0, ny: -1 };

        var raf = 0;
        var lastTime = 0;
        var lastDraw = 0;
        var alive = true;

        // кэш геометрии: пересчитывается только при изменении размера
        var pathCache = null;
        var pts = null;
        // кэш спрайта свечения головы
        var glow = { key: "", canvas: null };

        function metrics() {
            if (!pathCache) {
                pathCache = buildPath(
                    Math.max(1, state.width - cfg.thickness),
                    Math.max(1, state.height - cfg.thickness),
                    cfg.radius - cfg.thickness / 2
                );
            }
            return pathCache;
        }

        function resize() {
            if (!state.visible) return;          // бэк-стор выделим при первом появлении в кадре

            var w = el.offsetWidth;
            var h = el.offsetHeight;
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            if (w === state.width && h === state.height && dpr === state.dpr && canvas.width > 1) {
                schedule();
                return;                          // размер не изменился — canvas не перевыделяем
            }

            state.width = w;
            state.height = h;
            state.dpr = dpr;
            canvas.width = Math.max(1, Math.round((w + BLEED * 2) * dpr));
            canvas.height = Math.max(1, Math.round((h + BLEED * 2) * dpr));

            pathCache = null;
            glow.key = "";
            pts = new Float32Array((TRAIL_MAX_STEPS + 1) * 2);
            lastDraw = 0;
            schedule();
        }

        function pointer(e) {
            var rect = el.getBoundingClientRect();
            return [
                (e.clientX - rect.left) * (rect.width ? state.width / rect.width : 1),
                (e.clientY - rect.top) * (rect.height ? state.height / rect.height : 1)
            ];
        }

        /* ---------- свечение головы: спрайт вместо градиента на каждый кадр ---------- */
        function glowSprite(radius) {
            var key = cfg.color + "|" + radius + "|" + state.dpr;
            if (glow.key === key) return glow.canvas;

            var size = Math.max(8, Math.ceil(radius * 2 * state.dpr));
            var cv = document.createElement("canvas");
            cv.width = size;
            cv.height = size;
            var c = cv.getContext("2d");
            if (!c) return null;

            var g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            g.addColorStop(0, rgba(colors.head, 1));
            g.addColorStop(.2, rgba(colors.head, .4));
            g.addColorStop(.5, rgba(colors.head, .1));
            g.addColorStop(1, rgba(colors.head, 0));
            c.fillStyle = g;
            c.fillRect(0, 0, size, size);

            glow.key = key;
            glow.canvas = cv;
            return cv;
        }

        /* хвост блика: точки вдоль пути + пакеты по прозрачности.
           Раньше на каждый пиксель хвоста шёл отдельный stroke (до ~180 за кадр),
           теперь — ~24 stroke на весь хвост при том же виде. */
        function trail(path, from, length, dir, alpha) {
            if (length < .5 || alpha <= 0) return;

            var steps = clamp(Math.ceil(length / 3), 2, TRAIL_MAX_STEPS);
            if (!pts || pts.length < (steps + 1) * 2) pts = new Float32Array((steps + 1) * 2);

            for (var i = 0; i <= steps; i++) {
                pointAt(path, from - dir * length * (i / steps), head);
                pts[i * 2] = head.x;
                pts[i * 2 + 1] = head.y;
            }

            var glowWidth = cfg.light ? 2 + 6 * cfg.glow : 4 + 10 * cfg.glow;
            for (var b = 0; b < TRAIL_BUCKETS; b++) {
                var t = (b + .5) / TRAIL_BUCKETS;
                var w = t * t * alpha;
                if (w < .003) continue;

                // цвет сегмента: хвост → голова, на тёмном ещё подмешивается белый
                var r = colors.tail[0] + (colors.head[0] - colors.tail[0]) * t;
                var g = colors.tail[1] + (colors.head[1] - colors.tail[1]) * t;
                var bl = colors.tail[2] + (colors.head[2] - colors.tail[2]) * t;
                if (!cfg.light) {
                    var k = Math.pow(t, 6) * .65;
                    r += (255 - r) * k;
                    g += (255 - g) * k;
                    bl += (255 - bl) * k;
                }
                var coreCol = "rgba(" + Math.round(r) + ", " + Math.round(g) + ", " + Math.round(bl) + ", " + w.toFixed(3) + ")";

                // тёплый ореол вокруг блика — в самом canvas, без filter: drop-shadow
                var hw = w * (cfg.light ? .1 : .16) * cfg.glow;
                var hr = r, hg = g, hb = bl;
                if (!cfg.light) {
                    hr += (fireColor[0] - hr) * .72;
                    hg += (fireColor[1] - hg) * .72;
                    hb += (fireColor[2] - hb) * .72;
                }
                var haloCol = "rgba(" + Math.round(hr) + ", " + Math.round(hg) + ", " + Math.round(hb) + ", " + hw.toFixed(3) + ")";

                ctx.beginPath();
                var drawn = false;
                for (var s = 1; s <= steps; s++) {
                    var ts = 1 - (s - .5) / steps;
                    if (Math.min(TRAIL_BUCKETS - 1, Math.floor(ts * TRAIL_BUCKETS)) !== b) continue;
                    if (!drawn) {
                        ctx.moveTo(pts[(s - 1) * 2], pts[(s - 1) * 2 + 1]);
                        drawn = true;
                    }
                    ctx.lineTo(pts[s * 2], pts[s * 2 + 1]);
                }
                if (!drawn) continue;

                ctx.lineCap = "butt";
                ctx.lineWidth = glowWidth;
                ctx.strokeStyle = haloCol;
                ctx.stroke();
                ctx.lineWidth = cfg.thickness;
                ctx.strokeStyle = coreCol;
                ctx.stroke();
            }
        }

        /* свечение головы + искры */
        function headGlow(x, y, alpha, twinkle) {
            if (alpha <= 0) return;
            var radius = (12 + 40 * cfg.glow) * (cfg.light ? .6 : 1);
            var peak = (cfg.light ? .08 : .4) * cfg.glow * alpha;
            var sprite = glowSprite(radius);

            if (sprite) {
                var prevAlpha = ctx.globalAlpha;
                ctx.globalAlpha = clamp(peak, 0, 1);
                ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
                ctx.globalAlpha = prevAlpha;
            } else {
                var g = ctx.createRadialGradient(x, y, 0, x, y, radius);
                g.addColorStop(0, rgba(colors.head, peak));
                g.addColorStop(.2, rgba(colors.head, peak * .4));
                g.addColorStop(.5, rgba(colors.head, peak * .1));
                g.addColorStop(1, rgba(colors.head, 0));
                ctx.fillStyle = g;
                ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }

            if (!cfg.sparkle) return;
            var r2 = (1 + cfg.thickness * .6) * (cfg.light ? .85 : 1);
            var g2 = ctx.createRadialGradient(x, y, 0, x, y, r2 * 2.2);
            g2.addColorStop(0, rgba(cfg.light ? colors.head : WHITE, alpha));
            g2.addColorStop(cfg.light ? .3 : .4, rgba(cfg.light ? colors.head : lerpColor(colors.head, WHITE, .5), alpha * .9));
            g2.addColorStop(cfg.light ? .55 : 1, rgba(colors.head, cfg.light ? alpha * .12 : 0));
            g2.addColorStop(1, rgba(colors.head, 0));
            ctx.fillStyle = g2;
            ctx.beginPath();
            ctx.arc(x, y, r2 * 2.2, 0, TAU);
            ctx.fill();

            var arm = (3 + 4 * cfg.glow + cfg.thickness * 1.5) * twinkle;
            var mid = cfg.light ? colors.head : WHITE;
            var lg = ctx.createLinearGradient(x - arm, y, x + arm, y);
            lg.addColorStop(0, rgba(colors.head, 0));
            lg.addColorStop(.5, rgba(mid, alpha * .95));
            lg.addColorStop(1, rgba(colors.head, 0));
            ctx.lineWidth = cfg.light ? .75 : 1;
            ctx.strokeStyle = lg;
            ctx.beginPath();
            ctx.moveTo(x - arm, y);
            ctx.lineTo(x + arm, y);
            ctx.stroke();

            var vg = ctx.createLinearGradient(x, y - arm, x, y + arm);
            vg.addColorStop(0, rgba(colors.head, 0));
            vg.addColorStop(.5, rgba(mid, alpha * .95));
            vg.addColorStop(1, rgba(colors.head, 0));
            ctx.strokeStyle = vg;
            ctx.beginPath();
            ctx.moveTo(x, y - arm);
            ctx.lineTo(x, y + arm);
            ctx.stroke();
        }

        function spawnSparks(x, y, nx, ny, motion) {
            if (sparks.length > 48) return;
            var speed = 3 + Math.random() * 10;
            var spread = (Math.random() - .5) * 8;
            sparks.push({
                x: x + nx * (Math.random() * 3 - 1),
                y: y + ny * (Math.random() * 3 - 1),
                vx: nx * speed - ny * spread - motion * -ny * .04,
                vy: ny * speed + nx * spread - motion * nx * .04,
                age: 0,
                life: .35 + Math.random() * .5,
                size: .45 + Math.random() * .7,
                seed: Math.random() * TAU
            });
        }

        function draw(path) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (state.width < 2 || state.height < 2) return;

            var offset = (BLEED + cfg.thickness / 2) * state.dpr;
            ctx.setTransform(state.dpr, 0, 0, state.dpr, offset, offset);
            ctx.globalCompositeOperation = cfg.light ? "source-over" : "lighter";
            ctx.lineCap = "butt";

            var total = path.total;
            var perStar = total / cfg.stars;
            var motionAbs = Math.abs(state.motion);
            var dir = state.motion >= 0 ? 1 : -1;
            var trailMax = cfg.trailLength * cfg.duration;
            var trailLen = Math.min(motionAbs * trailMax, perStar * .92, total * .6);
            var revealAlpha = state.reveal * (1 + .4 * state.boost + .6 * state.flash);

            var flashAlpha = state.flash * (cfg.light ? .18 : .32) + state.boost * state.reveal * (cfg.light ? .07 : .12);
            if (flashAlpha > .005) {
                ctx.lineWidth = cfg.thickness + 2 * cfg.glow;
                ctx.strokeStyle = rgba(colors.head, flashAlpha);
                ctx.beginPath();
                ctx.roundRect(0, 0, Math.max(1, state.width - cfg.thickness), Math.max(1, state.height - cfg.thickness), Math.max(0, path.r));
                ctx.stroke();
            }

            var fade = clamp(1 - motionAbs / Math.max(1, total / cfg.duration * .6), 0, 1) * Math.min(1, revealAlpha);
            var headLen = (10 + 14 * cfg.glow + cfg.thickness * 2) * fade;

            for (var i = 0; i < cfg.stars; i++) {
                var pos = state.phase + i * perStar;
                trail(path, pos, trailLen, dir, Math.min(1, revealAlpha));
                if (fade > .01) {
                    trail(path, pos, headLen, 1, fade);
                    trail(path, pos, headLen, -1, fade);
                }
            }

            for (var p = 0; p < pulses.length; p++) {
                var pulse = pulses[p];
                var a = Math.pow(1 - pulse.age / .65, 2);
                var dist = total / 2 * (1 - Math.pow(1 - Math.min(1, pulse.age / .5), 2));
                var len = Math.min(dist, total * .16);
                trail(path, pulse.origin + dist, len, 1, a);
                pointAt(path, pulse.origin + dist, head);
                headGlow(head.x, head.y, a * .8, .8);
                trail(path, pulse.origin - dist, len, -1, a);
                pointAt(path, pulse.origin - dist, head);
                headGlow(head.x, head.y, a * .8, .8);
            }

            for (var j = 0; j < cfg.stars; j++) {
                pointAt(path, state.phase + j * perStar, head);
                var twinkle = .82 + .18 * Math.sin(state.time * 6.1 + j * 2.3) * Math.sin(state.time * 2.7 + j);
                headGlow(head.x, head.y, Math.min(1.3, revealAlpha), twinkle);
            }

            for (var s = 0; s < sparks.length; s++) {
                var sp = sparks[s];
                var life = 1 - sp.age / sp.life;
                var flick = .45 + .55 * Math.sin(state.time * 20 + sp.seed);
                var sa = life * flick * state.reveal * (cfg.light ? .35 : .9);
                if (sa <= .01) continue;
                ctx.fillStyle = rgba(cfg.light ? colors.head : lerpColor(colors.tail, WHITE, .6), sa);
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, sp.size * (.6 + .4 * life), 0, TAU);
                ctx.fill();
            }
        }

        function frame(now) {
            raf = 0;
            if (!alive || document.hidden || !state.visible) return;   // вкладка неактивна или кнопка вне кадра

            var dt = Math.min(.05, Math.max(.001, (now - lastTime) / 1000));
            lastTime = now;
            state.time += dt;

            var key = cfg.color + "|" + cfg.trailColor;
            if (key !== colors.key) {
                colors.key = key;
                colors.head = parseColor(cfg.color);
                colors.tail = parseColor(cfg.trailColor);
                glow.key = "";
            }

            var path = metrics();
            var total = path.total;
            var perStar = total / cfg.stars;
            var active = state.hovered || state.focused;
            var baseSpeed = (reduced || cfg.paused) ? 0 : cfg.direction * total / cfg.duration;

            if (cfg.paused) { state.velocity = 0; state.lap = -1; }

            var revealTarget = (cfg.hover === "reveal" && !active) ? 0 : 1;
            state.reveal += (revealTarget - state.reveal) * (1 - Math.exp(-dt / (revealTarget > state.reveal ? .16 : .45)));

            var boostTarget = (cfg.hover === "brighten" && active) ? 1 : 0;
            state.boost += (boostTarget - state.boost) * (1 - Math.exp(-dt / (boostTarget > state.boost ? .18 : .5)));

            state.flash *= Math.exp(-dt / .22);
            state.velocity += (baseSpeed - state.velocity) * (1 - Math.exp(-dt / .45));
            // останавливаемся точно: иначе затухающая скорость держит rAF вечно
            if (Math.abs(baseSpeed - state.velocity) < .05) state.velocity = baseSpeed;

            var extra = 0;
            if (state.lap >= 0) {
                var before = easeInOut(Math.min(1, state.lap / LAP));
                state.lap += dt;
                extra = (easeInOut(Math.min(1, state.lap / LAP)) - before) * total * cfg.direction;
                if (state.lap >= LAP) state.lap = -1;
            }

            state.motion = state.velocity + extra / dt;
            state.phase = mod(state.phase + state.velocity * dt + extra, total);

            for (var p = pulses.length - 1; p >= 0; p--) {
                pulses[p].age += dt;
                if (pulses[p].age >= .65) pulses.splice(p, 1);
            }
            for (var s = sparks.length - 1; s >= 0; s--) {
                var sp = sparks[s];
                sp.age += dt;
                sp.x += sp.vx * dt;
                sp.y += sp.vy * dt;
                sp.vx *= Math.exp(-dt * 2.2);
                sp.vy *= Math.exp(-dt * 2.2);
                if (sp.age >= sp.life) sparks.splice(s, 1);
            }

            var settling = Math.abs(revealTarget - state.reveal) > .002 ||
                Math.abs(boostTarget - state.boost) > .002 ||
                state.flash > .01 || pulses.length > 0 || sparks.length > 0;
            var moving = Math.abs(state.motion) > .05 || state.velocity !== 0 || state.lap >= 0;
            var lit = state.reveal > .002 || revealTarget > 0;

            if (!(settling || (moving && lit) || state.hovered)) {
                lastDraw = 0;
                return;                                   // анимация завершена — rAF больше не держим
            }

            // в простое рисуем 30 кадров/с, при взаимодействии — 60
            var frameGap = 1000 / (state.hovered || state.focused || state.flash > .02 || pulses.length ? ACTIVE_FPS : IDLE_FPS);
            if (lastDraw && now - lastDraw < frameGap - 1.5) {
                raf = requestAnimationFrame(frame);
                return;
            }
            lastDraw = now;

            draw(path);
            raf = requestAnimationFrame(frame);
        }

        function schedule() {
            if (raf || !alive || document.hidden || !state.visible) return;
            lastTime = performance.now();
            raf = requestAnimationFrame(frame);
        }

        /* ---------- события ---------- */
        function onEnter(e) {
            if (!state.width || !state.height) resize();
            var pt = pointer(e);
            state.pointerX = pt[0];
            state.pointerY = pt[1];
            state.hovered = true;

            if (cfg.hover === "reveal" && state.reveal < .15) {
                state.phase = nearestOnPath(metrics(), state.pointerX - cfg.thickness / 2, state.pointerY - cfg.thickness / 2);
                state.velocity = 0;
            }
            if (cfg.hover === "lap" && state.lap < 0 && !reduced && !cfg.paused) state.lap = 0;
            schedule();
        }

        function onLeave() { state.hovered = false; schedule(); }

        function pulse(origin) {
            pulses.push({ origin: origin, age: 0 });
            if (pulses.length > 4) pulses.shift();
            state.flash = 1;
            schedule();
        }

        function onPointerDown(e) {
            if (e.button !== 0 && e.pointerType === "mouse") return;
            var pt = pointer(e);
            pulse(nearestOnPath(metrics(), pt[0] - cfg.thickness / 2, pt[1] - cfg.thickness / 2));
        }

        function onClick(e) {
            if (e.detail === 0) pulse(state.phase);   // активация с клавиатуры
        }

        function onFocus() {
            state.focused = el.matches(":focus-visible");
            if (state.focused && cfg.hover === "lap" && state.lap < 0 && !reduced && !cfg.paused) state.lap = 0;
            schedule();
        }

        function onBlur() { state.focused = false; schedule(); }

        // вкладка скрыта — rAF не держим; вернулись — продолжаем с того же места
        function onVisibility() {
            if (document.hidden) {
                if (raf) { cancelAnimationFrame(raf); raf = 0; }
                return;
            }
            lastDraw = 0;
            schedule();
        }

        function onMotionChange() {
            reduced = !!(motionQuery && motionQuery.matches);
            lastDraw = 0;
            schedule();
        }

        el.addEventListener("pointerenter", onEnter);
        el.addEventListener("pointerleave", onLeave);
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("click", onClick);
        el.addEventListener("focus", onFocus);
        el.addEventListener("blur", onBlur);
        document.addEventListener("visibilitychange", onVisibility);
        if (motionQuery) {
            if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
            else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
        }

        var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
        if (ro) ro.observe(el);

        // canvas выделяется при первом появлении в кадре; анимация идёт только в кадре
        var io = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
            var visible = entries.some(function (x) { return x.isIntersecting; });
            if (visible === state.visible) return;
            state.visible = visible;
            if (visible) {
                resize();
                schedule();
            }
        }, { rootMargin: "100px" }) : null;
        if (io) io.observe(el);
        else resize();

        var api = {
            element: el,
            canvas: canvas,
            options: cfg,
            refresh: function () { pathCache = null; resize(); },
            set: function (patch) {
                Object.assign(cfg, patch);
                pathCache = null;
                glow.key = "";
                lastDraw = 0;
                schedule();
            },
            pulse: function () { pulse(state.phase); },
            destroy: function () {
                alive = false;
                cancelAnimationFrame(raf);
                raf = 0;
                if (ro) ro.disconnect();
                if (io) io.disconnect();
                el.removeEventListener("pointerenter", onEnter);
                el.removeEventListener("pointerleave", onLeave);
                el.removeEventListener("pointerdown", onPointerDown);
                el.removeEventListener("click", onClick);
                el.removeEventListener("focus", onFocus);
                el.removeEventListener("blur", onBlur);
                document.removeEventListener("visibilitychange", onVisibility);
                if (motionQuery) {
                    if (motionQuery.removeEventListener) motionQuery.removeEventListener("change", onMotionChange);
                    else if (motionQuery.removeListener) motionQuery.removeListener(onMotionChange);
                }
                delete el.__starBorder;
            }
        };
        el.__starBorder = api;
        return api;
    }

    function initAll(options) {
        var nodes = document.querySelectorAll(".star-border");
        var list = [];
        for (var i = 0; i < nodes.length; i++) list.push(init(nodes[i], options));
        return list;
    }

    global.StarBorder = { init: init, initAll: initAll, version: "1.1.0" };
})(window);
