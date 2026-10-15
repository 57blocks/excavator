/**
 * type-injection-catalog.mjs
 *
 * Loads and validates the type injection catalog (openspec: changes/
 * by-type-injection, capability `fact-graph`, design D4). The catalog is the
 * only place that says which annotations make a Java member an injection point
 * the container fills by type, and what else decides which bean it gets: per
 * injection family, the annotations, the member kinds they sit on, whether the
 * annotations beside the injection are qualifiers, and which arguments turn the
 * point into one by name or by JNDI name or restate its type; then, one role at
 * a time, the name qualifier and the annotations that give a bean a default
 * name, the annotations that produce a bean, the types that provide one, the
 * annotations that make bean-ness depend on the deployment, the annotations
 * that are never qualifiers, and the annotations that declare the business
 * interfaces of a bean. The stage that resolves the injection points
 * (type-injection-resolution.mjs) only executes it.
 *
 * Validation is strict and total: an unknown key, a missing field, a wrong
 * type, an empty family annotation or member kind list, a repeated family id,
 * a name that is not a qualified name, or a qualified name that two roles both
 * claim throws, naming where. There is no partial catalog - a typo that dropped
 * one annotation would otherwise read as "not an injection point" for every
 * member that writes it. The result is deeply frozen.
 *
 * Pure and build-free: it reads one JSON file (or takes a parsed object) and
 * nothing else.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The catalog that ships with the skill. */
export const SHIPPED_TYPE_INJECTION_CATALOG = join(dirname(fileURLToPath(import.meta.url)), 'catalogs', 'type-injections.json');

const CATALOG_VERSION = 1;
const ROOT = 'type-injection-catalog';

/** The member kinds an injection annotation can sit on. */
const MEMBER_KINDS = ['field', 'method', 'constructor'];

/** The identity of an annotation or type is its qualified name: a simple name would match the one of any package. */
const QUALIFIED_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/** An annotation argument is named by a Java identifier, not by a dotted name. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function fail(path, message) {
  throw new Error(`type-injection-catalog: ${path}: ${message}`);
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every key of `value` is in `required`, and every `required` one is present. */
function checkObject(path, value, required) {
  if (!isPlainObject(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (!required.includes(key)) fail(path, `unknown key ${JSON.stringify(key)}`);
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

/** A list of qualified names (annotations or types), none written twice. */
function checkNames(path, value, options) {
  checkArray(path, value, options);
  const seen = new Set();
  value.forEach((name, i) => {
    checkString(`${path}[${i}]`, name);
    if (!QUALIFIED_NAME.test(name)) fail(`${path}[${i}]`, 'expected a qualified name');
    if (seen.has(name)) fail(`${path}[${i}]`, `duplicate name ${JSON.stringify(name)}`);
    seen.add(name);
  });
}

function checkIdentifier(path, value) {
  checkString(path, value);
  if (!IDENTIFIER.test(value)) fail(path, 'expected an identifier, not a dotted name');
}

/** A list of annotation argument names, none written twice. */
function checkIdentifiers(path, value) {
  checkArray(path, value);
  const seen = new Set();
  value.forEach((name, i) => {
    checkIdentifier(`${path}[${i}]`, name);
    if (seen.has(name)) fail(`${path}[${i}]`, `duplicate argument ${JSON.stringify(name)}`);
    seen.add(name);
  });
}

function checkMemberKinds(path, value) {
  checkArray(path, value, { atLeastOne: true });
  const seen = new Set();
  value.forEach((kind, i) => {
    checkString(`${path}[${i}]`, kind);
    if (!MEMBER_KINDS.includes(kind)) fail(`${path}[${i}]`, `expected one of ${MEMBER_KINDS.join(', ')}`);
    if (seen.has(kind)) fail(`${path}[${i}]`, `duplicate member kind ${JSON.stringify(kind)}`);
    seen.add(kind);
  });
}

function checkFamily(path, family) {
  checkObject(path, family, [
    'id', 'basis', 'annotations', 'on', 'readsQualifiers', 'singleParameterMethods',
    'nameArguments', 'nameAnnotations', 'lookupArguments', 'typeArgument',
  ]);
  checkString(`${path}.id`, family.id);
  checkString(`${path}.basis`, family.basis);
  checkNames(`${path}.annotations`, family.annotations, { atLeastOne: true });
  checkMemberKinds(`${path}.on`, family.on);
  checkBoolean(`${path}.readsQualifiers`, family.readsQualifiers);
  checkBoolean(`${path}.singleParameterMethods`, family.singleParameterMethods);
  // The three argument lists may be empty: a family with no by-name form.
  checkIdentifiers(`${path}.nameArguments`, family.nameArguments);
  checkNames(`${path}.nameAnnotations`, family.nameAnnotations);
  checkIdentifiers(`${path}.lookupArguments`, family.lookupArguments);
  if (family.typeArgument !== null) checkIdentifier(`${path}.typeArgument`, family.typeArgument);

  // An argument is a bean name, a JNDI name or a type, not two of them: the
  // point would be one by name and one by type at once.
  const meaning = new Map();
  const claim = (at, argument, what) => {
    if (meaning.has(argument)) fail(at, `argument ${JSON.stringify(argument)} is already the ${meaning.get(argument)} argument of the family`);
    meaning.set(argument, what);
  };
  family.nameArguments.forEach((argument, i) => claim(`${path}.nameArguments[${i}]`, argument, 'name'));
  family.lookupArguments.forEach((argument, i) => claim(`${path}.lookupArguments[${i}]`, argument, 'lookup'));
  if (family.typeArgument !== null) claim(`${path}.typeArgument`, family.typeArgument, 'type');
}

/** A role that is a basis and one list of qualified names, which may be empty. */
function checkRole(path, role, listKey) {
  checkObject(path, role, ['basis', listKey]);
  checkString(`${path}.basis`, role.basis);
  checkNames(`${path}.${listKey}`, role[listKey]);
}

function checkNamedQualifier(path, role) {
  checkObject(path, role, ['basis', 'annotations', 'argument', 'defaultNameStereotypes']);
  checkString(`${path}.basis`, role.basis);
  checkNames(`${path}.annotations`, role.annotations);
  checkIdentifier(`${path}.argument`, role.argument);
  checkNames(`${path}.defaultNameStereotypes`, role.defaultNameStereotypes);
}

function checkBusinessInterfaces(path, role) {
  checkObject(path, role, ['basis', 'annotations', 'argument']);
  checkString(`${path}.basis`, role.basis);
  checkNames(`${path}.annotations`, role.annotations);
  checkIdentifier(`${path}.argument`, role.argument);
}

/**
 * No qualified name has two roles: an annotation that is both an injection
 * point and a producer, or a qualifier and a business interface declaration,
 * would be two things at one use. Within a role no name appears twice either,
 * which also keeps two families from sharing an annotation. The lists of one
 * role are read together: the name qualifier and the stereotypes that give a
 * bean a default name are one role, the injection annotations of every family
 * another.
 */
function checkRolesDisjoint(catalog) {
  const held = new Map();
  const claim = (role, path, names) => names.forEach((name, i) => {
    const at = `${path}[${i}]`;
    const previous = held.get(name);
    if (previous !== undefined) {
      fail(at, previous.role === role
        ? `${JSON.stringify(name)} is already listed as ${role} at ${previous.at}`
        : `${JSON.stringify(name)} is already listed as ${previous.role} at ${previous.at}, so it cannot also be ${role}`);
    }
    held.set(name, { role, at });
  });

  const families = `${ROOT}.injectionFamilies`;
  catalog.injectionFamilies.forEach((family, i) => claim('an injection annotation', `${families}[${i}].annotations`, family.annotations));
  catalog.injectionFamilies.forEach((family, i) => claim('a name injection annotation', `${families}[${i}].nameAnnotations`, family.nameAnnotations));
  claim('a name qualifier', `${ROOT}.namedQualifier.annotations`, catalog.namedQualifier.annotations);
  claim('a name qualifier', `${ROOT}.namedQualifier.defaultNameStereotypes`, catalog.namedQualifier.defaultNameStereotypes);
  claim('a producer', `${ROOT}.producers.annotations`, catalog.producers.annotations);
  claim('a provider type', `${ROOT}.providerTypes.types`, catalog.providerTypes.types);
  claim('a deployment dependent annotation', `${ROOT}.deploymentDependent.annotations`, catalog.deploymentDependent.annotations);
  claim('a non-qualifier', `${ROOT}.notQualifiers.annotations`, catalog.notQualifiers.annotations);
  claim('a business interface declaration', `${ROOT}.businessInterfaces.annotations`, catalog.businessInterfaces.annotations);
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
 * first thing wrong, naming its place (`injectionFamilies[0].on[1]: expected
 * one of field, method, constructor`).
 *
 * @param {unknown} value the parsed JSON
 * @returns {Readonly<object>}
 */
export function parseTypeInjectionCatalog(value) {
  // The version first: a catalog of another version may be missing or carry
  // what this one does not, and "wrong version" is the message that says why.
  if (isPlainObject(value) && value.version !== undefined && value.version !== CATALOG_VERSION) {
    fail(`${ROOT}.version`, `expected the number ${CATALOG_VERSION}`);
  }
  checkObject(ROOT, value, [
    'version', 'injectionFamilies', 'namedQualifier', 'producers', 'providerTypes',
    'deploymentDependent', 'notQualifiers', 'businessInterfaces',
  ]);

  const key = `${ROOT}.injectionFamilies`;
  checkArray(key, value.injectionFamilies);
  const ids = new Set();
  value.injectionFamilies.forEach((family, i) => {
    checkFamily(`${key}[${i}]`, family);
    // An id is what the coverage names a family by.
    if (ids.has(family.id)) fail(`${key}[${i}]`, `duplicate id ${JSON.stringify(family.id)}`);
    ids.add(family.id);
  });

  checkNamedQualifier(`${ROOT}.namedQualifier`, value.namedQualifier);
  checkRole(`${ROOT}.producers`, value.producers, 'annotations');
  checkRole(`${ROOT}.providerTypes`, value.providerTypes, 'types');
  checkRole(`${ROOT}.deploymentDependent`, value.deploymentDependent, 'annotations');
  checkRole(`${ROOT}.notQualifiers`, value.notQualifiers, 'annotations');
  checkBusinessInterfaces(`${ROOT}.businessInterfaces`, value.businessInterfaces);

  checkRolesDisjoint(value);
  return deepFreeze(structuredClone(value));
}

/**
 * Read, parse and validate a catalog file; the shipped catalog by default.
 *
 * @param {string} [path]
 * @returns {Readonly<object>}
 */
export function loadTypeInjectionCatalog(path = SHIPPED_TYPE_INJECTION_CATALOG) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`type-injection-catalog: cannot read ${path}: ${error.message}`);
  }
  return parseTypeInjectionCatalog(parsed);
}
