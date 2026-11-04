/* ==========================================================================
   partners-form.js — модальная форма «Заявка на партнёрство»
   Без зависимостей. Открывается по [data-partner-open], отправляет fetch-запрос
   в PHP-обработчик, проверяет Яндекс SmartCaptcha.
   ========================================================================== */

(function () {
  'use strict';

  var modal = document.getElementById('partner-form');
  if (!modal) return;

  var dialog = modal.querySelector('.pf-modal__dialog');
  var intro = modal.querySelector('.pf-intro');
  var form = document.getElementById('pf-form');
  var success = modal.querySelector('.pf-success');
  var title = document.getElementById('pf-title');
  var themeInput = form.querySelector('input[name="theme"]');
  var submitBtn = form.querySelector('.pf-submit');
  var submitLabel = form.querySelector('[data-pf-submit-label]');
  var formError = form.querySelector('.pf-form__error');
  var triggers = document.querySelectorAll('[data-partner-open]');
  var phoneInput = form.elements.phone;

  var submitLabelDefault = submitLabel ? submitLabel.textContent : 'Отправить заявку';
  var lastTrigger = null;
  var sending = false;
  var closing = false;
  var captchaWidget = null;
  var captchaLoading = false;
  var captchaFailed = false;
  var captchaPromise = null;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- открытие и закрытие ---------- */

  function openModal(trigger) {
    if (sending || !modal.hidden) return;

    lastTrigger = trigger || null;

    // Одна форма и один общий заголовок — «Стать партнёром».
    if (title) title.textContent = 'Стать партнёром';
    if (themeInput) themeInput.value = 'Стать партнёром';

    intro.hidden = false;
    form.hidden = false;
    success.hidden = true;
    modal.hidden = false;
    modal.classList.remove('is-open');

    // принудительный reflow, чтобы сработал переход
    void modal.offsetWidth;
    modal.classList.add('is-open');

    document.body.classList.add('pf-modal-open');
    var scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.paddingRight = scrollbar > 0 ? scrollbar + 'px' : '';

    ensureCaptcha();
    removeInternalStar();

    window.setTimeout(function () {
      dialog.focus();
    }, 60);
  }

  function closeModal() {
    if (sending || closing || modal.hidden) return;
    closing = true;

    var wasSuccess = !success.hidden;

    modal.classList.remove('is-open');
    document.body.classList.remove('pf-modal-open');
    document.body.style.paddingRight = '';

    window.setTimeout(function () {
      modal.hidden = true;
      closing = false;

      if (wasSuccess) resetForm();

      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      } else if (triggers.length) {
        triggers[0].focus();
      }
    }, reducedMotion ? 0 : 220);
  }

  function resetForm() {
    form.reset();
    intro.hidden = false;
    form.hidden = false;
    success.hidden = true;
    formError.hidden = true;
    clearErrors();
    resetCaptcha();
    if (submitBtn) submitBtn.disabled = false;
    if (submitLabel) submitLabel.textContent = submitLabelDefault;
  }

  /* ---------- фокус и клавиатура ---------- */

  function focusables() {
    var nodes = dialog.querySelectorAll('a[href], button:not([disabled]), iframe, input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetWidth || nodes[i].offsetHeight || nodes[i] === document.activeElement) {
        list.push(nodes[i]);
      }
    }
    return list;
  }

  function trapFocus(event) {
    var list = focusables();
    if (!list.length) return;

    var first = list[0];
    var last = list[list.length - 1];

    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', function (event) {
    if (modal.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key === 'Tab') trapFocus(event);
  });

  modal.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('[data-pf-close]') : null;
    if (target) {
      event.preventDefault();
      closeModal();
    }
  });

  for (var t = 0; t < triggers.length; t++) {
    triggers[t].addEventListener('click', function (event) {
      event.preventDefault();
      openModal(this);
    });
  }

  /* ---------- маска телефона ---------- */

  function formatPhone(value) {
    var digits = value.replace(/\D/g, '');
    if (!digits) return '';

    if (digits.charAt(0) === '8') digits = '7' + digits.slice(1);
    if (digits.charAt(0) !== '7') digits = '7' + digits;

    var n = digits.slice(1, 11);
    var out = '+7';

    if (n.length) out += ' (' + n.slice(0, 3);
    if (n.length >= 3) out += ') ' + n.slice(3, 6);
    if (n.length >= 6) out += '-' + n.slice(6, 8);
    if (n.length >= 8) out += '-' + n.slice(8, 10);

    return out;
  }

  if (phoneInput) {
    phoneInput.addEventListener('focus', function () {
      if (!this.value) this.value = '+7 (';
    });

    phoneInput.addEventListener('input', function () {
      this.value = formatPhone(this.value);
    });

    phoneInput.addEventListener('blur', function () {
      if (this.value === '+7 (' || this.value === '+7') this.value = '';
    });
  }

  /* ---------- валидация ---------- */

  function fieldElement(name) {
    return form.elements[name];
  }

  function errorElement(name) {
    return form.querySelector('[data-error-for="' + name + '"]');
  }

  function setError(name, message) {
    var field = fieldElement(name);
    var error = errorElement(name);

    if (field) {
      field.setAttribute('aria-invalid', 'true');
      if (error) {
        if (!error.id) error.id = 'pf-' + name + '-error';
        field.setAttribute('aria-describedby', error.id);
      }
    }

    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function clearError(name) {
    var field = fieldElement(name);
    var error = errorElement(name);

    if (field) {
      field.removeAttribute('aria-invalid');
      if (error && error.id) field.removeAttribute('aria-describedby');
    }

    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
  }

  function clearErrors() {
    var fields = ['name', 'phone', 'email', 'org', 'budget', 'access', 'captcha'];
    for (var i = 0; i < fields.length; i++) clearError(fields[i]);
  }

  function validateField(name) {
    var field = fieldElement(name);
    if (!field) return '';

    var value = typeof field.value === 'string' ? field.value.trim() : '';

    if (name === 'name') {
      return value ? '' : 'Укажите имя';
    }

    if (name === 'phone') {
      if (!value) return 'Укажите телефон';
      return value.replace(/\D/g, '').length >= 11 ? '' : 'Введите номер полностью';
    }

    if (name === 'email') {
      if (!value) return 'Укажите e-mail';
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? '' : 'Проверьте адрес e-mail';
    }

    if (name === 'org') {
      return value ? '' : 'Укажите организацию';
    }

    if (name === 'budget') {
      return value ? '' : 'Выберите бюджет';
    }

    if (name === 'access') {
      return field.checked ? '' : 'Нужно согласие на обработку данных';
    }

    return '';
  }

  function validateForm() {
    var order = ['name', 'phone', 'email', 'org', 'budget', 'access'];
    var firstInvalid = null;

    for (var i = 0; i < order.length; i++) {
      var name = order[i];
      var message = validateField(name);

      if (message) {
        setError(name, message);
        if (!firstInvalid) firstInvalid = fieldElement(name);
      } else {
        clearError(name);
      }
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }

    return true;
  }

  form.addEventListener('input', function (event) {
    if (event.target.name) clearError(event.target.name);
  });

  form.addEventListener('change', function (event) {
    if (event.target.name) clearError(event.target.name);
  });

  /* ---------- капча ---------- */

  function loadCaptchaScript() {
    if (window.smartCaptcha) return Promise.resolve();
    if (captchaPromise) return captchaPromise;

    captchaPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://smartcaptcha.yandexcloud.net/captcha.js?render=onload&onload=__pfCaptchaReady';
      script.async = true;
      script.onerror = function () {
        reject(new Error('Не удалось загрузить скрипт SmartCaptcha'));
      };

      window.__pfCaptchaReady = function () {
        resolve();
      };

      document.head.appendChild(script);
    });

    return captchaPromise;
  }

  function ensureCaptcha() {
    if (captchaWidget !== null || captchaLoading || captchaFailed) return;

    var container = document.getElementById('pf-captcha');
    if (!container) return;

    var sitekey = container.getAttribute('data-sitekey');
    if (!sitekey || sitekey.indexOf('__PF_') === 0) {
      captchaFailed = true;
      container.innerHTML = '<p class="pf-captcha__error">Не задан ключ SmartCaptcha.</p>';
      return;
    }

    captchaLoading = true;

    loadCaptchaScript()
      .then(function () {
        if (!window.smartCaptcha || typeof window.smartCaptcha.render !== 'function') {
          throw new Error('SmartCaptcha не инициализировалась');
        }

        // Если окно успели закрыть, отрисуем виджет при следующем открытии.
        if (modal.hidden) {
          captchaLoading = false;
          return;
        }

        captchaWidget = window.smartCaptcha.render(container, {
          sitekey: sitekey,
          hl: 'ru',
          callback: function () {
            clearError('captcha');
          }
        });

        if (typeof window.smartCaptcha.subscribe === 'function') {
          window.smartCaptcha.subscribe(captchaWidget, 'javascript-error', function () {
            setCaptchaError('Капча недоступна. Обновите страницу и попробуйте снова.');
          });
        }

        captchaLoading = false;
      })
      .catch(function () {
        captchaLoading = false;
        captchaFailed = true;
        container.innerHTML = '<p class="pf-captcha__error">Не удалось загрузить капчу. Обновите страницу и попробуйте снова.</p>';
      });
  }

  function getCaptchaToken() {
    if (captchaWidget !== null && window.smartCaptcha && typeof window.smartCaptcha.getResponse === 'function') {
      var token = window.smartCaptcha.getResponse(captchaWidget);
      if (token) return token;
    }

    var input = form.querySelector('input[name="smart-token"]');
    return input ? input.value : '';
  }

  function resetCaptcha() {
    if (captchaWidget !== null && window.smartCaptcha && typeof window.smartCaptcha.reset === 'function') {
      try {
        window.smartCaptcha.reset(captchaWidget);
      } catch (error) {
        /* виджет мог ещё не отрисоваться */
      }
    }
  }

  function setCaptchaError(message) {
    var error = errorElement('captcha');
    if (!error) return;

    error.textContent = message;
    error.hidden = false;
  }

  /* ---------- отправка ---------- */

  function setSending(state) {
    sending = state;
    if (submitBtn) submitBtn.disabled = state;
    if (submitLabel) submitLabel.textContent = state ? 'Отправляем…' : submitLabelDefault;
  }

  function showSuccess() {
    form.reset();
    clearErrors();
    resetCaptcha();

    intro.hidden = true;
    form.hidden = true;
    success.hidden = false;

    var heading = success.querySelector('.pf-success__title');
    if (heading) heading.focus();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (sending) return;

    formError.hidden = true;
    clearError('captcha');

    if (!validateForm()) return;

    if (captchaFailed) {
      setCaptchaError('Капча не загрузилась. Обновите страницу и попробуйте снова.');
      return;
    }

    var token = getCaptchaToken();
    if (!token) {
      setCaptchaError('Пройдите капчу');
      return;
    }

    setSending(true);

    var data = new FormData(form);
    data.set('smart-token', token);

    fetch(form.action, {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(function (response) {
        return response.text();
      })
      .then(function (text) {
        var result = null;

        try {
          result = JSON.parse(text);
        } catch (error) {
          result = null;
        }

        if (text.trim() === 'captcha' || (result && result.status === 'captcha')) {
          setCaptchaError('Пройдите капчу');
          resetCaptcha();
          return;
        }

        if (result && result.status === 'OK') {
          showSuccess();
          return;
        }

        throw new Error((result && result.message) || 'Ошибка отправки');
      })
      .catch(function () {
        formError.textContent = 'Не удалось отправить заявку. Попробуйте ещё раз или напишите на info@smmconfa.ru.';
        formError.hidden = false;
        resetCaptcha();
      })
      .finally(function () {
        setSending(false);
      });
  });

  /* ---------- «горящая» рамка кнопок ---------- */

  // Внутри формы анимация не нужна. Если общий app.js успел включить её
  // для кнопок модального окна, гасим и убираем canvas.
  function removeInternalStar() {
    var buttons = modal.querySelectorAll('.btn');

    for (var i = 0; i < buttons.length; i++) {
      var api = buttons[i].__starBorder;

      if (api && typeof api.destroy === 'function') {
        try {
          api.destroy();
        } catch (error) {
          /* уже уничтожена */
        }
      }

      var canvas = buttons[i].querySelector('.star-border__light');
      if (canvas) canvas.remove();
    }
  }


  removeInternalStar();

  /* ---------- открытие по ссылке ---------- */

  if (window.location.hash === '#partner-form' || /[?&]open=1(&|$)/.test(window.location.search)) {
    window.setTimeout(function () {
      openModal(null);
    }, 0);
  }
})();
