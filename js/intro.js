/* ==========================================================================
   Заставка «Суровой премии».

   Кадр собирается на canvas: кадр огня вырезается по силуэту логотипа,
   затем слогана. Переход — прожиг снизу вверх, с искрами и вспышкой.
   Пока идёт заставка, настоящая страница грузится в iframe под ней;
   уходим, когда она готова (или по таймауту).
   ========================================================================== */

(function () {
    'use strict';

    var root = document.querySelector('[data-intro]');
    if (!root) {
        return;
    }

    /* Заставка всегда начинается с первого экрана: отключаем
       восстановление прокрутки браузером после перезагрузки. */
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    function toTop() {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch (e) {
            window.scrollTo(0, 0);
        }
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }

    function announceIntroDone() {
        try {
            document.dispatchEvent(new CustomEvent('intro:done'));
        } catch (e) {}
    }

    var canvas = root.querySelector('[data-intro-canvas]');
    var ctx = canvas.getContext('2d', { alpha: false });
    var video = root.querySelector('[data-intro-video]');
    var skipBtn = root.querySelector('[data-intro-skip]');
    var frame = document.querySelector('[data-site-frame]');
    var siteRoot = document.querySelector('.site');
    var replayBtn = document.querySelector('[data-intro-replay]');

    var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var mobileQuery = window.matchMedia('(max-width: 700px) and (orientation: portrait)');

    var SLOGAN = ['ПОЛУЧИ СВОЙ', 'ОСКАР', 'В МАРКЕТИНГЕ'];
    var GROUND = '#080607';

    /* Тайминг в секундах от старта. */
    var T = {
        logoIn:    [0.10, 0.72],
        logoOut:   [2.15, 2.85],
        sloganIn:  [2.35, 3.05],
        minExit:   5.00,
        maxExit:   6.90,
        skipAfter: 0.55
    };

    var W = 0;
    var H = 0;
    var DPR = 1;

    var mainCv, mainCtx;
    var fireCv, fireCtx;
    var maskCv, maskCtx;
    var glowCv, glowCtx;

    var logoImg = new Image();
    var logoSrc = 'logo.svg';
    var logoLoaded = false;
    var logoFailed = false;


    var logoMask = null;
    var sloganMask = null;

    var logoBox = { x: 0, y: 0, w: 0, h: 0, top: 0, bottom: 0 };
    var sloganBox = { lines: [], size: 0, top: 0, bottom: 0, width: 0 };
    var fireRect = { sx: 0, sy: 0, sw: 1, sh: 1, dx: 0, dy: 0, dw: 0, dh: 0 };
    var layout = { bandTop: 0, bandBottom: 0 };

    var startTime = 0;
    var rafId = 0;
    var running = false;
    var waitingForFire = false;
    var waitStarted = 0;
    var leaving = false;
    var finished = false;
    var frozen = false;
    var exitAt = null;
    var exitStart = 0;
    var siteReady = false;
    var baseAlpha = 1;

    var embers = [];
    var lastEmber = 0;
    var lastFrame = 0;

    var fireSourceW = 0;
    var fireSourceH = 0;
    var exitLayer = 'slogan';

    var params = new URLSearchParams(window.location.search);
    var freezeAt = parseFloat(params.get('t'));
    var noIntro = params.get('intro') === '0';

    mainCv = canvas;
    mainCtx = ctx;

    fireCv = document.createElement('canvas');
    fireCtx = fireCv.getContext('2d');
    maskCv = document.createElement('canvas');
    maskCtx = maskCv.getContext('2d');
    glowCv = document.createElement('canvas');
    glowCtx = glowCv.getContext('2d');

    /* ---------- утилиты ---------- */

    function clamp(v, min, max) {
        return v < min ? min : v > max ? max : v;
    }

    function ease(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function span(t, from, to) {
        return clamp((t - from) / (to - from), 0, 1);
    }

    /* ---------- разметка и размеры ---------- */

    function setupCanvas(cv, c) {
        cv.width = Math.round(W * DPR);
        cv.height = Math.round(H * DPR);
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function measureSlogan(ctx2, size) {
        ctx2.font = '400 ' + size + 'px "Dela Award", sans-serif';
        if ('letterSpacing' in ctx2) {
            ctx2.letterSpacing = '-0.012em';
        }
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        return SLOGAN.map(function (line) {
            return ctx2.measureText(line).width;
        });
    }

    function fitSlogan() {
        var maxW = mobileQuery.matches
            ? W * 0.9
            : Math.min(W * 0.78, 1400);
        var probe = maskCtx;
        var base = 100;
        var widths = measureSlogan(probe, base);
        var widest = Math.max.apply(null, widths);
        var size = base * (maxW / widest);
        size = Math.min(size, H * 0.15, 150);
        size = Math.max(size, 20);
        return size;
    }

    function buildSloganMask() {
        if (sloganMask) {
            return;
        }
        sloganMask = document.createElement('canvas');
        sloganMask.width = maskCv.width;
        sloganMask.height = maskCv.height;
        var c = sloganMask.getContext('2d');
        c.setTransform(DPR, 0, 0, DPR, 0, 0);

        var size = fitSlogan();
        measureSlogan(c, size);
        var lineH = size * 1.05;
        var total = lineH * SLOGAN.length;
        var first = H / 2 - total / 2 + lineH / 2;
        var widest = 0;

        c.fillStyle = '#fff';
        SLOGAN.forEach(function (line, i) {
            c.fillText(line, W / 2, first + i * lineH);
            widest = Math.max(widest, c.measureText(line).width);
        });

        sloganBox.size = size;
        sloganBox.lines = SLOGAN.slice();
        sloganBox.width = widest;
        sloganBox.top = H / 2 - total / 2;
        sloganBox.bottom = H / 2 + total / 2;
    }

    function buildLogoMask() {
        if (logoMask) {
            return;
        }
        logoMask = document.createElement('canvas');
        logoMask.width = maskCv.width;
        logoMask.height = maskCv.height;
        var c = logoMask.getContext('2d');
        c.setTransform(DPR, 0, 0, DPR, 0, 0);

        var maxW = mobileQuery.matches
            ? Math.min(W * 0.84, 460)
            : Math.min(W * 0.64, 980);
        var ratio = 230 / 45;
        var w = maxW;
        var h = w / ratio;
        var x = (W - w) / 2;
        var y = H / 2 - h / 2;

        if (logoLoaded) {
            c.drawImage(logoImg, x, y, w, h);

            /* Тонкий зазор между «С» и «П»: в огне они сливаются в один блок. */
            var gapX = x + w * (44.7 / 230);
            var gapW = Math.max(1.6, w * 0.0032);
            c.globalCompositeOperation = 'destination-out';
            c.fillRect(gapX - gapW / 2, y, gapW, h);
            c.globalCompositeOperation = 'source-over';
        } else if (logoFailed) {
            c.fillStyle = '#fff';
            c.font = '900 ' + Math.round(h * 0.66) + 'px "Dela Award", sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('СУРОВАЯ ПРЕМИЯ', W / 2, H / 2);
        }

        logoBox.x = x;
        logoBox.y = y;
        logoBox.w = w;
        logoBox.h = h;
        logoBox.top = y;
        logoBox.bottom = y + h;
    }

    function computeFireRect() {
        var bandTop = Math.min(logoBox.top, sloganBox.top);
        var bandBottom = Math.max(logoBox.bottom, sloganBox.bottom);
        var bandH = Math.max(bandBottom - bandTop, H * 0.12);
        var textW = Math.max(logoBox.w, sloganBox.width, W * 0.3);
        var sw = fireSourceW || 1440;
        var sh = fireSourceH || 760;

        /* Берём не весь кадр, а яркую полосу пламени: так огонь
           остаётся крупным и не уходит в тёмные края ролика. */
        var crop = mobileQuery.matches
            ? { cx: 0.5, cy: 0.8, w: 0.98, h: 0.52 }
            : { cx: 0.78, cy: 0.82, w: 0.55, h: 0.55 };

        var cw = sw * crop.w;
        var ch = sh * crop.h;
        var sx = clamp(sw * crop.cx - cw / 2, 0, sw - cw);
        var sy = clamp(sh * crop.cy - ch / 2, 0, sh - ch);

        var targetW = textW * 1.18;
        var targetH = bandH * 1.68;
        var scale = Math.max(targetW / cw, targetH / ch);

        var dw = cw * scale;
        var dh = ch * scale;
        var cx = W / 2;
        var cy = (bandTop + bandBottom) / 2;

        fireRect.sx = sx;
        fireRect.sy = sy;
        fireRect.sw = cw;
        fireRect.sh = ch;
        fireRect.dw = dw;
        fireRect.dh = dh;
        fireRect.dx = cx - dw / 2;
        fireRect.dy = cy - dh / 2;

        layout.bandTop = bandTop;
        layout.bandBottom = bandBottom;
    }

    function layoutAll() {
        W = Math.max(1, window.innerWidth);
        H = Math.max(1, window.innerHeight);
        DPR = Math.min(window.devicePixelRatio || 1, 1.6);
        if (W * DPR > 3200) {
            DPR = 3200 / W;
        }

        setupCanvas(mainCv, mainCtx);
        setupCanvas(fireCv, fireCtx);
        setupCanvas(maskCv, maskCtx);

        var gw = Math.max(1, Math.round(W * DPR * 0.22));
        var gh = Math.max(1, Math.round(H * DPR * 0.22));
        glowCv.width = gw;
        glowCv.height = gh;
        glowCtx.setTransform(1, 0, 0, 1, 0, 0);

        logoMask = null;
        sloganMask = null;
        buildLogoMask();
        buildSloganMask();
        computeFireRect();
    }

    /* ---------- источник огня ---------- */

    function fireSource() {
        return video && video.readyState >= 2 ? video : null;
    }

    function syncSourceSize() {
        if (!video) {
            return;
        }
        var w = video.videoWidth;
        var h = video.videoHeight;
        if (w && h && (w !== fireSourceW || h !== fireSourceH)) {
            fireSourceW = w;
            fireSourceH = h;
            computeFireRect();
        }
    }

    /* ---------- маска ---------- */

    function drawMaskLayer(layerCv, lineY, visibleBelow) {
        if (!layerCv) {
            return;
        }

        if (lineY === null) {
            maskCtx.drawImage(layerCv, 0, 0, W, H);
            return;
        }

        var y = clamp(lineY, -40, H + 40);

        maskCtx.save();
        maskCtx.beginPath();
        if (visibleBelow) {
            maskCtx.rect(0, y, W, H - y + 40);
        } else {
            maskCtx.rect(0, -40, W, y + 40);
        }
        maskCtx.clip();
        maskCtx.drawImage(layerCv, 0, 0, W, H);
        maskCtx.restore();

        /* Мягкая кромка: три полосы со спадом яркости. */
        var bands = 3;
        var bandH = 10;
        var alphas = [0.58, 0.3, 0.12];

        for (var i = 0; i < bands; i++) {
            var top = visibleBelow
                ? y - (i + 1) * bandH
                : y + i * bandH;
            maskCtx.save();
            maskCtx.globalAlpha = alphas[i];
            maskCtx.beginPath();
            maskCtx.rect(0, top, W, bandH);
            maskCtx.clip();
            maskCtx.drawImage(layerCv, 0, 0, W, H);
            maskCtx.restore();
        }
    }

    function buildMask(t) {
        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        maskCtx.clearRect(0, 0, maskCv.width, maskCv.height);
        maskCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

        var counts = false;

        /* Без движения: показываем кадры без прожига и искр. */
        if (reducedQuery.matches) {
            if (t < T.sloganIn[0]) {
                drawMaskLayer(logoMask, null);
            } else {
                drawMaskLayer(sloganMask, null);
            }
            return true;
        }

        if (leaving) {
            var eT = Math.max(0, performance.now() / 1000 - exitStart);
            var pE = span(eT, 0.02, 0.82);
            var layer = exitLayer === 'logo' ? logoMask : sloganMask;
            var top = exitLayer === 'logo' ? logoBox.top : sloganBox.top;
            var bottom = exitLayer === 'logo' ? logoBox.bottom : sloganBox.bottom;
            var yE = bottom + 40 - ease(pE) * (bottom - top + 80);
            drawMaskLayer(layer, yE, false);
            return true;
        }

        /* Логотип: появляется снизу прожигом, уходит вверх прожигом. */
        if (t < T.logoOut[1] + 0.02) {
            counts = true;
            if (t < T.logoIn[0]) {
                /* ещё не виден */
            } else if (t < T.logoIn[1]) {
                var pIn = ease(span(t, T.logoIn[0], T.logoIn[1]));
                var yIn = logoBox.bottom + 36 - pIn * (logoBox.h + 72);
                drawMaskLayer(logoMask, yIn, true);
            } else if (t < T.logoOut[0]) {
                drawMaskLayer(logoMask, null);
            } else {
                var pOut = ease(span(t, T.logoOut[0], T.logoOut[1]));
                var yOut = logoBox.bottom + 36 - pOut * (logoBox.h + 72);
                drawMaskLayer(logoMask, yOut, false);
            }
        }

        /* Слоган: прожиг снизу вверх. */
        if (t >= T.sloganIn[0]) {
            counts = true;
            if (t < T.sloganIn[1]) {
                var pS = ease(span(t, T.sloganIn[0], T.sloganIn[1]));
                var yS = sloganBox.bottom + 40 - pS * (sloganBox.bottom - sloganBox.top + 80);
                drawMaskLayer(sloganMask, yS, true);
            } else {
                drawMaskLayer(sloganMask, null);
            }
        }

        return counts;
    }

    /* ---------- искры ---------- */

    function spawnEmbers(y, count, spread) {
        if (reducedQuery.matches) {
            return;
        }
        for (var i = 0; i < count; i++) {
            if (embers.length > 130) {
                break;
            }
            embers.push({
                x: W * 0.5 + (Math.random() - 0.5) * spread,
                y: y + (Math.random() - 0.5) * 18,
                vx: (Math.random() - 0.5) * 26,
                vy: -24 - Math.random() * 58,
                life: 0,
                max: 0.7 + Math.random() * 1.4,
                size: 0.8 + Math.random() * 1.8,
                hot: Math.random()
            });
        }
    }

    function updateEmbers(dt, t) {
        var i;
        for (i = embers.length - 1; i >= 0; i--) {
            var e = embers[i];
            e.life += dt;
            if (e.life >= e.max) {
                embers.splice(i, 1);
                continue;
            }
            e.x += (e.vx + Math.sin(t * 3 + e.y * 0.02) * 14) * dt;
            e.y += e.vy * dt;
            e.vy += 12 * dt;
            e.vx *= 0.995;
        }
    }

    function drawEmbers() {
        if (!embers.length) {
            return;
        }
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < embers.length; i++) {
            var e = embers[i];
            var k = 1 - e.life / e.max;
            var a = Math.pow(k, 1.4) * (0.35 + e.hot * 0.5);
            var len = e.size * (1 + k * 2.2);
            ctx.fillStyle = e.hot > 0.55
                ? 'rgba(255, 186, 120, ' + a.toFixed(3) + ')'
                : 'rgba(255, 96, 38, ' + a.toFixed(3) + ')';
            ctx.fillRect(e.x, e.y, e.size, len);
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    /* ---------- отрисовка ---------- */

    function drawFire(t) {
        var src = fireSource();
        var source = video;

        if (!src) {
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            ctx.fillStyle = GROUND;
            ctx.fillRect(0, 0, W, H);
            return;
        }

        fireCtx.setTransform(1, 0, 0, 1, 0, 0);
        fireCtx.clearRect(0, 0, fireCv.width, fireCv.height);
        fireCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

        /* Тёмная основа из раскалённых углей: даже в тёмных участках
           ролика буквы остаются читаемыми и тёплыми. */
        var base = fireCtx.createLinearGradient(0, layout.bandTop, 0, layout.bandBottom);
        base.addColorStop(0, '#6a2411');
        base.addColorStop(0.5, '#7a2a12');
        base.addColorStop(1, '#5f200d');
        fireCtx.fillStyle = base;
        fireCtx.fillRect(0, 0, W, H);

        if (src) {
            syncSourceSize();

            fireCtx.globalCompositeOperation = 'lighter';
            fireCtx.globalAlpha = 0.95;
            fireCtx.drawImage(
                source,
                fireRect.sx, fireRect.sy, fireRect.sw, fireRect.sh,
                fireRect.dx, fireRect.dy, fireRect.dw, fireRect.dh
            );

            /* Второй слой огня со сдвигом: заполняет тёмные промежутки
               и даёт более плотную, живую фактуру внутри букв. */
            fireCtx.globalAlpha = 0.42;
            fireCtx.drawImage(
                source,
                fireRect.sx, fireRect.sy, fireRect.sw, fireRect.sh,
                fireRect.dx - fireRect.dw * 0.2,
                fireRect.dy + fireRect.dh * 0.06,
                fireRect.dw * 1.06, fireRect.dh * 1.06
            );

            fireCtx.globalAlpha = 1;
            fireCtx.globalCompositeOperation = 'source-over';
        }

        fireCtx.globalCompositeOperation = 'destination-in';
        fireCtx.drawImage(maskCv, 0, 0, W, H);
        fireCtx.globalCompositeOperation = 'source-over';

        /* Лёгкое мерцание всего огня. */
        var flicker = 1;
        if (!reducedQuery.matches) {
            flicker = 0.9 + 0.1 * (0.55 + 0.45 * Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1.2));
        }

        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = GROUND;
        ctx.fillRect(0, 0, W, H);

        /* Тёплое дыхание за буквами. */
        var halo = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.38);
        halo.addColorStop(0, 'rgba(245, 102, 36, ' + (0.012 + 0.01 * flicker).toFixed(3) + ')');
        halo.addColorStop(0.7, 'rgba(180, 54, 16, 0.004)');
        halo.addColorStop(1, 'rgba(8, 6, 7, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, W, H);

        ctx.globalAlpha = clamp(baseAlpha * flicker, 0, 1);
        ctx.drawImage(fireCv, 0, 0, W, H);

        /* Свечение вокруг букв: уменьшенная копия, растянутая обратно. */
        glowCtx.setTransform(1, 0, 0, 1, 0, 0);
        glowCtx.clearRect(0, 0, glowCv.width, glowCv.height);
        glowCtx.drawImage(fireCv, 0, 0, glowCv.width, glowCv.height);

        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp((0.28 + 0.08 * flicker) * baseAlpha, 0, 1);
        ctx.drawImage(glowCv, 0, 0, W, H);

        drawEmbers();

        /* Вспышка на смене кадров и на выходе. */
        var flash = 0;
        var mid = (T.logoOut[0] + T.sloganIn[1]) / 2;
        flash = Math.max(flash, 1 - Math.abs(t - mid) / 0.55);
        if (leaving) {
            var eT = performance.now() / 1000 - exitStart;
            flash = Math.max(flash, 1 - eT / 0.7);
        }
        if (flash > 0) {
            var fa = Math.pow(clamp(flash, 0, 1), 2) * 0.13 * baseAlpha;
            if (reducedQuery.matches) {
                fa = 0;
            }
            if (fa > 0) {
                var fg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.5);
                fg.addColorStop(0, 'rgba(255, 160, 90, ' + fa.toFixed(3) + ')');
                fg.addColorStop(0.5, 'rgba(245, 102, 36, ' + (fa * 0.5).toFixed(3) + ')');
                fg.addColorStop(1, 'rgba(245, 102, 36, 0)');
                ctx.fillStyle = fg;
                ctx.fillRect(0, 0, W, H);
            }
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    function tick(now) {
        if (!running) {
            return;
        }

        /* Пока нет первого кадра огня — чёрный экран, без стоп-кадра. */
        if (waitingForFire) {
            if (video && video.readyState >= 2) {
                waitingForFire = false;
                startTime = now;
                lastFrame = now;
                lastEmber = now;
            } else if (now - waitStarted > 4000) {
                waitingForFire = false;
                startLeaving(now);
                ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
                ctx.fillStyle = GROUND;
                ctx.fillRect(0, 0, W, H);
                rafId = requestAnimationFrame(tick);
                return;
            } else {
                ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
                ctx.fillStyle = GROUND;
                ctx.fillRect(0, 0, W, H);
                rafId = requestAnimationFrame(tick);
                return;
            }
        }

        var t = (now - startTime) / 1000;
        var dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
        lastFrame = now;

        if (exitAt === null) {
            if ((siteReady && t >= T.minExit) || t >= T.maxExit) {
                exitAt = Math.min(t, T.maxExit);
                startLeaving(now);
            }
        }

        buildMask(t);
        drawFire(t);

        /* Искры вдоль кромки прожига и вокруг букв. */
        if (!reducedQuery.matches) {
            if (t > T.logoIn[0] && t < T.logoIn[1]) {
                var pIn = ease(span(t, T.logoIn[0], T.logoIn[1]));
                var yIn = logoBox.bottom + 36 - pIn * (logoBox.h + 72);
                if (now - lastEmber > 26) {
                    spawnEmbers(yIn, 2, logoBox.w * 1.05);
                    lastEmber = now;
                }
            }
            if (t > T.logoOut[0] && t < T.logoOut[1]) {
                var pOut = ease(span(t, T.logoOut[0], T.logoOut[1]));
                var yOut = logoBox.bottom + 36 - pOut * (logoBox.h + 72);
                if (now - lastEmber > 22) {
                    spawnEmbers(yOut, 3, logoBox.w * 1.05);
                    lastEmber = now;
                }
            }
            if (t > T.sloganIn[0] && t < T.sloganIn[1]) {
                var pS = ease(span(t, T.sloganIn[0], T.sloganIn[1]));
                var yS = sloganBox.bottom + 40 - pS * (sloganBox.bottom - sloganBox.top + 80);
                if (now - lastEmber > 20) {
                    spawnEmbers(yS, 3, sloganBox.width);
                    lastEmber = now;
                }
            }
            if (t > T.sloganIn[1] && !leaving && Math.random() < 0.35) {
                spawnEmbers(sloganBox.bottom - 4, 1, sloganBox.width * 0.9);
            }
            if (leaving) {
                var eT = now / 1000 - exitStart;
                if (eT < 0.85 && now - lastEmber > 18) {
                    var pE = span(eT, 0.02, 0.82);
                    var yE = sloganBox.bottom + 40 - ease(pE) * (sloganBox.bottom - sloganBox.top + 80);
                    spawnEmbers(yE, 3, sloganBox.width);
                    lastEmber = now;
                }
            }
            updateEmbers(dt, t);
        }

        rafId = requestAnimationFrame(tick);
    }

    /* ---------- запуск и выход ---------- */

    function startLeaving(now) {
        if (leaving) {
            return;
        }
        leaving = true;
        exitStart = now / 1000;
        exitLayer = exitStart < T.sloganIn[0] + 0.15 ? 'logo' : 'slogan';
        root.classList.remove('is-armed');

        /* Сначала даём слогану догореть на чёрном, и только потом
           открываем сайт — без двойного текста в кадре. */
        window.setTimeout(beginReveal, 800);
        window.setTimeout(finish, 1760);
    }

    function adoptIntroVideo() {
        /* Один ролик на заставку и на фон первого экрана: после появления
           сайта переносим уже загруженное видео в огонь под заголовком,
           чтобы не скачивать те же 3,4 МБ второй раз. */
        if (!video) {
            return;
        }
        var media = document.querySelector('.fire-media');
        if (!media) {
            return;
        }
        var target = media.querySelector('video');
        if (target === video) {
            return;
        }
        if (target) {
            video.setAttribute('data-src-desktop', target.getAttribute('data-src-desktop') || '');
            video.setAttribute('data-src-mobile', target.getAttribute('data-src-mobile') || '');
            target.remove();
        }
        video.classList.remove('intro__video');
        video.classList.add('fire-video');
        video.removeAttribute('data-intro-video');
        media.appendChild(video);
    }

    function beginReveal() {
        root.classList.add('is-leaving');
        if (frame) {
            frame.inert = false;
        }
        if (siteRoot) {
            siteRoot.inert = false;
        }
        if (document.body.classList.contains('is-intro')) {
            document.body.classList.remove('is-intro');
            document.documentElement.classList.remove('is-intro');
        }
        toTop();
        adoptIntroVideo();
        announceIntroDone();
    }

    function finish() {
        if (finished) {
            return;
        }
        finished = true;
        running = false;
        cancelAnimationFrame(rafId);
        root.hidden = true;
        root.classList.remove('is-leaving', 'is-armed');
        toTop();
        if (video) {
            if (root.contains(video)) {
                video.pause();
            }
        }
        if (replayBtn) {
            replayBtn.hidden = false;
        }
        release();
    }

    /* Отпускаем память полноэкранных canvas после выхода. */
    function release() {
        mainCv.width = 1;
        mainCv.height = 1;
        fireCv.width = 1;
        fireCv.height = 1;
        maskCv.width = 1;
        maskCv.height = 1;
        glowCv.width = 1;
        glowCv.height = 1;
        logoMask = null;
        sloganMask = null;
    }

    function skip() {
        if (finished || leaving) {
            return;
        }
        var t = (performance.now() - startTime) / 1000;
        if (!root.classList.contains('is-armed') && t < T.skipAfter) {
            return;
        }
        startLeaving(performance.now());
    }

    function armSkip() {
        root.classList.add('is-armed');
    }

    function boot() {
        W = 0;
        root.hidden = false;
        root.classList.remove('is-leaving', 'is-armed');
        document.body.classList.add('is-intro');
        document.documentElement.classList.add('is-intro');
        toTop();
        if (frame) {
            frame.inert = true;
        }
        if (siteRoot) {
            siteRoot.inert = true;
        }
        if (replayBtn) {
            replayBtn.hidden = true;
        }
        finished = false;
        leaving = false;
        exitAt = null;
        embers = [];
        frozen = !isNaN(freezeAt);

        layoutAll();

        if (video) {
            video.muted = true;
            video.loop = true;
            var src = mobileQuery.matches
                ? 'media/fire/fire-mobile-540-loop.mp4'
                : 'media/fire/fire-desktop-1440-loop.mp4';
            if (video.getAttribute('src') !== src) {
                video.setAttribute('src', src);
                video.load();
            }
            var p = video.play();
            if (p && p.catch) {
                p.catch(function () {});
            }
        }

        if (frozen) {
            running = false;
            startTime = performance.now() - freezeAt * 1000;
            if (video) {
                video.pause();
            }
            renderStatic();
            window.setTimeout(renderStatic, 350);
            window.setTimeout(renderStatic, 1200);
            window.setTimeout(renderStatic, 2500);
            root.classList.add('is-armed');
            return;
        }

        startTime = performance.now();
        waitStarted = startTime;
        waitingForFire = !frozen;
        exitStart = 0;
        lastFrame = startTime;
        lastEmber = startTime;
        running = true;
        baseAlpha = 1;
        canvas.style.transition = 'none';

        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(tick);
        window.setTimeout(armSkip, 700);
    }

    function renderStatic() {
        if (!frozen || finished) {
            return;
        }
        buildMask(freezeAt);
        drawFire(freezeAt);
    }

    function replay() {
        if (!finished && !root.hidden) {
            return;
        }
        if (video) {
            try {
                video.currentTime = 0;
            } catch (e) {}
        }
        boot();
    }

    /* ---------- события ---------- */

    if (skipBtn) {
        skipBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            skip();
        });
    }

    root.addEventListener('click', skip);

    document.addEventListener('keydown', function (e) {
        if (finished) {
            return;
        }
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
            skip();
        }
    });

    if (replayBtn) {
        replayBtn.addEventListener('click', replay);
    }

    if (frame) {
        var markSiteReady = function () {
            siteReady = true;
            try {
                var d = frame.contentDocument;
                if (d && d.fonts && d.fonts.ready) {
                    d.fonts.ready.then(function () {
                        siteReady = true;
                    });
                }
            } catch (e) {}
        };
        frame.addEventListener('load', markSiteReady);
        try {
            if (frame.contentDocument && frame.contentDocument.readyState === 'complete') {
                markSiteReady();
            }
        } catch (e) {
            siteReady = true;
        }

        /* Ждём не полную загрузку роликов, а готовый DOM сайта:
           этого достаточно, чтобы показать первый экран. */
        var framePoll = window.setInterval(function () {
            try {
                var d = frame.contentDocument;
                if (d && d.readyState !== 'loading') {
                    siteReady = true;
                }
            } catch (e) {
                siteReady = true;
            }
            if (siteReady || finished) {
                window.clearInterval(framePoll);
            }
        }, 200);
    } else {
        /* На основной странице iframe нет: DOM к моменту defer-скрипта
           уже разобран, дальше заставку держит только минимальное время. */
        siteReady = true;
    }

    if (video) {
        video.addEventListener('loadeddata', renderStatic);
    }

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            if (finished) {
                return;
            }
            layoutAll();
        }, 140);
    });

    logoImg.onload = function () {
        logoLoaded = true;
        if (!W) {
            return;
        }
        logoMask = null;
        buildLogoMask();
        computeFireRect();
        renderStatic();
    };
    logoImg.onerror = function () {
        logoFailed = true;
    };
    logoImg.src = logoSrc;

    if (document.fonts && document.fonts.load) {
        document.fonts.load('400 100px "Dela Award"').then(function () {
            sloganMask = null;
            buildSloganMask();
            computeFireRect();
            renderStatic();
        }).catch(function () {});
    }

    function startIntro() {
        if (logoLoaded) {
            boot();
            return;
        }
        var started = false;
        var go = function () {
            if (started) {
                return;
            }
            started = true;
            boot();
        };
        if (logoImg.complete && logoImg.naturalWidth) {
            logoLoaded = true;
            go();
            return;
        }
        logoImg.addEventListener('load', go);
        logoImg.addEventListener('error', go);
        window.setTimeout(go, 700);
    }

    window.__intro = {
        replay: replay,
        skip: skip,
        time: function () {
            return (performance.now() - startTime) / 1000;
        }
    };

    if (noIntro) {
        root.hidden = true;
        document.body.classList.remove('is-intro');
        document.documentElement.classList.remove('is-intro');
        toTop();
        if (frame) {
            frame.inert = false;
        }
        if (siteRoot) {
            siteRoot.inert = false;
        }
        if (replayBtn) {
            replayBtn.hidden = false;
        }
        announceIntroDone();
        finished = true;
        return;
    }

    try {
        startIntro();
    } catch (err) {
        root.hidden = true;
        document.body.classList.remove('is-intro');
        document.documentElement.classList.remove('is-intro');
        toTop();
        if (frame) {
            frame.inert = false;
        }
        if (siteRoot) {
            siteRoot.inert = false;
        }
        if (replayBtn) {
            replayBtn.hidden = false;
        }
        announceIntroDone();
        finished = true;
    }
})();
