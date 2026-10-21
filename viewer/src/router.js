/*
 * router.js: hash routes. #/overview, #/code?path=<p>&lines=<a>-<b>,
 * #/reports/<name> (design D5). parseRoute and buildHash are pure.
 */
(function () {
  'use strict';

  var XV = (window.XV = window.XV || {});

  function decode(text) {
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text;
    }
  }

  /**
   * parseRoute('#/code/x?path=a%2Fb&lines=3-9') gives
   * { page: 'code', rest: 'x', params: { path: 'a/b', lines: '3-9' } }.
   * An empty hash gives the Overview route; the page name is returned as typed otherwise.
   */
  function parseRoute(hash) {
    var text = typeof hash === 'string' ? hash : '';
    if (text.charAt(0) === '#') text = text.slice(1);
    var queryAt = text.indexOf('?');
    var path = queryAt === -1 ? text : text.slice(0, queryAt);
    var query = queryAt === -1 ? '' : text.slice(queryAt + 1);
    var segments = path.split('/').filter(function (segment) { return segment !== ''; });
    var params = {};
    query.split('&').forEach(function (pair) {
      if (pair === '') return;
      var eq = pair.indexOf('=');
      var key = decode(eq === -1 ? pair : pair.slice(0, eq));
      var value = eq === -1 ? '' : decode(pair.slice(eq + 1).replace(/\+/g, ' '));
      if (!Object.prototype.hasOwnProperty.call(params, key)) params[key] = value;
    });
    return {
      page: segments.length === 0 ? 'overview' : decode(segments[0]),
      rest: segments.slice(1).map(decode).join('/'),
      params: params,
    };
  }

  /** The inverse of parseRoute: buildHash('code', { path: 'a/b', lines: '3-9' }) is '#/code?path=a%2Fb&lines=3-9'. */
  function buildHash(page, params, rest) {
    var hash = '#/' + encodeURIComponent(page);
    if (rest) hash += '/' + rest.split('/').map(encodeURIComponent).join('/');
    var keys = Object.keys(params || {}).filter(function (key) { return params[key] !== null && params[key] !== undefined; });
    if (keys.length > 0) {
      hash += '?' + keys.map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); }).join('&');
    }
    return hash;
  }

  XV.router = { parseRoute: parseRoute, buildHash: buildHash };
})();
