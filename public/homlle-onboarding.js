/* Homlle cleaner onboarding — screen router.
   A real module so it satisfies script-src 'self'. No dependencies. */
(function () {
  'use strict';
  var screens = [].slice.call(document.querySelectorAll('.ho-screen'));
  if (!screens.length) return;
  var ids = screens.map(function (s) { return s.id; });

  function show(id) {
    if (ids.indexOf(id) < 0) id = 'home';
    screens.forEach(function (s) {
      if (s.id === id) { s.removeAttribute('hidden'); }
      else { s.setAttribute('hidden', ''); }
    });
    document.documentElement.setAttribute('data-screen', id);
    window.scrollTo(0, 0);
  }
  function fromHash() {
    return (window.location.hash || '#home').slice(1) || 'home';
  }
  window.addEventListener('hashchange', function () { show(fromHash()); });
  show(fromHash());
})();
