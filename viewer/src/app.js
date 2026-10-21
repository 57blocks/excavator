/*
 * app.js: boot. Reads the manifest, draws the shell (top bar, navigation), renders the page the
 * hash names, and tells the outside world when it is done: <html data-xv-ready="1">, plus a
 * data-xv-count-<name> per total the page shows. A failure draws an error card and sets
 * data-xv-ready="error" (design D5).
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;

  var COUNT_PREFIX = 'data-xv-count-';

  function clearCounts(root) {
    Array.prototype.slice.call(root.attributes).forEach(function (attr) {
      if (attr.name.indexOf(COUNT_PREFIX) === 0) root.removeAttribute(attr.name);
    });
  }

  function errorCard(title, error) {
    return h('section', { class: 'xv-card xv-card-error' },
      h('h2', { text: title }),
      h('p', { text: error && error.message ? error.message : String(error) }));
  }

  function pageStatus(manifest, page) {
    if (page.product === null) return XV.overview.worstStatus(manifest.products);
    var product = manifest.products.filter(function (p) { return p.name === page.product; })[0];
    return product ? product.status : 'not-run';
  }

  function drawShell(app, manifest) {
    var nav = h('nav', { class: 'xv-nav', 'aria-label': 'Pages' }, XV.pages.list.map(function (page) {
      return h('a', { href: XV.router.buildHash(page.id), 'data-xv-nav': page.id },
        h('span', { class: 'xv-dot xv-dot-' + pageStatus(manifest, page), 'aria-hidden': 'true' }),
        h('span', { text: page.label }));
    }));
    var main = h('main', { class: 'xv-main', id: 'xv-main' });
    XV.replaceChildren(app, h('div', { class: 'xv-shell' },
      h('header', { class: 'xv-topbar' },
        h('span', { class: 'xv-brand' }, h('span', { class: 'xv-brand-mark' }), 'Excavator'),
        h('span', { class: 'xv-project', text: manifest.project.name }),
        h('span', { class: 'xv-chip', title: manifest.snapshot.revision, text: manifest.snapshot.revision })),
      h('div', { class: 'xv-body' }, nav, main)));
    return { nav: nav, main: main };
  }

  function markCurrent(nav, pageId) {
    Array.prototype.slice.call(nav.querySelectorAll('a')).forEach(function (a) {
      if (a.getAttribute('data-xv-nav') === pageId) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function renderRoute(manifest, shell) {
    var root = document.documentElement;
    root.removeAttribute('data-xv-ready');
    clearCounts(root);
    var route = XV.router.parseRoute(window.location.hash);
    var page = XV.pages.find(route.page);
    markCurrent(shell.nav, page ? page.id : '');
    XV.replaceChildren(shell.main, null);
    if (!page) {
      shell.main.appendChild(errorCard('No such page', new Error('"' + route.page + '" is not a page of this viewer.')));
      root.setAttribute('data-xv-ready', 'error');
      return Promise.resolve();
    }
    var ctx = {
      manifest: manifest,
      route: route,
      root: shell.main,
      setCount: function (name, value) { root.setAttribute(COUNT_PREFIX + name, String(value)); },
    };
    return Promise.resolve().then(function () { return page.render(ctx); }).then(function () {
      root.setAttribute('data-xv-ready', '1');
    }, function (error) {
      shell.main.appendChild(errorCard('This page could not be drawn', error));
      root.setAttribute('data-xv-ready', 'error');
    });
  }

  function boot() {
    var app = document.getElementById('xv-app');
    try {
      var manifest = XV.data.readManifest();
      document.title = manifest.project.name + ' - Excavator view';
      var shell = drawShell(app, manifest);
      window.addEventListener('hashchange', function () { renderRoute(manifest, shell); });
      return renderRoute(manifest, shell);
    } catch (error) {
      XV.replaceChildren(app, h('main', { class: 'xv-main' }, errorCard('The viewer could not start', error)));
      document.documentElement.setAttribute('data-xv-ready', 'error');
      return Promise.resolve();
    }
  }

  XV.boot = boot;
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('xv-app')) boot();
})();
