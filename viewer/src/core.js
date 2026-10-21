/*
 * core.js: the XV namespace, a text-only DOM helper and number formatting.
 * Classic script, no imports (openspec: changes/report-viewer, design D1, D5).
 *
 * Every string that comes from a product or from source is inserted as text:
 * the helper below only uses createElement, createTextNode, setAttribute and
 * addEventListener, so nothing can be parsed as markup.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});

  // What the page shows where a product holds no value: an em dash (not a number or an empty string).
  var EMPTY = String.fromCharCode(0x2014);

  // Attributes that would make a string executable or load a resource are never set.
  var FORBIDDEN_ATTR = /^on/i;

  /**
   * h(tag, attrs, ...children): build an element.
   * attrs: { class, text, on: { click: fn }, <name>: <value> }; a null or false value is skipped.
   * children: nodes, strings (as text), numbers, arrays of those; null and false are skipped.
   */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (name) {
        var value = attrs[name];
        if (value === null || value === undefined || value === false) return;
        if (name === 'class') el.setAttribute('class', String(value));
        else if (name === 'text') el.appendChild(document.createTextNode(String(value)));
        else if (name === 'on') {
          Object.keys(value).forEach(function (type) { el.addEventListener(type, value[type]); });
        } else if (FORBIDDEN_ATTR.test(name) || name === 'src' || name === 'srcdoc' || name === 'style') {
          throw new Error('attribute not allowed: ' + name);
        } else el.setAttribute(name, value === true ? '' : String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else if (typeof child === 'object') el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }

  /** Group digits in threes: 1234567 becomes "1,234,567". Anything that is not a finite number gives the empty-value dash. */
  function formatNumber(value) {
    if (typeof value !== 'number' || !isFinite(value)) return EMPTY;
    var sign = value < 0 ? '-' : '';
    var digits = String(Math.abs(Math.round(value)));
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Replace the children of `el` with `children`. */
  function replaceChildren(el, children) {
    while (el.firstChild) el.removeChild(el.firstChild);
    append(el, children);
  }

  // The product states, in the words the page shows.
  var STATUS_LABELS = {
    'included': 'Included',
    'not-run': 'Not run',
    'unreadable': 'Unreadable',
    'different-revision': 'Different revision',
  };

  function statusLabel(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? STATUS_LABELS[status] : String(status);
  }

  // The pages, in navigation order (`order`, then registration). A page file registers itself:
  // { id, label, order, product (a manifest product name or null), status(manifest) (optional), render(ctx) -> Promise }.
  var pageList = [];
  var pages = {
    list: pageList,
    register: function (page) {
      if (typeof page.order !== 'number') page.order = 100;
      var at = pageList.length;
      while (at > 0 && pageList[at - 1].order > page.order) at -= 1;
      pageList.splice(at, 0, page);
    },
    find: function (id) {
      for (var i = 0; i < pageList.length; i++) if (pageList[i].id === id) return pageList[i];
      return null;
    },
  };

  XV.h = h;
  XV.EMPTY = EMPTY;
  // What the page says where a product predates a field (the field is absent, not null).
  XV.NOT_PROVIDED = 'not provided by the product';
  XV.formatNumber = formatNumber;
  XV.replaceChildren = replaceChildren;
  XV.statusLabel = statusLabel;
  XV.pages = pages;
})();
