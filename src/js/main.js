/* Portfolio interactions: theme, nav, scrollspy, scroll reveal, back to top,
   contact form. No framework, no third-party scripts. */

(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- footer year ------------------------------------------------------- */

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* --- theme -------------------------------------------------------------
     The attribute is already set by the inline script in <head>; this only
     handles switching it. Icon swapping is done in CSS off [data-theme]. */

  var root = document.documentElement;
  var themeToggle = document.getElementById('theme-toggle');
  var themeColor = document.querySelector('meta[name="theme-color"]');
  var THEME_COLORS = { dark: '#0b0f14', light: '#f7f9fb' };

  function currentTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (themeColor) themeColor.setAttribute('content', THEME_COLORS[theme]);
    if (themeToggle) {
      themeToggle.setAttribute('aria-label',
        theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
  }

  applyTheme(currentTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try {
        localStorage.setItem('theme', next);
      } catch (e) {
        // Private mode or blocked storage: the choice just will not persist.
      }
    });
  }

  // Follow the OS while the visitor has never picked a theme themselves.
  var systemLight = window.matchMedia('(prefers-color-scheme: light)');
  var onSystemChange = function (e) {
    var stored;
    try {
      stored = localStorage.getItem('theme');
    } catch (err) {
      stored = null;
    }
    if (stored !== 'light' && stored !== 'dark') applyTheme(e.matches ? 'light' : 'dark');
  };

  if (systemLight.addEventListener) systemLight.addEventListener('change', onSystemChange);
  else if (systemLight.addListener) systemLight.addListener(onSystemChange);

  /* --- mobile nav -------------------------------------------------------- */

  var nav = document.getElementById('nav');
  var toggle = document.getElementById('nav-toggle');

  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  }

  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });

    // Close after picking a destination, and on Escape.
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        closeNav();
        toggle.focus();
      }
    });
  }

  /* --- sticky header hairline, back to top -------------------------------
     One passive listener for both: each only toggles a class, so there is
     nothing to throttle. */

  var header = document.querySelector('.site-header');
  var toTop = document.getElementById('back-to-top');
  var TO_TOP_AT = 480;

  if (header || toTop) {
    var onScroll = function () {
      var y = window.scrollY;
      if (header) header.classList.toggle('is-stuck', y > 8);
      if (toTop) toTop.classList.toggle('is-visible', y > TO_TOP_AT);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      // Scrolling away does not move focus, so send it somewhere sensible.
      var brand = document.querySelector('.brand');
      if (brand) brand.focus({ preventScroll: true });
    });
  }

  /* --- scroll reveal ------------------------------------------------------ */

  var revealables = document.querySelectorAll('.reveal');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealables.forEach(function (el, i) {
      // Small stagger between siblings; capped so nothing feels slow.
      el.style.transitionDelay = Math.min(i % 6, 5) * 55 + 'ms';
      revealObserver.observe(el);
    });
  }

  /* --- scrollspy ---------------------------------------------------------- */

  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var setActive = function (id) {
      navLinks.forEach(function (link) {
        link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
      });
    };

    var spy = new IntersectionObserver(function (entries) {
      // Pick the entry nearest the top of the viewport that is on screen.
      var visible = entries.filter(function (e) { return e.isIntersecting; });
      if (!visible.length) return;
      visible.sort(function (a, b) {
        return a.boundingClientRect.top - b.boundingClientRect.top;
      });
      setActive(visible[0].target.id);
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (s) { spy.observe(s); });
  }

  /* --- contact form ------------------------------------------------------- */

  // Replaced at build time with the deployed API endpoint.
  var ENDPOINT = '__CONTACT_ENDPOINT__';

  var form = document.getElementById('contact-form');
  if (!form) return;

  var statusEl = document.getElementById('cf-status');
  var submitBtn = document.getElementById('cf-submit');
  var MAILTO = 'yassine.berqiqch@gmail.com';

  var fields = {
    name: { el: form.elements.name, error: document.getElementById('cf-name-error') },
    email: { el: form.elements.email, error: document.getElementById('cf-email-error') },
    message: { el: form.elements.message, error: document.getElementById('cf-message-error') }
  };

  function setStatus(kind, text) {
    if (!statusEl) return;
    statusEl.className = 'form-status' + (kind ? ' is-' + kind : '');
    statusEl.textContent = text || '';
  }

  function setFieldError(key, msg) {
    var f = fields[key];
    if (!f || !f.error) return;
    if (msg) {
      f.error.textContent = msg;
      f.error.hidden = false;
      f.el.setAttribute('aria-invalid', 'true');
      f.el.setAttribute('aria-describedby', f.error.id);
    } else {
      f.error.hidden = true;
      f.el.removeAttribute('aria-invalid');
      f.el.removeAttribute('aria-describedby');
    }
  }

  function clearErrors() {
    Object.keys(fields).forEach(function (k) { setFieldError(k, ''); });
  }

  // Deliberately permissive: the Lambda does the authoritative check.
  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function validate(data) {
    var errors = {};
    if (!data.name) errors.name = 'Please enter your name.';
    else if (data.name.length > 100) errors.name = 'Name is too long (max 100 characters).';

    if (!data.email) errors.email = 'Please enter your email address.';
    else if (!looksLikeEmail(data.email)) errors.email = 'Please enter a valid email address.';

    if (!data.message) errors.message = 'Please enter a message.';
    else if (data.message.length < 10) errors.message = 'Please write at least 10 characters.';
    else if (data.message.length > 5000) errors.message = 'Message is too long (max 5000 characters).';

    return errors;
  }

  // Re-validate a field once it has been marked invalid, so errors clear as you type.
  Object.keys(fields).forEach(function (key) {
    var f = fields[key];
    if (!f.el) return;
    f.el.addEventListener('input', function () {
      if (f.el.getAttribute('aria-invalid') === 'true') setFieldError(key, '');
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    setStatus('', '');

    var data = {
      name: (form.elements.name.value || '').trim(),
      email: (form.elements.email.value || '').trim(),
      subject: (form.elements.subject.value || '').trim(),
      message: (form.elements.message.value || '').trim(),
      company: form.elements.company.value || '' // honeypot
    };

    var errors = validate(data);
    var keys = Object.keys(errors);

    if (keys.length) {
      keys.forEach(function (k) { setFieldError(k, errors[k]); });
      var first = fields[keys[0]].el;
      if (first) first.focus();
      setStatus('error', 'Please correct the highlighted fields.');
      return;
    }

    if (!ENDPOINT || ENDPOINT.indexOf('__CONTACT') === 0) {
      setStatus('error', 'The form is not configured yet. Please email me at ' + MAILTO + '.');
      return;
    }

    submitBtn.classList.add('is-sending');
    submitBtn.disabled = true;
    setStatus('', '');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (res) {
        if (res.ok) {
          form.reset();
          setStatus('success', 'Thanks for reaching out — your message is on its way. I will reply soon.');
          return;
        }
        if (res.status === 429) {
          setStatus('error', 'Too many messages sent. Please try again in a few minutes.');
          return;
        }
        setStatus('error', (res.body && res.body.error) ||
          'Something went wrong sending your message. Please email me at ' + MAILTO + '.');
      })
      .catch(function (err) {
        setStatus('error', err && err.name === 'AbortError'
          ? 'The request timed out. Please try again or email me at ' + MAILTO + '.'
          : 'Network error. Please try again or email me at ' + MAILTO + '.');
      })
      .then(function () {
        clearTimeout(timer);
        submitBtn.classList.remove('is-sending');
        submitBtn.disabled = false;
      });
  });
})();
