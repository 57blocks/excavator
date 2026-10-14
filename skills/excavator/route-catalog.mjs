/**
 * route-catalog.mjs
 *
 * Loads and validates the route catalog (openspec: changes/jaxrs-route-facts,
 * capability `fact-graph`, design D3). The catalog is the only place that says
 * which annotations make a Java method an HTTP entry point: per route family,
 * the annotations that give a type its root path and a method its own path, the
 * annotations that name an HTTP method (one entry per verb), the annotations that
 * mark a type as a client of a remote service rather than an entry point of this
 * application, and whether only `public` methods are exposed. The stage that
 * resolves route sites (route-resolution.mjs) only executes it.
 *
 * Validation is strict and total: an unknown key, a missing field, a wrong type,
 * an empty list (the client annotations excepted) or a repeated id throws, naming
 * where. There is no partial catalog - a typo that dropped one verb would
 * otherwise show up as "no HTTP method" for every method that writes it. The
 * result is deeply frozen.
 *
 * Pure and build-free: it reads one JSON file (or takes a parsed object) and
 * nothing else.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The catalog that ships with the skill. */
export const SHIPPED_ROUTE_CATALOG = join(dirname(fileURLToPath(import.meta.url)), 'catalogs', 'routes.json');

const CATALOG_VERSION = 1;
const ROOT = 'route-catalog';

/** The identity of an annotation is its qualified name: a simple name would match the annotation of any package. */
const QUALIFIED_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function fail(path, message) {
  throw new Error(`route-catalog: ${path}: ${message}`);
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every key of `value` is in `required` or `optional`, and every `required` one is present. */
function checkObject(path, value, required, optional = []) {
  if (!isPlainObject(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) fail(path, `unknown key ${JSON.stringify(key)}`);
  }
  for (const key of required) {
    if (value[key] === undefined) fail(path, `missing ${JSON.stringify(key)}`);
  }
}

function checkString(path, value) {
  if (typeof value !== 'string') fail(path, 'expected a string');
  if (value === '') fail(path, 'expected a non-empty string');
}

function checkBoolean(path, value) {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
}

function checkArray(path, value, { atLeastOne = false } = {}) {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (atLeastOne && value.length === 0) fail(path, 'expected at least one entry');
}

/** A list of qualified annotation names, none written twice. */
function checkAnnotations(path, value, options) {
  checkArray(path, value, options);
  const seen = new Set();
  value.forEach((name, i) => {
    checkString(`${path}[${i}]`, name);
    if (!QUALIFIED_NAME.test(name)) fail(`${path}[${i}]`, 'expected a qualified name');
    if (seen.has(name)) fail(`${path}[${i}]`, `duplicate annotation ${JSON.stringify(name)}`);
    seen.add(name);
  });
}

/** The annotations of a path (root or method): which they are, and the argument that holds the path. */
function checkPath(path, value) {
  checkObject(path, value, ['annotations', 'argument']);
  checkAnnotations(`${path}.annotations`, value.annotations, { atLeastOne: true });
  checkString(`${path}.argument`, value.argument);
}

/**
 * One HTTP method: its verb, and the annotations that name it. The route is
 * written `<verb> <path>`, so a verb that held a space could not be read back.
 */
function checkVerb(path, entry) {
  checkObject(path, entry, ['verb', 'annotations']);
  checkString(`${path}.verb`, entry.verb);
  if (/\s/.test(entry.verb)) fail(`${path}.verb`, 'expected a verb without whitespace');
  checkAnnotations(`${path}.annotations`, entry.annotations, { atLeastOne: true });
}

function checkFamily(path, family) {
  checkObject(path, family, ['id', 'basis', 'rootPath', 'methodPath', 'verbs', 'clientAnnotations', 'publicOnly']);
  checkString(`${path}.id`, family.id);
  checkString(`${path}.basis`, family.basis);
  checkPath(`${path}.rootPath`, family.rootPath);
  checkPath(`${path}.methodPath`, family.methodPath);

  checkArray(`${path}.verbs`, family.verbs, { atLeastOne: true });
  const verbs = new Set();
  // An annotation names one verb: what a method writes must not depend on the order of the entries.
  const verbOf = new Map();
  family.verbs.forEach((entry, i) => {
    const at = `${path}.verbs[${i}]`;
    checkVerb(at, entry);
    if (verbs.has(entry.verb)) fail(`${at}.verb`, `duplicate verb ${JSON.stringify(entry.verb)}`);
    verbs.add(entry.verb);
    entry.annotations.forEach((name, j) => {
      if (verbOf.has(name)) fail(`${at}.annotations[${j}]`, `${JSON.stringify(name)} already names the verb ${JSON.stringify(verbOf.get(name))}`);
      verbOf.set(name, entry.verb);
    });
  });

  // May be empty: a family with no client declarations.
  checkAnnotations(`${path}.clientAnnotations`, family.clientAnnotations);
  checkBoolean(`${path}.publicOnly`, family.publicOnly);

  // A path annotation read as an HTTP method (or the converse) would make one use of it two things.
  const paths = new Set([...family.rootPath.annotations, ...family.methodPath.annotations]);
  family.verbs.forEach((entry, i) => entry.annotations.forEach((name, j) => {
    if (paths.has(name)) fail(`${path}.verbs[${i}].annotations[${j}]`, `${JSON.stringify(name)} is also a path annotation of the family`);
  }));
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Validate an already-parsed catalog and return it deeply frozen. Throws on the
 * first thing wrong, naming its place (`routeFamilies[0].verbs[2]: unknown key "extra"`).
 *
 * @param {unknown} value the parsed JSON
 * @returns {Readonly<object>}
 */
export function parseRouteCatalog(value) {
  // The version first: a catalog of another version may be missing or carry
  // what this one does not, and "wrong version" is the message that says why.
  if (isPlainObject(value) && value.version !== undefined && value.version !== CATALOG_VERSION) {
    fail(`${ROOT}.version`, `expected the number ${CATALOG_VERSION}`);
  }
  checkObject(ROOT, value, ['version', 'routeFamilies']);

  const key = `${ROOT}.routeFamilies`;
  checkArray(key, value.routeFamilies, { atLeastOne: true });
  const ids = new Set();
  value.routeFamilies.forEach((family, i) => {
    checkFamily(`${key}[${i}]`, family);
    // An id is what the coverage and the gaps name a family by.
    if (ids.has(family.id)) fail(`${key}[${i}]`, `duplicate id ${JSON.stringify(family.id)}`);
    ids.add(family.id);
  });
  return deepFreeze(structuredClone(value));
}

/**
 * Read, parse and validate a catalog file; the shipped catalog by default.
 *
 * @param {string} [path]
 * @returns {Readonly<object>}
 */
export function loadRouteCatalog(path = SHIPPED_ROUTE_CATALOG) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`route-catalog: cannot read ${path}: ${error.message}`);
  }
  return parseRouteCatalog(parsed);
}
