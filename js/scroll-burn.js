/* ==========================================================================
   Scroll Burn — прожиг между секциями.
   Векторная кромка (SVG-путь с CSS-заливкой) во всех браузерах: она
   стабильнее живого полноэкранного фильтра на тяжёлой странице.
   Геометрия секций кэшируется, слой прокручивается вместе с секцией.
   ========================================================================== */

(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  const DEFAULTS = Object.freeze({
    direction: 'up',
    start: 0,
    end: -100,
    smoothing: 0.12,
    displacement: 220,
    frequencyX: 0.015,
    frequencyY: 0.02,
    octaves: 3,
    seed: 7
  });

  /* Safari/WebKit: полноэкранный живой SVG-фильтр не отрисовывается,
     поэтому там векторная кромка. Blink (Chrome, Edge, Opera, а также
     Chrome DevTools с эмуляцией iPhone UA) остаётся на живом фильтре:
     движок там Blink, даже если User-Agent притворяется Safari. */
  const ua = navigator.userAgent;
  const isWebKitOnly = /AppleWebKit/i.test(ua) &&
    !/CriOS|FxiOS/i.test(ua) &&
    !((!!window.chrome && navigator.vendor === 'Google Inc.') ||
      /Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua));
  const USE_VECTOR_EDGE = isWebKitOnly;

  const VECTOR_DEFAULTS = Object.freeze({
    smoothing: 0.32,
    start: 0,
    end: -100,
    displacement: 310,
    frequencyX: 0.008,
    frequencyY: 0.002,
    octaves: 5,
    seed: 8
  });

  /* У каждого блока свой рисунок кромки: базовый seed + смещение. */
  const blockSeed = (base, index) => base + index * 17;

  const BASE = USE_VECTOR_EDGE
    ? { ...DEFAULTS, ...VECTOR_DEFAULTS }
    : DEFAULTS;
  const cfg = { ...BASE };
  let requestTick = () => {};

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const svgEl = (name, attrs = {}) => {
    const el = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };

  class Burn {
    constructor(el, index) {
      this.el = el;
      this.color = this.resolveColor(el);
      this.index = index;
      this.progress = -1;
      this.written = -1;
      this.visible = false;
      this.isVector = USE_VECTOR_EDGE;
      this.edgeSvg = null;
      this.path = null;
      this.config = null;
      this.armed = false;
      this.seed = blockSeed(cfg.seed, index);
      this.docTop = 0;
      this.height = 0;
      this.width = 0;
      this.v = 300;
      this.edge = 6;
      this.build();
      this.measure();
    }

    resolveColor(el) {
      const next = el.parentElement ? el.parentElement.nextElementSibling : null;
      if (next) {
        const bg = getComputedStyle(next).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      }
      if (el.dataset.color) return el.dataset.color;
      return getComputedStyle(document.body).backgroundColor || '#FFFFFF';
    }

    build() {
      if (this.isVector) {
        this.buildVector();
        return;
      }
      const id = `burn-filter-${this.index}`;
      this.filterId = id;

      const filter = svgEl('filter', {
        id,
        x: '0',
        y: '0',
        width: '100%',
        height: '100%',
        'color-interpolation-filters': 'sRGB'
      });

      this.turbulence = svgEl('feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: `${cfg.frequencyX} ${cfg.frequencyY}`,
        numOctaves: String(cfg.octaves),
        seed: String(blockSeed(cfg.seed, this.index)),
        result: 'noise'
      });

      this.displacement = svgEl('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'noise',
        scale: String(cfg.displacement),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'displaced'
      });

      const preSmooth = svgEl('feGaussianBlur', {
        in: 'displaced',
        stdDeviation: '1.8',
        result: 'presmooth'
      });

      const cut = svgEl('feComponentTransfer', {
        in: 'presmooth',
        result: 'cut'
      });
      cut.appendChild(svgEl('feFuncA', {
        type: 'discrete',
        tableValues: '0 0 0 0 0 1 1 1 1 1'
      }));

      /* Цвет кромки задаём явно feFlood по цвету следующей секции:
         без этого полупрозрачные пиксели фильтра подмешивали чёрный,
         и на стыке появлялась серая кайма. Форма и мягкость края
         остаются прежними — меняется только цвет. */
      const flood = svgEl('feFlood', {
        'flood-color': this.color,
        result: 'flood'
      });
      const colorize = svgEl('feComposite', {
        in: 'flood',
        in2: 'cut',
        operator: 'in',
        result: 'colored'
      });

      const postBlur = svgEl('feGaussianBlur', {
        in: 'colored',
        stdDeviation: '0.4'
      });

      filter.append(
        this.turbulence,
        this.displacement,
        preSmooth,
        cut,
        flood,
        colorize,
        postBlur
      );

      const defs = svgEl('defs');
      defs.appendChild(filter);

      const svg = svgEl('svg', { width: '1', height: '1', 'aria-hidden': 'true' });
      svg.classList.add('burn__defs');
      svg.appendChild(defs);

      const pad = document.createElement('div');
      pad.className = 'burn__pad';
      pad.style.visibility = 'hidden';

      const fill = document.createElement('div');
      fill.className = 'burn__fill';
      fill.style.background = this.color;

      pad.appendChild(fill);
      this.el.append(svg, pad);

      this.pad = pad;
      this.fill = fill;
    }

    buildVector() {
      /* В WebKit рисуем кромку простым SVG-путём: цвет задаётся тем же
         CSS-цветом, что и фон следующей секции, поэтому на стыке нет
         расхождения канваса и CSS. Слой живёт внутри `.burn` (inset:0)
         и прокручивается вместе с секцией. */
      const svg = svgEl('svg', {
        width: '100%',
        height: '100%',
        'aria-hidden': 'true'
      });
      svg.classList.add('burn__edge');
      svg.style.visibility = 'hidden';
      const path = svgEl('path', { fill: this.color });
      svg.appendChild(path);
      this.el.appendChild(svg);
      this.edgeSvg = svg;
      this.path = path;
    }

    measure() {
      // Высокая секция: слой прижат к нижним 100svh; короткая — целиком.
      const host = this.el.parentElement;
      const viewport = window.innerHeight || 1;
      if (host) {
        const hostHeight = host.getBoundingClientRect().height;
        this.el.classList.toggle('burn--viewport', hostHeight > viewport);
      }
      const rect = this.el.getBoundingClientRect();
      this.height = rect.height;
      this.width = rect.width;
      this.docTop = rect.top + (window.scrollY || window.pageYOffset || 0);
      this.written = -1;
      if (this.isVector) this.buildVectorShape();
    }

    apply(config) {
      this.config = config;
      this.seed = blockSeed(config.seed, this.index);
      this.edge = Math.ceil(config.displacement / 2) + 6;
      this.written = -1;
      if (this.isVector) {
        this.buildVectorShape();
        return;
      }
      this.turbulence.setAttribute(
        'baseFrequency',
        `${config.frequencyX} ${config.frequencyY}`
      );
      this.turbulence.setAttribute('numOctaves', String(config.octaves));
      this.turbulence.setAttribute('seed', String(this.seed));
      this.displacement.setAttribute('scale', String(config.displacement));

      const padInset = Math.max(300, config.displacement + 80);
      const edgeInset = Math.ceil(config.displacement / 2) + 6;
      this.v = padInset;
      this.edge = edgeInset;

      const padStyle = this.pad.style;
      padStyle.top = `${-padInset}px`;
      padStyle.right = `${-padInset}px`;
      padStyle.bottom = `${-padInset}px`;
      padStyle.left = `${-padInset}px`;

      const fillStyle = this.fill.style;
      fillStyle.height = `calc(100% - ${padInset * 2}px)`;

      if (config.direction === 'up') {
        fillStyle.top = 'auto';
        fillStyle.bottom = `${padInset - edgeInset}px`;
        fillStyle.transformOrigin = '50% 100%';
      } else {
        fillStyle.top = `${padInset - edgeInset}px`;
        fillStyle.bottom = 'auto';
        fillStyle.transformOrigin = '50% 0%';
      }

      this.written = -1;
    }

    updateVector(config, viewportHeight, rectTop, reducedMotion) {
      const H = this.height || 1;
      const startPx = (config.start / 100) * viewportHeight;
      const endPx = (config.end / 100) * (this.height || viewportHeight) -
        (this.edge + config.displacement / 2 + 8);
      const begin = this.docTop > endPx + 1
        ? Math.min(startPx, this.docTop)
        : startPx;
      const target = clamp((begin - rectTop) / ((begin - endPx) || 1), 0, 1);

      let next;
      if (reducedMotion || config.smoothing <= 0) {
        next = target;
      } else if (this.progress < 0) {
        next = target;
      } else {
        next = this.progress + (target - this.progress) * Math.min(1, config.smoothing);
        if (Math.abs(target - next) < 0.0005) next = target;
      }
      this.progress = next;
      const settling = Math.abs(next - target) > 0.0005;

      const show = next > 0.0005;
      if (show !== this.visible) {
        this.visible = show;
        this.edgeSvg.style.visibility = show ? 'visible' : 'hidden';
        this.edgeSvg.style.willChange = show ? 'transform' : '';
        this.written = -1;
      }
      if (!show) return settling;
      /* Секция вне экрана — двигать нечего. */
      if (rectTop + H <= 0 || rectTop >= viewportHeight) return settling;
      this.moveVector(next);
      this.written = next;
      return settling;
    }

    hash(n) {
      const x = Math.sin(n * 127.1 + this.seed * 311.7) * 43758.5453;
      return x - Math.floor(x);
    }

    noise(x, t, octaves, freq) {
      let value = 0;
      let amplitude = 0.5;
      let total = 0;
      let f = freq;
      for (let o = 0; o < octaves; o++) {
        const pos = x * f + t + this.seed * 0.37 + o * 19;
        const cell = Math.floor(pos);
        const frac = pos - cell;
        const smooth = frac * frac * (3 - 2 * frac);
        const a = this.hash(cell);
        const b = this.hash(cell + 1);
        value += (a + (b - a) * smooth - 0.5) * amplitude;
        total += amplitude;
        f *= 2.1;
        /* Верхние октавы слабее, иначе край получается «пилой». */
        amplitude *= 0.42;
      }
      return total ? (value / total) * 2 : 0;
    }

    /* Статичная кромка: рисуем её один раз, а при скролле только сдвигаем
       готовый путь трансформом. Раньше строка path собиралась заново на
       каждом кадре — на этом Safari и спотыкался. */
    buildVectorShape() {
      const cfg = this.config;
      if (!cfg || !this.path) return;
      const W = this.width || 1;
      const H = this.height || 1;
      const up = cfg.direction === 'up';
      const edge = up ? this.edge : -this.edge;
      const amp = Math.min(cfg.displacement * 0.28, 120);
      /* Шум статичный, как feTurbulence: кромка не «кипит» без скролла. */
      const t = 0;
      const step = Math.max(3, W / 400);

      /* Твердь уходит далеко за секцию: при сдвиге пути вниз/вверх
         между кромкой и стыком не появляется дырки. */
      const solid = up ? H * 2 + 2 : -H * 2 - 2;

      const yAt = (x) => {
        const n = this.noise(x, t, cfg.octaves, cfg.frequencyX);
        const fine = this.noise(x * 3.1 + 17.3, t * 1.6, 2, cfg.frequencyX * 6) * amp * 0.08;
        return edge + n * amp + fine;
      };

      const pts = [];
      for (let x = 0; x < W; x += step) pts.push([x, yAt(x)]);
      pts.push([W, yAt(W)]);
      /* Мягкое сглаживание, как pre-blur в SVG-фильтре. */
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i][1] = pts[i - 1][1] * 0.25 + pts[i][1] * 0.5 + pts[i + 1][1] * 0.25;
      }

      let d = `M 0 ${solid.toFixed(1)}`;
      for (const [x, y] of pts) d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      d += ` L ${W.toFixed(1)} ${solid.toFixed(1)} Z`;
      this.path.setAttribute('d', d);
      this.lastTransform = null;
      this.written = -1;
    }

    moveVector(p) {
      if (!this.path || !this.config) return;
      const H = this.height || 1;
      const y = this.config.direction === 'up' ? H * (1 - p) : H * p;
      if (this.lastTransform !== null && Math.abs(this.lastTransform - y) < 0.01) return;
      this.lastTransform = y;
      this.path.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    }

    arm() {
      if (this.isVector || this.armed || !this.pad) return;
      /* Как в оригинале: отдельный слой и готовый фильтр до начала
         прожига, чтобы первый кадр не тратился на их создание. */
      this.pad.style.filter = `url(#${this.filterId})`;
      this.pad.style.willChange = 'transform';
      this.pad.style.visibility = 'visible';
      this.fill.style.willChange = 'transform';
      this.armed = true;
    }

    maybeArm(rectTop, viewportHeight) {
      if (this.isVector) return;
      const near = rectTop < viewportHeight * 1.5 &&
        rectTop + this.height > -viewportHeight;
      if (near) {
        if (!this.armed) this.arm();
        return;
      }
      /* Далёкие переходы не держат живой фильтр в памяти. */
      if (this.armed && (
        rectTop > viewportHeight * 2.5 ||
        rectTop + this.height < -viewportHeight * 2.5
      )) {
        this.pad.style.filter = 'none';
        this.pad.style.willChange = '';
        this.pad.style.visibility = 'hidden';
        this.fill.style.willChange = '';
        this.armed = false;
      }
    }

    update(config, viewportHeight, rectTop, reducedMotion) {
      if (this.isVector) {
        return this.updateVector(config, viewportHeight, rectTop, reducedMotion);
      }
      this.maybeArm(rectTop, viewportHeight);
      const startPx = (config.start / 100) * viewportHeight;
      const endPx = (config.end / 100) * (this.height || viewportHeight) -
        (this.edge + config.displacement / 2 + 8);

      const begin = this.docTop > endPx + 1
        ? Math.min(startPx, this.docTop)
        : startPx;

      const denominator = (begin - endPx) || 1;
      const target = clamp((begin - rectTop) / denominator, 0, 1);

      let next;
      if (reducedMotion || config.smoothing <= 0) {
        next = target;
      } else if (this.progress < 0) {
        next = target;
      } else {
        next = this.progress + (target - this.progress) * Math.min(1, config.smoothing);
        if (Math.abs(target - next) < 0.0005) next = target;
      }
      this.progress = next;
      const settling = Math.abs(next - target) > 0.0005;

      const show = next > 0.0005;
      if (!show) return settling;

      if (Math.abs(next - this.written) > 0.0002 || next === 0 || next === 1) {
        this.fill.style.transform = `translate3d(0, 0, 0) scaleY(${next.toFixed(4)})`;
        this.written = next;
      }

      return settling;
    }
  }

  let started = false;

  const start = () => {
    if (started) return;
    started = true;

  const burnNodes = [...document.querySelectorAll('[data-burn]')];
  const burns = burnNodes.map((el, index) => new Burn(el, index));

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedQuery.matches;
  reducedQuery.addEventListener?.('change', (event) => {
    reducedMotion = event.matches;
  });

  const scrollbar = document.getElementById('scrollbar');
  let scrolledClass = false;

  const applyAll = () => burns.forEach((burn) => burn.apply(cfg));

  const write = (y) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? clamp(y / max, 0, 1) : 0;
    if (scrollbar) scrollbar.style.transform = `scaleX(${ratio.toFixed(4)})`;

    const scrolled = y > 40;
    if (scrolled !== scrolledClass) {
      document.body.classList.toggle('is-scrolled', scrolled);
      scrolledClass = scrolled;
    }
  };

  let rafId = 0;
  let lastY = window.scrollY || 0;
  let firePaused = false;
  let firePauseTimer = 0;
  let jumpTimer = 0;
  let jumping = false;

  const setJumping = (next) => {
    if (next === jumping) return;
    jumping = next;
    document.body.classList.toggle('is-burn-jumping', next);
  };

  const setFirePaused = (next) => {
    if (next === firePaused) return;
    firePaused = next;
    window.dispatchEvent(new CustomEvent('scrollburn:active', {
      detail: { active: next }
    }));
  };

  const holdFirePaused = () => {
    setFirePaused(true);
    clearTimeout(firePauseTimer);
    firePauseTimer = setTimeout(() => setFirePaused(false), 260);
  };

  const tick = () => {
    rafId = 0;
    const viewportHeight = window.innerHeight || 1;
    const y = window.scrollY || 0;
    /* Прыжок по якорю, бегунку или восстановление позиции: не прожигаем
       экран через полстраницы, а сразу ставим состояние цели и прячем
       переход на время резкого перемещения.
       Только на десктопе: на мобильном родная прокрутка должна отыгрывать
       кромку нормально, как в десктопном Chrome. */
    const jump = window.innerWidth >= 1024 &&
      Math.abs(y - lastY) > viewportHeight * 0.75;
    if (jump) {
      setJumping(true);
      clearTimeout(jumpTimer);
      jumpTimer = setTimeout(() => {
        setJumping(false);
        burns.forEach((burn) => { burn.progress = -1; });
        requestTick();
      }, 180);
      burns.forEach((burn) => { burn.progress = -1; });
    }
    lastY = y;
    let settling = false;
    for (const burn of burns) {
      if (burn.update(cfg, viewportHeight, burn.docTop - y, reducedMotion)) settling = true;
    }
    let transition = false;
    for (const burn of burns) {
      if (burn.progress > 0.001 && burn.progress < 0.999) {
        transition = true;
        break;
      }
    }
    if (transition) {
      holdFirePaused();
    } else {
      clearTimeout(firePauseTimer);
      setFirePaused(false);
    }

    write(y);
    if (settling) requestTick();
  };

  requestTick = () => {
    if (!rafId) rafId = requestAnimationFrame(tick);
  };

  applyAll();
  burns.forEach((burn) => burn.measure());
  requestTick();

  window.addEventListener('scroll', requestTick, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      requestTick();
    }
  });

  window.addEventListener('resize', () => {
    burns.forEach((burn) => burn.measure());
    requestTick();
  });

  window.addEventListener('load', () => {
    burns.forEach((burn) => burn.measure());
    requestTick();
  });

  /* Ленивые картинки и раскрытые аккордеоны меняют высоту секций:
     без повторного замера старые границы прожига «наезжают» на контент. */
  let measureRaf = 0;
  const scheduleMeasure = () => {
    if (measureRaf) return;
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      burns.forEach((burn) => burn.measure());
      requestTick();
    });
  };
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleMeasure).observe(document.body);
  }
  document.addEventListener('load', (event) => {
    if (event.target && event.target.tagName === 'IMG') scheduleMeasure();
  }, true);


  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      burns.forEach((burn) => burn.measure());
      requestTick();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Пульт                                                               */
  /* ------------------------------------------------------------------ */

  const lab = document.getElementById('lab');
  const panel = document.getElementById('labPanel');
  const toggle = document.getElementById('labToggle');
  const closeButton = document.getElementById('labClose');
  const resetButton = document.getElementById('labReset');

  if (lab && panel && toggle && closeButton && resetButton) {
    const inputs = [...document.querySelectorAll('input[data-key]')];
    const dirButtons = [...document.querySelectorAll('[data-dir]')];

    const formats = {
      smoothing: (v) => Number(v).toFixed(2),
      start: (v) => `${Math.round(v)}%`.replace('-', '−'),
      end: (v) => `${Math.round(v)}%`.replace('-', '−'),
      displacement: (v) => `${Math.round(v)} px`,
      frequencyX: (v) => Number(v).toFixed(3),
      frequencyY: (v) => Number(v).toFixed(3),
      octaves: (v) => String(Math.round(v)),
      seed: (v) => String(Math.round(v))
    };

    const syncOutputs = () => {
      document.querySelectorAll('[data-out]').forEach((output) => {
        const key = output.dataset.out;
        if (formats[key]) output.textContent = formats[key](cfg[key]);
      });
      dirButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.dir === cfg.direction));
      });
    };

    const syncInputs = () => {
      inputs.forEach((input) => {
        input.value = String(cfg[input.dataset.key]);
      });
      syncOutputs();
    };

    const openLab = (open) => {
      lab.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      panel.setAttribute('aria-hidden', String(!open));
      if (open) {
        panel.removeAttribute('inert');
      } else {
        panel.setAttribute('inert', '');
      }
    };

    toggle.addEventListener('click', () => {
      openLab(!lab.classList.contains('is-open'));
    });

    closeButton.addEventListener('click', () => {
      openLab(false);
      toggle.focus();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && lab.classList.contains('is-open')) {
        openLab(false);
        toggle.focus();
      }
    });

    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        if (!(key in cfg)) return;
        cfg[key] = Number(input.value);
        syncOutputs();
        applyAll();
        requestTick();
      });
    });

    dirButtons.forEach((button) => {
      button.addEventListener('click', () => {
        cfg.direction = button.dataset.dir;
        syncOutputs();
        applyAll();
        requestTick();
      });
    });

    resetButton.addEventListener('click', () => {
      Object.assign(cfg, BASE);
      syncInputs();
      applyAll();
      requestTick();
    });

    syncInputs();
  }
  };

  /* Тяжёлая инициализация — после первого кадра, чтобы страница успела
     показаться. Если пользователь сразу скроллит или трогает пульт —
     запускаем немедленно. */
  const scheduleStart = () => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(start, { timeout: 400 });
    } else {
      setTimeout(start, 0);
    }
  };

  if (document.readyState === 'complete') {
    scheduleStart();
  } else {
    window.addEventListener('load', scheduleStart, { once: true });
  }
  window.addEventListener('scroll', start, { passive: true, once: true });
  window.addEventListener('pointerdown', start, { passive: true, once: true });
})();
