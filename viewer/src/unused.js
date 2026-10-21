/*
 * unused.js: the Unused code page (openspec: changes/report-viewer, spec "Unused code page").
 * It shows what `unused-code.json` holds: counts and conservation, the decisions, the unused
 * functions with their reason, confidence and signals, the test-only ones and the residual
 * assumptions. It states the product's facts and says nothing about what to do with them.
 *
 * The filter and row functions are pure and are run in Node by the tests.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;
  var fmt = XV.formatNumber;

  var CONFIDENCES = ['high', 'medium', 'low'];
  var CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
  var REASONS = ['unreferenced', 'only-reachable-from-unused'];
  var NO_LANGUAGE = 'unknown';
  var SIGNALS_SHOWN = 2;
  var QUERY_HEAD_CHARS = 60;

  // ---- pure ----

  /** The signals as one short text: the first two names, then how many more there are ("capped, name-elsewhere +3"). */
  function signalsText(signals) {
    if (!signals || signals.length === 0) return null;
    var names = signals.slice(0, SIGNALS_SHOWN).map(function (signal) { return signal.signal; });
    var more = signals.length - names.length;
    return names.join(', ') + (more > 0 ? ' +' + more : '');
  }

  /** Everything the signals record, as JSON text, for the tooltip. */
  function signalsTitle(signals) {
    return signals && signals.length > 0 ? JSON.stringify(signals) : null;
  }

  /** The first line of a query, cut to QUERY_HEAD_CHARS; `rest` says whether anything of the query is left out. */
  function queryHead(query) {
    var first = query.split('\n')[0];
    var head = first.length > QUERY_HEAD_CHARS ? first.slice(0, QUERY_HEAD_CHARS) + '...' : first;
    return { head: head, rest: head !== query };
  }

  /** A table row from one `unused[]` entry of the product. Missing fields stay null, never 0 or ''. */
  function normalizeRow(raw) {
    var range = Array.isArray(raw.lineRange) && typeof raw.lineRange[0] === 'number' ? raw.lineRange : null;
    var name = typeof raw.name === 'string' ? raw.name : null;
    var owner = typeof raw.owner === 'string' ? raw.owner : null;
    var file = typeof raw.file === 'string' ? raw.file : null;
    return {
      id: raw.id,
      name: name,
      owner: owner,
      language: typeof raw.language === 'string' ? raw.language : null,
      file: file,
      lineRange: range,
      visibility: typeof raw.visibility === 'string' ? raw.visibility : null,
      reason: typeof raw.reason === 'string' ? raw.reason : null,
      confidence: typeof raw.confidence === 'string' ? raw.confidence : null,
      group: typeof raw.group === 'number' ? raw.group : null,
      signals: Array.isArray(raw.signals) ? raw.signals : [],
      search: [name, owner, file].join('\n').toLowerCase(),
    };
  }

  function languageOf(row) {
    return row.language === null ? NO_LANGUAGE : row.language;
  }

  function includes(list, value) {
    return list.length === 0 || list.indexOf(value) !== -1;
  }

  /**
   * The rows that match every filter. filters: { confidence: [...], reason: [...], language: [...], text, group };
   * an empty list or text, or a null group, does not filter. Text is matched, ignoring case, against the
   * name, the owner and the file.
   */
  function filterRows(rows, filters) {
    var text = (filters.text || '').trim().toLowerCase();
    var confidence = filters.confidence || [];
    var reason = filters.reason || [];
    var language = filters.language || [];
    var group = filters.group === undefined ? null : filters.group;
    return rows.filter(function (row) {
      return includes(confidence, row.confidence) && includes(reason, row.reason) && includes(language, languageOf(row)) &&
        (group === null || row.group === group) && (text === '' || row.search.indexOf(text) !== -1);
    });
  }

  /** The distinct values of a field over the rows, sorted. */
  function distinct(rows, valueOf) {
    var seen = {};
    rows.forEach(function (row) { seen[valueOf(row)] = true; });
    return Object.keys(seen).sort();
  }

  /** The sort keys of the columns, by column id. */
  var KEYS = {
    name: function (row) { return row.name; },
    owner: function (row) { return row.owner; },
    language: function (row) { return row.language; },
    location: function (row) { return row.file === null ? null : row.file + '\n' + pad(row.lineRange === null ? 0 : row.lineRange[0]); },
    visibility: function (row) { return row.visibility; },
    reason: function (row) { return row.reason; },
    confidence: function (row) { return row.confidence === null ? null : (CONFIDENCE_RANK[row.confidence] || 0); },
    group: function (row) { return row.group; },
    signals: function (row) { return row.signals.length; },
  };

  function pad(number) {
    var text = String(number);
    return '0000000000'.slice(text.length) + text;
  }

  // ---- DOM ----

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

  function confidenceBadge(confidence) {
    return confidence === null ? null : h('span', { class: 'xv-badge xv-badge-conf-' + confidence, text: confidence });
  }

  function location(row) {
    return row.file === null ? null : XV.codeLink(row.file, row.lineRange);
  }

  function locationTitle(row) {
    if (row.file === null) return null;
    var lines = XV.code.rangeText(row.lineRange);
    return row.file + (lines ? ':' + lines : '');
  }

  function summaryCards(product) {
    var counts = product.counts;
    var conservation = product.conservation;
    var tiles = [
      ['Candidates', counts.candidates], ['Removed by decision', counts.removedByDecision], ['Test only', counts.testOnly],
      ['Unused', counts.unused], ['Unreferenced', counts.unreferenced], ['Only reachable from unused', counts.onlyReachableFromUnused],
      ['Groups', counts.groups],
    ].map(function (t) { return XV.tile(t[0], fmt(t[1])); });
    var byConfidence = counts.byConfidence || {};
    var languages = counts.byLanguage || {};
    var conservationLine = 'candidates (' + fmt(conservation.candidates) + ') = removed by decision (' + fmt(conservation.removedByDecision) +
      ') + test only (' + fmt(conservation.testOnly) + ') + unused (' + fmt(conservation.unused) + '): ' +
      (conservation.holds === true ? 'holds' : 'does not hold');
    return [
      h('section', { class: 'xv-card' }, h('h2', { text: 'Counts' }), h('div', { class: 'xv-tiles' }, tiles),
        h('p', { class: 'xv-conservation', text: conservationLine })),
      h('div', { class: 'xv-grid-side' },
        h('section', { class: 'xv-card' }, h('h2', { text: 'Unused by confidence' }),
          XV.simpleTable([{ label: 'Confidence' }, { label: 'Unused', num: true }],
            CONFIDENCES.map(function (c) { return [confidenceBadge(c), fmt(byConfidence[c])]; }))),
        h('section', { class: 'xv-card' }, h('h2', { text: 'By language' }),
          XV.simpleTable([{ label: 'Language' }, { label: 'Candidates', num: true }, { label: 'Calls', num: true }, { label: 'Unused', num: true },
            { label: 'High', num: true }, { label: 'Medium', num: true }, { label: 'Low', num: true }],
          Object.keys(languages).sort().map(function (language) {
            var r = languages[language];
            return [language, fmt(r.candidates), fmt(r.calls), fmt(r.unused), fmt(r.high), fmt(r.medium), fmt(r.low)];
          })))),
    ];
  }

  function queryCell(query) {
    if (typeof query !== 'string' || query === '') return null;
    var parts = queryHead(query);
    if (!parts.rest) return h('code', { text: query });
    return h('details', { class: 'xv-details' }, h('summary', { text: parts.head }), h('code', { text: query }));
  }

  function decisionsCard(decisions) {
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Decisions' }),
      decisions.length === 0 ? h('p', { class: 'xv-muted', text: 'The product records no decisions.' })
        : XV.simpleTable([{ label: 'Kind' }, { label: 'Reason', wrap: true }, { label: 'Query', wrap: true }, { label: 'Hits', num: true }],
          decisions.map(function (d) {
            return [typeof d.kind === 'string' ? d.kind : null, typeof d.reason === 'string' ? d.reason : null, queryCell(d.query), fmt(d.hits)];
          })));
  }

  function unusedCard(ctx, rows) {
    var filters = { confidence: [], reason: [], language: [], text: '', group: null };
    var holder = h('div', { class: 'xv-filters' });
    var languages = distinct(rows, languageOf);
    var table = XV.dataTable({
      rows: rows,
      columns: [
        { label: 'Name', key: KEYS.name, width: 'md', title: function (r) { return r.name; }, render: function (r) { return r.name; } },
        { label: 'Location', key: KEYS.location, width: 'xl', title: locationTitle, render: location },
        { label: 'Confidence', key: KEYS.confidence, render: function (r) { return confidenceBadge(r.confidence); } },
        { label: 'Reason', key: KEYS.reason, render: function (r) { return r.reason; } },
        { label: 'Language', key: KEYS.language, render: function (r) { return r.language; } },
        { label: 'Group', key: KEYS.group, num: true, render: function (r) { return r.group === null ? null : groupButton(r.group); } },
        { label: 'Owner', key: KEYS.owner, width: 'md', title: function (r) { return r.owner; }, render: function (r) { return r.owner; } },
        { label: 'Visibility', key: KEYS.visibility, render: function (r) { return r.visibility; } },
        { label: 'Signals', key: KEYS.signals, width: 'md', title: function (r) { return signalsTitle(r.signals); }, render: function (r) { return signalsText(r.signals); } },
      ],
    });
    var shown = h('p', { class: 'xv-muted', 'data-xv-shown': '' });

    function groupButton(group) {
      return h('button', {
        type: 'button', class: 'xv-linkbtn', title: 'Show only the functions of group ' + group, text: String(group),
        on: { click: function () { filters.group = group; apply(); } },
      });
    }

    function toggle(list, value) {
      var at = list.indexOf(value);
      if (at === -1) list.push(value); else list.splice(at, 1);
      apply();
    }

    function drawFilters() {
      XV.replaceChildren(holder, [
        chipGroup('Confidence', CONFIDENCES, filters.confidence, function (v) { toggle(filters.confidence, v); }),
        chipGroup('Reason', REASONS, filters.reason, function (v) { toggle(filters.reason, v); }),
        chipGroup('Language', languages, filters.language, function (v) { toggle(filters.language, v); }),
        filters.group === null ? null : h('div', { class: 'xv-filter' },
          h('span', { class: 'xv-filter-label', text: 'Group' }),
          h('button', { type: 'button', class: 'xv-chip-btn xv-chip-on', text: 'Group ' + filters.group + ' (clear)', on: { click: function () { filters.group = null; apply(); } } })),
      ]);
    }

    function apply() {
      var matching = filterRows(rows, filters);
      ctx.setCount('unused-shown', matching.length);
      XV.replaceChildren(shown, 'Showing ' + fmt(matching.length) + ' of ' + fmt(rows.length) + ' unused functions');
      drawFilters();
      table.setRows(matching);
    }

    var search = h('input', {
      type: 'search', class: 'xv-input', placeholder: 'Search name, owner or file', 'aria-label': 'Search name, owner or file',
      on: { input: function (event) { filters.text = event.target.value; apply(); } },
    });
    var card = h('section', { class: 'xv-card' }, h('h2', { text: 'Unused functions' }), search, holder, shown, table.el);
    ctx.setCount('unused', rows.length);
    apply();
    return card;
  }

  function testOnlyCard(rows) {
    var table = XV.dataTable({
      rows: rows,
      columns: [
        { label: 'Name', key: KEYS.name, width: 'md', title: function (r) { return r.name; }, render: function (r) { return r.name; } },
        { label: 'Language', key: KEYS.language, render: function (r) { return r.language; } },
        { label: 'Location', key: KEYS.location, width: 'xl', title: locationTitle, render: location },
      ],
    });
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Used only by tests' }),
      rows.length === 0 ? h('p', { class: 'xv-muted', text: 'The product lists no function used only by tests.' }) : table.el);
  }

  function assumptionsCard(list) {
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Residual assumptions' }),
      h('ul', { class: 'xv-list' }, list.map(function (text) { return h('li', { text: String(text) }); })));
  }

  function render(ctx) {
    var manifest = ctx.manifest;
    var product = XV.productOf(manifest, 'unused-code');
    var page = h('div', { class: 'xv-page' },
      XV.pageHead('Unused code', 'Functions no route reaches, as the unused-code product lists them.'));
    ctx.root.appendChild(page);
    var unavailable = XV.unavailableCard(product);
    if (unavailable) {
      page.appendChild(unavailable);
      return Promise.resolve();
    }
    var banner = XV.revisionBanner(manifest, product);
    if (banner) page.appendChild(banner);
    return XV.data.loadJson(product.payloads[0]).then(function (data) {
      summaryCards(data).forEach(function (card) { page.appendChild(card); });
      page.appendChild(decisionsCard(Array.isArray(data.decisions) ? data.decisions : []));
      page.appendChild(unusedCard(ctx, (data.unused || []).map(normalizeRow)));
      page.appendChild(testOnlyCard((data.testOnly || []).map(normalizeRow)));
      page.appendChild(assumptionsCard(data.residualAssumptions || []));
    });
  }

  XV.unused = {
    signalsText: signalsText,
    signalsTitle: signalsTitle,
    queryHead: queryHead,
    normalizeRow: normalizeRow,
    filterRows: filterRows,
    distinct: distinct,
    languageOf: languageOf,
    keys: KEYS,
    render: render,
  };

  XV.pages.register({ id: 'unused', label: 'Unused code', order: 20, product: 'unused-code', render: render });
})();
