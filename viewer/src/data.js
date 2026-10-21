/*
 * data.js: reads the manifest and the data payloads the packer inlined.
 * A payload is an octet-stream data element with the id "xv-<name>" holding
 * base64(gzip(bytes)); it is decoded on first use and cached (design D2).
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});
  var cache = {};
  var jsonCache = {};

  /** The manifest: product statuses, snapshot revision, and where each payload is. */
  function readManifest() {
    var el = document.getElementById('xv-manifest');
    if (!el) throw new Error('the page has no manifest (#xv-manifest)');
    var manifest;
    try {
      manifest = JSON.parse(el.textContent);
    } catch (error) {
      throw new Error('the manifest is not valid JSON: ' + error.message);
    }
    return manifest;
  }

  /** base64 text to bytes. */
  function decodeBase64(text) {
    var binary = atob(text.replace(/\s+/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** gzip bytes to UTF-8 text (DecompressionStream is needed: Chrome 80+, Firefox 113+, Safari 16.4+). */
  function gunzipText(bytes) {
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('this browser has no DecompressionStream; the data cannot be unpacked'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  /** The text of payload `name`, decoded once. */
  function loadText(name) {
    if (!Object.prototype.hasOwnProperty.call(cache, name)) {
      cache[name] = Promise.resolve().then(function () {
        var el = document.getElementById('xv-' + name);
        if (!el) throw new Error('the page has no data payload "' + name + '"');
        return gunzipText(decodeBase64(el.textContent)).catch(function (error) {
          if (error && /DecompressionStream/.test(error.message)) throw error;
          throw new Error('data payload "' + name + '" could not be unpacked: it is not valid gzip data');
        });
      });
    }
    return cache[name];
  }

  /** The parsed JSON of payload `name`, parsed once. */
  function loadJson(name) {
    if (!Object.prototype.hasOwnProperty.call(jsonCache, name)) {
      jsonCache[name] = loadText(name).then(function (text) {
        try {
          return JSON.parse(text);
        } catch (error) {
          throw new Error('data payload "' + name + '" is not valid JSON: ' + error.message);
        }
      });
    }
    return jsonCache[name];
  }

  /**
   * Visit the records of a JSONL text one line at a time; a record is never kept
   * unless `visit` keeps it. Returns { lines, bad }: records visited and lines that did not parse.
   */
  function eachJsonlRecord(text, visit) {
    var lines = 0;
    var bad = 0;
    var start = 0;
    while (start <= text.length) {
      var end = text.indexOf('\n', start);
      if (end === -1) end = text.length;
      var line = text.slice(start, end);
      start = end + 1;
      if (line.trim() === '') continue;
      var record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        bad += 1;
        continue;
      }
      lines += 1;
      visit(record);
    }
    return { lines: lines, bad: bad };
  }

  XV.data = {
    readManifest: readManifest,
    decodeBase64: decodeBase64,
    loadText: loadText,
    loadJson: loadJson,
    eachJsonlRecord: eachJsonlRecord,
  };
})();
