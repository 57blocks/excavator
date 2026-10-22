// Pure result mapping for extract-structure.mjs.
// Kept separate from the CLI entrypoint so unit tests do not import a shebang script.
const REQUIRED_STRUCTURE_ARRAY_FIELDS = [
  'functions',
  'classes',
  'imports',
  'exports',
];
const OPTIONAL_STRUCTURE_ARRAY_FIELDS = [
  'sections',
  'definitions',
  'services',
  'endpoints',
  'steps',
  'resources',
];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isFiniteInteger(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value);
}

function isLineRange(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every(isFiniteInteger);
}

function hasValidOptionalField(value, field, validator) {
  return value[field] === undefined || validator(value[field]);
}

function isValidEntryArray(value, validator) {
  return Array.isArray(value) &&
    value.every(entry => isPlainObject(entry) && validator(entry));
}

// Java type facts (openspec: changes/java-member-call-resolution). Optional:
// only the Java extractor emits them.
const JAVA_TYPE_KINDS = new Set(['class', 'interface', 'enum', 'record']);
const JAVA_SUPERTYPE_RELATIONS = new Set(['extends', 'implements']);

function isTypeParameterArray(value) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) &&
    typeof item.name === 'string' &&
    (item.bound === null || typeof item.bound === 'string'));
}

function isSupertypeArray(value) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) &&
    JAVA_SUPERTYPE_RELATIONS.has(item.relation) &&
    typeof item.type === 'string' &&
    isFiniteInteger(item.line));
}

function isFieldTypeArray(value) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) &&
    typeof item.name === 'string' &&
    typeof item.type === 'string');
}

// Java declaration facts (openspec: changes/dead-code-detection, D8). Access,
// modifier keywords and class-literal contexts are closed sets: an unknown
// value fails the file instead of reaching liveness analysis as a guess.
const JAVA_VISIBILITIES = new Set(['public', 'protected', 'package', 'private']);
const JAVA_METHOD_MODIFIERS = new Set(['static', 'final', 'native', 'default', 'synchronized', 'abstract']);
const JAVA_CLASS_LITERAL_CONTEXTS = new Set(['annotation', 'code']);

function isModifierArray(value) {
  return Array.isArray(value) && value.every(item => JAVA_METHOD_MODIFIERS.has(item));
}

// Facts for by-type injection (openspec: changes/by-type-injection, D3). The
// keywords a type declaration can carry and the kinds of nested type are
// closed sets: an unknown value fails the file instead of reaching candidate
// resolution as a guess.
const JAVA_TYPE_MODIFIERS = new Set([
  'public', 'protected', 'private', 'abstract', 'static', 'final', 'sealed', 'non-sealed', 'strictfp',
]);
const JAVA_NESTED_TYPE_KINDS = new Set(['class', 'interface', 'enum', 'record', 'annotation', 'anonymous']);

function isTypeModifierArray(value) {
  return Array.isArray(value) && value.every(item => JAVA_TYPE_MODIFIERS.has(item));
}

function isTypeAtLine(value) {
  return isPlainObject(value) && typeof value.type === 'string' && isFiniteInteger(value.line);
}

// A type below top level, or an anonymous class body. An anonymous class has
// no name, is local by definition and states the type it instantiates; every
// other kind has a name and no `instantiates`.
function isNestedTypeArray(value) {
  return Array.isArray(value) && value.every(item => {
    if (!isPlainObject(item) || !JAVA_NESTED_TYPE_KINDS.has(item.kind)) return false;
    const anonymous = item.kind === 'anonymous';
    return (anonymous ? item.name === null : typeof item.name === 'string') &&
      isFiniteInteger(item.line) &&
      typeof item.owner === 'string' &&
      typeof item.local === 'boolean' &&
      (!anonymous || item.local === true) &&
      isTypeModifierArray(item.modifiers) &&
      isSupertypeArray(item.supertypes) &&
      (anonymous ? isTypeAtLine(item.instantiates) : item.instantiates === undefined);
  });
}

// The class literals an annotation argument lists. The value of such an
// argument is never a string: a string value with class literals disagrees.
function isArgumentClassLiteralsValid(argument) {
  return hasValidOptionalField(argument, 'classLiterals', list => Array.isArray(list) && list.every(isTypeAtLine)) &&
    (argument.classLiterals === undefined || argument.value === null);
}

// A type's annotations with their arguments (openspec: changes/
// name-binding-references, D2): a value is the string a single string literal
// wrote, or null for any other way of writing it - never undefined.
function isAnnotationUseArray(value) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) &&
    typeof item.name === 'string' &&
    isFiniteInteger(item.line) &&
    Array.isArray(item.arguments) &&
    item.arguments.every(argument =>
      isPlainObject(argument) &&
      typeof argument.key === 'string' &&
      (argument.value === null || typeof argument.value === 'string') &&
      isArgumentClassLiteralsValid(argument)));
}

// Annotations on a Java type's members (openspec: changes/
// annotation-injection-references, D1). The member kinds are a closed set, and
// `parameter` is there for a parameter or component and nowhere else: a record
// that disagrees fails the file instead of reaching name resolution with a
// missing or stray position.
const JAVA_MEMBER_KINDS = new Set(['field', 'method', 'constructor', 'parameter', 'component']);

function isNameAtLine(value) {
  return isPlainObject(value) && typeof value.name === 'string' && isFiniteInteger(value.line);
}

function isMemberAnnotationArray(value) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) &&
    typeof item.name === 'string' &&
    isFiniteInteger(item.line) &&
    Array.isArray(item.arguments) &&
    item.arguments.every(argument =>
      isPlainObject(argument) &&
      typeof argument.key === 'string' &&
      (argument.value === null || typeof argument.value === 'string') &&
      isFiniteInteger(argument.line) &&
      isArgumentClassLiteralsValid(argument)) &&
    JAVA_MEMBER_KINDS.has(item.on) &&
    typeof item.owner === 'string' &&
    typeof item.nested === 'boolean' &&
    isNameAtLine(item.member) &&
    // A field's or method's declared type. A constructor and a record, the
    // member of its components' annotations, have none.
    hasValidOptionalField(item.member, 'type', value => typeof value === 'string') &&
    (item.on === 'constructor' || item.on === 'component' ? item.member.type === undefined : true) &&
    (item.on === 'parameter' || item.on === 'component'
      ? isNameAtLine(item.parameter) && isFiniteInteger(item.parameter.index) && item.parameter.index >= 0
      : item.parameter === undefined));
}

function isClassLiteralArray(value) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) &&
    typeof item.type === 'string' &&
    isFiniteInteger(item.line) &&
    JAVA_CLASS_LITERAL_CONTEXTS.has(item.context));
}

function isNamePairArray(value, keys) {
  return Array.isArray(value) && value.every(item =>
    isPlainObject(item) && keys.every(key => typeof item[key] === 'string'));
}

// TS/JS JSX elements: the tags that can name code, and a count of the rest.
function isJsxFacts(value) {
  return isPlainObject(value) &&
    isFiniteInteger(value.intrinsic) && value.intrinsic >= 0 &&
    Array.isArray(value.elements) &&
    value.elements.every(element =>
      isPlainObject(element) &&
      typeof element.name === 'string' &&
      isFiniteInteger(element.lineNumber) &&
      hasValidOptionalField(element, 'local', flag => flag === true) &&
      hasValidOptionalField(element, 'syntaxError', flag => flag === true));
}

const STRUCTURE_ENTRY_VALIDATORS = {
  functions: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.params) &&
    hasValidOptionalField(entry, 'paramTypes', isStringArray) &&
    hasValidOptionalField(entry, 'returnType', value => typeof value === 'string') &&
    hasValidOptionalField(entry, 'abstract', value => typeof value === 'boolean') &&
    hasValidOptionalField(entry, 'typeParameters', isTypeParameterArray) &&
    hasValidOptionalField(entry, 'visibility', value => JAVA_VISIBILITIES.has(value)) &&
    hasValidOptionalField(entry, 'modifiers', isModifierArray) &&
    hasValidOptionalField(entry, 'annotations', isStringArray),
  classes: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.methods) &&
    isStringArray(entry.properties) &&
    hasValidOptionalField(entry, 'kind', value => JAVA_TYPE_KINDS.has(value)) &&
    hasValidOptionalField(entry, 'qualifiedName', value => typeof value === 'string') &&
    hasValidOptionalField(entry, 'modifiers', isTypeModifierArray) &&
    hasValidOptionalField(entry, 'supertypes', isSupertypeArray) &&
    hasValidOptionalField(entry, 'fieldTypes', isFieldTypeArray) &&
    hasValidOptionalField(entry, 'annotations', isStringArray) &&
    hasValidOptionalField(entry, 'annotationArguments', isAnnotationUseArray) &&
    hasValidOptionalField(entry, 'typeParameters', isTypeParameterArray) &&
    hasValidOptionalField(entry, 'memberTypes', isStringArray),
  imports: entry =>
    typeof entry.source === 'string' &&
    isStringArray(entry.specifiers) &&
    isFiniteInteger(entry.lineNumber) &&
    hasValidOptionalField(entry, 'isStatic', value => typeof value === 'boolean') &&
    hasValidOptionalField(entry, 'bindings', value => isNamePairArray(value, ['local', 'imported'])) &&
    hasValidOptionalField(entry, 'reexports', value => isNamePairArray(value, ['exported', 'imported'])),
  exports: entry =>
    typeof entry.name === 'string' &&
    isFiniteInteger(entry.lineNumber) &&
    hasValidOptionalField(entry, 'isDefault', value => typeof value === 'boolean') &&
    hasValidOptionalField(entry, 'local', value => typeof value === 'string'),
  sections: entry =>
    typeof entry.name === 'string' &&
    isFiniteInteger(entry.level) &&
    isLineRange(entry.lineRange),
  definitions: entry =>
    typeof entry.name === 'string' &&
    typeof entry.kind === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.fields),
  services: entry =>
    typeof entry.name === 'string' &&
    hasValidOptionalField(entry, 'image', value => typeof value === 'string') &&
    Array.isArray(entry.ports) &&
    entry.ports.every(isFiniteInteger) &&
    hasValidOptionalField(entry, 'lineRange', isLineRange),
  endpoints: entry =>
    hasValidOptionalField(entry, 'method', value => typeof value === 'string') &&
    typeof entry.path === 'string' &&
    isLineRange(entry.lineRange),
  steps: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange),
  resources: entry =>
    typeof entry.name === 'string' &&
    typeof entry.kind === 'string' &&
    isLineRange(entry.lineRange),
};

function isValidStructuralAnalysis(analysis) {
  if (!isPlainObject(analysis)) {
    return false;
  }

  return REQUIRED_STRUCTURE_ARRAY_FIELDS.every(field =>
    isValidEntryArray(analysis[field], STRUCTURE_ENTRY_VALIDATORS[field])) &&
    OPTIONAL_STRUCTURE_ARRAY_FIELDS.every(field =>
      hasValidOptionalField(
        analysis,
        field,
        value => isValidEntryArray(value, STRUCTURE_ENTRY_VALIDATORS[field]),
      )) &&
    // Not a symbol array: class literals reference types, they declare none.
    hasValidOptionalField(analysis, 'classLiterals', isClassLiteralArray) &&
    hasValidOptionalField(analysis, 'memberAnnotations', isMemberAnnotationArray) &&
    // Not a symbol array either: nested types are declarations below a class
    // the file already lists.
    hasValidOptionalField(analysis, 'nestedTypes', isNestedTypeArray) &&
    hasValidOptionalField(analysis, 'jsx', isJsxFacts);
}

// What a Java call site is invoked on (java-member-call-resolution, D2). The
// kinds and their fields are closed: an unknown shape fails the file rather
// than reaching the fact graph as something it would have to guess about.
const RECEIVER_VALIDATORS = {
  none: () => true,
  this: () => true,
  super: () => true,
  unknown: () => true,
  local: r => r.type === null || typeof r.type === 'string',
  name: r => typeof r.name === 'string',
  field: r => typeof r.name === 'string' && isValidReceiver(r.object),
  call: r => isFiniteInteger(r.site) && r.site >= 0,
  new: r => typeof r.type === 'string',
  type: r => typeof r.type === 'string',
  construct: r => typeof r.type === 'string',
};

function isValidReceiver(receiver) {
  return isPlainObject(receiver) &&
    Object.hasOwn(RECEIVER_VALIDATORS, receiver.kind) &&
    RECEIVER_VALIDATORS[receiver.kind](receiver);
}

function isValidCallGraph(callGraph) {
  return Array.isArray(callGraph) && callGraph.every(entry =>
    isPlainObject(entry) &&
    typeof entry.caller === 'string' &&
    typeof entry.callee === 'string' &&
    isFiniteInteger(entry.lineNumber) &&
    hasValidOptionalField(entry, 'local', value => value === true) &&
    hasValidOptionalField(entry, 'receiver', isValidReceiver) &&
    // null: a method reference, which does not write its arguments
    // (dead-code-detection, D8).
    hasValidOptionalField(entry, 'argCount', value => value === null || (isFiniteInteger(value) && value >= 0)) &&
    hasValidOptionalField(entry, 'enclosingType', value => value === null || typeof value === 'string'));
}

function mapCallGraph(callGraph) {
  return callGraph && callGraph.length > 0
    ? callGraph.map(entry => ({
        caller: entry.caller,
        callee: entry.callee,
        lineNumber: entry.lineNumber,
        // TS/JS only: the callee's root is a parameter or local of an
        // enclosing function, which the fact graph must not resolve by name.
        ...(entry.local === undefined ? {} : { local: entry.local }),
        // Java only: the receiver, argument count and enclosing type the fact
        // graph resolves member calls with.
        ...(entry.receiver === undefined ? {} : { receiver: entry.receiver }),
        ...(entry.argCount === undefined ? {} : { argCount: entry.argCount }),
        ...(entry.enclosingType === undefined ? {} : { enclosingType: entry.enclosingType }),
      }))
    : null;
}

export function analyzeFileWithOutcomes(registry, file, content) {
  const wantsCallGraph =
    file.fileCategory === 'code' || file.fileCategory === 'script';
  const selectedPlugin = typeof registry.getPluginForFile === 'function'
    ? registry.getPluginForFile(file.path)
    : registry;

  if (selectedPlugin === null) {
    return {
      analysis: null,
      callGraph: null,
      structureOutcome: 'skipped',
      callGraphOutcome: 'skipped',
    };
  }

  const supportsFullAnalysis =
    typeof selectedPlugin?.analyzeFileFull === 'function';
  const supportsSeparateCallGraph =
    typeof selectedPlugin?.extractCallGraph === 'function';

  if (wantsCallGraph && supportsFullAnalysis) {
    let full;
    try {
      full = registry.analyzeFileFull(file.path, content);
    } catch {
      return {
        analysis: null,
        callGraph: null,
        structureOutcome: 'failed',
        callGraphOutcome: wantsCallGraph ? 'failed' : 'skipped',
      };
    }

    const analysis = isValidStructuralAnalysis(full?.structure)
      ? full.structure
      : null;
    const hasValidCallGraph = wantsCallGraph && isValidCallGraph(full?.callGraph);
    const callGraph = hasValidCallGraph ? mapCallGraph(full.callGraph) : null;

    return {
      analysis,
      callGraph,
      structureOutcome: analysis === null ? 'failed' : 'succeeded',
      callGraphOutcome: wantsCallGraph
        ? hasValidCallGraph ? 'succeeded' : 'failed'
        : 'skipped',
    };
  }

  let analysis = null;
  let callGraph = null;
  let structureOutcome = 'failed';
  let callGraphOutcome = wantsCallGraph && supportsSeparateCallGraph
    ? 'failed'
    : 'skipped';

  try {
    const extractedAnalysis = registry.analyzeFile(file.path, content);
    if (isValidStructuralAnalysis(extractedAnalysis)) {
      analysis = extractedAnalysis;
      structureOutcome = 'succeeded';
    }
  } catch {
    analysis = null;
    structureOutcome = 'failed';
  }

  if (wantsCallGraph && supportsSeparateCallGraph) {
    try {
      const extractedCallGraph = registry.extractCallGraph(file.path, content);
      if (isValidCallGraph(extractedCallGraph)) {
        callGraph = mapCallGraph(extractedCallGraph);
        callGraphOutcome = 'succeeded';
      }
    } catch {
      callGraph = null;
      callGraphOutcome = 'failed';
    }
  }

  return { analysis, callGraph, structureOutcome, callGraphOutcome };
}

/**
 * Every declaration array an extractor can fill. A file whose extractor ran
 * and filled none of them is `zero-symbol` — a real, reportable outcome, not
 * a failure and not an absence.
 */
const SYMBOL_ARRAY_FIELDS = [
  ...REQUIRED_STRUCTURE_ARRAY_FIELDS,
  ...OPTIONAL_STRUCTURE_ARRAY_FIELDS,
];

/** Outcomes `analyzeFileWithOutcomes` (plus the caller's read step) can report. */
export const EXTRACTION_OUTCOMES = Object.freeze([
  'succeeded',
  'failed',
  'skipped',
  'read-failed',
]);

/**
 * Map one extraction outcome onto the per-file status the coverage ledger
 * consumes. Fail-closed: an unknown or missing outcome throws instead of
 * defaulting, because a silently defaulted status is exactly the invisible
 * bucket this ledger exists to remove.
 */
export function deriveStatus(analysis, outcome) {
  if (!EXTRACTION_OUTCOMES.includes(outcome)) {
    throw new Error(
      `buildResult: outcome must be one of ${EXTRACTION_OUTCOMES.join('|')}, got ${JSON.stringify(outcome)}`,
    );
  }
  if (outcome === 'skipped') return { status: 'no-extractor' };
  if (outcome === 'read-failed') {
    return { status: 'parse-failed', statusReason: 'read-failed' };
  }
  if (outcome === 'failed' || !analysis) {
    return { status: 'parse-failed', statusReason: 'extractor-error-or-invalid-output' };
  }
  const symbols = SYMBOL_ARRAY_FIELDS.reduce(
    (sum, field) => sum + (Array.isArray(analysis[field]) ? analysis[field].length : 0),
    0,
  );
  return { status: symbols > 0 ? 'parsed' : 'zero-symbol' };
}

/** Java type facts a class entry carries through to the structure row. */
const JAVA_TYPE_FACT_FIELDS = Object.freeze([
  'kind', 'qualifiedName', 'modifiers', 'supertypes', 'fieldTypes', 'annotations', 'annotationArguments', 'typeParameters', 'memberTypes',
]);

/** Java declaration facts a method or constructor entry carries through. */
const JAVA_MEMBER_FACT_FIELDS = Object.freeze(['visibility', 'modifiers', 'annotations']);

function classLiteralsOf(argument) {
  return argument.classLiterals.map(literal => ({ type: literal.type, line: literal.line }));
}

function pickDefined(source, fields) {
  const out = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

export function buildResult(file, totalLines, nonEmptyLines, analysis, callGraph, batchImportData, outcome) {
  const { status, statusReason } = deriveStatus(analysis, outcome);
  const base = {
    path: file.path,
    language: file.language,
    fileCategory: file.fileCategory,
    totalLines,
    nonEmptyLines,
    status,
    ...(statusReason ? { statusReason } : {}),
  };

  if (!analysis) {
    base.metrics = {};
    return base;
  }

  if (analysis.functions && analysis.functions.length > 0) {
    base.functions = analysis.functions.map(fn => ({
      name: fn.name,
      // Additive: the declaring scope the extractor already computed (Go
      // receiver, Rust impl type, C++ qualifier). It was being dropped here,
      // so nothing downstream could tell two same-named methods apart.
      ...(fn.owner === undefined ? {} : { owner: fn.owner }),
      startLine: fn.lineRange[0],
      endLine: fn.lineRange[1],
      params: fn.params || [],
      // Parameter types, from extractors whose language overloads by type
      // (Java); node identity uses them in place of the parameter names.
      ...(Array.isArray(fn.paramTypes) ? { paramTypes: fn.paramTypes } : {}),
      // Java facts for member-call resolution. The return type travels as
      // `declaredReturnType`, never `returnType`: node identity and the source
      // index read `returnType`, so carrying it would rename every Java node.
      ...(file.language === 'java' && typeof fn.returnType === 'string'
        ? { declaredReturnType: fn.returnType }
        : {}),
      ...(fn.abstract === true ? { abstract: true } : {}),
      ...(fn.typeParameters === undefined ? {} : { typeParameters: fn.typeParameters }),
      // Java declaration facts for liveness analysis; never node identity.
      ...pickDefined(fn, JAVA_MEMBER_FACT_FIELDS),
    }));
  }

  if (analysis.classes && analysis.classes.length > 0) {
    base.classes = analysis.classes.map(cls => ({
      name: cls.name,
      startLine: cls.lineRange[0],
      endLine: cls.lineRange[1],
      methods: cls.methods || [],
      properties: cls.properties || [],
      ...pickDefined(cls, JAVA_TYPE_FACT_FIELDS),
    }));
  }

  if (analysis.imports && analysis.imports.length > 0) {
    base.imports = analysis.imports.map(imp => ({
      source: imp.source,
      specifiers: imp.specifiers || [],
      line: imp.lineNumber,
      ...(imp.isStatic === true ? { static: true } : {}),
      // TS/JS: what each local name imports, and what a re-export forwards.
      ...(Array.isArray(imp.bindings)
        ? { bindings: imp.bindings.map(binding => ({ local: binding.local, imported: binding.imported })) }
        : {}),
      ...(Array.isArray(imp.reexports)
        ? { reexports: imp.reexports.map(binding => ({ exported: binding.exported, imported: binding.imported })) }
        : {}),
    }));
  }

  if (analysis.exports && analysis.exports.length > 0) {
    base.exports = analysis.exports.map(exp => ({
      name: exp.name,
      line: exp.lineNumber,
      isDefault: exp.isDefault === true,
      ...(typeof exp.local === 'string' ? { local: exp.local } : {}),
    }));
  }

  // TS/JS: JSX elements whose tag can name code, and the intrinsic count.
  if (analysis.jsx !== undefined) {
    base.jsx = {
      elements: analysis.jsx.elements.map(element => ({
        name: element.name,
        line: element.lineNumber,
        ...(element.local === true ? { local: true } : {}),
        ...(element.syntaxError === true ? { syntaxError: true } : {}),
      })),
      intrinsic: analysis.jsx.intrinsic,
    };
  }

  if (analysis.sections && analysis.sections.length > 0) {
    base.sections = analysis.sections.map(s => ({
      heading: s.name,
      level: s.level,
      line: s.lineRange[0],
    }));
  }

  if (analysis.definitions && analysis.definitions.length > 0) {
    base.definitions = analysis.definitions.map(d => ({
      name: d.name,
      kind: d.kind,
      fields: d.fields || [],
      startLine: d.lineRange[0],
      endLine: d.lineRange[1],
    }));
  }

  if (analysis.services && analysis.services.length > 0) {
    base.services = analysis.services.map(s => ({
      name: s.name,
      image: s.image,
      ports: s.ports || [],
      ...(s.lineRange ? { startLine: s.lineRange[0], endLine: s.lineRange[1] } : {}),
    }));
  }

  if (analysis.endpoints && analysis.endpoints.length > 0) {
    base.endpoints = analysis.endpoints.map(e => ({
      method: e.method,
      path: e.path,
      startLine: e.lineRange[0],
      endLine: e.lineRange[1],
    }));
  }

  if (analysis.steps && analysis.steps.length > 0) {
    base.steps = analysis.steps.map(s => ({
      name: s.name,
      startLine: s.lineRange[0],
      endLine: s.lineRange[1],
    }));
  }

  if (analysis.resources && analysis.resources.length > 0) {
    base.resources = analysis.resources.map(r => ({
      name: r.name,
      kind: r.kind,
      startLine: r.lineRange[0],
      endLine: r.lineRange[1],
    }));
  }

  // Java: every class literal of the file, an empty list included, so "none
  // in this file" is told apart from "not extracted".
  if (Array.isArray(analysis.classLiterals)) {
    base.classLiterals = analysis.classLiterals.map(literal => ({
      type: literal.type,
      line: literal.line,
      context: literal.context,
    }));
  }

  // Java: the annotations on every field, method, constructor, parameter and
  // record component, an empty list included, for the same reason.
  if (Array.isArray(analysis.memberAnnotations)) {
    base.memberAnnotations = analysis.memberAnnotations.map(use => ({
      name: use.name,
      line: use.line,
      arguments: use.arguments.map(argument => ({
        key: argument.key,
        value: argument.value,
        line: argument.line,
        ...(argument.classLiterals === undefined ? {} : { classLiterals: classLiteralsOf(argument) }),
      })),
      on: use.on,
      owner: use.owner,
      nested: use.nested,
      member: {
        name: use.member.name,
        line: use.member.line,
        ...(use.member.type === undefined ? {} : { type: use.member.type }),
      },
      ...(use.parameter === undefined
        ? {}
        : { parameter: { name: use.parameter.name, index: use.parameter.index, line: use.parameter.line } }),
    }));
  }

  // Java: every type declared below top level and every anonymous class body,
  // an empty list included, for the same reason.
  if (Array.isArray(analysis.nestedTypes)) {
    base.nestedTypes = analysis.nestedTypes.map(nested => ({
      kind: nested.kind,
      name: nested.name,
      line: nested.line,
      owner: nested.owner,
      local: nested.local,
      modifiers: [...nested.modifiers],
      supertypes: nested.supertypes.map(supertype => ({ relation: supertype.relation, type: supertype.type, line: supertype.line })),
      ...(nested.instantiates === undefined
        ? {}
        : { instantiates: { type: nested.instantiates.type, line: nested.instantiates.line } }),
    }));
  }

  if (callGraph && callGraph.length > 0) {
    base.callGraph = callGraph;
  }

  const metrics = {};

  const importPaths = batchImportData?.[file.path];
  if (importPaths && importPaths.length > 0) {
    metrics.importCount = importPaths.length;
  } else if (analysis.imports) {
    const internal = analysis.imports.filter(imp => {
      const src = imp?.source ?? '';
      return src.startsWith('.');
    });
    metrics.importCount = internal.length;
  }

  if (analysis.exports) {
    metrics.exportCount = analysis.exports.length;
  }
  if (analysis.functions) {
    metrics.functionCount = analysis.functions.length;
  }
  if (analysis.classes) {
    metrics.classCount = analysis.classes.length;
  }
  if (analysis.sections) {
    metrics.sectionCount = analysis.sections.length;
  }
  if (analysis.definitions) {
    metrics.definitionCount = analysis.definitions.length;
  }
  if (analysis.services) {
    metrics.serviceCount = analysis.services.length;
  }
  if (analysis.endpoints) {
    metrics.endpointCount = analysis.endpoints.length;
  }
  if (analysis.steps) {
    metrics.stepCount = analysis.steps.length;
  }
  if (analysis.resources) {
    metrics.resourceCount = analysis.resources.length;
  }

  base.metrics = metrics;

  return base;
}
