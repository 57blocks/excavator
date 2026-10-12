/**
 * name-binding-catalog.mjs
 *
 * Loads and validates the name-binding catalog (openspec: changes/
 * name-binding-references, capability `fact-graph`, design D1). The catalog is
 * the only place that says which XML elements and annotations declare a name,
 * how a name is defaulted, which files hold expressions and what an expression
 * can see; the stages that read bindings and resolve expression names only
 * execute it.
 *
 * Validation is strict and total: an unknown key, a missing field, a wrong type
 * or a repeated id throws, naming where. There is no partial catalog - a typo
 * that dropped one binder would otherwise show up as "no binding" for every
 * name it declares. The result is deeply frozen.
 *
 * Pure and build-free: it reads one JSON file (or takes a parsed object) and
 * nothing else.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The catalog that ships with the skill. */
export const SHIPPED_NAME_BINDING_CATALOG = join(dirname(fileURLToPath(import.meta.url)), 'catalogs', 'name-bindings.json');

const CATALOG_VERSION = 1;
const ROOT = 'name-bindings';

const isUpper = (ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/**
 * The named algorithms a binder's `defaultName` may select. A framework's
 * "name left out" rule is data (which algorithm); the algorithms themselves
 * are plain string functions with no framework in them.
 */
export const DEFAULT_NAME_RULES = Object.freeze({
  /** First character lower case, the rest as written. */
  'lowercase-first': (simpleName) => simpleName.charAt(0).toLowerCase() + simpleName.slice(1),
  /** As `java.beans.Introspector.decapitalize`: unchanged when the first two characters are both upper case. */
  'java-beans-decapitalize': (simpleName) => (
    simpleName.length > 1 && isUpper(simpleName.charAt(0)) && isUpper(simpleName.charAt(1))
      ? simpleName
      : simpleName.charAt(0).toLowerCase() + simpleName.slice(1)
  ),
});

function fail(path, message) {
  throw new Error(`name-binding-catalog: ${path}: ${message}`);
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

function checkArray(path, value, { atLeastOne = false } = {}) {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (atLeastOne && value.length === 0) fail(path, 'expected at least one entry');
}

function checkBoolean(path, value) {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
}

function checkStrings(path, value, options) {
  checkArray(path, value, options);
  value.forEach((item, i) => checkString(`${path}[${i}]`, item));
}

/** Exactly one of `child` (a direct child element's text) or `attribute` says where a value is read from. */
function checkSource(path, value) {
  const sources = ['child', 'attribute'].filter((key) => value[key] !== undefined);
  if (sources.length !== 1) fail(path, 'expected exactly one of "child" or "attribute"');
  return sources[0];
}

function checkXmlBinder(path, binder) {
  checkObject(
    path, binder,
    ['id', 'namespace', 'basis', 'root', 'element', 'parent', 'name', 'target', 'namespacedNames', 'missingTarget'],
    ['rootNamespace'],
  );
  for (const key of ['id', 'namespace', 'basis', 'root', 'element', 'parent']) checkString(`${path}.${key}`, binder[key]);
  if (binder.rootNamespace !== undefined) checkStrings(`${path}.rootNamespace`, binder.rootNamespace, { atLeastOne: true });
  checkBoolean(`${path}.namespacedNames`, binder.namespacedNames);
  if (binder.missingTarget !== 'unknown' && binder.missingTarget !== 'configures') {
    fail(`${path}.missingTarget`, 'expected "unknown" or "configures"');
  }

  checkObject(`${path}.name`, binder.name, [], ['child', 'attribute', 'split']);
  const nameFrom = checkSource(`${path}.name`, binder.name);
  if (nameFrom === 'child') checkString(`${path}.name.child`, binder.name.child);
  else checkStrings(`${path}.name.attribute`, binder.name.attribute, { atLeastOne: true });
  if (binder.name.split !== undefined) {
    if (nameFrom !== 'attribute') fail(`${path}.name`, '"split" needs "attribute"');
    // attribute name -> the characters that separate the names written in it
    const split = `${path}.name.split`;
    if (!isPlainObject(binder.name.split)) fail(split, 'expected an object');
    const separated = Object.keys(binder.name.split);
    if (separated.length === 0) fail(split, 'expected at least one entry');
    for (const attribute of separated) {
      if (!binder.name.attribute.includes(attribute)) fail(split, `${JSON.stringify(attribute)} is not one of the listed attributes`);
      checkString(`${split}.${attribute}`, binder.name.split[attribute]);
    }
  }

  checkObject(`${path}.target`, binder.target, ['kind'], ['child', 'attribute']);
  if (binder.target.kind !== 'class' && binder.target.kind !== 'bundle') fail(`${path}.target.kind`, 'expected "class" or "bundle"');
  const targetFrom = checkSource(`${path}.target`, binder.target);
  checkString(`${path}.target.${targetFrom}`, binder.target[targetFrom]);
}

function checkAnnotationBinder(path, binder) {
  checkObject(path, binder, ['id', 'namespace', 'basis', 'annotations', 'nameArguments', 'defaultName', 'namespacedNames']);
  for (const key of ['id', 'namespace', 'basis']) checkString(`${path}.${key}`, binder[key]);
  checkBoolean(`${path}.namespacedNames`, binder.namespacedNames);
  checkStrings(`${path}.annotations`, binder.annotations, { atLeastOne: true });
  checkStrings(`${path}.nameArguments`, binder.nameArguments);
  const rule = binder.defaultName;
  if (rule !== null) {
    if (typeof rule !== 'string') fail(`${path}.defaultName`, 'expected a rule name or null');
    if (!Object.hasOwn(DEFAULT_NAME_RULES, rule)) fail(`${path}.defaultName`, `unknown rule ${JSON.stringify(rule)}`);
  }
}

function checkWhen(path, when) {
  checkObject(path, when, ['elementTextIn']);
  const condition = `${path}.elementTextIn`;
  checkObject(condition, when.elementTextIn, ['root', 'elements', 'anyOf']);
  checkString(`${condition}.root`, when.elementTextIn.root);
  checkStrings(`${condition}.elements`, when.elementTextIn.elements, { atLeastOne: true });
  checkStrings(`${condition}.anyOf`, when.elementTextIn.anyOf, { atLeastOne: true });
}

function checkExpressionLanguage(path, language) {
  checkObject(path, language, ['id', 'basis', 'delimiters', 'files', 'implicitNames', 'localDeclarations', 'sees']);
  checkString(`${path}.id`, language.id);
  checkString(`${path}.basis`, language.basis);
  checkStrings(`${path}.delimiters`, language.delimiters, { atLeastOne: true });

  const files = `${path}.files`;
  checkObject(files, language.files, ['extensions', 'xmlRoots']);
  checkStrings(`${files}.extensions`, language.files.extensions);
  checkArray(`${files}.xmlRoots`, language.files.xmlRoots);
  language.files.xmlRoots.forEach((entry, i) => {
    checkObject(`${files}.xmlRoots[${i}]`, entry, ['root'], ['rootNamespace']);
    checkString(`${files}.xmlRoots[${i}].root`, entry.root);
    if (entry.rootNamespace !== undefined) checkStrings(`${files}.xmlRoots[${i}].rootNamespace`, entry.rootNamespace, { atLeastOne: true });
  });
  if (language.files.extensions.length === 0 && language.files.xmlRoots.length === 0) {
    fail(files, 'expected at least one extension or XML root');
  }

  checkStrings(`${path}.implicitNames`, language.implicitNames);
  checkArray(`${path}.localDeclarations`, language.localDeclarations);
  language.localDeclarations.forEach((entry, i) => {
    const declaration = `${path}.localDeclarations[${i}]`;
    checkObject(declaration, entry, ['attribute'], ['element', 'elementNamespaces', 'declares']);
    checkString(`${declaration}.attribute`, entry.attribute);
    if (entry.element !== undefined) checkString(`${declaration}.element`, entry.element);
    if (entry.elementNamespaces !== undefined) {
      if (entry.element === undefined) fail(declaration, '"elementNamespaces" needs "element"');
      checkStrings(`${declaration}.elementNamespaces`, entry.elementNamespaces, { atLeastOne: true });
    }
    if (entry.declares !== undefined && entry.declares !== 'literal' && entry.declares !== 'expression-root') {
      fail(`${declaration}.declares`, 'expected "literal" or "expression-root"');
    }
  });
  checkArray(`${path}.sees`, language.sees, { atLeastOne: true });
  language.sees.forEach((entry, i) => {
    checkObject(`${path}.sees[${i}]`, entry, ['namespace'], ['when']);
    checkString(`${path}.sees[${i}].namespace`, entry.namespace);
    if (entry.when !== undefined) checkWhen(`${path}.sees[${i}].when`, entry.when);
  });
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
 * first thing wrong, naming its place (`xmlBinders[1]: unknown key "extra"`).
 *
 * @param {unknown} value the parsed JSON
 * @returns {Readonly<object>}
 */
export function parseNameBindingCatalog(value) {
  checkObject(ROOT, value, ['version', 'unitDescriptors', 'xmlBinders', 'annotationBinders', 'expressionLanguages']);
  if (value.version !== CATALOG_VERSION) fail(`${ROOT}.version`, `expected the number ${CATALOG_VERSION}`);
  checkStrings(`${ROOT}.unitDescriptors`, value.unitDescriptors);

  const lists = [
    ['xmlBinders', checkXmlBinder],
    ['annotationBinders', checkAnnotationBinder],
    ['expressionLanguages', checkExpressionLanguage],
  ];
  const ids = new Set();
  for (const [key, check] of lists) {
    checkArray(`${ROOT}.${key}`, value[key]);
    value[key].forEach((entry, i) => {
      check(`${ROOT}.${key}[${i}]`, entry);
      // An id is what the coverage and the evidence name a binder by.
      if (ids.has(entry.id)) fail(`${ROOT}.${key}[${i}]`, `duplicate id ${JSON.stringify(entry.id)}`);
      ids.add(entry.id);
    });
  }
  return deepFreeze(structuredClone(value));
}

/**
 * Read, parse and validate a catalog file; the shipped catalog by default.
 *
 * @param {string} [path]
 * @returns {Readonly<object>}
 */
export function loadNameBindingCatalog(path = SHIPPED_NAME_BINDING_CATALOG) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`name-binding-catalog: cannot read ${path}: ${error.message}`);
  }
  return parseNameBindingCatalog(parsed);
}
