/*
 * code.js: the Code page (openspec: changes/report-viewer, spec "Embedded
 * source and its visible classes"; design D4, D5): the tree of the files the
 * products point at, a source panel with line numbers, and the line range a
 * link names. XV.codeLink builds the link the product pages use.
 *
 * The pure functions (line ranges, tree, filter, bucket wording) are on
 * XV.code and are run in Node by the tests.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;
  var fmt = XV.formatNumber;

  var BUCKETS = ['embedded', 'binary', 'tooLarge', 'notInSnapshot', 'notEmbeddedOnRequest'];
  var BUCKET_LABELS = {
    embedded: 'Embedded',
    binary: 'Binary',
    tooLarge: 'Too large',
    notInSnapshot: 'Not in snapshot',
    notEmbeddedOnRequest: 'Not embedded on request',
  };
  var MAX_TREE_FILES = 3000;
  var filterText = '';

  // ---- pure ----

  /** '12' gives {start:12,end:12}; '12-20' gives {start:12,end:20}; anything else, including 0 and a reversed range, gives null. */
  function parseLines(text) {
    if (typeof text !== 'string') return null;
    var match = /^(\d+)(?:-(\d+))?$/.exec(text);
    if (!match) return null;
    var start = parseInt(match[1], 10);
    var end = match[2] === undefined ? start : parseInt(match[2], 10);
    if (start < 1 || end < start) return null;
    return { start: start, end: end };
  }

  /** The text a link carries for a product's line range: [a, b], a number, or an already formatted 'a-b'; null when there is none. */
  function rangeText(range) {
    if (Array.isArray(range) && range.length >= 1 && typeof range[0] === 'number') {
      var last = typeof range[1] === 'number' ? range[1] : range[0];
      return range[0] === last ? String(range[0]) : range[0] + '-' + last;
    }
    if (typeof range === 'number') return String(range);
    if (typeof range === 'string' && parseLines(range)) return range;
    return null;
  }

  /** The lines of a text: a final newline does not start another line, and an empty text has none. */
  function splitLines(text) {
    if (text === '') return [];
    var lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.map(function (line) { return line.charAt(line.length - 1) === '\r' ? line.slice(0, -1) : line; });
  }

  /**
   * What a requested range means for a file of `lineCount` lines:
   * none (no range asked), invalid (not a range), out-of-range (some line is past the end; `line` is the first
   * missing one and nothing is highlighted), or ok.
   */
  function lineStatus(linesParam, lineCount) {
    if (linesParam === undefined || linesParam === null || linesParam === '') return { state: 'none' };
    var range = parseLines(linesParam);
    if (!range) return { state: 'invalid', text: String(linesParam) };
    if (range.end > lineCount) return { state: 'out-of-range', line: Math.max(range.start, lineCount + 1), start: range.start, end: range.end };
    return { state: 'ok', start: range.start, end: range.end };
  }

  function bucketLabel(bucket) {
    return Object.prototype.hasOwnProperty.call(BUCKET_LABELS, bucket) ? BUCKET_LABELS[bucket] : String(bucket);
  }

  /** The sentence that says why a file is not shown. */
  function bucketReason(bucket, info, source, snapshotRevision) {
    if (bucket === 'tooLarge') {
      return 'This file is ' + fmt(info.bytes) + ' bytes; the limit for embedding a file is ' + fmt(source.limitBytes) + ' bytes.';
    }
    if (bucket === 'notEmbeddedOnRequest') return 'The page was packed without source text (--no-source); no file text is embedded.';
    if (bucket === 'binary') return 'This file is not text (a NUL byte in its first 8 KiB), so it is not embedded.';
    if (bucket === 'notInSnapshot') return 'This path is not in the source snapshot (' + snapshotRevision + ').';
    return '';
  }

  /** [{path, bucket, bytes}] from the manifest's source.files, sorted by path. */
  function entriesFromSource(source) {
    var files = (source && source.files) || {};
    return Object.keys(files).sort().map(function (path) {
      return { path: path, bucket: files[path].bucket, bytes: typeof files[path].bytes === 'number' ? files[path].bytes : null };
    });
  }

  /** Entries whose path contains `query` (case-insensitive); an empty query keeps all. */
  function filterEntries(entries, query) {
    var q = (query || '').trim().toLowerCase();
    if (q === '') return entries;
    return entries.filter(function (entry) { return entry.path.toLowerCase().indexOf(q) !== -1; });
  }

  /** The directory tree of the entries: { name, path, dirs: [...], files: [...], count }, directories first, each sorted by name. */
  function buildTree(entries) {
    var root = { name: '', path: '', dirs: Object.create(null), files: [], count: 0 };
    entries.forEach(function (entry) {
      var parts = entry.path.split('/').filter(function (part) { return part !== ''; });
      var node = root;
      node.count += 1;
      for (var i = 0; i < parts.length - 1; i++) {
        var name = parts[i];
        if (!Object.prototype.hasOwnProperty.call(node.dirs, name)) {
          node.dirs[name] = { name: name, path: node.path === '' ? name : node.path + '/' + name, dirs: Object.create(null), files: [], count: 0 };
        }
        node = node.dirs[name];
        node.count += 1;
      }
      node.files.push({ name: parts.length > 0 ? parts[parts.length - 1] : entry.path, path: entry.path, bucket: entry.bucket });
    });
    return finishTree(root);
  }

  function finishTree(node) {
    node.dirs = Object.keys(node.dirs).sort().map(function (name) { return finishTree(node.dirs[name]); });
    node.files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return node;
  }

  // ---- DOM ----

  /** A link to a file, and to the lines of it when a range is given. */
  function codeLink(path, range) {
    var lines = rangeText(range);
    var params = { path: path };
    if (lines) params.lines = lines;
    return h('a', {
      class: 'xv-codelink xv-mono',
      href: XV.router.buildHash('code', params),
      title: 'Open ' + path + (lines ? ' at ' + lines : '') + ' in the Code page',
      text: path + (lines ? ':' + lines : ''),
    });
  }

  function bucketDot(bucket) {
    return h('span', { class: 'xv-bucket xv-bucket-' + bucket, title: bucketLabel(bucket), 'aria-label': bucketLabel(bucket) });
  }

  function renderNode(node, activePath, open) {
    var files = node.files.map(function (file) {
      return h('li', { class: 'xv-tree-file' },
        h('a', { href: XV.router.buildHash('code', { path: file.path }), 'aria-current': file.path === activePath ? 'true' : null },
          bucketDot(file.bucket), h('span', { text: file.name })));
    });
    var dirs = node.dirs.map(function (dir) {
      var holdsActive = activePath !== null && (activePath + '/').indexOf(dir.path + '/') === 0;
      return h('li', null, h('details', { open: open || holdsActive }, h('summary', null, dir.name + '/ ', h('span', { class: 'xv-muted', text: '(' + fmt(dir.count) + ')' })),
        renderNode(dir, activePath, open)));
    });
    return h('ul', { class: 'xv-tree' }, dirs, files);
  }

  function renderTreeInto(holder, entries, activePath) {
    var matching = filterEntries(entries, filterText);
    var shown = matching.slice(0, MAX_TREE_FILES);
    var note = matching.length > shown.length
      ? h('p', { class: 'xv-muted', text: 'Showing the first ' + fmt(shown.length) + ' of ' + fmt(matching.length) + ' paths; narrow the filter to see the rest.' })
      : (matching.length === 0 ? h('p', { class: 'xv-muted', text: 'No referenced path matches.' }) : null);
    XV.replaceChildren(holder, [
      h('p', { class: 'xv-muted', text: fmt(matching.length) + ' of ' + fmt(entries.length) + ' paths' }),
      renderNode(buildTree(shown), activePath, filterText.trim() !== ''),
      note,
    ]);
  }

  function countTiles(source, referenced) {
    var tiles = [h('div', { class: 'xv-tile' }, h('div', { class: 'xv-tile-label', text: 'Referenced files' }), h('div', { class: 'xv-tile-value', text: fmt(referenced) }))];
    BUCKETS.forEach(function (bucket) {
      tiles.push(h('div', { class: 'xv-tile' },
        h('div', { class: 'xv-tile-label' }, bucketDot(bucket), ' ' + bucketLabel(bucket)),
        h('div', { class: 'xv-tile-value', text: fmt(source.counts[bucket]) })));
    });
    return h('div', { class: 'xv-tiles' }, tiles);
  }

  function sourcePanel(ctx, entry, route, source) {
    var snapshot = ctx.manifest.snapshot.revision;
    var head = function (extra) {
      return h('div', { class: 'xv-panel-head' },
        h('span', { class: 'xv-mono xv-panel-path', text: entry.path }),
        h('span', { class: 'xv-badge xv-badge-bucket-' + entry.bucket, text: bucketLabel(entry.bucket) }),
        extra);
    };
    if (entry.bucket !== 'embedded') {
      return Promise.resolve(h('section', { class: 'xv-card' }, head(null),
        h('p', { text: bucketReason(entry.bucket, entry, source, snapshot) })));
    }
    return XV.data.loadJson('sources').then(function (texts) {
      var text = Object.prototype.hasOwnProperty.call(texts, entry.path) ? texts[entry.path] : null;
      if (text === null) throw new Error('the page lists ' + entry.path + ' as embedded but holds no text for it');
      var lines = splitLines(text);
      var status = lineStatus(route.params.lines, lines.length);
      ctx.setCount('lines', lines.length);
      var notice = null;
      if (status.state === 'out-of-range') notice = 'Line ' + status.line + ' is not in the current version of this file.';
      else if (status.state === 'invalid') notice = 'The line range "' + status.text + '" is not a range of lines.';
      var code = h('div', { class: 'xv-code', role: 'region', 'aria-label': 'Source of ' + entry.path, tabindex: '0' });
      var first = null;
      lines.forEach(function (line, index) {
        var number = index + 1;
        var marked = status.state === 'ok' && number >= status.start && number <= status.end;
        var el = h('div', { class: marked ? 'xv-line xv-line-hl' : 'xv-line', 'data-n': number }, line);
        if (marked && first === null) first = el;
        code.appendChild(el);
      });
      if (status.state === 'ok') code.setAttribute('data-xv-highlight', status.start + '-' + status.end);
      var card = h('section', { class: 'xv-card xv-card-flush' },
        head(h('span', { class: 'xv-muted', text: fmt(lines.length) + ' lines, ' + fmt(entry.bytes) + ' bytes' })),
        notice ? h('p', { class: 'xv-notice', text: notice }) : null,
        code);
      if (first !== null) {
        window.setTimeout(function () { first.scrollIntoView({ block: 'center' }); }, 0);
      }
      return card;
    });
  }

  function render(ctx) {
    var source = ctx.manifest.source;
    var entries = entriesFromSource(source);
    var activePath = typeof ctx.route.params.path === 'string' && ctx.route.params.path !== '' ? ctx.route.params.path : null;
    ctx.setCount('sources', source.counts.embedded);

    var page = h('div', { class: 'xv-page' },
      h('div', { class: 'xv-page-head' }, h('h1', { text: 'Code' }),
        h('p', { text: 'The files the included products point at, as they are in the source snapshot ' + ctx.manifest.snapshot.revision + '.' })),
      h('section', { class: 'xv-card' }, h('h2', { text: 'Files by class' }), countTiles(source, entries.length)));

    var treeHolder = h('div', { class: 'xv-tree-holder' });
    var filter = h('input', {
      type: 'search',
      class: 'xv-input',
      placeholder: 'Filter paths',
      'aria-label': 'Filter paths',
      value: filterText,
      on: { input: function (event) { filterText = event.target.value; renderTreeInto(treeHolder, entries, activePath); } },
    });
    renderTreeInto(treeHolder, entries, activePath);
    var panel = h('div', { class: 'xv-panel' });
    page.appendChild(h('div', { class: 'xv-split' },
      h('section', { class: 'xv-card xv-card-tree' }, h('h2', { text: 'Files' }), filter, treeHolder), panel));
    ctx.root.appendChild(page);

    if (activePath === null) {
      panel.appendChild(h('section', { class: 'xv-card' }, h('p', { class: 'xv-muted', text: entries.length === 0 ? 'No product points at a file.' : 'Choose a file to see its source.' })));
      return Promise.resolve();
    }
    var entry = null;
    for (var i = 0; i < entries.length; i++) if (entries[i].path === activePath) entry = entries[i];
    if (entry === null) {
      panel.appendChild(h('section', { class: 'xv-card' }, h('span', { class: 'xv-mono', text: activePath }),
        h('p', { text: 'No included product points at this path, so the page holds nothing for it.' })));
      return Promise.resolve();
    }
    return sourcePanel(ctx, entry, ctx.route, source).then(function (card) { panel.appendChild(card); });
  }

  function status(manifest) {
    var counts = manifest.source.counts;
    if (counts.embedded > 0) return 'included';
    return counts.notInSnapshot > 0 ? 'different-revision' : 'not-run';
  }

  XV.codeLink = codeLink;
  XV.code = {
    parseLines: parseLines,
    rangeText: rangeText,
    splitLines: splitLines,
    lineStatus: lineStatus,
    bucketLabel: bucketLabel,
    bucketReason: bucketReason,
    entriesFromSource: entriesFromSource,
    filterEntries: filterEntries,
    buildTree: buildTree,
    status: status,
    render: render,
  };

  XV.pages.register({ id: 'code', label: 'Code', order: 50, product: null, status: status, render: render });
})();
