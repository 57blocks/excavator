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

const STRUCTURE_ENTRY_VALIDATORS = {
  functions: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.params) &&
    hasValidOptionalField(entry, 'returnType', value => typeof value === 'string'),
  classes: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.methods) &&
    isStringArray(entry.properties),
  imports: entry =>
    typeof entry.source === 'string' &&
    isStringArray(entry.specifiers) &&
    isFiniteInteger(entry.lineNumber),
  exports: entry =>
    typeof entry.name === 'string' &&
    isFiniteInteger(entry.lineNumber) &&
    hasValidOptionalField(entry, 'isDefault', value => typeof value === 'boolean'),
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
      ));
}

function isValidCallGraph(callGraph) {
  return Array.isArray(callGraph) && callGraph.every(entry =>
    isPlainObject(entry) &&
    typeof entry.caller === 'string' &&
    typeof entry.callee === 'string' &&
    isFiniteInteger(entry.lineNumber));
}

function mapCallGraph(callGraph) {
  return callGraph && callGraph.length > 0
    ? callGraph.map(entry => ({
        caller: entry.caller,
        callee: entry.callee,
        lineNumber: entry.lineNumber,
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
      startLine: fn.lineRange[0],
      endLine: fn.lineRange[1],
      params: fn.params || [],
    }));
  }

  if (analysis.classes && analysis.classes.length > 0) {
    base.classes = analysis.classes.map(cls => ({
      name: cls.name,
      startLine: cls.lineRange[0],
      endLine: cls.lineRange[1],
      methods: cls.methods || [],
      properties: cls.properties || [],
    }));
  }

  if (analysis.imports && analysis.imports.length > 0) {
    base.imports = analysis.imports.map(imp => ({
      source: imp.source,
      specifiers: imp.specifiers || [],
      line: imp.lineNumber,
    }));
  }

  if (analysis.exports && analysis.exports.length > 0) {
    base.exports = analysis.exports.map(exp => ({
      name: exp.name,
      line: exp.lineNumber,
      isDefault: exp.isDefault === true,
    }));
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
