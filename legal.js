/* TakeRemo — legal pages: reading progress bar, section reveal, contents highlight. */
(function () {
  'use strict';

  var bar = document.querySelector('.lg-progress i');
  var links = Array.prototype.slice.call(document.querySelectorAll('.lg-toc a'));
  var secs = Array.prototype.slice.call(document.querySelectorAll('.lg-sec'));
  var ticking = false;

  function update() {
    ticking = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';

    // the last section whose top has passed the reading line is the current one
    var current = secs[0];
    secs.forEach(function (s) { if (s.getBoundingClientRect().top <= 160) current = s; });
    links.forEach(function (a) {
      a.classList.toggle('on', !!current && a.getAttribute('href') === '#' + current.id);
    });
  }

  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', update);

  // fade sections in as they scroll into view
  var items = document.querySelectorAll('.lg-sec, .lg-short div');
  if ('IntersectionObserver' in window) {
    document.documentElement.classList.add('lg-js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el, i) {
      el.style.transitionDelay = (el.matches('.lg-short div') ? i * 80 : 0) + 'ms';
      io.observe(el);
    });
  }

  update();
})();
