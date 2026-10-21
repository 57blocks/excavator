/*
 * components.js: the pieces the product pages share (openspec: changes/report-viewer, design D5):
 * count tiles, a plain table, the different-revision banner, the card for a product that is not
 * available, and a table that sorts and pages (200 rows a page). The sort and paging functions
 * are pure and are run in Node by the tests.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;
  var fmt = XV.formatNumber;

  var PAGE_SIZE = 200;
  var EN_DASH = String.fromCharCode(0x2013);
  var ARROW_UP = String.fromCharCode(0x25b2);
  var ARROW_DOWN = String.fromCharCode(0x25bc);

  // ---- pure ----

  function typeRank(value) {
    return typeof value === 'number' ? 0 : 1;
  }

  /** Order two sort keys: numbers by value, text by code unit, numbers before text. */
  function compareKeys(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
    var x = String(a);
    var y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * A sorted copy of `rows` by `keyOf(row)`; `dir` is 1 (ascending) or -1. A row whose key is null or
   * undefined comes last in both directions; equal keys keep the order the rows came in.
   */
  function sortRows(rows, keyOf, dir) {
    var indexed = rows.map(function (row, index) { return { row: row, index: index, key: keyOf(row) }; });
    indexed.sort(function (a, b) {
      var aNone = a.key === null || a.key === undefined;
      var bNone = b.key === null || b.key === undefined;
      if (aNone || bNone) return aNone === bNone ? a.index - b.index : (aNone ? 1 : -1);
      return compareKeys(a.key, b.key) * (dir < 0 ? -1 : 1) || a.index - b.index;
    });
    return indexed.map(function (item) { return item.row; });
  }

  /**
   * Which rows page `page` (1-based) shows out of `total`: the page is clamped into range;
   * from and to are 1-based and inclusive, both 0 when there are no rows.
   */
  function pageBounds(total, page, size) {
    var pages = Math.max(1, Math.ceil(total / size));
    var current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    if (total === 0) return { page: 1, pages: 1, from: 0, to: 0, total: 0 };
    return { page: current, pages: pages, from: (current - 1) * size + 1, to: Math.min(total, current * size), total: total };
  }

  function footerText(bounds) {
    if (bounds.total === 0) return 'No rows';
    return 'Rows ' + fmt(bounds.from) + EN_DASH + fmt(bounds.to) + ' of ' + fmt(bounds.total);
  }

  // ---- DOM ----

  /** A cell's content: a missing value (null, '' or the empty-value dash) shows as a muted dash; a field the product lacks says so. */
  function cellContent(value) {
    if (value === XV.NOT_PROVIDED) return h('span', { class: 'xv-muted', text: XV.NOT_PROVIDED });
    if (value === null || value === undefined || value === '' || value === XV.EMPTY) return h('span', { class: 'xv-muted', text: XV.EMPTY });
    return value;
  }

  function tile(label, value) {
    return h('div', { class: 'xv-tile' },
      h('div', { class: 'xv-tile-label', text: label }),
      h('div', { class: 'xv-tile-value', text: value }));
  }

  /** columns: [{ label, num, wrap }]; rows: arrays of cells (text or nodes). */
  function simpleTable(columns, rows) {
    return h('div', { class: 'xv-table-wrap' },
      h('table', { class: 'xv-table' },
        h('thead', null, h('tr', null, columns.map(function (c) {
          return h('th', { class: c.num ? 'xv-num' : null, text: c.label });
        }))),
        h('tbody', null, rows.map(function (row) {
          return h('tr', null, columns.map(function (c, i) {
            return h('td', { class: c.num ? 'xv-num' : (c.wrap ? 'xv-wrap' : null) }, cellContent(row[i]));
          }));
        }))));
  }

  function chipGroup(label, values, selected, onToggle) {
    return h('div', { class: 'xv-filter' },
      h('span', { class: 'xv-filter-label', text: label }),
      h('span', { class: 'xv-chips' }, values.map(function (value) {
        var on = selected.indexOf(value) !== -1;
        return h('button', {
          type: 'button',
          class: on ? 'xv-chip-btn xv-chip-on' : 'xv-chip-btn',
          'aria-pressed': on ? 'true' : 'false',
          text: value,
          on: { click: function () { onToggle(value); } },
        });
      })));
  }

  function productOf(manifest, name) {
    for (var i = 0; i < manifest.products.length; i++) if (manifest.products[i].name === name) return manifest.products[i];
    return null;
  }

  /** The banner a product page shows at its top when the product was made at another revision; null otherwise. */
  function revisionBanner(manifest, product) {
    if (!product || product.status !== 'different-revision') return null;
    return h('section', { class: 'xv-card xv-card-warn' },
      h('h2', { text: product.label + ': different revision' }),
      h('p', null, 'The product was made at ', h('code', { text: product.revision }), '; the source snapshot is ',
        h('code', { text: manifest.snapshot.revision }), '. Its content is shown as it was written.'));
  }

  /** The card a page shows instead of a table when its product is not run or cannot be read; null when it can be shown. */
  function unavailableCard(product) {
    if (!product) return h('section', { class: 'xv-card xv-card-error' }, h('h2', { text: 'No such product' }));
    if (product.status === 'not-run') {
      return h('section', { class: 'xv-card' }, h('h2', { text: product.label + ': not run' }),
        h('p', null, 'There is no ' + product.file + ' in .excavator/.'),
        h('p', null, 'Command: ', h('code', { text: product.command })));
    }
    if (product.status === 'unreadable') {
      return h('section', { class: 'xv-card xv-card-error' }, h('h2', { text: product.label + ': unreadable' }),
        h('p', { text: product.reason || 'The file could not be read.' }));
    }
    return null;
  }

  function pageHead(title, subtitle) {
    return h('div', { class: 'xv-page-head' }, h('h1', { text: title }), subtitle ? h('p', { text: subtitle }) : null);
  }

  /**
   * A table that sorts by any column and pages. columns: [{ label, num, width ('sm', 'md', 'lg' or 'xl': cut with an ellipsis), title(row) -> the whole text, key(row) -> sort key, render(row) -> text or node }].
   * Option initialSort { label, dir } sorts from the start by the column of that label (rows without a key come last either way). Options onRowClick(row) and rowClass(row) make rows clickable and mark one. Returns { el, setRows(rows), refresh() }. Sorting and paging act on every row handed in.
   */
  function dataTable(options) {
    var size = options.pageSize || PAGE_SIZE;
    var state = { rows: options.rows, column: -1, dir: 1, page: 1 };
    if (options.initialSort) {
      state.column = options.columns.map(function (c) { return c.label; }).indexOf(options.initialSort.label);
      if (state.column < 0) throw new Error('initialSort names no column: ' + options.initialSort.label);
      state.dir = options.initialSort.dir;
    }
    var el = h('div', { class: 'xv-dt' });

    function visibleRows() {
      return state.column < 0 ? state.rows : sortRows(state.rows, options.columns[state.column].key, state.dir);
    }

    function header(column, index) {
      var active = state.column === index;
      var arrow = active ? ' ' + (state.dir > 0 ? ARROW_UP : ARROW_DOWN) : '';
      return h('th', { class: column.num ? 'xv-num' : null, 'aria-sort': active ? (state.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', {
          type: 'button',
          class: 'xv-sort',
          text: column.label + arrow,
          on: {
            click: function () {
              if (state.column === index) state.dir = -state.dir;
              else { state.column = index; state.dir = 1; }
              state.page = 1;
              draw();
            },
          },
        }));
    }

    // One line per cell: a column with a width is cut with an ellipsis, and its title holds the whole text.
    function cell(column, row) {
      var classes = [];
      if (column.num) classes.push('xv-num');
      if (column.width) classes.push('xv-trunc', 'xv-w-' + column.width);
      var full = column.title ? column.title(row) : null;
      return h('td', { class: classes.join(' ') || null, title: typeof full === 'string' && full !== '' ? full : null }, cellContent(column.render(row)));
    }

    // A row can be clicked (or opened with Enter) when the table has an onRowClick; rowClass(row) marks the chosen one.
    function tableRow(row) {
      var extra = options.rowClass ? options.rowClass(row) : null;
      var clickable = typeof options.onRowClick === 'function';
      var open = function () { options.onRowClick(row); };
      return h('tr', {
        class: [clickable ? 'xv-clickable' : '', extra || ''].join(' ').trim() || null,
        tabindex: clickable ? '0' : null,
        on: clickable ? { click: open, keydown: function (event) { if (event.key === 'Enter') open(); } } : null,
      }, options.columns.map(function (c) { return cell(c, row); }));
    }

    function draw() {
      var rows = visibleRows();
      var bounds = pageBounds(rows.length, state.page, size);
      state.page = bounds.page;
      var shown = rows.slice(Math.max(0, bounds.from - 1), bounds.to);
      var pager = function (label, to, disabled) {
        return h('button', { type: 'button', class: 'xv-pager', disabled: disabled, text: label, on: { click: function () { state.page = to; draw(); } } });
      };
      XV.replaceChildren(el, [
        h('div', { class: 'xv-table-wrap xv-dense' },
          h('table', { class: 'xv-table' },
            h('thead', null, h('tr', null, options.columns.map(header))),
            h('tbody', null, shown.map(function (row) { return tableRow(row); })))),
        h('div', { class: 'xv-footer' },
          h('span', { class: 'xv-muted', 'data-xv-footer': '', text: footerText(bounds) }),
          h('span', { class: 'xv-pagers' },
            pager('Previous', bounds.page - 1, bounds.page <= 1),
            h('span', { class: 'xv-muted', text: 'Page ' + fmt(bounds.page) + ' of ' + fmt(bounds.pages) }),
            pager('Next', bounds.page + 1, bounds.page >= bounds.pages))),
      ]);
    }

    draw();
    return {
      el: el,
      setRows: function (rows) { state.rows = rows; state.page = 1; draw(); },
      refresh: function () { draw(); },
    };
  }

  // The SVG namespace is an identifier the DOM API needs, not an address anything is loaded from.
  var SVG_NAMESPACE = ['http', '//www.w3.org/2000/svg'].join(':');

  /** An SVG element built with createElementNS; attrs are set as attributes, children are elements or text. */
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NAMESPACE, tag);
    Object.keys(attrs || {}).forEach(function (name) {
      if (/^on/i.test(name) || name === 'style' || name === 'href') throw new Error('attribute not allowed: ' + name);
      el.setAttribute(name, String(attrs[name]));
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  XV.svgEl = svgEl;
  XV.cellContent = cellContent;
  XV.chipGroup = chipGroup;
  XV.tile = tile;
  XV.simpleTable = simpleTable;
  XV.productOf = productOf;
  XV.revisionBanner = revisionBanner;
  XV.unavailableCard = unavailableCard;
  XV.pageHead = pageHead;
  XV.dataTable = dataTable;
  XV.table = { sortRows: sortRows, pageBounds: pageBounds, footerText: footerText, compareKeys: compareKeys, PAGE_SIZE: PAGE_SIZE };
})();
