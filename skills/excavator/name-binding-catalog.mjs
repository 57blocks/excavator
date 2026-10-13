/**
 * name-binding-catalog.mjs
 *
 * Loads and validates the name-binding catalog (openspec: changes/
 * name-binding-references and changes/xml-injection-references, capability
 * `fact-graph`, design D1 of each). The catalog is the only place that says which
 * XML elements and annotations declare a name, how a name is defaulted, which
 * files hold expressions and what an expression can see, and - version 2 - which
 * XML attributes and elements write the name of another declaration (an
 * injection site) and which element is the consumer it is injected into; the
 * stages that read bindings and resolve names only execute it.
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

const CATALOG_VERSION = 2;
const ROOT = 'name-bindings';
const TARGET_KINDS = ['class', 'bundle', 'name'];
const SITE_SCOPES = ['unit', 'file', 'outside'];

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

/**
 * The namespaces a root element may declare: strings, and `null` for a root that
 * declares none (a DTD-form file). Version 2 of the catalog.
 */
function checkRootNamespaces(path, value) {
  checkArray(path, value, { atLeastOne: true });
  value.forEach((item, i) => {
    if (item !== null && (typeof item !== 'string' || item === '')) fail(`${path}[${i}]`, 'expected a non-empty string or null');
  });
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
  if (binder.rootNamespace !== undefined) checkRootNamespaces(`${path}.rootNamespace`, binder.rootNamespace);
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

  const target = `${path}.target`;
  checkObject(target, binder.target, ['kind'], ['child', 'attribute', 'unknownWhen', 'inheritFrom']);
  // `name`: the target text is another name, looked up like any name (an alias).
  if (!TARGET_KINDS.includes(binder.target.kind)) fail(`${target}.kind`, 'expected "class", "bundle" or "name"');
  const targetFrom = checkSource(target, binder.target);
  checkString(`${target}.${targetFrom}`, binder.target[targetFrom]);
  // The target rules say what a class attribute means, so they are for a class target only.
  for (const rule of ['unknownWhen', 'inheritFrom']) {
    if (binder.target[rule] !== undefined && binder.target.kind !== 'class') fail(target, `"${rule}" needs "kind": "class"`);
  }
  if (binder.target.unknownWhen !== undefined) checkStrings(`${target}.unknownWhen`, binder.target.unknownWhen, { atLeastOne: true });
  if (binder.target.inheritFrom !== undefined) checkString(`${target}.inheritFrom`, binder.target.inheritFrom);
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

const SITE_ELEMENT_SHAPE = ['element', 'attribute'];
const SITE_NAMESPACE_SHAPE = ['attributeNamespace', 'attributeSuffix'];

/**
 * One injection site: an id, an optional visibility scope, and one of two
 * shapes - an attribute of an element (`element`, `attribute`), or an attribute
 * in a namespace by the end of its name (`attributeNamespace`, `attributeSuffix`).
 */
function checkInjectionSite(path, site) {
  checkObject(path, site, ['id'], ['scope', ...SITE_ELEMENT_SHAPE, ...SITE_NAMESPACE_SHAPE]);
  checkString(`${path}.id`, site.id);
  if (site.scope !== undefined && !SITE_SCOPES.includes(site.scope)) fail(`${path}.scope`, 'expected "unit", "file" or "outside"');

  const written = (shape) => shape.filter((key) => site[key] !== undefined);
  const elementShape = written(SITE_ELEMENT_SHAPE);
  const namespaceShape = written(SITE_NAMESPACE_SHAPE);
  if (elementShape.length > 0 && namespaceShape.length > 0) {
    fail(path, 'the "element"/"attribute" shape and the "attributeNamespace"/"attributeSuffix" shape cannot be mixed');
  }
  if (elementShape.length === 0 && namespaceShape.length === 0) {
    fail(path, 'expected either "element" and "attribute", or "attributeNamespace" and "attributeSuffix"');
  }
  // A shape is both of its keys: one alone is a missing field.
  for (const key of elementShape.length > 0 ? SITE_ELEMENT_SHAPE : SITE_NAMESPACE_SHAPE) {
    if (site[key] === undefined) fail(path, `missing ${JSON.stringify(key)}`);
    checkString(`${path}.${key}`, site[key]);
  }
}

function checkXmlInjection(path, family) {
  checkObject(path, family, ['id', 'namespace', 'basis', 'root', 'consumer', 'sites', 'census'], ['rootNamespace']);
  for (const key of ['id', 'namespace', 'basis', 'root']) checkString(`${path}.${key}`, family[key]);
  if (family.rootNamespace !== undefined) checkRootNamespaces(`${path}.rootNamespace`, family.rootNamespace);

  checkObject(`${path}.consumer`, family.consumer, ['element', 'binder']);
  checkString(`${path}.consumer.element`, family.consumer.element);
  checkString(`${path}.consumer.binder`, family.consumer.binder);

  checkArray(`${path}.sites`, family.sites, { atLeastOne: true });
  family.sites.forEach((site, i) => checkInjectionSite(`${path}.sites[${i}]`, site));

  // What the family reads no site of is still counted; a census that counts
  // nothing would let every unread reference shape pass unseen.
  const census = `${path}.census`;
  checkObject(census, family.census, ['attributes', 'attributeSuffixes', 'elements']);
  for (const key of ['attributes', 'attributeSuffixes', 'elements']) checkStrings(`${census}.${key}`, family.census[key]);
  if (['attributes', 'attributeSuffixes', 'elements'].every((key) => family.census[key].length === 0)) {
    fail(census, 'expected at least one entry in "attributes", "attributeSuffixes" or "elements"');
  }
}

/**
 * A family's consumer binder is an XML binder of the family's namespace whose
 * target is a class: the consumer's class is what an injection edge starts from.
 */
function checkConsumerBinder(path, family, xmlBinders) {
  const where = `${path}.consumer.binder`;
  const binder = xmlBinders.find((candidate) => candidate.id === family.consumer.binder);
  if (binder === undefined) fail(where, `no XML binder with the id ${JSON.stringify(family.consumer.binder)}`);
  if (binder.namespace !== family.namespace) {
    fail(where, `${JSON.stringify(binder.id)} is in the namespace ${JSON.stringify(binder.namespace)}, not ${JSON.stringify(family.namespace)}`);
  }
  if (binder.target.kind !== 'class') {
    fail(where, `${JSON.stringify(binder.id)} must have a target of kind "class", not ${JSON.stringify(binder.target.kind)}`);
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
  checkObject(files, language.files, ['extensions', 'templateExtensions', 'xmlRoots']);
  checkStrings(`${files}.extensions`, language.files.extensions);
  checkStrings(`${files}.templateExtensions`, language.files.templateExtensions);
  language.files.templateExtensions.forEach((extension, i) => {
    if (!language.files.extensions.includes(extension)) fail(`${files}.templateExtensions[${i}]`, `${JSON.stringify(extension)} is not one of the extensions`);
  });
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
  // The version first: a catalog of an older version is also missing what the
  // newer one requires, and "wrong version" is the message that says why.
  if (isPlainObject(value) && value.version !== undefined && value.version !== CATALOG_VERSION) {
    fail(`${ROOT}.version`, `expected the number ${CATALOG_VERSION}`);
  }
  checkObject(ROOT, value, ['version', 'unitDescriptors', 'xmlBinders', 'annotationBinders', 'expressionLanguages', 'xmlInjections']);
  checkStrings(`${ROOT}.unitDescriptors`, value.unitDescriptors);

  const lists = [
    ['xmlBinders', checkXmlBinder],
    ['annotationBinders', checkAnnotationBinder],
    ['expressionLanguages', checkExpressionLanguage],
    ['xmlInjections', checkXmlInjection],
  ];
  // An id is what the coverage and the evidence name a binder, a language or a
  // family by: one space for all of them.
  const ids = new Set();
  for (const [key, check] of lists) {
    checkArray(`${ROOT}.${key}`, value[key]);
    value[key].forEach((entry, i) => {
      check(`${ROOT}.${key}[${i}]`, entry);
      if (ids.has(entry.id)) fail(`${ROOT}.${key}[${i}]`, `duplicate id ${JSON.stringify(entry.id)}`);
      ids.add(entry.id);
    });
  }

  // The coverage counts the injection sites by id: a space of its own.
  const siteIds = new Set();
  value.xmlInjections.forEach((family, i) => {
    const path = `${ROOT}.xmlInjections[${i}]`;
    family.sites.forEach((site, j) => {
      if (siteIds.has(site.id)) fail(`${path}.sites[${j}]`, `duplicate site id ${JSON.stringify(site.id)}`);
      siteIds.add(site.id);
    });
    checkConsumerBinder(path, family, value.xmlBinders);
  });
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
