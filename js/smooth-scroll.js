/* ==========================================================================
   Плавная прокрутка для десктопа.
   Колёсико и тачпад двигают страницу с лёгкой инерцией, а якорные переходы
   (кнопки «Смотреть номинации», меню) едут с рассчитанной длительностью —
   без рывка на несколько экранов. На телефонах, планшетах без мыши и при
   prefers-reduced-motion скрипт не включается: остаётся родная прокрутка.
   ========================================================================== */

(() => {
  'use strict';

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const MIN_WIDTH = 1024;

  /* Ширина, а не тип указателя: на некоторых браузерах с мышью/тачпадом
     fine-pointer не определяется, и плавность пропадала. Телефоны и узкие
     экраны остаются на родной прокрутке. */
  if (reduceQuery.matches || window.innerWidth < MIN_WIDTH) return;

  const LERP = 0.15;          // доля пути за кадр — мягкость колеса
  const MAX_STEP = 190;       // потолок шага: большой рывок колеса не телепортирует
  const MIN_DURATION = 520;   // мс, короткий якорь
  const MAX_DURATION = 1300;  // мс, дальний якорь
  const DURATION_PER_PX = 0.09;

  const doc = document.documentElement;
  /* Плавность считаем сами — встроенную CSS-анимацию прокрутки выключаем,
     иначе каждый программный шаг браузер будет «доезжать» отдельно. */
  doc.style.scrollBehavior = 'auto';

  let current = window.scrollY || 0;
  let target = current;
  let lastApplied = current;
  let rafId = 0;
  let glide = null;
  let enabled = true;
  let watchdog = 0;

  const clampY = (value) => Math.min(maxY(), Math.max(0, value));

  function maxY() {
    return Math.max(0, doc.scrollHeight - window.innerHeight);
  }

  function apply(y) {
    lastApplied = y;
    window.scrollTo(0, y);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function locked() {
    const classes = document.body.classList;
    return classes.contains('menu-open') ||
      classes.contains('is-intro') ||
      classes.contains('pf-modal-open');
  }

  /* Внутри модалки или другого своего скролл-контейнера колесо не трогаем. */
  function scrollsInside(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function start() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  /* Кадры могут встать (вкладка ушла в фон, браузер придержал анимации).
     В этом случае колесо не должно «залипать» — через мгновение ставим
     целевую позицию напрямую и отпускаем страницу. */
  function armWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (!rafId) return;
      cancelAnimationFrame(rafId);
      rafId = 0;
      if (glide) current = glide.to;
      else current = target;
      glide = null;
      apply(current);
    }, 340);
  }

  function frame(now) {
    rafId = 0;
    clearTimeout(watchdog);

    if (!enabled || locked()) {
      glide = null;
      current = target = window.scrollY || 0;
      return;
    }

    if (glide) {
      const t = Math.min(1, (now - glide.start) / glide.duration);
      current = glide.from + (glide.to - glide.from) * easeInOutCubic(t);
      apply(current);
      target = current;
      if (t < 1) {
        start();
      } else {
        glide = null;
      }
      return;
    }

    const diff = target - current;
    if (Math.abs(diff) < 0.4) {
      current = target;
      if (Math.abs(lastApplied - current) > 0.4) apply(current);
      return;
    }

    let step = diff * LERP;
    if (step > MAX_STEP) step = MAX_STEP;
    else if (step < -MAX_STEP) step = -MAX_STEP;

    current += step;
    apply(current);
    start();
  }

  function onWheel(event) {
    if (!enabled || reduceQuery.matches || window.innerWidth < MIN_WIDTH) return;
    if (event.ctrlKey) return;      // масштаб жестом/pinch
    if (locked()) return;
    if (event.target && scrollsInside(event.target)) return;

    event.preventDefault();

    glide = null;                   // колесо перехватывает якорную анимацию
    const y = window.scrollY || 0;
    if (Math.abs(y - current) > 2) current = target = y;

    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * window.innerHeight
        : event.deltaY;

    target = Math.max(0, Math.min(maxY(), target + delta));
    start();
    armWatchdog();
  }

  function onScroll() {
    const y = window.scrollY || 0;
    /* Позицию поменяли не мы (ползунок, клавиатура, якорь браузера) —
       подхватываем её, чтобы не спорить с пользователем. */
    if (Math.abs(y - lastApplied) > 3) {
      current = target = y;
      glide = null;
    }
  }

  function checkMode() {
    const active = !reduceQuery.matches && window.innerWidth >= MIN_WIDTH;
    enabled = active;
    if (!active) {
      glide = null;
      current = target = window.scrollY || 0;
    }
  }

  /* Публичная точка входа для якорных переходов. */
  function scrollToY(y) {
    const reduced = reduceQuery.matches;
    if (!enabled || reduced || window.innerWidth < MIN_WIDTH) {
      window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }

    const to = clampY(y);
    const from = window.scrollY || 0;
    const distance = Math.abs(to - from);
    if (distance < 2) return;

    glide = {
      from,
      to,
      start: performance.now(),
      duration: Math.min(MAX_DURATION,
        Math.max(MIN_DURATION, distance * DURATION_PER_PX))
    };
    target = to;
    start();
    armWatchdog();
  }

  window.siteScrollToY = scrollToY;

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', checkMode);

  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', checkMode);
  }

  checkMode();
})();
