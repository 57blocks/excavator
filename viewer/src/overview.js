/*
 * overview.js: the Overview page (openspec: changes/report-viewer, spec
 * "Overview page"). Every number is read from a product field or counted over
 * the product's records; nothing is estimated.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;
  var fmt = XV.formatNumber;

  function bump(map, key, by) {
    map[key] = (map[key] || 0) + by;
  }

  function sortedRows(map, countKey) {
    return Object.keys(map).map(function (key) {
      var row = { type: key };
      row[countKey] = map[key];
      return row;
    }).sort(function (a, b) { return b[countKey] - a[countKey] || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0); });
  }

  function stringList(value) {
    return Array.isArray(value) ? value.filter(function (v) { return typeof v === 'string'; }) : [];
  }

  function sumValues(object) {
    var total = 0;
    Object.keys(object || {}).forEach(function (key) {
      if (typeof object[key] === 'number') total += object[key];
    });
    return total;
  }

  /**
   * Count the records of a knowledge-graph JSONL text: nodes and edges by type, gaps by kind,
   * the header's facts and the coverage record. Lines that do not parse are counted, not skipped silently.
   */
  function summarizeGraph(text) {
    var nodes = {};
    var edges = {};
    var gapKinds = {};
    var totals = { nodes: 0, edges: 0, gaps: 0, layers: 0, tour: 0, other: 0 };
    var header = null;
    var coverage = null;
    var scan = XV.data.eachJsonlRecord(text, function (record) {
      var kind = record && typeof record === 'object' ? record.record : undefined;
      if (kind === 'header' && header === null) {
        header = record;
      } else if (kind === 'node') {
        totals.nodes += 1;
        bump(nodes, record.node && typeof record.node.type === 'string' ? record.node.type : 'unknown', 1);
      } else if (kind === 'edge') {
        totals.edges += 1;
        bump(edges, record.edge && typeof record.edge.type === 'string' ? record.edge.type : 'unknown', 1);
      } else if (kind === 'gap') {
        totals.gaps += 1;
        var gap = record.gap || {};
        var key = typeof gap.kind === 'string' ? gap.kind : 'unknown';
        var row = gapKinds[key] || (gapKinds[key] = { kind: key, records: 0, count: 0 });
        row.records += 1;
        if (typeof gap.count === 'number') row.count += gap.count;
      } else if (kind === 'layer') {
        totals.layers += 1;
      } else if (kind === 'tour') {
        totals.tour += 1;
      } else if (kind === 'coverage') {
        coverage = record.coverage || null;
      } else {
        totals.other += 1;
      }
    });
    var fields = (header && header.fields) || {};
    var project = fields.project && typeof fields.project === 'object' ? fields.project : {};
    var headerCounts = (header && header.counts) || {};
    return {
      hasHeader: header !== null,
      project: {
        name: typeof project.name === 'string' ? project.name : null,
        description: typeof project.description === 'string' && project.description !== '' ? project.description : null,
        languages: stringList(project.languages),
        frameworks: stringList(project.frameworks),
      },
      kind: typeof fields.kind === 'string' ? fields.kind : null,
      totals: totals,
      headerCounts: {
        nodes: typeof headerCounts.nodes === 'number' ? headerCounts.nodes : null,
        edges: typeof headerCounts.edges === 'number' ? headerCounts.edges : null,
      },
      nodesByType: sortedRows(nodes, 'count'),
      edgesByType: sortedRows(edges, 'count'),
      gapsByKind: Object.keys(gapKinds).sort().map(function (k) { return gapKinds[k]; }),
      coverage: summarizeCoverage(coverage),
      badLines: scan.bad,
    };
  }

  function summarizeCoverage(coverage) {
    if (!coverage || typeof coverage !== 'object') return null;
    var byLanguage = coverage.byLanguage && typeof coverage.byLanguage === 'object' ? coverage.byLanguage : {};
    var rows = Object.keys(byLanguage).sort().map(function (language) {
      var entry = byLanguage[language] || {};
      var kinds = entry.kinds || {};
      return {
        language: language,
        files: typeof entry.files === 'number' ? entry.files : null,
        parsed: typeof entry.parsed === 'number' ? entry.parsed : null,
        zeroSymbol: typeof entry.zeroSymbol === 'number' ? entry.zeroSymbol : null,
        skipped: sumValues(entry.skipped),
        functions: typeof kinds['function'] === 'number' ? kinds['function'] : null,
        classes: typeof kinds['class'] === 'number' ? kinds['class'] : null,
      };
    });
    return {
      files: typeof coverage.files === 'number' ? coverage.files : null,
      ignored: typeof coverage.ignored === 'number' ? coverage.ignored : null,
      languages: rows,
    };
  }

  var SEVERITY = { 'unreadable': 3, 'different-revision': 2, 'not-run': 1, 'included': 0 };

  /** The most serious state among the products: unreadable, different revision, not run, included. */
  function worstStatus(products) {
    var worst = 'included';
    (products || []).forEach(function (product) {
      if ((SEVERITY[product.status] || 0) > SEVERITY[worst]) worst = product.status;
    });
    return worst;
  }

  /** What the Overview says in a product's detail cell. */
  function detailText(product, snapshotRevision) {
    if (product.status === 'unreadable') return product.reason || 'The file could not be read.';
    if (product.status === 'not-run') return 'There is no ' + product.file + '.';
    if (product.status === 'different-revision') {
      return 'Made at ' + product.revision + '; the source snapshot is ' + snapshotRevision + '.';
    }
    if (product.revisionNote) return capitalize(product.revisionNote) + '.';
    return 'Made at the source snapshot revision.';
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ---- DOM ----

  function badge(status) {
    return h('span', { class: 'xv-badge xv-badge-' + status, text: XV.statusLabel(status) });
  }

  var tile = XV.tile;
  var table = XV.simpleTable;

  function productRow(product, snapshotRevision) {
    var detail = [h('div', { text: detailText(product, snapshotRevision) })];
    if (product.items) {
      detail = product.items.map(function (item) {
        return h('div', null, item.file + ': ' + XV.statusLabel(item.status).toLowerCase() +
          (item.status === 'not-run' ? ' (' + item.command + ')' : ''));
      });
    } else if (product.status === 'not-run') {
      detail.push(h('div', null, 'Command: ', h('code', { text: product.command })));
    }
    return [
      product.label,
      badge(product.status),
      detail,
      h('span', { class: 'xv-mono', text: product.revision || (product.status === 'not-run' || product.status === 'unreadable' ? '' : 'none recorded') }),
    ];
  }

  function revisionBanners(manifest) {
    return manifest.products.map(function (p) { return XV.revisionBanner(manifest, p); }).filter(function (card) { return card !== null; });
  }

  function graphSection(summary) {
    var parts = [];
    var facts = [];
    function fact(label, value) {
      if (value === null || value === undefined || value === '') return;
      facts.push(h('dt', { text: label }), h('dd', null, value));
    }
    fact('Name in graph', summary.project.name);
    fact('Kind', summary.kind);
    fact('Description', summary.project.description);
    fact('Languages', summary.project.languages.length > 0 ? pills(summary.project.languages) : 'none listed');
    fact('Frameworks', summary.project.frameworks.length > 0 ? pills(summary.project.frameworks) : 'none listed');
    parts.push(h('section', { class: 'xv-card' }, h('h2', { text: 'Knowledge graph' }), h('dl', { class: 'xv-facts' }, facts)));

    var tiles = [
      tile('Nodes', fmt(summary.totals.nodes)),
      tile('Edges', fmt(summary.totals.edges)),
      tile('Gaps', fmt(summary.totals.gaps)),
    ];
    if (summary.coverage && summary.coverage.files !== null) tiles.push(tile('Files in coverage', fmt(summary.coverage.files)));
    if (summary.coverage && summary.coverage.ignored !== null) tiles.push(tile('Ignored', fmt(summary.coverage.ignored)));
    var notes = [];
    if (!summary.hasHeader) notes.push('The graph has no header record.');
    if (summary.badLines > 0) notes.push(fmt(summary.badLines) + ' line(s) of the graph file did not parse and are not counted.');
    if (summary.headerCounts.nodes !== null && summary.headerCounts.nodes !== summary.totals.nodes) {
      notes.push('The header states ' + fmt(summary.headerCounts.nodes) + ' nodes; ' + fmt(summary.totals.nodes) + ' node records are in the file.');
    }
    if (summary.headerCounts.edges !== null && summary.headerCounts.edges !== summary.totals.edges) {
      notes.push('The header states ' + fmt(summary.headerCounts.edges) + ' edges; ' + fmt(summary.totals.edges) + ' edge records are in the file.');
    }
    parts.push(h('section', { class: 'xv-card' },
      h('h2', { text: 'Counts' }),
      h('div', { class: 'xv-tiles' }, tiles),
      notes.map(function (n) { return h('p', { class: 'xv-muted', text: n }); })));

    parts.push(h('div', { class: 'xv-grid-2' },
      h('section', { class: 'xv-card' }, h('h2', { text: 'Nodes by type' }),
        table([{ label: 'Type' }, { label: 'Nodes', num: true }],
          summary.nodesByType.map(function (r) { return [r.type, fmt(r.count)]; }))),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Edges by type' }),
        table([{ label: 'Type' }, { label: 'Edges', num: true }],
          summary.edgesByType.map(function (r) { return [r.type, fmt(r.count)]; })))));

    if (summary.coverage && summary.coverage.languages.length > 0) {
      parts.push(h('section', { class: 'xv-card' }, h('h2', { text: 'Coverage by language' }),
        table([{ label: 'Language' }, { label: 'Files', num: true }, { label: 'Parsed', num: true },
          { label: 'Zero symbols', num: true }, { label: 'Skipped', num: true },
          { label: 'Functions', num: true }, { label: 'Classes', num: true }],
        summary.coverage.languages.map(function (r) {
          return [r.language, fmt(r.files), fmt(r.parsed), fmt(r.zeroSymbol), fmt(r.skipped), fmt(r.functions), fmt(r.classes)];
        }))));
    }
    if (summary.gapsByKind.length > 0) {
      parts.push(h('section', { class: 'xv-card' }, h('h2', { text: 'Gaps by kind' }),
        table([{ label: 'Kind' }, { label: 'Gap records', num: true }, { label: 'Sum of counts', num: true }],
          summary.gapsByKind.map(function (r) { return [r.kind, fmt(r.records), fmt(r.count)]; }))));
    }
    return parts;
  }

  function pills(values) {
    return h('span', { class: 'xv-pills' }, values.map(function (v) { return h('span', { class: 'xv-pill', text: v }); }));
  }

  function render(ctx) {
    var manifest = ctx.manifest;
    var snapshot = manifest.snapshot.revision;
    var graph = manifest.products.filter(function (p) { return p.name === 'knowledge-graph'; })[0];
    var page = h('div', { class: 'xv-page' });
    page.appendChild(h('div', { class: 'xv-page-head' }, h('h1', { text: 'Overview' }),
      h('p', { text: manifest.project.name })));
    revisionBanners(manifest).forEach(function (card) { page.appendChild(card); });
    page.appendChild(h('section', { class: 'xv-card' },
      h('h2', { text: 'Project' }),
      h('dl', { class: 'xv-facts' },
        h('dt', { text: 'Project' }), h('dd', { text: manifest.project.name }),
        h('dt', { text: 'Source snapshot' }), h('dd', null, h('span', { class: 'xv-mono', text: snapshot })))));
    page.appendChild(h('section', { class: 'xv-card' },
      h('h2', { text: 'Products' }),
      table([{ label: 'Product' }, { label: 'Status' }, { label: 'Detail', wrap: true }, { label: 'Revision' }],
        manifest.products.map(function (p) { return productRow(p, snapshot); }))));
    ctx.root.appendChild(page);

    if (!graph || (graph.status !== 'included' && graph.status !== 'different-revision')) return Promise.resolve();
    return XV.data.loadText(graph.payloads[0]).then(function (text) {
      var summary = summarizeGraph(text);
      ctx.setCount('nodes', summary.totals.nodes);
      ctx.setCount('edges', summary.totals.edges);
      ctx.setCount('gaps', summary.totals.gaps);
      graphSection(summary).forEach(function (card) { page.appendChild(card); });
    });
  }

  XV.overview = {
    summarizeGraph: summarizeGraph,
    worstStatus: worstStatus,
    detailText: detailText,
    render: render,
  };

  XV.pages.register({ id: 'overview', label: 'Overview', order: 10, product: null, render: render });
})();
