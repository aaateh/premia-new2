(function () {
  // «горящая» рамка кнопок из дизайн-системы
  if (window.StarBorder) {
    var buttons = document.querySelectorAll('.btn:not(.btn--ghost)');
    for (var b = 0; b < buttons.length; b++) {
      var el = buttons[b];
      el.classList.add('star-border');
      window.StarBorder.init(el, {
        radius: 4,
        thickness: 1,
        duration: 4,
        glow: .6,
        hover: 'lap',
        theme: el.closest('.section--soft') ? 'light' : 'dark'
      });
    }
  }

  // на мобильных группы номинаций свёрнуты — чтобы не было простыни текста
  if (window.innerWidth <= 900) {
    var groups = document.querySelectorAll('.nom-group');
    for (var i = 0; i < groups.length; i++) groups[i].removeAttribute('open');
  }

  // плавное раскрытие спойлеров без библиотек
  function enhanceDetails() {
    var items = document.querySelectorAll('details');
    for (var d = 0; d < items.length; d++) {
      (function (details) {
        var summary = details.querySelector('summary');
        if (!summary || details.dataset.motionReady) return;
        details.dataset.motionReady = '1';

        summary.addEventListener('click', function (event) {
          if (event.target.closest('a')) return;
          event.preventDefault();
          if (details.dataset.animating === '1') return;
          if (!details.animate) {
            details.open = !details.open;
            return;
          }

          var reduced = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (reduced) {
            details.open = !details.open;
            return;
          }

          details.dataset.animating = '1';
          var start = details.offsetHeight;
          var panel = details.querySelector('.nom-group__body');
          details.style.overflow = 'hidden';

          var targets = [];
          if (panel) {
            targets.push(panel);
          } else {
            for (var c = 0; c < details.children.length; c++) {
              if (details.children[c].tagName !== 'SUMMARY') targets.push(details.children[c]);
            }
          }

          var ease = 'cubic-bezier(.4, 0, .2, 1)';

          function finish() {
            details.style.height = '';
            details.style.overflow = '';
            delete details.dataset.animating;
          }

          if (!details.open) {
            details.open = true;
            details.style.height = 'auto';
            var end = details.offsetHeight;
            details.style.height = start + 'px';
            var anim = details.animate([
              { height: start + 'px' },
              { height: end + 'px' }
            ], {
              duration: 620,
              easing: ease
            });
            for (var t = 0; t < targets.length; t++) {
              targets[t].animate([
                { opacity: 0, transform: 'translateY(-24px)', filter: 'blur(8px)', clipPath: 'inset(0 0 100% 0)' },
                { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)', clipPath: 'inset(0 0 0 0)' }
              ], {
                duration: 560,
                delay: t * 70,
                easing: ease,
                fill: 'backwards'
              });
            }
            anim.onfinish = finish;
            anim.oncancel = finish;
          } else {
            var border = details.offsetHeight - details.clientHeight;
            var end = summary.offsetHeight + border;
            var anim = details.animate([
              { height: start + 'px' },
              { height: end + 'px' }
            ], {
              duration: 420,
              easing: 'cubic-bezier(.4, 0, .2, 1)'
            });
            for (var o = 0; o < targets.length; o++) {
              targets[o].animate([
                { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
                { opacity: 0, transform: 'translateY(-12px)', filter: 'blur(4px)' }
              ], {
                duration: 280,
                easing: 'cubic-bezier(.4, 0, .2, 1)'
              });
            }
            anim.onfinish = function () {
              details.open = false;
              finish();
            };
            anim.oncancel = finish;
          }
        });
      })(items[d]);
    }
  }

  enhanceDetails();

  // топор плавно поворачивается при прокрутке секции «Принципы»
  (function axeOnScroll() {
    var axe = document.querySelector('.axe');
    var section = document.getElementById('principles');
    if (!axe || !section) return;
    if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var raf = 0;

    function update() {
      raf = 0;
      if (getComputedStyle(axe).display === 'none') return;
      var rect = section.getBoundingClientRect();
      var vh = window.innerHeight || 1;
      if (rect.bottom < -120 || rect.top > vh + 120) return;

      var p = (vh - rect.top) / (vh + rect.height);
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      axe.style.transform = 'rotate(' + (10 - p * 28).toFixed(2) + 'deg)';
    }

    function onScroll() {
      if (!raf) raf = requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  })();

  // якорные ссылки: точно доводим до секции с отступом под закреплённую шапку
  (function anchorScroll() {
    var header = document.querySelector('.header');

    function offset() {
      return header ? header.getBoundingClientRect().height + 16 : 16;
    }

    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target.closest ? event.target.closest('a[href^="#"]') : null;
      if (!link || link.hasAttribute('data-partner-open')) return;

      var hash = link.getAttribute('href');
      if (!hash || hash === '#') return;

      var target;
      try {
        target = document.querySelector(hash);
      } catch (error) {
        return;
      }
      if (!target) return;

      event.preventDefault();

      var top = target.getBoundingClientRect().top + (window.pageYOffset || 0) - offset();
      if (top < 0) top = 0;

      var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!reduced && window.siteScrollToY) {
        window.siteScrollToY(top);
      } else {
        window.scrollTo({
          top: top,
          behavior: reduced ? 'auto' : 'smooth'
        });
      }

      if (window.history && history.replaceState) history.replaceState(null, '', hash);
    });
  })();

  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');
  if (!burger || !nav) return;

  var lockedScroll = 0;

  // Пока меню открыто, страница под ним не прокручивается: фиксируем body
  // со сдвигом на текущую позицию и возвращаем её при закрытии. Одного
  // overflow: hidden мало — на телефоне прокрутка всё равно уходит к странице.
  function lockScroll() {
    lockedScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('menu-open');
    document.body.style.position = 'fixed';
    document.body.style.top = -lockedScroll + 'px';
    document.body.style.right = '0';
    document.body.style.left = '0';
    document.body.style.width = '100%';
  }

  function unlockScroll() {
    document.documentElement.classList.remove('menu-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.right = '';
    document.body.style.left = '';
    document.body.style.width = '';

    // на сайте включён scroll-behavior: smooth — возвращаем позицию сразу,
    // без анимации, иначе прокрутка «доезжает» из нуля
    var html = document.documentElement;
    var smooth = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    void document.body.offsetHeight;
    window.scrollTo(0, lockedScroll);
    html.style.scrollBehavior = smooth;
  }

  function setMenu(open) {
    if (open === nav.classList.contains('is-open')) return;
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('menu-open', open);
    if (open) lockScroll();
    else unlockScroll();
  }

  burger.addEventListener('click', function () {
    setMenu(!nav.classList.contains('is-open'));
  });

  nav.addEventListener('click', function (e) {
    if (e.target.closest('a') && window.innerWidth <= 980) setMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      burger.focus();
    }
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 980 && nav.classList.contains('is-open')) setMenu(false);
  });
})();
