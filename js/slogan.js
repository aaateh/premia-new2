/* Слоган на телефоне: +7 %, но только если верхняя строка ещё влезает. */

(function () {
    'use strict';

    var slogan = document.querySelector('[data-slogan]');
    if (!slogan) {
        return;
    }

    var line = slogan.querySelector('[data-slogan-line]');
    if (!line) {
        return;
    }

    function fit() {
        slogan.classList.remove('hero__sub--big');

        if (window.innerWidth > 600) {
            return;
        }

        slogan.classList.add('hero__sub--measuring');
        var ok = line.getBoundingClientRect().width <= slogan.clientWidth + 0.5;
        slogan.classList.remove('hero__sub--measuring');

        if (ok) {
            slogan.classList.add('hero__sub--big');
        }
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(fit);
    } else {
        fit();
    }

    window.addEventListener('resize', fit);
})();
