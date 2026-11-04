/* Фон «Суровой премии»: ролик огня, искры и управление движением.
   На слабом устройстве огонь не включается — остаётся чёрный фон. */

(function () {
    'use strict';

    var scene = document.querySelector('[data-fire-scene]');
    if (!scene) {
        return;
    }

    var video = scene.querySelector('video');
    var toggle = document.querySelector('[data-fire-toggle]');
    var label = document.querySelector('[data-fire-label]');
    var statusEl = document.querySelector('[data-fire-status]');
    var speedInput = document.querySelector('[data-fire-speed-input]');
    var speedOutput = document.querySelector('[data-fire-speed-out]');
    if (!video) {
        return;
    }

    var mobileQuery = window.matchMedia('(max-width: 600px) and (orientation: portrait)');
    var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var waitFull = scene.getAttribute('data-wait') === 'full';
    var forcedStill = scene.getAttribute('data-still') === '1';
    var rate = parseFloat(scene.getAttribute('data-rate') || '1') || 1;

    var wantsMotion = !forcedStill;
    var blocked = false;
    // Без режима ожидания ролик можно запускать сразу: постер уже на месте.
    var ready = !waitFull && !forcedStill;
    var revealed = false;
    var loadedSource = '';
    var loadToken = 0;
    var objectUrl = '';
    var sparks = null;
    var sceneVisible = true;
    var burnVisible = false;
    var burnActive = false;
    var suspended = false;

    video.muted = true;
    video.loop = true;

    function setStatus(text) {
        if (statusEl) {
            statusEl.textContent = text;
        }
    }

    /** Скорость ролика: 0.35–1.5, значение показываем на бегунке. */
    function applySpeed(value) {
        var next = parseFloat(value);
        if (!isFinite(next)) {
            next = rate;
        }
        next = Math.max(0.35, Math.min(1.5, next));
        rate = next;
        video.playbackRate = next;
        if (speedOutput) {
            speedOutput.textContent = next.toFixed(2).replace('.', ',') + '×';
        }

        return next;
    }

    /** Почему огонь нельзя включать: '' — можно. */
    function blockReason() {
        if (reducedQuery.matches) {
            return 'уменьшено движение — чёрный фон';
        }

        var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection) {
            if (connection.saveData) {
                return 'экономия трафика — чёрный фон';
            }
            if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
                return 'медленная сеть — чёрный фон';
            }
        }

        if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 2) {
            return 'слабое устройство — чёрный фон';
        }

        if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2) {
            return 'мало памяти — чёрный фон';
        }

        if (window.matchMedia('(update: slow)').matches) {
            return 'медленный экран — чёрный фон';
        }

        if (typeof video.canPlayType === 'function' && !video.canPlayType('video/mp4')) {
            return 'видео не поддерживается — чёрный фон';
        }

        return '';
    }

    function disableFire(reason) {
        setStatus(reason);

        var speedBox = document.querySelector('[data-fire-speed]');
        if (speedBox) {
            speedBox.remove();
        }

        if (scene.querySelector('.fire-still')) {
            scene.classList.add('is-still');
            if (toggle) {
                toggle.hidden = true;
            }
            return;
        }

        if (toggle) {
            toggle.remove();
        }
        scene.remove();
        document.documentElement.classList.add('fire-off');
    }

    var reason = blockReason();
    if (reason) {
        disableFire(reason);
        return;
    }

    var sparkCanvas = scene.querySelector('.fire-sparks');
    sparks = sparkCanvas ? createSparks(sparkCanvas) : null;

    createBurn(function (visible) {
        burnVisible = visible;
        /* Если заголовок миссии в кадре, огонь в буквах важнее паузы
           на время прожига между секциями. */
        suspended = burnActive && !burnVisible;
        sync();
    });
    observeScene();

    function sourceFor() {
        return mobileQuery.matches ? video.getAttribute('data-src-mobile') : video.getAttribute('data-src-desktop');
    }

    function applySource() {
        var source = sourceFor();
        if (!source || source === loadedSource) {
            return;
        }

        /* Заставка уже загрузила этот же ролик и отдала его сюда:
           второй раз по сети не тянем. */
        if (video.getAttribute('src') === source) {
            loadedSource = source;
            if (video.readyState >= 2) {
                markReady();
                reveal();
                sync();
            }
            return;
        }

        loadedSource = source;
        ready = false;
        revealed = false;
        loadToken += 1;
        scene.classList.remove('is-ready');
        if (toggle) {
            toggle.hidden = true;
        }
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = '';
        }

        // На странице с ожиданием качаем ролик целиком: только после этого
        // показываем огонь, чтобы не было рывка на недогруженном видео.
        if (waitFull && typeof window.fetch === 'function' && window.Blob && window.URL && URL.createObjectURL) {
            download(source, loadToken);
            return;
        }

        video.src = source;
        video.load();
    }

    function download(source, token) {
        setStatus('загрузка 0%');

        fetch(source, { credentials: 'same-origin' })
            .then(function (response) {
                if (!response.ok || !response.body || typeof response.body.getReader !== 'function') {
                    throw new Error('stream');
                }

                var total = parseInt(response.headers.get('Content-Length') || '0', 10);
                var reader = response.body.getReader();
                var chunks = [];
                var received = 0;

                function pump() {
                    return reader.read().then(function (step) {
                        if (token !== loadToken) {
                            throw new Error('stale');
                        }
                        if (step.done) {
                            return new Blob(chunks, { type: 'video/mp4' });
                        }

                        chunks.push(step.value);
                        received += step.value.length;
                        if (total) {
                            setStatus('загрузка ' + Math.min(99, Math.round(received / total * 100)) + '%');
                        } else {
                            setStatus('загрузка ' + (received / 1048576).toFixed(1) + ' МБ');
                        }
                        return pump();
                    });
                }

                return pump();
            })
            .then(function (blob) {
                if (token !== loadToken) {
                    return;
                }

                objectUrl = URL.createObjectURL(blob);
                video.src = objectUrl;
                video.load();
                markReady();
                sync();
            })
            .catch(function () {
                if (token !== loadToken) {
                    return;
                }
                setStatus('ролик не загрузился — чёрный фон');
            });
    }

    function isFullyBuffered() {
        if (!waitFull) {
            return true;
        }
        if (!video.duration || !isFinite(video.duration)) {
            return false;
        }
        if (video.readyState < 3) {
            return false;
        }
        var buffered = video.buffered;
        return buffered.length > 0 && buffered.end(buffered.length - 1) >= video.duration - 0.25;
    }

    function updateProgress() {
        if (!waitFull || ready || !video.duration || !isFinite(video.duration)) {
            return;
        }
        var buffered = video.buffered;
        var end = buffered.length ? buffered.end(buffered.length - 1) : 0;
        var percent = Math.max(0, Math.min(100, Math.round(end / video.duration * 100)));
        setStatus('загрузка ' + percent + '%');
    }

    /** Ролик готов к запуску. Показываем его только когда готов кадр. */
    function markReady() {
        if (ready) {
            return;
        }
        ready = true;
        if (toggle) {
            toggle.hidden = false;
        }
        setStatus('огонь загружен — показываем');
        if (sparks) {
            sparks.setActive(wantsMotion && !document.hidden && sceneVisible);
        }
        updateUi();
    }

    /** Проявить огонь: только после того, как декодирован первый кадр,
        иначе 4K-видео появляется рывком уже после конца затухания. */
    function reveal() {
        if (revealed || !ready) {
            return;
        }
        revealed = true;
        requestAnimationFrame(function () {
            scene.classList.add('is-ready');
        });
    }

    function updateUi() {
        var playing = !video.paused && !video.ended;
        if (toggle) {
            toggle.setAttribute('data-state', playing ? 'playing' : 'paused');
            toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
            toggle.setAttribute('aria-label', playing ? 'Пауза фона' : 'Включить фон');
        }
        if (label) {
            label.textContent = playing ? 'Пауза фона' : 'Включить фон';
        }
    }

    function shouldPlay() {
        return ready && !blocked && wantsMotion && !suspended &&
            !document.hidden && (sceneVisible || burnVisible);
    }

    function play() {
        if (!ready || blocked || !wantsMotion || document.hidden) {
            return;
        }
        if (!sceneVisible && !burnVisible) {
            return;
        }

        var promise = video.play();
        if (promise && typeof promise.catch === 'function') {
            promise.catch(function () {
                blocked = true;
                if (toggle) {
                    toggle.hidden = false;
                }
                setStatus('автозапуск запрещён — нажмите на огонь');
                updateUi();
            });
        }
    }

    function pause() {
        if (!video.paused) {
            video.pause();
        }
    }

    function sync() {
        if (!ready) {
            pause();
            if (sparks) {
                sparks.setActive(false);
            }
            return;
        }

        if (sparks) {
            sparks.setActive(wantsMotion && !document.hidden && sceneVisible && !suspended);
        }

        if (shouldPlay()) {
            play();
        } else {
            pause();
        }
    }

    video.addEventListener('loadedmetadata', function () {
        video.playbackRate = rate;
        updateProgress();
    });

    // Первый декодированный кадр — можно плавно проявлять.
    video.addEventListener('loadeddata', reveal);
    video.addEventListener('canplay', reveal);

    video.addEventListener('progress', function () {
        updateProgress();
        if (!ready && isFullyBuffered()) {
            markReady();
            sync();
        }
    });

    video.addEventListener('canplaythrough', function () {
        if (!ready && isFullyBuffered()) {
            markReady();
            sync();
        }
    });

    video.addEventListener('playing', function () {
        blocked = false;
        ready = true;
        if (toggle) {
            toggle.hidden = false;
        }
        reveal();
        setStatus('огонь играет');
        updateUi();
    });

    video.addEventListener('pause', updateUi);

    video.addEventListener('error', function () {
        blocked = true;
        revealed = false;
        scene.classList.remove('is-ready');
        if (sparks) {
            sparks.setActive(false);
        }
        setStatus('ролик не загрузился — чёрный фон');
        updateUi();
    });

    document.addEventListener('visibilitychange', sync);

    /* Во время прожига между секциями огонь замирает: полноэкранное видео
       и искры не конкурируют с SVG-фильтром кромки. После паузы возвращается. */
    window.addEventListener('scrollburn:active', function (event) {
        burnActive = !!(event.detail && event.detail.active);
        suspended = burnActive && !burnVisible;
        sync();
    });

    var onQueryChange = function () {
        applySource();
        sync();
    };

    if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', onQueryChange);
        reducedQuery.addEventListener('change', function () {
            if (reducedQuery.matches) {
                wantsMotion = false;
                pause();
                if (sparks) {
                    sparks.setActive(false);
                }
                updateUi();
            }
        });
    } else if (typeof mobileQuery.addListener === 'function') {
        mobileQuery.addListener(onQueryChange);
    }

    if (toggle) {
        toggle.addEventListener('click', function () {
            if (!ready) {
                return;
            }

            if (blocked) {
                blocked = false;
                wantsMotion = true;
                sync();
                updateUi();
                return;
            }

            wantsMotion = !wantsMotion;
            sync();
            updateUi();
        });
    }

    if (speedInput) {
        speedInput.addEventListener('input', function () {
            var next = applySpeed(speedInput.value);
            var url = new URL(window.location.href);
            if (Math.abs(next - 1) < 0.001) {
                url.searchParams.delete('speed');
            } else {
                url.searchParams.set('speed', next.toFixed(2));
            }
            window.history.replaceState(null, '', url);
        });
    }

    // Автозапуск мог не сработать — первое действие пользователя пробует снова.
    var retry = function () {
        if (!blocked || !ready) {
            return;
        }
        blocked = false;
        sync();
        updateUi();
    };

    document.addEventListener('pointerdown', retry, { passive: true });
    document.addEventListener('keydown', retry);

    applySource();
    applySpeed(rate);
    setStatus(waitFull ? 'ждём полную загрузку' : 'готовим ролик');
    updateProgress();
    updateUi();
    sync();

    /* Следим, виден ли первый экран: ниже него ролик и искры останавливаем. */
    function observeScene() {
        if (!window.IntersectionObserver) {
            return;
        }

        var sections = [document.querySelector('.hero'), document.querySelector('#about')];
        sections = sections.filter(function (item) { return item; });
        if (!sections.length) {
            return;
        }

        var states = [];
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var index = sections.indexOf(entry.target);
                if (index >= 0) {
                    states[index] = entry.isIntersecting;
                }
            });

            var next = states.some(function (value) { return value; });
            if (next === sceneVisible) {
                return;
            }

            sceneVisible = next;
            scene.classList.toggle('is-offscreen', !sceneVisible);
            sync();
        }, { rootMargin: '0px 0px' });

        sections.forEach(function (item) {
            observer.observe(item);
        });
    }

    /* Заголовок «Сильная работа…»: тот же ролик просвечивает через буквы.
       Маска — контуры текста, canvas рисует кадры, только пока заголовок в кадре. */
    function createBurn(onChange) {
        var title = document.querySelector('[data-burn-title]');
        if (!title) {
            return null;
        }

        var canvas = title.querySelector('.mission__burn');
        var textEl = title.querySelector('.mission__title-text');
        if (!canvas || !textEl) {
            return null;
        }

        var context = canvas.getContext('2d');
        if (!context) {
            return null;
        }

        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var mask = '';
        var visible = false;
        var active = false;
        var raf = 0;
        var last = 0;
        var resizeTimer = 0;

        function buildMask() {
            var rect = title.getBoundingClientRect();
            var width = Math.round(rect.width);
            var height = Math.round(rect.height);
            var node = textEl.firstChild;
            if (!width || !height || !node || node.nodeType !== 3) {
                return false;
            }

            var style = window.getComputedStyle(title);
            var lineHeight = parseFloat(style.lineHeight);
            if (!isFinite(lineHeight) || lineHeight <= 0) {
                lineHeight = parseFloat(style.fontSize) * 1.2;
            }

            var probe = title.querySelector('.mission__baseline');
            if (!probe) {
                return false;
            }
            var baseline = probe.getBoundingClientRect().top - rect.top;

            var maskCanvas = document.createElement('canvas');
            maskCanvas.width = Math.round(width * dpr);
            maskCanvas.height = Math.round(height * dpr);
            var maskContext = maskCanvas.getContext('2d');
            if (!maskContext) {
                return false;
            }

            maskContext.scale(dpr, dpr);
            maskContext.fillStyle = '#fff';
            maskContext.textBaseline = 'alphabetic';
            maskContext.font = style.fontStyle + ' ' + style.fontWeight + ' ' +
                style.fontSize + ' ' + style.fontFamily;
            if ('letterSpacing' in maskContext) {
                maskContext.letterSpacing = style.letterSpacing;
            }

            var text = node.nodeValue;
            var range = document.createRange();
            var chars = [];
            var index;

            for (index = 0; index < text.length; index += 1) {
                if (!/\S/.test(text.charAt(index))) {
                    continue;
                }
                range.setStart(node, index);
                range.setEnd(node, index + 1);
                var box = range.getBoundingClientRect();
                if (box.width < 0.5 || box.height < 0.5) {
                    continue;
                }
                chars.push({ index: index, top: box.top, left: box.left });
            }

            if (!chars.length) {
                return false;
            }

            var firstTop = chars[0].top;
            var lines = {};
            for (index = 0; index < chars.length; index += 1) {
                var line = Math.round((chars[index].top - firstTop) / lineHeight);
                if (!lines[line]) {
                    lines[line] = [];
                }
                lines[line].push(chars[index]);
            }

            Object.keys(lines).forEach(function (key) {
                var items = lines[key];
                var from = items[0].index;
                var to = items[items.length - 1].index;
                var lineText = text.slice(from, to + 1);
                var x = items[0].left - rect.left;
                var y = baseline + Number(key) * lineHeight;
                maskContext.fillText(lineText.toUpperCase(), x, y);
            });

            mask = maskCanvas.toDataURL('image/png');
            canvas.style.webkitMaskImage = 'url("' + mask + '")';
            canvas.style.maskImage = 'url("' + mask + '")';

            return true;
        }

        function sizeCanvas() {
            var width = Math.round(title.clientWidth * dpr);
            var height = Math.round(title.clientHeight * dpr);
            if (width && height && (canvas.width !== width || canvas.height !== height)) {
                canvas.width = width;
                canvas.height = height;
            }
        }

        function draw() {
            if (!mask) {
                return;
            }

            var width = title.clientWidth;
            var height = title.clientHeight;
            var videoWidth = video.videoWidth;
            var videoHeight = video.videoHeight;
            if (!width || !height || !videoWidth || !videoHeight || video.readyState < 2) {
                return;
            }

            sizeCanvas();
            var scale = Math.max(width / videoWidth, height / videoHeight);
            var sourceWidth = width / scale;
            var sourceHeight = height / scale;
            context.drawImage(
                video,
                (videoWidth - sourceWidth) / 2,
                videoHeight - sourceHeight,
                sourceWidth,
                sourceHeight,
                0,
                0,
                canvas.width,
                canvas.height
            );

            if (!active) {
                active = true;
                title.classList.add('is-video-burn');
            }
        }

        function tick(now) {
            raf = 0;
            if (!visible || document.hidden) {
                return;
            }
            if (now - last >= 33) {
                last = now;
                draw();
            }
            /* На паузе достаточно одного кадра — буквы замирают вместе
               с фоновым огнём, а не живут своей жизнью. */
            if (!video.paused) {
                raf = window.requestAnimationFrame(tick);
            }
        }

        function schedule() {
            if (!raf) {
                raf = window.requestAnimationFrame(tick);
            }
        }

        function setVisible(next) {
            if (next === visible) {
                return;
            }

            visible = next;
            if (visible) {
                if (!mask) {
                    if (document.fonts && document.fonts.ready) {
                        document.fonts.ready.then(function () {
                            buildMask();
                            schedule();
                        });
                    } else {
                        buildMask();
                    }
                }
                schedule();
            } else if (raf) {
                window.cancelAnimationFrame(raf);
                raf = 0;
            }

            if (onChange) {
                onChange(visible);
            }
        }

        if (window.IntersectionObserver) {
            new IntersectionObserver(function (entries) {
                setVisible(entries.some(function (entry) { return entry.isIntersecting; }));
            }, { rootMargin: '180px 0px' }).observe(title);
        } else {
            setVisible(true);
        }

        window.addEventListener('resize', function () {
            if (resizeTimer) {
                window.clearTimeout(resizeTimer);
            }
            resizeTimer = window.setTimeout(function () {
                if (visible) {
                    buildMask();
                    draw();
                } else {
                    mask = '';
                }
            }, 180);
        });

        /* Огонь снова пошёл — продолжаем перерисовывать буквы. */
        video.addEventListener('play', function () {
            if (visible) {
                schedule();
            }
        });

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (raf) {
                    window.cancelAnimationFrame(raf);
                    raf = 0;
                }
            } else if (visible) {
                schedule();
            }
        });

        return true;
    }

    /* Искры: те же параметры, что у оригинала, — 70 частиц,
       подъём снизу вверх, затухание к краям траектории. */
    function createSparks(canvas) {
        var context = canvas.getContext('2d');
        if (!context) {
            return null;
        }

        var coarse = window.matchMedia('(max-width: 900px)').matches;
        var count = 70;
        var time = 5.8;
        var width = 1;
        var height = 1;
        var scale = 1;
        var raf = 0;
        var last = 0;
        var running = false;

        function random(seed) {
            var value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
            return value - Math.floor(value);
        }

        var particles = [];
        for (var i = 0; i < count; i += 1) {
            particles.push({
                offset: random(i + 1),
                speed: 0.055 + random(i + 2) * 0.06,
                x: random(i + 3),
                radius: 0.45 + random(i + 4) * 1.1,
                drift: 20 + random(i + 5) * 60,
                phase: random(i + 6) * Math.PI * 2,
                trail: 3 + random(i + 7) * 7
            });
        }

        function draw() {
            context.setTransform(scale, 0, 0, scale, 0, 0);
            context.clearRect(0, 0, width, height);

            for (var i = 0; i < particles.length; i += 1) {
                var particle = particles[i];
                var progress = (time * particle.speed + particle.offset) % 1;
                var y = height * (1.08 - progress * 1.2);
                var x = particle.x * width + Math.sin(progress * 5 + particle.phase) * particle.drift * progress;
                var fade = Math.sin(Math.PI * progress);
                if (fade < 0.01) {
                    continue;
                }

                context.save();
                context.translate(x, y);
                context.rotate(Math.sin(progress * 4 + particle.phase) * 0.25);

                var trail = context.createLinearGradient(0, 0, 0, particle.trail);
                trail.addColorStop(0, 'rgba(238,153,84,' + fade * 0.9 + ')');
                trail.addColorStop(1, 'rgba(193,79,35,0)');
                context.lineCap = 'round';
                context.lineWidth = particle.radius;
                context.strokeStyle = trail;
                context.beginPath();
                context.moveTo(0, 0);
                context.lineTo(0, particle.trail);
                context.stroke();

                var glowRadius = particle.radius * 5;
                var glow = context.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
                glow.addColorStop(0, 'rgba(230,120,53,' + fade * 0.55 + ')');
                glow.addColorStop(1, 'rgba(206,83,32,0)');
                context.fillStyle = glow;
                context.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);

                context.fillStyle = 'rgba(246,177,108,' + fade + ')';
                context.beginPath();
                context.arc(0, 0, particle.radius * 0.55, 0, Math.PI * 2);
                context.fill();
                context.restore();
            }
        }

        function resize() {
            var box = canvas.parentElement.getBoundingClientRect();
            width = box.width;
            height = box.height;
            scale = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);

            // На странице с ожиданием полной загрузки до готовности огня
            // холст остаётся пустым — фон должен быть чёрным.
            if (running || !waitFull) {
                draw();
            }
        }

        function loop(now) {
            raf = 0;
            if (!running || document.hidden) {
                return;
            }

            var gap = now - last;
            if (gap < 1000 / (coarse ? 30 : 45)) {
                raf = requestAnimationFrame(loop);
                return;
            }

            time += Math.min(gap / 1000, 0.05);
            last = now;
            draw();
            raf = requestAnimationFrame(loop);
        }

        function start() {
            if (raf) {
                return;
            }
            last = performance.now();
            raf = requestAnimationFrame(loop);
        }

        function stop() {
            if (raf) {
                cancelAnimationFrame(raf);
            }
            raf = 0;
        }

        resize();
        window.addEventListener('resize', resize);

        return {
            setActive: function (active) {
                running = active;
                if (active) {
                    start();
                } else {
                    stop();
                }
            }
        };
    }
})();
