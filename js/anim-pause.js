/* Пауза CSS-анимаций, когда элемент вне экрана или вкладка не активна.
   Наблюдаем и секции, и сами анимированные блоки: если секция видна,
   но её анимация (перо, огонь, машинка и т. п.) уже ушла за кадр —
   она всё равно останавливается. Скрытая вкладка — html.is-page-hidden. */
(function () {
  var root = document.documentElement;

  function syncTab() {
    root.classList.toggle("is-page-hidden", document.hidden);
  }

  syncTab();
  document.addEventListener("visibilitychange", syncTab);

  if (!window.IntersectionObserver) return;

  var blocks = document.querySelectorAll(
    ".site > header, .site > main > section, .site > footer, " +
      ".typewriter, .bike, .fire-slot, .dates-art, .quill, .torch, .pocket-watch, .faq-book, .pricing-camera, .key-art, .lamp, "
      + ".poster-tape, #mission h2, .awards"
  );
  if (!blocks.length) return;

  // До первого срабатывания наблюдателя анимации не запускаем.
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].classList.add("anim-paused");
  }

  // Сразу снимаем паузу с того, что уже в кадре: не ждём колбэка наблюдателя.
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  for (var k = 0; k < blocks.length; k++) {
    blocks[k].classList.toggle("anim-paused", !inView(blocks[k]));
  }

  var io = new IntersectionObserver(
    function (entries) {
      for (var j = 0; j < entries.length; j++) {
        entries[j].target.classList.toggle(
          "anim-paused",
          !entries[j].isIntersecting
        );
      }
    },
    { rootMargin: "0px" }
  );

  for (var n = 0; n < blocks.length; n++) io.observe(blocks[n]);

  // Страховка на случай, если IntersectionObserver отдаёт колбэки с задержкой:
  // обновляем паузы на скролле и ресайзе одним rAF-кадром.
  var ticking = false;

  function refresh() {
    ticking = false;
    for (var b = 0; b < blocks.length; b++) {
      blocks[b].classList.toggle("anim-paused", !inView(blocks[b]));
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(refresh);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
})();
