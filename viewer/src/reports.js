/*
 * reports.js: the Reports page (openspec: changes/report-viewer, spec "Code page and Reports page").
 * #/reports lists the two reports and their states; #/reports/hotspots and #/reports/doc-map show one,
 * rendered by markdown.js. The reports are written by a model from the products; this page shows
 * them as written.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;

  // The route name of each report and the manifest item it shows.
  var ROUTES = { 'hotspots': 'hotspots-report', 'doc-map': 'doc-map-report' };
  var ROUTE_NAMES = ['hotspots', 'doc-map'];

  function itemFor(manifest, routeName) {
    var product = XV.productOf(manifest, 'reports');
    var items = product && product.items ? product.items : [];
    for (var i = 0; i < items.length; i++) if (items[i].name === ROUTES[routeName]) return items[i];
    return null;
  }

  function statusBadge(status) {
    return h('span', { class: 'xv-badge xv-badge-' + status, text: XV.statusLabel(status) });
  }

  function listPage(ctx, page) {
    var included = 0;
    var rows = ROUTE_NAMES.map(function (name) {
      var item = itemFor(ctx.manifest, name);
      if (!item) return [name, statusBadge('not-run'), XV.EMPTY];
      if (item.status === 'included') included += 1;
      return [
        item.file,
        statusBadge(item.status),
        item.status === 'included'
          ? h('a', { href: XV.router.buildHash('reports', {}, name), text: 'Open' })
          : h('span', null, 'Not run. Command: ', h('code', { text: item.command })),
      ];
    });
    ctx.setCount('reports', included);
    page.appendChild(h('section', { class: 'xv-card' }, h('h2', { text: 'Reports' }),
      h('p', { class: 'xv-muted', text: 'Reports are written by a model from the products; this viewer shows them as written.' }),
      XV.simpleTable([{ label: 'Report' }, { label: 'Status' }, { label: 'Open or produce', wrap: true }], rows)));
  }

  function reportPage(ctx, page, name) {
    var item = itemFor(ctx.manifest, name);
    if (!item) {
      page.appendChild(h('section', { class: 'xv-card xv-card-error' }, h('h2', { text: 'No such report' }), h('p', { text: '"' + name + '" is not a report of this viewer.' })));
      return Promise.resolve();
    }
    page.appendChild(h('p', null, h('a', { href: XV.router.buildHash('reports', {}), text: 'All reports' })));
    if (item.status !== 'included') {
      page.appendChild(XV.unavailableCard({ status: 'not-run', label: item.label, file: item.file, command: item.command }));
      ctx.setCount('reports', 0);
      return Promise.resolve();
    }
    var product = XV.productOf(ctx.manifest, 'reports');
    ctx.setCount('reports', product.items.filter(function (i) { return i.status === 'included'; }).length);
    return XV.data.loadText(item.payload).then(function (text) {
      var lineCount = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
      ctx.setCount('report-lines', lineCount);
      page.appendChild(h('section', { class: 'xv-card' },
        h('p', { class: 'xv-muted' }, item.file + ': ' + lineCount + ' lines. Written by a model from the products; shown as written.'),
        XV.markdown.render(text)));
    });
  }

  function render(ctx) {
    var name = ctx.route.rest;
    var page = h('div', { class: 'xv-page' }, XV.pageHead('Reports', name === '' ? 'The reports the skills wrote from the products.' : null));
    ctx.root.appendChild(page);
    if (name === '') {
      listPage(ctx, page);
      return Promise.resolve();
    }
    return reportPage(ctx, page, name);
  }

  XV.reports = { routes: ROUTES, render: render };

  XV.pages.register({ id: 'reports', label: 'Reports', order: 60, product: 'reports', render: render });
})();
