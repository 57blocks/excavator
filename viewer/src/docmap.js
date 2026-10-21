/*
 * docmap.js: the Doc map page (openspec: changes/report-viewer, spec "Doc map page"; design D3).
 * It shows what `doc-map.json` holds: the documents, the units each document describes with their
 * quote, the code found for each and the verdict of `doc-map/checks.json` on every piece of evidence,
 * the coverage of the project's code files, and the residual assumptions. Quotes, reasons and
 * searches are shown as the products wrote them.
 *
 * Joining checks to units and filtering are pure and are run in Node by the tests.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;
  var fmt = XV.formatNumber;

  var CODE_STATUSES = ['found', 'not-found', 'not-checked'];
  var VERDICTS = ['does', 'not', 'none', 'not checked'];
  var NOT_CHECKED = 'not checked';
  var UNITS_SHOWN_IN_TITLE = 30;

  // ---- pure ----

  function checkKey(unit, file, line) {
    return unit + ' ' + file + ':' + line;
  }

  /** The line of a piece of evidence or a check as the product records it (a number), else null. */
  function lineOf(value) {
    return typeof value === 'number' ? value : null;
  }

  /**
   * Join the checks to the units. A check belongs to the evidence of the unit (1-based number) that has the same
   * file and line. Returns { rows, hasChecks, unmatched, duplicates }: `unmatched` counts checks that name no
   * evidence, `duplicates` checks whose unit, file and line an earlier check already has (the first is used).
   */
  function joinChecks(units, checks) {
    var hasChecks = Array.isArray(checks);
    var byKey = Object.create(null);
    var duplicates = 0;
    (hasChecks ? checks : []).forEach(function (check) {
      var key = checkKey(check.unit, check.file, check.line);
      if (key in byKey) duplicates += 1;
      else byKey[key] = { check: check, used: false };
    });
    var rows = units.map(function (unit, index) {
      var number = index + 1;
      var code = unit.code && typeof unit.code === 'object' ? unit.code : null;
      var evidence = (code && Array.isArray(code.evidence) ? code.evidence : []).map(function (item) {
        var entry = byKey[checkKey(number, item.file, item.line)];
        if (entry) entry.used = true;
        return {
          file: typeof item.file === 'string' ? item.file : null,
          line: lineOf(item.line),
          code: typeof item.code === 'string' ? item.code : null,
          check: entry ? { verdict: entry.check.verdict, reason: typeof entry.check.reason === 'string' ? entry.check.reason : null } : null,
        };
      });
      var verdicts = countVerdicts(evidence);
      return {
        number: number,
        document: typeof unit.document === 'string' ? unit.document : null,
        id: typeof unit.id === 'string' ? unit.id : null,
        title: typeof unit.title === 'string' ? unit.title : null,
        quote: typeof unit.quote === 'string' ? unit.quote : null,
        line: lineOf(unit.line),
        page: lineOf(unit.page),
        codeStatus: code && typeof code.status === 'string' ? code.status : 'not-checked',
        evidence: evidence,
        searched: code && Array.isArray(code.searched) ? code.searched : [],
        verdicts: verdicts,
        verdictText: verdictText(verdicts, evidence.length),
      };
    });
    var unmatched = 0;
    Object.keys(byKey).forEach(function (key) { if (!byKey[key].used) unmatched += 1; });
    return { rows: rows, hasChecks: hasChecks, unmatched: unmatched, duplicates: duplicates };
  }

  /** How many pieces of evidence each verdict has; `unchecked` have no check, `other` a verdict the viewer does not know. */
  function countVerdicts(evidence) {
    var counts = { does: 0, not: 0, none: 0, unchecked: 0, other: 0 };
    evidence.forEach(function (item) {
      if (item.check === null) counts.unchecked += 1;
      else if (item.check.verdict === 'does' || item.check.verdict === 'not' || item.check.verdict === 'none') counts[item.check.verdict] += 1;
      else counts.other += 1;
    });
    return counts;
  }

  /** "does 3 / not 0 / none 0", with unchecked and other pieces added when there are some; no text for a unit without evidence. */
  function verdictText(counts, evidenceCount) {
    if (evidenceCount === 0) return null;
    if (counts.unchecked === evidenceCount) return NOT_CHECKED;
    var text = 'does ' + counts.does + ' / not ' + counts.not + ' / none ' + counts.none;
    if (counts.unchecked > 0) text += ' / not checked ' + counts.unchecked;
    if (counts.other > 0) text += ' / other ' + counts.other;
    return text;
  }

  function hasVerdict(row, verdict) {
    if (verdict === NOT_CHECKED) return row.verdicts.unchecked > 0;
    return row.verdicts[verdict] > 0;
  }

  /**
   * The units that match every filter: filters { codeStatus: [...], verdict: [...], text }. A unit matches a verdict
   * when any of its evidence has it ("not checked": any evidence without a check). Text is matched, ignoring case,
   * against the document, id, title and quote.
   */
  function filterUnits(rows, filters) {
    var text = (filters.text || '').trim().toLowerCase();
    var statuses = filters.codeStatus || [];
    var verdicts = filters.verdict || [];
    return rows.filter(function (row) {
      if (statuses.length > 0 && statuses.indexOf(row.codeStatus) === -1) return false;
      if (verdicts.length > 0 && !verdicts.some(function (v) { return hasVerdict(row, v); })) return false;
      if (text === '') return true;
      return [row.document, row.id, row.title, row.quote].join('\n').toLowerCase().indexOf(text) !== -1;
    });
  }

  /** "line 193", or "page 2, line 40" when the unit has a page. */
  function whereText(row) {
    if (row.line === null && row.page === null) return null;
    var parts = [];
    if (row.page !== null) parts.push('page ' + row.page);
    if (row.line !== null) parts.push('line ' + row.line);
    return parts.join(', ');
  }

  /** Unit numbers as text, cut after UNITS_SHOWN_IN_TITLE with how many more there are. */
  function unitList(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) return null;
    var head = numbers.slice(0, UNITS_SHOWN_IN_TITLE).join(', ');
    return numbers.length > UNITS_SHOWN_IN_TITLE ? head + ' +' + (numbers.length - UNITS_SHOWN_IN_TITLE) : head;
  }

  var KEYS = {
    document: function (r) { return r.document; },
    id: function (r) { return r.id; },
    title: function (r) { return r.title; },
    quote: function (r) { return r.quote; },
    where: function (r) { return r.page === null ? r.line : (r.page * 1000000 + (r.line === null ? 0 : r.line)); },
    codeStatus: function (r) { return r.codeStatus; },
    evidence: function (r) { return r.evidence.length; },
    verdict: function (r) { return r.verdictText; },
  };

  // ---- DOM ----

  function verdictBadge(verdict) {
    var known = verdict === 'does' || verdict === 'not' || verdict === 'none';
    return h('span', { class: 'xv-badge xv-badge-verdict-' + (known ? verdict : 'other'), text: String(verdict) });
  }

  function statusBadge(status) {
    return h('span', { class: 'xv-badge xv-badge-code-' + status, text: status });
  }

  function factsCard(data, coverage) {
    var facts = [];
    var fact = function (label, value) { facts.push(h('dt', { text: label }), h('dd', null, value)); };
    fact('Documents folder', h('span', { class: 'xv-mono', text: String(data.docsRoot) }));
    var converters = data.converters && typeof data.converters === 'object' ? data.converters : {};
    var names = Object.keys(converters).sort();
    fact('Converters', names.length === 0 ? XV.EMPTY : names.map(function (n) { return n + ': ' + converters[n]; }).join(', '));
    var code = data.code && typeof data.code === 'object' ? data.code : null;
    fact('Code root', code && typeof code.root === 'string' ? h('span', { class: 'xv-mono', text: code.root }) : 'none recorded');
    fact('Code revision', code && typeof code.revision === 'string' ? h('span', { class: 'xv-mono', text: code.revision }) : 'none recorded');
    if (coverage) fact('Coverage facts revision', typeof coverage.sourceRevision === 'string' ? h('span', { class: 'xv-mono', text: coverage.sourceRevision }) : 'none recorded');
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Sources' }), h('dl', { class: 'xv-facts' }, facts));
  }

  function countsCard(counts) {
    var tiles = [
      ['Documents', counts.files], ['Read', counts.read], ['Empty', counts.empty], ['No converter', counts.noConverter],
      ['Unsupported', counts.unsupported], ['Failed', counts.failed], ['Units', counts.units],
      ['Code found', counts.found], ['No code found', counts.notFound], ['Not checked', counts.notChecked],
    ].map(function (t) { return XV.tile(t[0], fmt(t[1])); });
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Counts' }), h('div', { class: 'xv-tiles' }, tiles));
  }

  function documentsCard(documents) {
    var table = XV.dataTable({
      rows: documents,
      columns: [
        { label: 'Path', width: 'xl', key: function (d) { return d.path; }, title: function (d) { return d.path; }, render: function (d) { return d.path; } },
        { label: 'Format', key: function (d) { return d.format; }, render: function (d) { return d.format; } },
        { label: 'Status', key: function (d) { return d.status; }, render: function (d) { return d.status; } },
        { label: 'Reason', width: 'lg', key: function (d) { return d.reason; }, title: function (d) { return d.reason; }, render: function (d) { return d.reason; } },
        { label: 'Chars', num: true, key: function (d) { return d.chars; }, render: function (d) { return d.chars === null ? null : fmt(d.chars); } },
        { label: 'Lines', num: true, key: function (d) { return d.lines; }, render: function (d) { return d.lines === null ? null : fmt(d.lines); } },
        { label: 'Pages', num: true, key: function (d) { return d.pages; }, render: function (d) { return d.pages === null ? null : fmt(d.pages); } },
        { label: 'Units', num: true, key: function (d) { return d.units; }, render: function (d) { return d.units === null ? null : fmt(d.units); } },
      ],
    });
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Documents' }), table.el);
  }

  function normalizeDocument(raw) {
    var num = function (v) { return typeof v === 'number' ? v : null; };
    return {
      path: String(raw.path), format: typeof raw.format === 'string' ? raw.format : null, status: typeof raw.status === 'string' ? raw.status : null,
      reason: typeof raw.reason === 'string' ? raw.reason : null, chars: num(raw.chars), lines: num(raw.lines), pages: num(raw.pages), units: num(raw.units),
    };
  }

  function unreadableCard(documents) {
    var bad = documents.filter(function (d) { return d.status !== 'read'; });
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Documents that were not read' }),
      bad.length === 0 ? h('p', { class: 'xv-muted', text: 'Every document was read.' })
        : XV.simpleTable([{ label: 'Path', wrap: true }, { label: 'Status' }, { label: 'Reason', wrap: true }],
          bad.map(function (d) { return [d.path, d.status, d.reason]; })));
  }

  function evidenceItem(item) {
    return h('li', { class: 'xv-evidence' },
      h('div', null, item.file === null ? XV.EMPTY : XV.codeLink(item.file, item.line === null ? null : [item.line])),
      item.code === null ? null : h('pre', { class: 'xv-quote', text: item.code }),
      item.check === null
        ? h('p', { class: 'xv-muted', text: 'Not checked: checks.json has no verdict for this place.' })
        : h('p', null, verdictBadge(item.check.verdict), ' ', item.check.reason === null ? h('span', { class: 'xv-muted', text: 'No reason recorded.' }) : item.check.reason));
  }

  function detailPanel(row) {
    var where = whereText(row);
    var body = [
      h('h2', null, [row.document === null ? XV.EMPTY : row.document, row.id === null ? '' : ' / ' + row.id, row.title === null ? '' : ' ' + row.title].join('')),
      h('p', { class: 'xv-muted', text: [where, 'unit ' + row.number].filter(Boolean).join(', ') }),
      h('h3', { text: 'Quote' }),
      row.quote === null ? h('p', { class: 'xv-muted', text: XV.EMPTY }) : h('pre', { class: 'xv-quote', text: row.quote }),
      h('h3', null, 'Code ', statusBadge(row.codeStatus)),
    ];
    if (row.codeStatus === 'found') {
      body.push(h('ul', { class: 'xv-evidence-list' }, row.evidence.map(evidenceItem)));
    } else if (row.codeStatus === 'not-found') {
      body.push(h('p', { text: 'No code was found. The searches that found none:' }));
      body.push(row.searched.length === 0 ? h('p', { class: 'xv-muted', text: 'The product lists no search.' }) : h('ul', { class: 'xv-evidence-list' }, row.searched.map(function (search) {
        return h('li', { class: 'xv-evidence' },
          h('div', null, 'Pattern: ', h('code', { text: String(search.pattern) })),
          h('div', { class: 'xv-muted' }, 'Paths: ' + (Array.isArray(search.paths) && search.paths.length > 0 ? search.paths.join(', ') : XV.EMPTY)));
      })));
    } else {
      body.push(h('p', { class: 'xv-muted', text: 'The code for this unit was not looked for.' }));
    }
    return h('section', { class: 'xv-card', 'data-xv-unit': row.number }, body);
  }

  function unitsCard(ctx, joined, preselected) {
    var rows = joined.rows;
    var filters = { codeStatus: [], verdict: [], text: '' };
    var selected = preselected;
    var detail = h('div', { class: 'xv-detail' });
    var holder = h('div', { class: 'xv-filters' });
    var shown = h('p', { class: 'xv-muted' });

    function showDetail() {
      XV.replaceChildren(detail, selected === null ? null : detailPanel(selected));
    }

    var table = XV.dataTable({
      rows: rows,
      onRowClick: function (row) { selected = row; showDetail(); table.refresh(); },
      rowClass: function (row) { return selected === row ? 'xv-row-selected' : null; },
      columns: [
        { label: 'Document', width: 'md', key: KEYS.document, title: function (r) { return r.document; }, render: function (r) { return r.document; } },
        { label: 'Id', key: KEYS.id, render: function (r) { return r.id; } },
        { label: 'Title', width: 'md', key: KEYS.title, title: function (r) { return r.title; }, render: function (r) { return r.title; } },
        { label: 'Quote', width: 'lg', key: KEYS.quote, title: function (r) { return r.quote; }, render: function (r) { return r.quote; } },
        { label: 'Where', key: KEYS.where, render: whereText },
        { label: 'Code', key: KEYS.codeStatus, render: function (r) { return statusBadge(r.codeStatus); } },
        { label: 'Evidence', num: true, key: KEYS.evidence, render: function (r) { return String(r.evidence.length); } },
        { label: 'Verdicts', key: KEYS.verdict, render: function (r) { return r.verdictText; } },
      ],
    });

    function toggle(list, value) {
      var at = list.indexOf(value);
      if (at === -1) list.push(value); else list.splice(at, 1);
      apply();
    }

    function apply() {
      var matching = filterUnits(rows, filters);
      ctx.setCount('units-shown', matching.length);
      XV.replaceChildren(shown, 'Showing ' + fmt(matching.length) + ' of ' + fmt(rows.length) + ' units');
      XV.replaceChildren(holder, [
        XV.chipGroup('Code', CODE_STATUSES, filters.codeStatus, function (v) { toggle(filters.codeStatus, v); }),
        XV.chipGroup('Verdict', VERDICTS, filters.verdict, function (v) { toggle(filters.verdict, v); }),
      ]);
      table.setRows(matching);
    }

    var search = h('input', {
      type: 'search', class: 'xv-input', placeholder: 'Search document, id, title or quote', 'aria-label': 'Search document, id, title or quote',
      on: { input: function (event) { filters.text = event.target.value; apply(); } },
    });
    var notes = [];
    if (!joined.hasChecks) notes.push('There is no doc-map/checks.json in this page: every piece of evidence shows as not checked.');
    if (joined.unmatched > 0) notes.push(fmt(joined.unmatched) + ' check(s) in checks.json name no evidence of a unit.');
    if (joined.duplicates > 0) notes.push(fmt(joined.duplicates) + ' check(s) repeat the unit, file and line of an earlier check and are not used.');
    ctx.setCount('units', rows.length);
    apply();
    showDetail();
    return [
      h('section', { class: 'xv-card' }, h('h2', { text: 'Units' }), search, holder, shown,
        notes.map(function (n) { return h('p', { class: 'xv-muted', text: n }); }), table.el,
        h('p', { class: 'xv-muted', text: 'Click a unit to see its quote, its code and the verdict on each place.' })),
      detail,
    ];
  }

  function coverageCards(coverage) {
    if (!coverage || typeof coverage !== 'object') {
      return [h('section', { class: 'xv-card' }, h('h2', { text: 'Coverage' }), h('p', { class: 'xv-muted', text: 'The product has no coverage yet: /excavator-doc-map has not counted the project\'s code files.' }))];
    }
    var c = coverage.counts || {};
    var tiles = [['Files analysed', c.files], ['Documents', c.documents], ['Code files', c.code], ['With evidence', c.withEvidence],
      ['Without evidence', c.withoutEvidence], ['Pieces of evidence', c.evidence], ['Not in a code file', c.outside]].map(function (t) { return XV.tile(t[0], fmt(t[1])); });
    var directories = (Array.isArray(coverage.directories) ? coverage.directories : []);
    var files = (Array.isArray(coverage.files) ? coverage.files : []);
    var outside = (Array.isArray(coverage.outside) ? coverage.outside : []);
    var documents = (Array.isArray(coverage.documents) ? coverage.documents : []);

    var dirTable = XV.dataTable({
      rows: directories,
      columns: [
        { label: 'Directory', width: 'xl', key: function (d) { return d.path; }, title: function (d) { return d.path; }, render: function (d) { return d.path; } },
        { label: 'Code files', num: true, key: function (d) { return d.files; }, render: function (d) { return fmt(d.files); } },
        { label: 'With evidence', num: true, key: function (d) { return d.withEvidence; }, render: function (d) { return fmt(d.withEvidence); } },
        { label: 'Units', width: 'lg', key: function (d) { return d.units ? d.units.length : null; }, title: function (d) { return unitList(d.units); }, render: function (d) { return unitList(d.units); } },
      ],
    });

    var fileFilters = { evidence: [], text: '' };
    var fileHolder = h('div', { class: 'xv-filters' });
    var fileShown = h('p', { class: 'xv-muted' });
    var fileTable = XV.dataTable({
      rows: files,
      columns: [
        { label: 'File', width: 'xl', key: function (f) { return f.path; }, title: function (f) { return f.path; }, render: function (f) { return XV.codeLink(f.path, null); } },
        { label: 'Evidence', key: function (f) { return f.units && f.units.length > 0 ? 1 : 0; }, render: function (f) { return f.units && f.units.length > 0 ? 'with evidence' : 'without evidence'; } },
        { label: 'Units', width: 'lg', key: function (f) { return f.units ? f.units.length : null; }, title: function (f) { return unitList(f.units); }, render: function (f) { return unitList(f.units); } },
      ],
    });
    function applyFiles() {
      var text = fileFilters.text.trim().toLowerCase();
      var matching = files.filter(function (f) {
        var withEvidence = f.units && f.units.length > 0;
        if (fileFilters.evidence.length > 0 && fileFilters.evidence.indexOf(withEvidence ? 'with evidence' : 'without evidence') === -1) return false;
        return text === '' || f.path.toLowerCase().indexOf(text) !== -1;
      });
      XV.replaceChildren(fileShown, 'Showing ' + fmt(matching.length) + ' of ' + fmt(files.length) + ' code files');
      XV.replaceChildren(fileHolder, XV.chipGroup('Evidence', ['with evidence', 'without evidence'], fileFilters.evidence, function (v) {
        var at = fileFilters.evidence.indexOf(v);
        if (at === -1) fileFilters.evidence.push(v); else fileFilters.evidence.splice(at, 1);
        applyFiles();
      }));
      fileTable.setRows(matching);
    }
    applyFiles();
    var fileSearch = h('input', {
      type: 'search', class: 'xv-input', placeholder: 'Search code file paths', 'aria-label': 'Search code file paths',
      on: { input: function (event) { fileFilters.text = event.target.value; applyFiles(); } },
    });

    return [
      h('section', { class: 'xv-card' }, h('h2', { text: 'Coverage' }),
        h('p', { class: 'xv-muted', text: 'A code file without evidence means only that no unit\'s evidence is in it.' }),
        h('div', { class: 'xv-tiles' }, tiles)),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Coverage by directory' }), dirTable.el),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Coverage by file' }), fileSearch, fileHolder, fileShown, fileTable.el),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Evidence outside the code files' }),
        outside.length === 0 ? h('p', { class: 'xv-muted', text: 'Every piece of evidence is in a code file of the facts.' })
          : XV.simpleTable([{ label: 'Unit', num: true }, { label: 'File', wrap: true }, { label: 'Line', num: true }],
            outside.map(function (o) { return [fmt(o.unit), typeof o.file === 'string' ? XV.codeLink(o.file, typeof o.line === 'number' ? [o.line] : null) : null, fmt(o.line)]; }))),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Documents among the facts' }),
        documents.length === 0 ? h('p', { class: 'xv-muted', text: 'No fact file counts as a document.' })
          : h('ul', { class: 'xv-list' }, documents.map(function (d) { return h('li', { class: 'xv-mono', text: String(d) }); }))),
    ];
  }

  function assumptionsCard(list) {
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Residual assumptions' }),
      h('ul', { class: 'xv-list' }, list.map(function (text) { return h('li', { text: String(text) }); })));
  }

  function render(ctx) {
    var manifest = ctx.manifest;
    var product = XV.productOf(manifest, 'doc-map');
    var page = h('div', { class: 'xv-page' },
      XV.pageHead('Doc map', 'The functions the documents describe, each with its quote and the code the product ties to it.'));
    ctx.root.appendChild(page);
    var unavailable = XV.unavailableCard(product);
    if (unavailable) {
      page.appendChild(unavailable);
      return Promise.resolve();
    }
    var banner = XV.revisionBanner(manifest, product);
    if (banner) page.appendChild(banner);
    var wantsChecks = product.payloads.indexOf('doc-map-checks') !== -1;
    return Promise.all([XV.data.loadJson('doc-map'), wantsChecks ? XV.data.loadJson('doc-map-checks') : Promise.resolve(null)]).then(function (loaded) {
      var data = loaded[0];
      var checks = loaded[1] ? loaded[1].checks : null;
      var joined = joinChecks(Array.isArray(data.units) ? data.units : [], checks);
      ctx.setCount('checks', joined.hasChecks ? checks.length : 0);
      var wanted = parseInt(ctx.route.params.unit, 10);
      var preselected = joined.rows.filter(function (r) { return r.number === wanted; })[0] || null;
      var documents = (Array.isArray(data.documents) ? data.documents : []).map(normalizeDocument);
      page.appendChild(countsCard(data.counts || {}));
      page.appendChild(factsCard(data, data.coverage));
      page.appendChild(documentsCard(documents));
      unitsCard(ctx, joined, preselected).forEach(function (card) { page.appendChild(card); });
      coverageCards(data.coverage).forEach(function (card) { page.appendChild(card); });
      page.appendChild(unreadableCard(documents));
      page.appendChild(assumptionsCard(data.residualAssumptions || []));
    });
  }

  XV.docmap = {
    joinChecks: joinChecks,
    countVerdicts: countVerdicts,
    verdictText: verdictText,
    filterUnits: filterUnits,
    whereText: whereText,
    unitList: unitList,
    detailPanel: detailPanel,
    keys: KEYS,
    render: render,
  };

  XV.pages.register({ id: 'doc-map', label: 'Doc map', order: 30, product: 'doc-map', render: render });
})();
