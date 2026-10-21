/*
 * markdown.js: a zero-dependency Markdown renderer for the reports (openspec: changes/report-viewer,
 * spec "Code page and Reports page", design D5). It builds DOM nodes only: text always goes in as a
 * text node, so raw HTML in a report is shown as the characters it is made of and nothing is parsed
 * or run. Syntax it does not handle is left as the text it was; nothing is dropped.
 *
 * Blocks: ATX headings, paragraphs, bullet and numbered lists (nested by indentation), GFM tables with
 * alignment, fenced code (the language only becomes a class), block quotes and horizontal rules.
 * Inline: code spans, strong, emphasis and links. A link is an <a> only when it points at a route of
 * this page ("#/..."); any other link is its text followed by the address as plain text, so the page
 * never navigates away. Images, raw URLs and path:line references stay text.
 *
 * parseBlocks and parseInline are pure (they build a tree of plain objects); render builds the DOM.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var h = XV.h;

  var MAX_DEPTH = 20;
  var PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

  // ---- blocks ----

  var FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  var HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var QUOTE = /^ {0,3}>/;
  var BULLET = /^( *)([-*+])(?:[ \t]+(.*))?$/;
  var ORDERED = /^( *)(\d{1,9})([.)])(?:[ \t]+(.*))?$/;
  var DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

  function isBlank(line) {
    return /^[ \t]*$/.test(line);
  }

  function indentOf(line) {
    var i = 0;
    while (i < line.length && line.charAt(i) === ' ') i += 1;
    return i;
  }

  function fenceOpen(line) {
    var m = FENCE.exec(line);
    if (!m) return null;
    if (m[1].charAt(0) === '`' && m[2].indexOf('`') !== -1) return null;
    return { char: m[1].charAt(0), length: m[1].length, info: m[2].trim() };
  }

  function isFenceClose(line, open) {
    var m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    return m !== null && m[1].charAt(0) === open.char && m[1].length >= open.length;
  }

  function listMarker(line) {
    var m = BULLET.exec(line);
    if (m) return { indent: m[1].length, kind: 'ul', text: m[3] || '', start: null };
    m = ORDERED.exec(line);
    if (m) return { indent: m[1].length, kind: 'ol', text: m[4] || '', start: parseInt(m[2], 10) };
    return null;
  }

  function splitRow(line) {
    var text = line.trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.length > 0 && text.charAt(text.length - 1) === '|' && text.charAt(text.length - 2) !== '\\') text = text.slice(0, -1);
    var cells = [];
    var cell = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '\\' && text.charAt(i + 1) === '|') { cell += '\\|'; i += 1; }
      else if (ch === '|') { cells.push(cell.trim()); cell = ''; }
      else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  }

  function isTableStart(lines, i) {
    if (i + 1 >= lines.length || lines[i].indexOf('|') === -1 || !DELIMITER_ROW.test(lines[i + 1]) || lines[i + 1].indexOf('-') === -1) return false;
    return splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
  }

  function alignOf(cell) {
    var left = cell.charAt(0) === ':';
    var right = cell.charAt(cell.length - 1) === ':';
    return left && right ? 'center' : (right ? 'right' : (left ? 'left' : null));
  }

  /** True when `line` begins a block that ends a paragraph. */
  function startsBlock(lines, i) {
    var line = lines[i];
    return fenceOpen(line) !== null || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || listMarker(line) !== null || isTableStart(lines, i);
  }

  function parseTable(lines, i) {
    var head = splitRow(lines[i]);
    var align = splitRow(lines[i + 1]).map(alignOf);
    var rows = [];
    var j = i + 2;
    while (j < lines.length && !isBlank(lines[j]) && fenceOpen(lines[j]) === null && !HEADING.test(lines[j]) && !QUOTE.test(lines[j]) && !RULE.test(lines[j]) && listMarker(lines[j]) === null) {
      var cells = splitRow(lines[j]);
      while (cells.length < head.length) cells.push('');
      rows.push(cells.slice(0, head.length).map(function (c) { return parseInline(c, 0); }));
      j += 1;
    }
    return {
      node: { t: 'table', align: align, head: head.map(function (c) { return parseInline(c, 0); }), rows: rows },
      next: j,
    };
  }

  function parseList(lines, i, depth) {
    var first = listMarker(lines[i]);
    var node = { t: first.kind, start: first.kind === 'ol' && first.start !== 1 ? first.start : null, items: [] };
    var base = first.indent;
    var j = i;
    while (j < lines.length) {
      var m = listMarker(lines[j]);
      if (!m || m.kind !== first.kind || m.indent < base) break;
      var itemIndent = m.indent;
      var content = [m.text];
      var childLines = [];
      var k = j + 1;
      while (k < lines.length) {
        var line = lines[k];
        if (isBlank(line)) {
          var next = k + 1;
          while (next < lines.length && isBlank(lines[next])) next += 1;
          if (next < lines.length && indentOf(lines[next]) > itemIndent) { for (; k < next; k++) childLines.push({ text: '', lazy: false }); continue; }
          break;
        }
        var ind = indentOf(line);
        if (ind > itemIndent) { childLines.push({ text: line, lazy: false, indent: ind }); k += 1; continue; }
        if (listMarker(line) !== null || startsBlock(lines, k)) break;
        childLines.push({ text: line.trim(), lazy: true });
        k += 1;
      }
      var dedent = null;
      childLines.forEach(function (c) { if (!c.lazy && c.text !== '' && (dedent === null || c.indent < dedent)) dedent = c.indent; });
      childLines.forEach(function (c) { content.push(c.lazy || c.text === '' ? c.text : c.text.slice(Math.min(dedent, c.indent))); });
      node.items.push(parseBlocks(content, depth + 1));
      j = k;
      var peek = j;
      while (peek < lines.length && isBlank(lines[peek])) peek += 1;
      var again = peek < lines.length ? listMarker(lines[peek]) : null;
      if (again && again.kind === first.kind && again.indent >= base && again.indent <= itemIndent) j = peek;
      else break;
    }
    return { node: node, next: j };
  }

  /** The blocks of an array of lines. Past MAX_DEPTH the lines are kept as one paragraph of text. */
  function parseBlocks(lines, depth) {
    depth = depth || 0;
    if (typeof lines === 'string') lines = lines.replace(/\r\n?/g, '\n').split('\n');
    if (depth > MAX_DEPTH) return [{ t: 'p', c: [{ t: 'text', v: lines.join('\n') }] }];
    var blocks = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (isBlank(line)) { i += 1; continue; }
      var open = fenceOpen(line);
      if (open) {
        var body = [];
        i += 1;
        while (i < lines.length && !isFenceClose(lines[i], open)) { body.push(lines[i]); i += 1; }
        i += 1;
        blocks.push({ t: 'code', lang: /^[A-Za-z0-9_+.#-]+$/.test(open.info.split(/\s+/)[0] || '') ? open.info.split(/\s+/)[0] : null, v: body.join('\n') });
        continue;
      }
      var heading = HEADING.exec(line);
      if (heading) { blocks.push({ t: 'heading', level: heading[1].length, c: parseInline(heading[2] || '', 0) }); i += 1; continue; }
      if (RULE.test(line)) { blocks.push({ t: 'hr' }); i += 1; continue; }
      if (QUOTE.test(line)) {
        var inner = [];
        while (i < lines.length && !isBlank(lines[i]) && (QUOTE.test(lines[i]) || (inner.length > 0 && !startsBlock(lines, i)))) {
          inner.push(QUOTE.test(lines[i]) ? lines[i].replace(/^ {0,3}> ?/, '') : lines[i]);
          i += 1;
        }
        blocks.push({ t: 'quote', c: parseBlocks(inner, depth + 1) });
        continue;
      }
      if (listMarker(line)) {
        var list = parseList(lines, i, depth);
        blocks.push(list.node);
        i = list.next;
        continue;
      }
      if (isTableStart(lines, i)) {
        var table = parseTable(lines, i);
        blocks.push(table.node);
        i = table.next;
        continue;
      }
      var para = [line.replace(/^[ \t]+/, '')];
      i += 1;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) { para.push(lines[i].replace(/^[ \t]+/, '')); i += 1; }
      blocks.push({ t: 'p', c: parseInline(para.join('\n').replace(/[ \t]+$/, ''), 0) });
    }
    return blocks;
  }

  // ---- inline ----

  function isAlnum(ch) {
    return ch !== '' && /[A-Za-z0-9]/.test(ch);
  }

  function isSpace(ch) {
    return ch === '' || /\s/.test(ch);
  }

  /** The end of the backtick run at `i` and of its code span: { end, content } or null when the span never closes. */
  function codeSpanAt(text, i) {
    var run = 0;
    while (text.charAt(i + run) === '`') run += 1;
    var from = i + run;
    var k;
    while ((k = text.indexOf('`', from)) !== -1) {
      var r = k;
      while (text.charAt(r) === '`') r += 1;
      if (r - k === run) {
        var content = text.slice(i + run, k).replace(/\n/g, ' ');
        if (content.length > 1 && content.charAt(0) === ' ' && content.charAt(content.length - 1) === ' ' && /[^ ]/.test(content)) content = content.slice(1, -1);
        return { end: r, content: content, run: run };
      }
      from = r;
    }
    return { end: null, run: run };
  }

  /** The index of a run of `ch` at or after `from` that closes an emphasis of length `len`; its last `len` characters close. */
  function findCloser(text, from, ch, len, memo) {
    var key = from + ':' + len;
    if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
    var found = scanForCloser(text, from, ch, len, memo);
    memo[key] = found;
    return found;
  }

  // Remembering each answer keeps a run of unmatched delimiters from being searched again and again.
  function scanForCloser(text, from, ch, len, memo) {
    var j = from;
    while (j < text.length) {
      var c = text.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === '`') {
        var span = codeSpanAt(text, j);
        j = span.end === null ? j + span.run : span.end;
        continue;
      }
      if (c !== ch) { j += 1; continue; }
      var run = 0;
      while (text.charAt(j + run) === ch) run += 1;
      var prev = j > 0 ? text.charAt(j - 1) : '';
      var after = text.charAt(j + run);
      var canClose = !isSpace(prev) && (ch === '*' || !isAlnum(after));
      var canOpen = !isSpace(after) && (ch === '*' || !isAlnum(prev));
      if (canClose && run >= len) return j + run - len;
      if (canOpen && run <= 3) {
        var nested = findCloser(text, j + run, ch, run, memo);
        if (nested !== -1) { j = nested + run; continue; }
      }
      j += run;
    }
    return -1;
  }

  /** The end index of a "[text](destination)" starting at `i`, or null: { close, end }. */
  function linkAt(text, i) {
    var depth = 0;
    var j = i;
    var close = -1;
    while (j < text.length) {
      var c = text.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === '`') {
        var span = codeSpanAt(text, j);
        j = span.end === null ? j + span.run : span.end;
        continue;
      }
      if (c === '[') depth += 1;
      if (c === ']') { depth -= 1; if (depth === 0) { close = j; break; } }
      j += 1;
    }
    if (close === -1 || text.charAt(close + 1) !== '(') return null;
    var parens = 1;
    var k = close + 2;
    while (k < text.length) {
      var d = text.charAt(k);
      if (d === '\\') { k += 2; continue; }
      if (d === '(') parens += 1;
      if (d === ')') { parens -= 1; if (parens === 0) return { close: close, end: k }; }
      k += 1;
    }
    return null;
  }

  /** The inline nodes of a text: { t: 'text'|'code'|'strong'|'em'|'link'|'br' }. */
  function parseInline(text, depth) {
    var out = [];
    var buf = '';
    var i = 0;
    var memo = {};
    function flush() {
      if (buf !== '') { out.push({ t: 'text', v: buf }); buf = ''; }
    }
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === '\\') {
        var next = text.charAt(i + 1);
        if (next !== '' && PUNCTUATION.indexOf(next) !== -1) { buf += next; i += 2; continue; }
        if (next === '\n') { flush(); out.push({ t: 'br' }); i += 2; continue; }
        buf += ch; i += 1; continue;
      }
      if (ch === '\n') {
        if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); flush(); out.push({ t: 'br' }); }
        else buf = buf.replace(/ +$/, '') + ' ';
        i += 1;
        continue;
      }
      if (ch === '`') {
        var span = codeSpanAt(text, i);
        if (span.end === null) { buf += text.slice(i, i + span.run); i += span.run; continue; }
        flush();
        out.push({ t: 'code', v: span.content });
        i = span.end;
        continue;
      }
      if (ch === '!' && text.charAt(i + 1) === '[') {
        var image = linkAt(text, i + 1);
        if (image) { buf += text.slice(i, image.end + 1); i = image.end + 1; continue; }
        buf += ch; i += 1; continue;
      }
      if (ch === '[' && depth < MAX_DEPTH) {
        var link = linkAt(text, i);
        if (link) {
          var label = parseInline(text.slice(i + 1, link.close), depth + 1);
          var raw = text.slice(link.close + 2, link.end);
          var dest = raw.trim().split(/\s+/)[0] || '';
          if (dest.charAt(0) === '<' && dest.charAt(dest.length - 1) === '>') dest = dest.slice(1, -1);
          flush();
          if (dest.indexOf('#/') === 0) {
            var title = /"([^"]*)"\s*$/.exec(raw);
            out.push({ t: 'link', href: dest, title: title ? title[1] : null, c: label });
          } else {
            label.forEach(function (node) { out.push(node); });
            out.push({ t: 'text', v: ' (' + raw.trim() + ')' });
          }
          i = link.end + 1;
          continue;
        }
        buf += ch; i += 1; continue;
      }
      if ((ch === '*' || ch === '_') && depth < MAX_DEPTH) {
        var run = 0;
        while (text.charAt(i + run) === ch) run += 1;
        var prev = i > 0 ? text.charAt(i - 1) : '';
        var after = text.charAt(i + run);
        var canOpen = !isSpace(after) && (ch === '*' || !isAlnum(prev));
        var handled = false;
        if (canOpen && run <= 3) {
          var len = run;
          var at = findCloser(text, i + run, ch, len, memo);
          if (at !== -1) {
            var inner = parseInline(text.slice(i + run, at), depth + 1);
            flush();
            var node = len === 1 ? { t: 'em', c: inner } : (len === 2 ? { t: 'strong', c: inner } : { t: 'em', c: [{ t: 'strong', c: inner }] });
            out.push(node);
            i = at + len;
            handled = true;
          }
        }
        if (!handled) { buf += text.slice(i, i + run); i += run; }
        continue;
      }
      buf += ch;
      i += 1;
    }
    flush();
    return out;
  }

  // ---- DOM ----

  function renderInline(nodes, parent) {
    nodes.forEach(function (node) {
      if (node.t === 'text') parent.appendChild(document.createTextNode(node.v));
      else if (node.t === 'code') parent.appendChild(h('code', { text: node.v }));
      else if (node.t === 'br') parent.appendChild(h('br'));
      else {
        var el = node.t === 'link' ? h('a', { href: node.href, title: node.title }) : h(node.t);
        renderInline(node.c, el);
        parent.appendChild(el);
      }
    });
  }

  function cell(tag, nodes, align) {
    var el = h(tag, { class: align ? 'xv-align-' + align : null });
    renderInline(nodes, el);
    return el;
  }

  function renderBlocks(blocks, parent) {
    blocks.forEach(function (block) {
      if (block.t === 'heading') {
        var heading = h('h' + block.level);
        renderInline(block.c, heading);
        parent.appendChild(heading);
      } else if (block.t === 'p') {
        var p = h('p');
        renderInline(block.c, p);
        parent.appendChild(p);
      } else if (block.t === 'ul' || block.t === 'ol') {
        var list = h(block.t, { start: block.start });
        block.items.forEach(function (item) {
          var li = h('li');
          // The first paragraph of an item is written straight into it; later blocks follow.
          if (item.length > 0 && item[0].t === 'p') {
            renderInline(item[0].c, li);
            renderBlocks(item.slice(1), li);
          } else renderBlocks(item, li);
          list.appendChild(li);
        });
        parent.appendChild(list);
      } else if (block.t === 'code') {
        parent.appendChild(h('pre', { class: 'xv-md-code' }, h('code', { class: block.lang ? 'language-' + block.lang : null, text: block.v })));
      } else if (block.t === 'quote') {
        var quote = h('blockquote');
        renderBlocks(block.c, quote);
        parent.appendChild(quote);
      } else if (block.t === 'hr') {
        parent.appendChild(h('hr'));
      } else if (block.t === 'table') {
        var head = h('tr');
        block.head.forEach(function (nodes, i) { head.appendChild(cell('th', nodes, block.align[i])); });
        var body = h('tbody');
        block.rows.forEach(function (row) {
          var tr = h('tr');
          row.forEach(function (nodes, i) { tr.appendChild(cell('td', nodes, block.align[i])); });
          body.appendChild(tr);
        });
        parent.appendChild(h('div', { class: 'xv-table-wrap' }, h('table', { class: 'xv-table' }, h('thead', null, head), body)));
      }
    });
  }

  /** A div holding the report's Markdown as DOM nodes. */
  function render(text) {
    var root = h('div', { class: 'xv-md' });
    renderBlocks(parseBlocks(text, 0), root);
    return root;
  }

  XV.markdown = { parseBlocks: parseBlocks, parseInline: parseInline, render: render };
})();
