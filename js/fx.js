'use strict';
/* Cursor-reactive grid background. Injects its own markup (.fx) as the first
   child of <body>, then tracks the pointer via two CSS vars (--mx/--my).
   GPU-cheap (rAF-throttled), no-ops on touch / reduced-motion. */
(function () {
  var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq && mq.matches) return;

  function init() {
    var fx = document.querySelector('.fx');
    if (!fx) {
      fx = document.createElement('div');
      fx.className = 'fx';
      fx.setAttribute('aria-hidden', 'true');
      fx.innerHTML = '<div class="fx-grid"></div><div class="fx-glowgrid"></div><div class="fx-spot"></div>';
      document.body.insertBefore(fx, document.body.firstChild);
    }
    var b = document.body, x = 0, y = 0, ticking = false;
    function paint() { ticking = false; b.style.setProperty('--mx', x + 'px'); b.style.setProperty('--my', y + 'px'); }
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      x = e.clientX; y = e.clientY;
      b.classList.add('fx-on');
      if (!ticking) { ticking = true; requestAnimationFrame(paint); }
    }, { passive: true });
    document.addEventListener('mouseleave', function () { b.classList.remove('fx-on'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
