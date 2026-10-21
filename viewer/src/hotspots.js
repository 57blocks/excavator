/*
 * hotspots.js: the Hotspots page (openspec: changes/report-viewer, spec "Hotspots page"). It shows what
 * `hotspots.json` holds: the window and the repositories read, what the history can show (no history,
 * shallow clones), the files and directories with their counts and score, commits by year and the
 * shares by author, the files changed together, the feature groups and the residual assumptions.
 * Numbers are shown as the product states them; a field an older product lacks says so and is never 0.
 *
 * The row, notice and sparkline functions are pure and are run in Node by the tests.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;
  var fmt = XV.formatNumber;

  var SPARK_WIDTH = 84;
  var SPARK_HEIGHT = 24;
  var SPARK_GAP = 1;

  // ---- pure ----

  /** The window in words: "since 2025-01-01 (UTC midnight 2025-01-01T00:00:00Z)" or "whole history". */
  function windowText(win) {
    if (!win || typeof win.since !== 'string') return 'whole history';
    return 'since ' + win.since + (typeof win.sinceUtc === 'string' ? ' (' + win.sinceUtc + ')' : '');
  }

  /** A numeric field as a cell: absent is "not provided by the product", null is empty, a number is grouped. */
  function numberField(value) {
    if (value === undefined) return XV.NOT_PROVIDED;
    return value === null ? null : fmt(value);
  }

  /** A plain value as a cell: absent is "not provided by the product", null is empty. */
  function plainField(value) {
    if (value === undefined) return XV.NOT_PROVIDED;
    return value === null ? null : String(value);
  }

  /** The date part of an ISO time, or null. */
  function dateText(iso) {
    return typeof iso === 'string' ? iso.slice(0, 10) : (iso === undefined ? XV.NOT_PROVIDED : null);
  }

  /** The instant of an ISO time as a number, for sorting (offsets are taken into account). */
  function timeKey(iso) {
    if (typeof iso !== 'string') return null;
    var t = Date.parse(iso);
    return isNaN(t) ? null : t;
  }

  /** The highest score among the rows; null when none has one. */
  function maxScore(rows) {
    var max = null;
    rows.forEach(function (row) {
      if (typeof row.score === 'number' && (max === null || row.score > max)) max = row.score;
    });
    return max;
  }

  /** A score as a percentage of the highest, 0 to 100; null when the row has no score or there is no highest. */
  function scoreShare(score, max) {
    if (typeof score !== 'number' || max === null || max <= 0) return null;
    return Math.max(0, Math.min(100, (score / max) * 100));
  }

  /** The commits of each year, [{ year, commits }] in year order; null when the row has none to give. */
  function yearSeries(commitsByYear) {
    if (!commitsByYear || typeof commitsByYear !== 'object') return null;
    return Object.keys(commitsByYear).sort(function (a, b) { return Number(a) - Number(b); }).map(function (year) {
      return { year: year, commits: commitsByYear[year] };
    });
  }

  /** The years as one text: "2020: 767, 2021: 462". */
  function yearText(series) {
    return series.map(function (p) { return p.year + ': ' + p.commits; }).join(', ');
  }

  /** The bars of a sparkline: one per year, in a box of width x height, the highest year as tall as the box. */
  function sparkBars(series, width, height, gap) {
    var n = series.length;
    if (n === 0) return [];
    var barWidth = Math.max(1, (width - (n - 1) * gap) / n);
    var max = 0;
    series.forEach(function (p) { if (p.commits > max) max = p.commits; });
    return series.map(function (p, i) {
      var barHeight = max === 0 ? 0 : (p.commits / max) * height;
      return { x: i * (barWidth + gap), y: height - barHeight, width: barWidth, height: barHeight, title: p.year + ': ' + p.commits + ' commits' };
    });
  }

  /** What the history cannot show, as sentences the product backs: no history, shallow clones, files outside every repository. */
  function notices(product) {
    var out = [];
    if (product.historyAvailable === false) {
      var no = product.noHistory || {};
      var text = 'There is no history to count. Only line counts have values; commits, authors, scores and every other history field are empty.';
      if (no.reason === 'not-a-repository') {
        text += ' Reason: not-a-repository: the project root is not inside a Git work tree, and no child directory is a Git repository with commits.';
      } else if (no.reason === 'inside-repository') {
        text += ' Reason: inside-repository: the project root is the directory "' + no.pathInRepository + '" of the Git repository at "' +
          no.repositoryRoot + '" (relative to the project root). History is read only from a repository root.';
      } else {
        text += ' The product records no reason.';
      }
      out.push(text);
    }
    (Array.isArray(product.repos) ? product.repos : []).forEach(function (repo) {
      if (repo.shallow === true) {
        out.push(repo.path + ' is a shallow clone: its counts are lower bounds. ' + fmt(repo.boundaryCommits) +
          ' boundary commit(s) are not counted, and nothing before ' + repo.earliestVisibleCommit + ' is visible.');
      }
    });
    var counts = product.counts || {};
    if (typeof counts.filesWithoutHistory === 'number' && counts.filesWithoutHistory > 0 && product.historyAvailable !== false) {
      out.push(fmt(counts.filesWithoutHistory) + ' file(s) belong to no repository whose history was read and have no history.');
    }
    return out;
  }

  /** The conservation line: changes read = attributed + outside the selection, with whether the numbers add up. */
  function conservationText(c) {
    if (!c || typeof c.changesRead !== 'number') return null;
    var holds = c.changesRead === c.attributed + c.outsideSelection;
    return 'changes read (' + fmt(c.changesRead) + ') = attributed to selected files (' + fmt(c.attributed) + ') + outside the selection (' +
      fmt(c.outsideSelection) + '): ' + (holds ? 'holds' : 'does not hold');
  }

  /** The rule the product used for pairs, in its own numbers. */
  function coChangeText(c) {
    if (!c) return null;
    return 'A pair counts the commits that changed both files. Commits that changed 2 to ' + fmt(c.maxFilesPerCommit) +
      ' selected files are counted; a pair is listed when its files changed together at least ' + fmt(c.minTogether) + ' times.';
  }

  /** Rows whose text for any of `fields` (functions returning text) contains the query, ignoring case. */
  function filterRows(rows, query, fields) {
    var q = (query || '').trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(function (row) {
      return fields.some(function (field) {
        var value = field(row);
        return typeof value === 'string' && value.toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  // ---- DOM ----

  function sparkline(commitsByYear) {
    var series = yearSeries(commitsByYear);
    if (series === null) return commitsByYear === undefined ? XV.NOT_PROVIDED : null;
    var bars = sparkBars(series, SPARK_WIDTH, SPARK_HEIGHT, SPARK_GAP);
    var svg = XV.svgEl('svg', {
      class: 'xv-spark', width: SPARK_WIDTH, height: SPARK_HEIGHT, viewBox: '0 0 ' + SPARK_WIDTH + ' ' + SPARK_HEIGHT,
      role: 'img', 'aria-label': 'Commits by year: ' + yearText(series),
    });
    bars.forEach(function (bar) {
      svg.appendChild(XV.svgEl('rect', { x: bar.x, y: bar.y, width: bar.width, height: bar.height, class: 'xv-spark-bar' }, XV.svgEl('title', {}, bar.title)));
    });
    return svg;
  }

  function scoreCell(score, max) {
    if (score === undefined) return XV.NOT_PROVIDED;
    if (score === null) return null;
    var share = scoreShare(score, max);
    var fill = h('span', { class: 'xv-bar-fill' });
    if (share !== null) fill.style.width = share + '%';
    return h('span', { class: 'xv-scorecell' }, h('span', { class: 'xv-bar' }, fill), h('span', { class: 'xv-scorenum', text: fmt(score) }));
  }

  function numColumn(label, field) {
    return { label: label, num: true, key: function (r) { return r[field]; }, render: function (r) { return numberField(r[field]); } };
  }

  function lastChangedColumn() {
    return {
      label: 'Last changed', key: function (r) { return timeKey(r.lastChanged); },
      title: function (r) { return typeof r.lastChanged === 'string' ? r.lastChanged : null; }, render: function (r) { return dateText(r.lastChanged); },
    };
  }

  /** The columns a directory row and a group row share: counts, score, commits by year and the shares by author. */
  function statColumns(max) {
    var concentration = function (r, field) {
      if (r.concentration === undefined) return undefined;
      return r.concentration === null ? null : r.concentration[field];
    };
    var share = function (field) {
      return function (r) { var v = concentration(r, field); return v === undefined ? XV.NOT_PROVIDED : (v === null ? null : String(v)); };
    };
    return [
      { label: 'Score', num: true, key: function (r) { return r.score; }, render: function (r) { return scoreCell(r.score, max); } },
      numColumn('Commits', 'commits'), numColumn('Authors', 'authors'),
      {
        label: 'Commits by year', key: function (r) { var s = yearSeries(r.commitsByYear); return s && s.length > 0 ? s[s.length - 1].commits : null; },
        title: function (r) { var s = yearSeries(r.commitsByYear); return s ? yearText(s) : null; }, render: function (r) { return sparkline(r.commitsByYear); },
      },
      numColumn('Files', 'files'), numColumn('Lines', 'lines'), numColumn('Added', 'added'), numColumn('Removed', 'removed'), lastChangedColumn(),
      { label: 'Commits by people', num: true, key: function (r) { return concentration(r, 'commitsByPeople'); }, render: function (r) { var v = concentration(r, 'commitsByPeople'); return v === undefined ? XV.NOT_PROVIDED : numberField(v); } },
      { label: 'Top author share', num: true, key: function (r) { return concentration(r, 'topAuthorShare'); }, render: share('topAuthorShare') },
      { label: 'Authors for 80%', num: true, key: function (r) { return concentration(r, 'authorsFor80Percent'); }, render: function (r) { var v = concentration(r, 'authorsFor80Percent'); return v === undefined ? XV.NOT_PROVIDED : numberField(v); } },
    ];
  }

  // The columns of each table and the column it starts sorted by (by label), kept together so a test can read them.
  var TABLES = {
    files: {
      initialSort: { label: 'Score', dir: -1 },
      columns: function (max) {
        return [
          { label: 'Path', width: 'xl', key: function (r) { return r.path; }, title: function (r) { return r.path; }, render: function (r) { return XV.codeLink(r.path, null); } },
          { label: 'Score', num: true, key: function (r) { return r.score; }, render: function (r) { return scoreCell(r.score, max); } },
          numColumn('Commits', 'commits'), numColumn('Authors', 'authors'), numColumn('Added', 'added'), numColumn('Removed', 'removed'), numColumn('Lines', 'lines'),
          lastChangedColumn(), numColumn('Lineage conflicts', 'lineageConflicts'),
        ];
      },
    },
    directories: {
      initialSort: { label: 'Score', dir: -1 },
      columns: function (max) {
        return [
          { label: 'Directory', width: 'xl', key: function (r) { return r.path; }, title: function (r) { return r.path === '.' ? '. (the project root)' : r.path; }, render: function (r) { return r.path; } },
        ].concat(statColumns(max));
      },
    },
    pairs: {
      initialSort: { label: 'Together', dir: -1 },
      columns: function () {
        return [
          numColumn('Together', 'together'),
          { label: 'Share of A', num: true, key: function (r) { return r.shareOfA; }, render: function (r) { return plainField(r.shareOfA); } },
          { label: 'Share of B', num: true, key: function (r) { return r.shareOfB; }, render: function (r) { return plainField(r.shareOfB); } },
          { label: 'File A', width: 'xl', key: function (r) { return r.a; }, title: function (r) { return r.a; }, render: function (r) { return XV.codeLink(r.a, null); } },
          { label: 'File B', width: 'xl', key: function (r) { return r.b; }, title: function (r) { return r.b; }, render: function (r) { return XV.codeLink(r.b, null); } },
        ];
      },
    },
    groups: {
      initialSort: { label: 'Score', dir: -1 },
      columns: function (max) {
        return [{ label: 'Group', width: 'lg', key: function (r) { return r.name; }, title: function (r) { return r.name; }, render: function (r) { return r.name; } }]
          .concat(statColumns(max), [{ label: 'Unmatched paths', num: true, key: function (r) { return Array.isArray(r.unmatchedPaths) ? r.unmatchedPaths.length : null; }, render: function (r) { return Array.isArray(r.unmatchedPaths) ? fmt(r.unmatchedPaths.length) : XV.NOT_PROVIDED; } }]);
      },
    },
  };

  /** A filtered table card: search box, shown line, table. `rowsText` are the fields the search looks in. */
  function filteredTable(ctx, title, rows, columns, options) {
    var shown = h('p', { class: 'xv-muted' });
    var table = XV.dataTable({ rows: rows, columns: columns, initialSort: options.initialSort || null });
    function apply(query) {
      var matching = filterRows(rows, query, options.fields);
      ctx.setCount(options.name + '-shown', matching.length);
      XV.replaceChildren(shown, 'Showing ' + fmt(matching.length) + ' of ' + fmt(rows.length) + ' ' + options.noun);
      table.setRows(matching);
    }
    var search = h('input', {
      type: 'search', class: 'xv-input', placeholder: options.placeholder, 'aria-label': options.placeholder,
      on: { input: function (event) { apply(event.target.value); } },
    });
    ctx.setCount(options.name, rows.length);
    apply('');
    return h('section', { class: 'xv-card' }, h('h2', { text: title }), options.intro || null, search, shown, table.el);
  }

  function noticeCard(list) {
    if (list.length === 0) return null;
    return h('section', { class: 'xv-card xv-card-warn' }, h('h2', { text: 'What the history can show' }),
      list.map(function (text) { return h('p', { text: text }); }));
  }

  function headerCards(product) {
    var counts = product.counts || {};
    var repos = Array.isArray(product.repos) ? product.repos : [];
    var tiles = [['Files with history', counts.filesWithHistory], ['Files without history', counts.filesWithoutHistory],
      ['Binary files', counts.binaryFiles], ['Files with lineage conflicts', counts.filesWithLineageConflicts]]
      .map(function (t) { return XV.tile(t[0], fmt(t[1])); });
    var bots = product.bots;
    var conservation = conservationText(product.conservation);
    var facts = h('dl', { class: 'xv-facts' },
      h('dt', { text: 'Window' }), h('dd', { text: windowText(product.window) }),
      h('dt', { text: 'Source kind' }), h('dd', { text: plainField(product.sourceKind) || XV.EMPTY }),
      h('dt', { text: 'Commits by bots' }),
      h('dd', { text: bots && typeof bots.commits === 'number' ? fmt(bots.commits) + ' (author email local part ends in ' + bots.emailMarker.replace(/@$/, '') + '; left out of the shares by author)' : XV.EMPTY }));
    return [
      h('section', { class: 'xv-card' }, h('h2', { text: 'History' }), facts),
      repos.length === 0 ? null : h('section', { class: 'xv-card' }, h('h2', { text: 'Repositories read' }),
        XV.simpleTable([{ label: 'Path' }, { label: 'Head', wrap: true }, { label: 'Shallow' }, { label: 'Boundary commits', num: true }, { label: 'Earliest visible commit' }],
          repos.map(function (r) { return [r.path, h('span', { class: 'xv-mono', text: String(r.head) }), r.shallow ? 'yes' : 'no', fmt(r.boundaryCommits), r.earliestVisibleCommit]; }))),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Counts' }), h('div', { class: 'xv-tiles' }, tiles),
        conservation === null ? null : h('p', { class: 'xv-conservation', text: conservation })),
    ];
  }

  function groupsCard(product, max) {
    var summary = product.featureGroups;
    var groups = Array.isArray(product.groups) ? product.groups : [];
    if (summary === null || summary === undefined) {
      return h('section', { class: 'xv-card' }, h('h2', { text: 'Feature groups' }), h('p', { class: 'xv-muted', text: 'No feature groups in this product.' }));
    }
    var tiles = [['Groups listed', summary.groupsListed], ['Files in a group', summary.filesInAGroup], ['Files in several groups', summary.filesInSeveralGroups], ['Listed paths matching no file', summary.pathsUnmatched]]
      .map(function (t) { return XV.tile(t[0], fmt(t[1])); });
    var table = XV.dataTable({ rows: groups, columns: TABLES.groups.columns(max), initialSort: TABLES.groups.initialSort });
    var unmatched = groups.filter(function (g) { return Array.isArray(g.unmatchedPaths) && g.unmatchedPaths.length > 0; });
    return h('section', { class: 'xv-card' }, h('h2', { text: 'Feature groups' }),
      h('p', { class: 'xv-muted', text: 'A group counts only the files its groups file lists, and a file in several groups counts in each.' }),
      h('div', { class: 'xv-tiles' }, tiles), table.el,
      unmatched.length === 0 ? null : h('h3', { text: 'Listed paths that matched no selected file' }),
      unmatched.map(function (g) {
        return h('details', { class: 'xv-details' }, h('summary', { text: g.name + ' (' + g.unmatchedPaths.length + ')' }),
          h('ul', { class: 'xv-list' }, g.unmatchedPaths.map(function (p) { return h('li', { class: 'xv-mono', text: String(p) }); })));
      }));
  }

  function render(ctx) {
    var manifest = ctx.manifest;
    var product = XV.productOf(manifest, 'hotspots');
    var page = h('div', { class: 'xv-page' },
      XV.pageHead('Hotspots', 'Where the history counts changes, as the hotspots product states them: commits, authors and lines per file and directory, and the files changed together.'));
    ctx.root.appendChild(page);
    var unavailable = XV.unavailableCard(product);
    if (unavailable) {
      page.appendChild(unavailable);
      return Promise.resolve();
    }
    var banner = XV.revisionBanner(manifest, product);
    if (banner) page.appendChild(banner);
    return XV.data.loadJson(product.payloads[0]).then(function (data) {
      var files = Array.isArray(data.files) ? data.files : [];
      var directories = Array.isArray(data.directories) ? data.directories : [];
      var pairs = Array.isArray(data.pairs) ? data.pairs : [];
      var max = maxScore(files);
      var dirMax = maxScore(directories);
      var notice = noticeCard(notices(data));
      if (notice) page.appendChild(notice);
      headerCards(data).forEach(function (card) { if (card) page.appendChild(card); });

      page.appendChild(filteredTable(ctx, 'Files', files, TABLES.files.columns(max), {
        name: 'files', noun: 'files', placeholder: 'Search file paths', initialSort: TABLES.files.initialSort,
        fields: [function (r) { return r.path; }],
        intro: h('p', { class: 'xv-muted', text: 'Score is commits x lines at HEAD. A binary file has no lines and no score.' }),
      }));

      page.appendChild(filteredTable(ctx, 'Directories', directories, TABLES.directories.columns(dirMax), {
        name: 'directories', noun: 'directories', placeholder: 'Search directory paths', initialSort: TABLES.directories.initialSort,
        fields: [function (r) { return r.path; }],
      }));

      var rule = coChangeText(data.coChange);
      var counts = data.coChange || {};
      page.appendChild(filteredTable(ctx, 'Files changed together', pairs, TABLES.pairs.columns(), {
        name: 'pairs', noun: 'pairs', placeholder: 'Search file paths', initialSort: TABLES.pairs.initialSort,
        fields: [function (r) { return r.a; }, function (r) { return r.b; }],
        intro: h('div', null,
          rule === null ? h('p', { class: 'xv-muted', text: 'The product records no rule for pairs.' }) : h('p', { text: rule }),
          h('p', { class: 'xv-muted', text: 'Commits counted for pairs: ' + fmt(counts.commitsCounted) + '. Commits over the limit, counted for no pair: ' + fmt(counts.commitsOverLimit) +
            '. Pairs listed: ' + fmt(counts.pairsListed) + '. Pairs below the minimum, not listed: ' + fmt(counts.pairsBelowMinimum) + '.' })),
      }));

      page.appendChild(groupsCard(data, maxScore(Array.isArray(data.groups) ? data.groups : [])));
      ctx.setCount('groups', Array.isArray(data.groups) ? data.groups.length : 0);
      page.appendChild(h('section', { class: 'xv-card' }, h('h2', { text: 'Residual assumptions' }),
        h('ul', { class: 'xv-list' }, (data.residualAssumptions || []).map(function (text) { return h('li', { text: String(text) }); }))));
    });
  }

  XV.hotspots = {
    windowText: windowText,
    numberField: numberField,
    plainField: plainField,
    dateText: dateText,
    timeKey: timeKey,
    maxScore: maxScore,
    scoreShare: scoreShare,
    yearSeries: yearSeries,
    yearText: yearText,
    sparkBars: sparkBars,
    sparkline: sparkline,
    notices: notices,
    conservationText: conservationText,
    coChangeText: coChangeText,
    filterRows: filterRows,
    statColumns: statColumns,
    tables: TABLES,
    scoreCell: scoreCell,
    render: render,
  };

  XV.pages.register({ id: 'hotspots', label: 'Hotspots', order: 40, product: 'hotspots', render: render });
})();
