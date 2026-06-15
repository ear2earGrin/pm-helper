'use strict';
/* Site-wide EN/BG language runtime.
   - Text is dual-authored in the markup: <span data-lang="en">…</span><span data-lang="bg">…</span>
     css/i18n.css hides the inactive language based on <html lang>.
   - This script builds the EN|BG toggle, persists the choice, and lets page
     scripts react via the 'yf:langchange' event and window.YFLang.get(). */
(function () {
  var KEY = 'yf-lang';
  var SUPPORTED = ['en', 'bg'];

  function current() {
    var l = document.documentElement.getAttribute('lang');
    return SUPPORTED.indexOf(l) !== -1 ? l : 'en';
  }

  function apply(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = 'en';
    document.documentElement.setAttribute('lang', lang);
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    document.querySelectorAll('.yf-lang-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-set-lang') === lang);
    });
    document.dispatchEvent(new CustomEvent('yf:langchange', { detail: { lang: lang } }));
  }

  window.YFLang = { get: current, set: apply };

  function buildToggle() {
    document.querySelectorAll('.nav-inner, .lat-nav').forEach(function (host) {
      if (host.querySelector('.yf-langtoggle')) return;
      var wrap = document.createElement('div');
      wrap.className = 'yf-langtoggle';
      SUPPORTED.forEach(function (l) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'yf-lang-btn';
        btn.setAttribute('data-set-lang', l);
        btn.setAttribute('aria-label', l === 'bg' ? 'Български' : 'English');
        btn.textContent = l.toUpperCase();
        btn.addEventListener('click', function () { apply(l); });
        wrap.appendChild(btn);
      });
      var links = host.querySelector('.nav-links');
      (links || host).appendChild(wrap);
    });
  }

  function start() { buildToggle(); apply(current()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
