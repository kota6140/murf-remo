/* TakeRemo — header dropdowns (Services, Industries) + deep links to an industry tab */
(() => {
  'use strict';
  const dds = Array.from(document.querySelectorAll('.nav-dd'));

  const setOpen = (dd, open) => {
    dd.classList.toggle('is-open', open);
    const btn = dd.querySelector('.nav-dd-btn');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const closeAll = (except) => dds.forEach((dd) => { if (dd !== except) setOpen(dd, false); });

  dds.forEach((dd) => {
    const btn = dd.querySelector('.nav-dd-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // with a mouse, clicking the label itself goes to the page (hover still opens the menu); touch keeps the toggle
      if (btn.dataset.href && window.matchMedia('(hover: hover) and (pointer: fine)').matches) { location.href = btn.dataset.href; return; }
      const open = !dd.classList.contains('is-open');
      closeAll(dd);
      setOpen(dd, open);
    });
    dd.addEventListener('click', (e) => { if (e.target.closest('.nav-dd-menu a')) setOpen(dd, false); });
  });
  document.addEventListener('click', () => closeAll());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  // #industry-<key> opens that tab in the homepage "Industries" section
  const openIndustryFromHash = () => {
    const m = location.hash.match(/^#industry-([a-z]+)$/);
    if (!m) return;
    const tab = document.querySelector(`.ind-pill-btn[data-industry="${m[1]}"]`);
    const section = document.getElementById('industries');
    if (!tab || !section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tab.click();
  };
  window.addEventListener('hashchange', openIndustryFromHash);
  if (location.hash.indexOf('#industry-') === 0) window.addEventListener('load', () => setTimeout(openIndustryFromHash, 350));
})();
