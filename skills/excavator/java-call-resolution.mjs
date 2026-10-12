/**
 * java-call-resolution.mjs
 *
 * Resolves Java call sites by the declared type of their receiver (openspec:
 * changes/java-member-call-resolution, capability `fact-graph`, design
 * D3–D9). Pure: it reads structure-all rows only — the type facts and call
 * receivers the Java extractor recorded — and never re-reads source.
 *
 * Every call site gets exactly one outcome:
 *   - `edge`: caller and target are each one declaration; the target is the
 *     declaration the receiver's static type selects, which may be an
 *     interface or abstract method;
 *   - `calls-external`: the target type is provably outside the repository;
 *   - `calls-generated`: the target is a method the source does not declare
 *     (accessor of a declared field, Lombok builder or constructor, implicit
 *     default or record constructor, enum `values` / `valueOf`);
 *   - `calls-ambiguous`: more than one candidate;
 *   - `calls-unresolved`: the receiver type, the type or the method cannot be
 *     determined;
 *   - `calls-caller-unresolved`: the calling declaration cannot be.
 *
 * What is never done, because it would be a guess: instantiating generics
 * (a type variable from another declaration is unknown), choosing among
 * same-arity overloads, inferring lambda parameter types, or resolving inside
 * anonymous, local or nested types.
 *
 * A method reference (`X::m`, `X::new`) is a site with `argCount: null`
 * (openspec: changes/dead-code-detection, design D8): it applies to a
 * declaration of any arity, so one candidate of that name is an edge and
 * more are ambiguous — including a method or constructor the source does not
 * declare but that exists at another arity (an `Object` method, a generated
 * accessor or constructor). An array constructor `T[]::new` is external.
 *
 * Report mode (design D13) adds what a caller of the resolver needs to
 * reason past a bucket — the receiver type, the candidates of an ambiguous
 * call when they are known, the target of a call whose caller is not — and
 * never changes an outcome.
 */

/** Every outcome a Java call site can have. */
export const JAVA_CALL_OUTCOMES = Object.freeze([
  'edge',
  'calls-external',
  'calls-generated',
  'calls-ambiguous',
  'calls-unresolved',
  'calls-caller-unresolved',
]);

const EXTERNAL = 'calls-external';
const GENERATED = 'calls-generated';
const AMBIGUOUS = 'calls-ambiguous';
const UNRESOLVED = 'calls-unresolved';
const CALLER_UNRESOLVED = 'calls-caller-unresolved';

/**
 * Fail-closed check that every call site landed in exactly one outcome.
 *
 * @param {number} siteCount
 * @param {Record<string, number>} tally outcome -> count
 */
export function assertCallConservation(siteCount, tally) {
  let total = 0;
  for (const [outcome, count] of Object.entries(tally)) {
    if (!JAVA_CALL_OUTCOMES.includes(outcome)) {
      throw new Error(`java-call-resolution: call site outcome outside the known set: ${JSON.stringify(outcome)}`);
    }
    total += count;
  }
  if (total !== siteCount) {
    throw new Error(`java-call-resolution: ${siteCount} Java call site(s) but ${total} outcome(s)`);
  }
}

// The public types of java.lang, implicitly imported by every file (D3).
const JAVA_LANG = new Set([
  'AbstractMethodError', 'Appendable', 'ArithmeticException', 'ArrayIndexOutOfBoundsException',
  'ArrayStoreException', 'AssertionError', 'AutoCloseable', 'Boolean', 'BootstrapMethodError', 'Byte',
  'Character', 'CharSequence', 'Class', 'ClassCastException', 'ClassCircularityError', 'ClassFormatError',
  'ClassLoader', 'ClassNotFoundException', 'ClassValue', 'CloneNotSupportedException', 'Cloneable',
  'Comparable', 'Deprecated', 'Double', 'Enum', 'EnumConstantNotPresentException', 'Error', 'Exception',
  'ExceptionInInitializerError', 'Float', 'FunctionalInterface', 'IllegalAccessError',
  'IllegalAccessException', 'IllegalArgumentException', 'IllegalCallerException',
  'IllegalMonitorStateException', 'IllegalStateException', 'IllegalThreadStateException',
  'IncompatibleClassChangeError', 'IndexOutOfBoundsException', 'InheritableThreadLocal',
  'InstantiationError', 'InstantiationException', 'Integer', 'InternalError', 'InterruptedException',
  'Iterable', 'LayerInstantiationException', 'LinkageError', 'Long', 'MatchException', 'Math', 'Module',
  'ModuleLayer', 'NegativeArraySizeException', 'NoClassDefFoundError', 'NoSuchFieldError',
  'NoSuchFieldException', 'NoSuchMethodError', 'NoSuchMethodException', 'NullPointerException', 'Number',
  'NumberFormatException', 'Object', 'OutOfMemoryError', 'Override', 'Package', 'Process',
  'ProcessBuilder', 'ProcessHandle', 'Readable', 'Record', 'ReflectiveOperationException', 'Runnable',
  'Runtime', 'RuntimeException', 'RuntimePermission', 'SafeVarargs', 'ScopedValue', 'SecurityException',
  'SecurityManager', 'Short', 'StackOverflowError', 'StackTraceElement', 'StackWalker', 'StrictMath',
  'String', 'StringBuffer', 'StringBuilder', 'StringIndexOutOfBoundsException', 'StringTemplate',
  'SuppressWarnings', 'System', 'Thread', 'ThreadDeath', 'ThreadGroup', 'ThreadLocal', 'Throwable',
  'TypeNotPresentException', 'UnknownError', 'UnsatisfiedLinkError', 'UnsupportedClassVersionError',
  'UnsupportedOperationException', 'VerifyError', 'VirtualMachineError', 'Void', 'WrongThreadException',
]);

const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void']);

// java.lang.Object's methods, by name, with the argument counts they take.
const OBJECT_METHODS = new Map([
  ['equals', [1]], ['hashCode', [0]], ['toString', [0]], ['getClass', [0]],
  ['notify', [0]], ['notifyAll', [0]], ['wait', [0, 1, 2]], ['clone', [0]], ['finalize', [0]],
]);

const BUILDER_ANNOTATIONS = new Set(['Builder', 'SuperBuilder']);
const CONSTRUCTOR_ANNOTATIONS = new Set([
  'NoArgsConstructor', 'AllArgsConstructor', 'RequiredArgsConstructor', 'Data', 'Value', 'Builder', 'SuperBuilder',
]);

/** `argCount` null (a method reference) matches every arity. */
function arityMatches(argCount, arity) {
  return argCount === null || argCount === arity;
}

function isObjectMethod(name, argCount) {
  const arities = OBJECT_METHODS.get(name);
  if (!arities) return false;
  return argCount === null || arities.includes(argCount);
}

function capitalize(name) {
  return name.length > 0 ? name[0].toUpperCase() + name.slice(1) : name;
}

function lastSegment(dotted) {
  const i = dotted.lastIndexOf('.');
  return i < 0 ? dotted : dotted.slice(i + 1);
}

// Names as the fact graph compares them (dead-code-detection, "Java type
// hierarchy edges"). A name with anything else in it — whitespace or a
// comment an older extractor kept from a name wrapped across lines — cannot
// be read: it resolves to nothing known and never to a different type.
const IDENTIFIER = String.raw`[\p{ID_Start}_$][\p{ID_Continue}$]*`;
const IDENTIFIER_PATTERN = new RegExp(`^${IDENTIFIER}$`, 'u');
const DOTTED_NAME_PATTERN = new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER})*$`, 'u');
const ERASED_KEY_PATTERN = new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER})*(?:\\[\\])*$`, 'u');

function isIdentifier(text) {
  return IDENTIFIER_PATTERN.test(text);
}

/** A well-formed dotted Java name: identifiers joined by `.`, nothing else. */
function isDottedName(text) {
  return typeof text === 'string' && DOTTED_NAME_PATTERN.test(text);
}

/** A package name as the fact graph can compare it: the default package or a dotted name. */
function isPackageName(pkg) {
  return pkg === '' || isDottedName(pkg);
}

/**
 * A type as written, reduced to its name: annotations and type arguments
 * removed, array dimensions and varargs counted.
 * @returns {{ base: string, dims: number }}
 */
export function stripTypeText(text) {
  let t = String(text).replace(/@[\w.$]+(\s*\([^()]*\))?/g, ' ');
  while (/<[^<>]*>/.test(t)) t = t.replace(/<[^<>]*>/g, '');
  let dims = 0;
  t = t.replace(/\.\.\./g, () => { dims += 1; return ''; });
  t = t.replace(/\[\s*\]/g, () => { dims += 1; return ''; });
  return { base: t.replace(/\s+/g, ''), dims };
}

/** A parameter type as a signature-key token: simple name plus dimensions. */
function signatureToken(text) {
  const { base, dims } = stripTypeText(text);
  return `${lastSegment(base)}${'[]'.repeat(dims)}`;
}

/** Argument counts a method accepts: exactly its arity, or more with varargs; any for a method reference. */
function applicable(method, argCount) {
  if (argCount === null) return true;
  const n = method.paramTypes.length;
  if (method.varargs) return argCount >= n - 1;
  return argCount === n;
}

// Resolution results. `isStatic` marks a reference to the type itself
// (`Type.m()`), as opposed to an instance of it.
const R_UNKNOWN = Object.freeze({ status: 'unknown' });
const R_AMBIGUOUS = Object.freeze({ status: 'ambiguous' });
const R_EXTERNAL = Object.freeze({ status: 'external', isStatic: false });
const R_EXTERNAL_STATIC = Object.freeze({ status: 'external', isStatic: true });
const R_ARRAY = Object.freeze({ status: 'array' });
const R_PRIMITIVE = Object.freeze({ status: 'primitive' });

function repoRef(type, isStatic) {
  return { status: 'repo', type, isStatic };
}

/**
 * Ambiguous among resolution results. When every alternative is a repository
 * type (or several), `types` lists them, so report mode can name the
 * candidates (D13); anything unknown among them leaves the set unknown.
 */
function ambiguousAmong(results) {
  const types = [];
  for (const res of results) {
    if (res.status === 'repo') types.push(res.type);
    else if (res.status === 'ambiguous' && res.types) types.push(...res.types);
    else return R_AMBIGUOUS;
  }
  return { status: 'ambiguous', types: [...new Set(types)] };
}

function asInstance(res) {
  if (res.status === 'repo') return res.isStatic ? repoRef(res.type, false) : res;
  if (res.status === 'external') return R_EXTERNAL;
  return res;
}

/**
 * Build a resolver over a set of Java structure rows.
 *
 * @param {{
 *   rows: object[],
 *   functionIds: Map<string, (string|null)[]>,
 *   classIds?: Map<string, (string|null)[]>,
 *   otherJvmRows?: object[],
 * }} args `functionIds` / `classIds` map a row's path to the node ids of its
 *   `functions` / `classes` entries, index for index; null marks an id shared
 *   with another declaration, which is never an edge endpoint. `otherJvmRows`
 *   are the structure rows of the repository's Kotlin and Scala sources.
 */
export function createJavaCallResolver({ rows, functionIds, classIds = new Map(), otherJvmRows = [] }) {
  /** fqn -> TypeInfo[] (more than one when two files declare the same name) */
  const typesByFqn = new Map();
  const packages = new Set();
  const contextByPath = new Map();
  /** path -> simple name -> TypeInfo, for the types a file declares */
  const typesByPath = new Map();

  // Java code can use the types of the repository's Kotlin and Scala sources,
  // which this resolver does not read: by directory, the type names declared
  // there. A type or package found there is in the repository, not outside.
  const otherJvmNamesByDir = new Map();
  for (const row of otherJvmRows) {
    const slash = row.path.lastIndexOf('/');
    const dir = slash < 0 ? '' : row.path.slice(0, slash);
    if (!otherJvmNamesByDir.has(dir)) otherJvmNamesByDir.set(dir, new Set());
    const names = otherJvmNamesByDir.get(dir);
    const file = row.path.slice(slash + 1).replace(/\.[^.]+$/, '');
    names.add(file);
    names.add(`${file}Kt`); // the class Kotlin compiles a file's top-level declarations into
    for (const cls of row.classes ?? []) if (typeof cls.name === 'string') names.add(cls.name);
  }

  for (const row of rows) {
    const ctx = fileContext(row);
    contextByPath.set(row.path, ctx);
    const ids = functionIds.get(row.path) ?? [];
    const methodsByOwner = new Map();
    (row.functions ?? []).forEach((fn, index) => {
      if (!fn.owner) return;
      if (!methodsByOwner.has(fn.owner)) methodsByOwner.set(fn.owner, []);
      methodsByOwner.get(fn.owner).push({ fn, id: ids[index] });
    });
    const typeIds = classIds.get(row.path) ?? [];
    (row.classes ?? []).forEach((cls, classIndex) => {
      if (typeof cls.qualifiedName !== 'string' || typeof cls.kind !== 'string') return;
      const type = {
        id: typeIds[classIndex] ?? null,
        fqn: cls.qualifiedName,
        name: cls.name,
        kind: cls.kind,
        path: row.path,
        ctx,
        cls,
        fields: new Map((cls.fieldTypes ?? []).map((f) => [f.name, f.type])),
        annotations: new Set((cls.annotations ?? []).map(lastSegment)),
        typeParams: new Map((cls.typeParameters ?? []).map((p) => [p.name, p.bound])),
        memberTypes: new Set(cls.memberTypes ?? []),
        methodsByName: new Map(),
        constructors: [],
      };
      for (const { fn, id } of methodsByOwner.get(cls.name) ?? []) {
        const paramTypes = fn.paramTypes ?? [];
        const method = {
          id,
          name: fn.name,
          paramTypes,
          varargs: paramTypes.length > 0 && paramTypes[paramTypes.length - 1].endsWith('...'),
          abstract: fn.abstract === true,
          // Null when the row predates these facts: then nothing is known,
          // which is never read as `static` or `private`.
          visibility: typeof fn.visibility === 'string' ? fn.visibility : null,
          modifiers: Array.isArray(fn.modifiers) ? fn.modifiers : null,
          declaredReturnType: fn.declaredReturnType,
          typeParams: new Map((fn.typeParameters ?? []).map((p) => [p.name, p.bound])),
          lineRange: [fn.startLine, fn.endLine],
          owner: type,
        };
        method.signature = paramTypes.map(signatureToken).join(',');
        if (fn.name === cls.name && fn.declaredReturnType === undefined) {
          type.constructors.push(method);
        } else {
          if (!type.methodsByName.has(fn.name)) type.methodsByName.set(fn.name, []);
          type.methodsByName.get(fn.name).push(method);
        }
      }
      if (!typesByFqn.has(type.fqn)) typesByFqn.set(type.fqn, []);
      typesByFqn.get(type.fqn).push(type);
      if (!typesByPath.has(row.path)) typesByPath.set(row.path, new Map());
      typesByPath.get(row.path).set(type.name, type);
      if (ctx.pkg) packages.add(ctx.pkg);
    });
  }

  function fileContext(row) {
    const first = (row.classes ?? []).find((c) => typeof c.qualifiedName === 'string');
    const pkg = first && first.qualifiedName.endsWith(`.${first.name}`)
      ? first.qualifiedName.slice(0, -(first.name.length + 1))
      : '';
    const singleImports = new Map();
    const onDemand = [];
    const staticSingle = new Map();
    const staticOnDemand = [];
    // A malformed package or import (whitespace or a comment inside the name,
    // as an older extractor wrote a wrapped one) hides what the file's simple
    // type names refer to: names no well-formed single import binds are then
    // unknown (`opaque`). A malformed name itself resolves to unknown.
    let opaque = !isPackageName(pkg);
    for (const imp of row.imports ?? []) {
      const star = imp.specifiers?.length === 1 && imp.specifiers[0] === '*';
      const wellFormed = isDottedName(imp.source);
      if (imp.static === true) {
        if (star) {
          staticOnDemand.push(imp.source);
        } else {
          const i = imp.source.lastIndexOf('.');
          if (i < 0) continue;
          const member = wellFormed ? imp.source.slice(i + 1) : imp.source.slice(i + 1).trim();
          if (!wellFormed && !isIdentifier(member)) {
            // Which member it imports is unknown: it may bring in any name.
            staticOnDemand.push(imp.source);
            continue;
          }
          if (!staticSingle.has(member)) staticSingle.set(member, []);
          staticSingle.get(member).push(imp.source.slice(0, i));
        }
      } else if (star) {
        onDemand.push(imp.source);
        if (!wellFormed) opaque = true;
      } else if (wellFormed) {
        singleImports.set(lastSegment(imp.source), imp.source);
      } else {
        const name = lastSegment(imp.source).trim();
        if (isIdentifier(name)) singleImports.set(name, imp.source);
        else opaque = true;
      }
    }
    // The directory the package path starts in: types declared under the
    // same source root are what this file is compiled against first.
    const dir = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
    const pkgDir = pkg.replace(/\./g, '/');
    const sourceRoot = pkgDir && (dir === pkgDir || dir.endsWith(`/${pkgDir}`))
      ? dir.slice(0, dir.length - pkgDir.length)
      : dir;
    return { row, path: row.path, pkg, singleImports, onDemand, staticSingle, staticOnDemand, sourceRoot, opaque };
  }

  // ---------------------------------------------------------------------------
  // Type names (D3)
  // ---------------------------------------------------------------------------

  /** A repository type by fully qualified name, preferring the caller's own source root. */
  function lookupFqn(fqn, ctx) {
    const hits = typesByFqn.get(fqn);
    if (!hits) return null;
    if (hits.length === 1) return repoRef(hits[0], true);
    const local = hits.filter((t) => t.ctx.sourceRoot === ctx.sourceRoot);
    return local.length === 1 ? repoRef(local[0], true) : ambiguousAmong(hits.map((t) => repoRef(t, true)));
  }

  const otherJvmDirsByPackage = new Map();
  /** Directories of Kotlin and Scala sources laid out in the package's path. */
  function otherJvmDirs(pkg) {
    let dirs = otherJvmDirsByPackage.get(pkg);
    if (dirs) return dirs;
    const pkgDir = pkg.replace(/\./g, '/');
    dirs = !pkgDir ? [] : [...otherJvmNamesByDir.keys()].filter((d) => d === pkgDir || d.endsWith(`/${pkgDir}`));
    otherJvmDirsByPackage.set(pkg, dirs);
    return dirs;
  }

  /** A type the repository's Kotlin or Scala sources declare in package `pkg`. */
  function isOtherJvmType(pkg, name) {
    return otherJvmDirs(pkg).some((d) => otherJvmNamesByDir.get(d).has(name));
  }

  function isRepoType(fqn) {
    if (typesByFqn.has(fqn)) return true;
    const i = fqn.lastIndexOf('.');
    return i > 0 && isOtherJvmType(fqn.slice(0, i), fqn.slice(i + 1));
  }

  function isRepoPackage(pkg) {
    return packages.has(pkg) || otherJvmDirs(pkg).length > 0;
  }

  function isRepoTypePrefix(segments) {
    for (let i = segments.length - 1; i > 0; i--) {
      if (isRepoType(segments.slice(0, i).join('.'))) return true;
    }
    return false;
  }

  function isRepoPackagePrefix(segments) {
    for (let i = segments.length - 1; i > 0; i--) {
      if (isRepoPackage(segments.slice(0, i).join('.'))) return true;
    }
    return false;
  }

  /**
   * A type `name` that an on-demand import of `container` brings in, which
   * the repository declares but this resolver does not: a member type of a
   * repository type, or a Kotlin or Scala type.
   */
  function isUnresolvedRepoType(container, name) {
    if ((typesByFqn.get(container) ?? []).some((t) => t.memberTypes.has(name))) return true;
    return isOtherJvmType(container, name);
  }

  /** A fully qualified name written in an import or in code; a malformed one is unknown. */
  function resolveFqn(fqn, ctx) {
    if (!isDottedName(fqn)) return R_UNKNOWN;
    const hit = lookupFqn(fqn, ctx);
    if (hit) return hit;
    const segments = fqn.split('.');
    // A nested type of a repository type, a type missing from a repository
    // package, or a Kotlin or Scala type: in the repository, but not resolvable.
    if (isRepoTypePrefix(segments)) return R_UNKNOWN;
    if (isRepoPackage(segments.slice(0, -1).join('.'))) return R_UNKNOWN;
    return R_EXTERNAL_STATIC;
  }

  /** Member types declared in `type` or a repository supertype of it. */
  function memberTypeVisible(type, name) {
    for (const t of hierarchy(type).types) {
      if (t.memberTypes.has(name)) return true;
    }
    return false;
  }

  /**
   * A simple type name, only where Java says a type of that name is in
   * scope (no fallback for names nothing declares). Returns null when no
   * type of that name is visible.
   */
  function resolveSimpleStrict(name, scope) {
    if (scope.owner && memberTypeVisible(scope.owner, name)) return R_UNKNOWN;
    const ctx = scope.ctx;
    const single = ctx.singleImports.get(name);
    if (single) return resolveFqn(single, ctx);
    if (ctx.opaque) return R_UNKNOWN;
    const samePackage = lookupFqn(ctx.pkg ? `${ctx.pkg}.${name}` : name, ctx);
    if (samePackage) return samePackage;
    if (isOtherJvmType(ctx.pkg, name)) return R_UNKNOWN;
    const found = [];
    for (const prefix of ctx.onDemand) {
      const hit = lookupFqn(`${prefix}.${name}`, ctx) ?? (isUnresolvedRepoType(prefix, name) ? R_UNKNOWN : null);
      if (hit) found.push(hit);
    }
    if (found.length > 0) {
      // A java.lang type of that name adds no repository declaration.
      if (found.length > 1 || JAVA_LANG.has(name) || found[0].status === 'ambiguous') return ambiguousAmong(found);
      return found[0];
    }
    if (JAVA_LANG.has(name)) return R_EXTERNAL_STATIC;
    return null;
  }

  function isOutsideScope(name) {
    return !isRepoPackage(name) && !isRepoType(name) && !isRepoTypePrefix(name.split('.'));
  }

  /** An on-demand import of something outside the repository. */
  function hasExternalOnDemand(ctx) {
    ctx.externalOnDemand ??= ctx.onDemand.some(isOutsideScope);
    return ctx.externalOnDemand;
  }

  /**
   * What the static on-demand imports may bring in besides the repository
   * types this resolver reads: members of a type outside the repository
   * (`outside`), or of one it declares but cannot resolve (`unknown`).
   */
  function staticOnDemandReach(ctx) {
    if (!ctx.staticOnDemandReach) {
      const statuses = ctx.staticOnDemand.map((t) => resolveFqn(t, ctx).status);
      ctx.staticOnDemandReach = {
        outside: statuses.includes('external'),
        unknown: statuses.some((s) => s === 'unknown' || s === 'ambiguous'),
      };
    }
    return ctx.staticOnDemandReach;
  }

  /**
   * Resolve a type as written, in `scope` = { ctx, owner, typeVars, exact }.
   * `typeVars` maps type variable names in scope to their bound; with `exact`
   * a variable stands for its bound (it is declared in the scope being
   * resolved), otherwise its instantiation is unknown.
   */
  function resolveType(text, scope, depth = 0) {
    if (typeof text !== 'string' || depth > 8) return R_UNKNOWN;
    const { base, dims } = stripTypeText(text);
    if (!base) return R_UNKNOWN;
    if (dims > 0) return R_ARRAY;
    if (PRIMITIVES.has(base)) return R_PRIMITIVE;
    if (!isDottedName(base)) return R_UNKNOWN;
    const segments = base.split('.');
    if (segments.length === 1) {
      if (scope.typeVars?.has(base)) {
        const bound = scope.typeVars.get(base);
        if (!scope.exact || bound === null) return R_UNKNOWN;
        return asInstance(resolveType(bound, { ...scope, typeVars: new Map(), exact: false }, depth + 1));
      }
      const strict = resolveSimpleStrict(base, scope);
      if (strict) return asInstance(strict);
      // Nothing in the repository declares it: it comes from an on-demand
      // import of an outside package, or is not resolvable.
      return hasExternalOnDemand(scope.ctx) ? R_EXTERNAL : R_UNKNOWN;
    }
    const full = lookupFqn(base, scope.ctx);
    if (full) return asInstance(full);
    if (isRepoTypePrefix(segments) || isRepoPackagePrefix(segments)) return R_UNKNOWN;
    const head = resolveSimpleStrict(segments[0], scope);
    if (head === null) return R_EXTERNAL; // a package outside the repository
    if (head.status === 'repo') return R_UNKNOWN; // a nested type, not extracted
    if (head.status === 'external') return R_EXTERNAL;
    return head;
  }

  /** Scope for a type written inside a declaration of `type`. */
  function typeScope(type, exact) {
    return { ctx: type.ctx, owner: type, typeVars: type.typeParams, exact };
  }

  // ---------------------------------------------------------------------------
  // Type hierarchy
  // ---------------------------------------------------------------------------

  const supertypeCache = new Map();
  /** A type's supertypes as written, each resolved in the type's own file. */
  function supertypesOf(type) {
    let list = supertypeCache.get(type);
    if (list) return list;
    const scope = { ctx: type.ctx, owner: null, typeVars: type.typeParams, exact: false };
    list = (type.cls.supertypes ?? []).map((s) => ({ relation: s.relation, line: s.line, res: asInstance(resolveType(s.type, scope)) }));
    supertypeCache.set(type, list);
    return list;
  }

  const hierarchyCache = new Map();
  /**
   * The type and its repository ancestors, nearest first (superclass before
   * interfaces at each level), with whether an explicit supertype lies
   * outside the repository (`hasExternal`) or cannot be resolved
   * (`hasUnknown`), and whether an enum's implicit java.lang.Enum adds
   * methods of its own (`implicitExternal`; it adds no accessible fields).
   */
  function hierarchy(type) {
    let h = hierarchyCache.get(type);
    if (h) return h;
    h = { types: [], hasExternal: false, hasUnknown: false, implicitExternal: false };
    hierarchyCache.set(type, h); // guards against cycles
    const seen = new Set([type]);
    let level = [type];
    while (level.length > 0) {
      const next = [];
      for (const t of level) {
        h.types.push(t);
        if (t.kind === 'enum') h.implicitExternal = true;
        for (const s of supertypesOf(t)) {
          if (s.res.status === 'repo') {
            if (!seen.has(s.res.type)) {
              seen.add(s.res.type);
              next.push(s.res.type);
            }
          } else if (s.res.status === 'external') {
            h.hasExternal = true;
          } else {
            h.hasUnknown = true;
          }
        }
      }
      level = next;
    }
    return h;
  }

  /** Methods an outside or unresolvable supertype may declare. */
  function methodsMaybeOutside(type) {
    const h = hierarchy(type);
    return h.hasExternal || h.hasUnknown || h.implicitExternal;
  }

  /** Fields an outside or unresolvable supertype may declare. */
  function fieldsMaybeOutside(type) {
    const h = hierarchy(type);
    return h.hasExternal || h.hasUnknown;
  }

  const methodCache = new Map();
  /** Distinct-signature methods named `name` applicable to `argCount`, nearest first. */
  function findMethods(type, name, argCount) {
    const key = `${name}\u0000${argCount}`;
    let perType = methodCache.get(type);
    if (!perType) {
      perType = new Map();
      methodCache.set(type, perType);
    }
    let found = perType.get(key);
    if (found) return found;
    const seen = new Set();
    found = [];
    for (const t of hierarchy(type).types) {
      for (const m of t.methodsByName.get(name) ?? []) {
        if (!applicable(m, argCount) || seen.has(m.signature)) continue;
        seen.add(m.signature);
        found.push(m);
      }
    }
    perType.set(key, found);
    return found;
  }

  function declaresMethodNamed(type, name) {
    return hierarchy(type).types.some((t) => t.methodsByName.has(name));
  }

  /** A field declared in the type or a repository ancestor: { type, owner }. */
  function findField(type, name) {
    for (const t of hierarchy(type).types) {
      if (t.fields.has(name)) return { typeText: t.fields.get(name), owner: t };
    }
    return null;
  }

  /** Whether `name` is a method the source does not declare (D6); any arity when `argCount` is null. */
  function isGenerated(type, name, argCount) {
    for (const t of hierarchy(type).types) {
      if (t.kind === 'enum' && ((name === 'values' && arityMatches(argCount, 0)) || (name === 'valueOf' && arityMatches(argCount, 1)))) return true;
      if (t.kind === 'record' && arityMatches(argCount, 0) && t.fields.has(name)) return true;
      if ((name === 'builder' || name === 'toBuilder') && arityMatches(argCount, 0)
        && [...t.annotations].some((a) => BUILDER_ANNOTATIONS.has(a))) return true;
      for (const field of t.fields.keys()) {
        const cap = capitalize(field);
        if (arityMatches(argCount, 0) && (name === `get${cap}` || name === `is${cap}`)) return true;
        if (arityMatches(argCount, 1) && name === `set${cap}`) return true;
        // Lombok names a boolean `isActive` field's accessors isActive / setActive.
        if (/^is[A-Z]/.test(field)) {
          if (arityMatches(argCount, 0) && name === field) return true;
          if (arityMatches(argCount, 1) && name === `set${field.slice(2)}`) return true;
        }
      }
    }
    return false;
  }

  /**
   * For a method reference, whether a method named `name` that the source
   * does not declare — an `Object` method or a generated one — may exist at
   * an arity other than the one declared candidate's: then the reference
   * may bind to either, and choosing would be a guess.
   */
  function undeclaredOverloadMayExist(type, name, candidate) {
    const arity = candidate.paramTypes.length;
    for (const a of OBJECT_METHODS.get(name) ?? []) if (a !== arity) return true;
    for (const a of [0, 1]) if (a !== arity && isGenerated(type, name, a)) return true;
    return false;
  }

  /** The bucket for a call no declaration in `type`'s hierarchy matches (D6). */
  function classifyMissing(type, name, argCount) {
    if (isObjectMethod(name, argCount)) return EXTERNAL;
    if (isGenerated(type, name, argCount)) return GENERATED;
    const h = hierarchy(type);
    if (h.hasUnknown) return UNRESOLVED;
    if (h.hasExternal || h.implicitExternal) return EXTERNAL;
    return UNRESOLVED;
  }

  /** An ambiguous outcome; `candidates` (methods) when the full set is known. */
  function ambiguousResult(candidates) {
    return candidates ? { outcome: AMBIGUOUS, candidates } : { outcome: AMBIGUOUS };
  }

  /**
   * The declarations a call may bind to when its receiver is one of several
   * repository types: the union of the lookup on each, or undefined when any
   * lookup cannot say (D13). External and generated targets add none.
   */
  function unionOfCandidates(results) {
    const union = [];
    for (const r of results) {
      if (r.outcome === 'edge') union.push(r.target);
      else if (r.outcome === AMBIGUOUS && r.candidates) union.push(...r.candidates);
      else if (r.outcome !== EXTERNAL && r.outcome !== GENERATED) return undefined;
    }
    return [...new Set(union)];
  }

  const lookupCache = new Map();
  /**
   * Method lookup on a resolved repository type: an outcome plus its target.
   * Results are shared through the cache and must not be mutated.
   */
  function lookupOn(type, name, argCount) {
    const key = `${name}\u0000${argCount}`;
    let perType = lookupCache.get(type);
    if (!perType) {
      perType = new Map();
      lookupCache.set(type, perType);
    }
    let result = perType.get(key);
    if (result) return result;
    const candidates = findMethods(type, name, argCount);
    // `outsideHierarchy` is for reporting: an outside supertype of the
    // lookup type could declare a same-arity overload we cannot see (Risks).
    // `candidates` too (D13): the declarations an ambiguous call may bind
    // to, unless a supertype the repository declares but this resolver
    // cannot read could add one.
    const known = !hierarchy(type).hasUnknown;
    if (candidates.length === 1 && argCount === null && undeclaredOverloadMayExist(type, name, candidates[0])) result = ambiguousResult(known ? candidates : undefined);
    else if (candidates.length === 1) result = { outcome: 'edge', target: candidates[0], outsideHierarchy: methodsMaybeOutside(type) };
    else if (candidates.length > 1) result = ambiguousResult(known ? candidates : undefined);
    else result = { outcome: classifyMissing(type, name, argCount) };
    perType.set(key, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Receivers (D2)
  // ---------------------------------------------------------------------------

  /**
   * An identifier no local binds, possibly followed by field names
   * (`helper`, `Type.FIELD`, `java.util.Collections`). Java reads its head
   * as a variable, else a type, else a package.
   */
  function resolveNameChain(segments, site) {
    const scope = site.scope;
    if (!scope.owner) return R_UNKNOWN;
    let cur = null;
    let i = 1;
    const variable = resolveVariable(segments[0], scope);
    if (variable.res) {
      cur = variable.res;
    } else {
      cur = resolveSimpleStrict(segments[0], scope);
      if (!cur) {
        // An inherited field of a supertype the repository does not declare.
        if (variable.hidden) return R_UNKNOWN;
        // A package: the shortest prefix that names a repository type.
        for (let k = 2; k <= segments.length && !cur; k++) {
          cur = lookupFqn(segments.slice(0, k).join('.'), scope.ctx);
          i = k;
        }
        if (!cur) {
          // Neither variable nor type nor package of the repository: a static
          // field or a type an on-demand import brings in, or a package
          // outside the repository.
          if (variable.unknown) return R_UNKNOWN;
          if (segments.length === 1) return variable.outside || hasExternalOnDemand(scope.ctx) ? R_EXTERNAL : R_UNKNOWN;
          return isRepoPackagePrefix(segments) || isRepoTypePrefix(segments) ? R_UNKNOWN : R_EXTERNAL;
        }
      }
    }
    for (; i < segments.length; i++) cur = fieldOf(cur, segments[i]);
    return cur;
  }

  /**
   * A field visible by simple name: declared in the enclosing type's
   * hierarchy, else statically imported. Returns `res: null` when neither
   * declares it, with whether a supertype the repository does not declare
   * (`hidden`), a static on-demand import of an unresolvable repository type
   * (`unknown`) or of an outside type (`outside`) may.
   */
  function resolveVariable(name, scope) {
    const owner = scope.owner;
    const field = findField(owner, name);
    if (field) return { res: fieldValue(field, field.owner === owner) };
    // A field an outside supertype declares would shadow a static import.
    const hidden = fieldsMaybeOutside(owner);
    const imported = staticField(name, scope.ctx);
    if (imported) {
      if (!hidden) return { res: imported };
      return { res: imported.status === 'repo' ? R_AMBIGUOUS : R_UNKNOWN };
    }
    const { unknown, outside } = staticOnDemandReach(scope.ctx);
    return { res: null, hidden, unknown, outside };
  }

  /**
   * A statically imported field: single imports first, then on-demand. Two
   * imports providing the same field name do not compile, so a repository
   * hit is the field.
   */
  function staticField(name, ctx) {
    for (const typeName of ctx.staticSingle.get(name) ?? []) {
      const res = resolveFqn(typeName, ctx);
      if (res.status === 'repo') {
        const imported = findField(res.type, name);
        if (imported) return fieldValue(imported, false);
      } else {
        // A static field of an outside type has an outside type; of a type
        // the repository declares but cannot resolve, an unknown one.
        return res.status === 'external' ? R_EXTERNAL : R_UNKNOWN;
      }
    }
    const found = new Set();
    let value = null;
    for (const typeName of ctx.staticOnDemand) {
      const res = resolveFqn(typeName, ctx);
      if (res.status !== 'repo') continue;
      const imported = findField(res.type, name);
      if (imported && !found.has(imported.owner)) {
        found.add(imported.owner);
        value = fieldValue(imported, false);
      }
    }
    if (found.size > 1) return R_AMBIGUOUS;
    return value;
  }

  /** The value of a field: an instance of its declared type. A type variable
   *  in it stands for its bound only inside the declaring type itself. */
  function fieldValue(field, insideDeclaringType) {
    return asInstance(resolveType(field.typeText, typeScope(field.owner, insideDeclaringType)));
  }

  /** `object.name` where `name` is a field. */
  function fieldOf(object, name) {
    if (object.status === 'repo') {
      const field = findField(object.type, name);
      if (field) return fieldValue(field, false);
      return R_UNKNOWN; // a nested type or an inherited outside field
    }
    // A static field of an outside type has an outside type; an instance
    // field of one may be a type variable instantiated with anything.
    if (object.status === 'external' && object.isStatic) return R_EXTERNAL;
    return R_UNKNOWN;
  }

  /** `a.b.c` as a list of names when the receiver is only names, else null. */
  function nameChain(receiver) {
    if (receiver.kind === 'name') return [receiver.name];
    if (receiver.kind === 'field') {
      const head = nameChain(receiver.object);
      return head ? [...head, receiver.name] : null;
    }
    return null;
  }

  function resolveReceiver(receiver, site, file) {
    switch (receiver?.kind) {
      case 'this':
        return site.scope.owner ? repoRef(site.scope.owner, false) : R_UNKNOWN;
      case 'local':
        return receiver.type === null ? R_UNKNOWN : asInstance(resolveType(receiver.type, site.scope));
      case 'name':
        return resolveNameChain([receiver.name], site);
      case 'field': {
        const chain = nameChain(receiver);
        if (chain) return resolveNameChain(chain, site);
        return fieldOf(resolveReceiver(receiver.object, site, file), receiver.name);
      }
      case 'call': {
        // A report-mode probe (D13) also types a receiver whose own call has
        // no resolvable caller: the same unknown caller as the outer call.
        let inner = resolveSite(file, receiver.site);
        if (site.probe === true && inner.outcome === CALLER_UNRESOLVED) inner = probeSite(file, receiver.site)?.result ?? inner;
        if (inner.outcome !== 'edge' || inner.target.declaredReturnType === undefined) return R_UNKNOWN;
        const method = inner.target;
        // A type variable in a return type is instantiated by the caller: unknown.
        return asInstance(resolveType(method.declaredReturnType, {
          ctx: method.owner.ctx,
          owner: method.owner,
          typeVars: new Map([...method.owner.typeParams, ...method.typeParams]),
          exact: false,
        }));
      }
      case 'new':
      case 'type':
        return asInstance(resolveType(receiver.type, site.scope));
      default:
        return R_UNKNOWN;
    }
  }

  // ---------------------------------------------------------------------------
  // Call sites
  // ---------------------------------------------------------------------------

  /** The method name of a call site: the callee text after its last dot. */
  function methodName(site) {
    return lastSegment(site.callee);
  }

  /** Per-file memo of site outcomes (chained calls resolve their receiver first). */
  const fileState = new Map();

  function stateOf(row) {
    let state = fileState.get(row.path);
    if (!state) {
      // Declarations by owner and name, for finding a call's caller.
      const ids = functionIds.get(row.path) ?? [];
      const declarations = new Map();
      (row.functions ?? []).forEach((fn, index) => {
        const key = `${fn.owner}\u0000${fn.name}`;
        if (!declarations.has(key)) declarations.set(key, []);
        declarations.get(key).push({ fn, id: ids[index] });
      });
      state = {
        row,
        ctx: contextByPath.get(row.path),
        types: typesByPath.get(row.path) ?? new Map(),
        declarations,
        outcomes: [],
        resolving: new Set(),
        probes: new Map(),
        probing: new Set(),
      };
      fileState.set(row.path, state);
    }
    return state;
  }

  /** The calling declaration (D8): this file, owner = enclosing type, same name, lines contain the call. */
  function resolveCaller(state, site, owner) {
    const matches = (state.declarations.get(`${owner.name}\u0000${site.caller}`) ?? [])
      .filter(({ fn }) => site.lineNumber >= fn.startLine && site.lineNumber <= fn.endLine);
    return matches.length === 1 ? matches[0] : null;
  }

  /** The enclosing type of a call site, when it is a type this resolver reads. */
  function ownerOf(state, site) {
    return typeof site.enclosingType === 'string' ? state.types.get(site.enclosingType) ?? null : null;
  }

  /** Names in scope at a call site: the enclosing type's and, when known, the caller's type variables. */
  function callerScope(state, owner, caller) {
    return {
      ctx: state.ctx,
      owner,
      typeVars: new Map([...owner.typeParams, ...(caller?.fn.typeParameters ?? []).map((p) => [p.name, p.bound])]),
      exact: true,
    };
  }

  /**
   * Outcome of one call site, memoized: `{ outcome, callerId?, target?,
   * candidates?, lookupType? }`. `lookupType` is the repository type the
   * method lookup ran on.
   */
  function resolveSite(state, index) {
    const cached = state.outcomes[index];
    if (cached) return cached;
    const site = state.row.callGraph[index];
    if (state.resolving.has(index) || !site) return { outcome: UNRESOLVED };
    state.resolving.add(index);
    const owner = ownerOf(state, site);
    const caller = owner ? resolveCaller(state, site, owner) : null;
    let result;
    // A null id is a node shared with another declaration (identity
    // collision): an edge to or from it would be an edge to the wrong one.
    if (!caller || caller.id == null) {
      result = { outcome: CALLER_UNRESOLVED };
    } else {
      const context = { scope: callerScope(state, owner, caller) };
      // Lookup results are shared through caches; copy before adding the caller.
      result = { ...resolveTarget(state, site, context, owner), callerId: caller.id };
      if (result.outcome === 'edge' && result.target.id == null) result = { outcome: AMBIGUOUS, target: result.target };
      if (context.lookupType) result.lookupType = context.lookupType;
    }
    state.resolving.delete(index);
    state.outcomes[index] = result;
    return result;
  }

  /**
   * Report mode only (D13): the target of a call whose caller cannot be
   * attributed, resolved in its enclosing type's scope as if the caller were
   * known. Null when the enclosing type is itself not one this resolver reads
   * (a nested, local or anonymous type), where resolving would be a guess.
   * Never feeds an outcome.
   */
  function probeSite(state, index) {
    if (state.probes.has(index)) return state.probes.get(index);
    const site = state.row.callGraph[index];
    const owner = site ? ownerOf(state, site) : null;
    let probe = null;
    if (owner && !state.probing.has(index)) {
      state.probing.add(index);
      const context = { scope: callerScope(state, owner, resolveCaller(state, site, owner)), probe: true };
      let result = resolveTarget(state, site, context, owner);
      if (result.outcome === 'edge' && result.target.id == null) result = { outcome: AMBIGUOUS };
      probe = { result, lookupType: context.lookupType ?? null };
      state.probing.delete(index);
    }
    state.probes.set(index, probe);
    return probe;
  }

  function resolveTarget(state, site, context, owner) {
    const receiver = site.receiver;
    // null: a method reference, applicable at any arity. Absent or malformed: unresolved.
    const argCount = site.argCount === null ? null : Number.isInteger(site.argCount) ? site.argCount : undefined;
    if (!receiver || argCount === undefined) return { outcome: UNRESOLVED };
    if (receiver.kind === 'construct') return resolveConstruction(receiver.type, context, argCount);
    const name = methodName(site);
    switch (receiver.kind) {
      case 'none':
        return resolveBareCall(owner, name, argCount, context);
      case 'this':
        context.lookupType = owner;
        return lookupOn(owner, name, argCount);
      case 'super':
        return resolveSuperCall(owner, name, argCount, context);
      default:
        return callOn(resolveReceiver(receiver, context, state), name, argCount, context);
    }
  }

  function callOn(res, name, argCount, context) {
    switch (res.status) {
      case 'repo':
        context.lookupType = res.type;
        return lookupOn(res.type, name, argCount);
      case 'external':
        return { outcome: EXTERNAL };
      case 'ambiguous':
        // Several repository types of that name: the call may bind in any.
        if (!res.types || res.types.some((t) => hierarchy(t).hasUnknown)) return { outcome: AMBIGUOUS };
        return ambiguousResult(unionOfCandidates(res.types.map((t) => lookupOn(t, name, argCount))));
      case 'array':
        return { outcome: isObjectMethod(name, argCount) ? EXTERNAL : UNRESOLVED };
      default:
        return { outcome: UNRESOLVED };
    }
  }

  /** `super.m()`: the superclass's hierarchy. */
  function resolveSuperCall(owner, name, argCount, context) {
    const superclass = owner.kind === 'class'
      ? supertypesOf(owner).find((s) => s.relation === 'extends')
      : null;
    if (superclass) return callOn(superclass.res, name, argCount, context);
    if (owner.kind === 'enum') return { outcome: EXTERNAL };
    return { outcome: isObjectMethod(name, argCount) ? EXTERNAL : UNRESOLVED };
  }

  /**
   * A bare call `m()` (D7): the enclosing type's hierarchy; only when no
   * method of that name is declared there, single then on-demand static
   * imports.
   */
  function resolveBareCall(owner, name, argCount, context) {
    const scope = context.scope;
    if (declaresMethodNamed(owner, name)) {
      context.lookupType = owner;
      return lookupOn(owner, name, argCount);
    }
    const h = hierarchy(owner);
    // A method an outside or unresolvable supertype declares would shadow
    // the static imports.
    const hidden = methodsMaybeOutside(owner);

    // Imported types whose methods this resolver cannot see: `opaque` when
    // any, `unknown` when one of them is in the repository; `partial` when
    // an imported type's own supertypes may hide a candidate.
    const fromImports = (typeNames) => {
      const candidates = [];
      let opaque = false;
      let unknown = false;
      let partial = false;
      for (const typeName of typeNames) {
        const res = resolveFqn(typeName, scope.ctx);
        if (res.status === 'repo') {
          for (const m of findMethods(res.type, name, argCount)) candidates.push(m);
          if (hierarchy(res.type).hasUnknown) partial = true;
        } else {
          opaque = true;
          if (res.status !== 'external') unknown = true;
        }
      }
      return { candidates, opaque, unknown, partial };
    };
    // The imported candidates are the whole set only when nothing else may shadow or add one.
    const ambiguousImport = ({ candidates, opaque, partial }) =>
      ambiguousResult(!opaque && !hidden && !partial ? candidates : undefined);

    const single = scope.ctx.staticSingle.get(name);
    if (single) {
      const imported = fromImports(single);
      const { candidates, opaque, unknown } = imported;
      if (candidates.length === 1 && !opaque && !hidden) return { outcome: 'edge', target: candidates[0] };
      if (candidates.length > 0) return ambiguousImport(imported);
      if (opaque) return { outcome: h.hasUnknown || unknown ? UNRESOLVED : EXTERNAL };
    }
    const imported = fromImports(scope.ctx.staticOnDemand);
    const { candidates, opaque, unknown } = imported;
    if (candidates.length === 1 && !opaque && !hidden) return { outcome: 'edge', target: candidates[0] };
    if (candidates.length > 0) return ambiguousImport(imported);
    if (isObjectMethod(name, argCount)) return { outcome: EXTERNAL };
    if (isGenerated(owner, name, argCount)) return { outcome: GENERATED };
    if (h.hasUnknown || unknown) return { outcome: UNRESOLVED };
    if (h.hasExternal || h.implicitExternal || opaque) return { outcome: EXTERNAL };
    return { outcome: UNRESOLVED };
  }

  /** `new X(...)` (D9) and the constructor reference `X::new` (argCount null). */
  function resolveConstruction(typeText, context, argCount) {
    const res = asInstance(resolveType(typeText, context.scope));
    // `T[]::new`: the array constructor, never a repository declaration.
    if (res.status === 'array') return { outcome: EXTERNAL };
    if (res.status === 'external') return { outcome: EXTERNAL };
    if (res.status === 'ambiguous') {
      // Constructors are not inherited: each candidate type's own are the whole set.
      return ambiguousResult(res.types ? unionOfCandidates(res.types.map((t) => constructOn(t, argCount))) : undefined);
    }
    if (res.status !== 'repo') return { outcome: UNRESOLVED };
    context.lookupType = res.type;
    return constructOn(res.type, argCount);
  }

  /** Constructor lookup on a resolved repository type. */
  function constructOn(type, argCount) {
    const mayGenerate = type.kind === 'record' || [...type.annotations].some((a) => CONSTRUCTOR_ANNOTATIONS.has(a));
    const candidates = type.constructors.filter((c) => applicable(c, argCount));
    // A reference may also bind to a constructor the source does not declare.
    if (candidates.length === 1 && argCount === null && mayGenerate) return ambiguousResult(candidates);
    if (candidates.length === 1) return { outcome: 'edge', target: candidates[0] };
    if (candidates.length > 1) return ambiguousResult(candidates);
    if (type.constructors.length === 0 && arityMatches(argCount, 0)) return { outcome: GENERATED };
    if (mayGenerate) return { outcome: GENERATED };
    return { outcome: UNRESOLVED };
  }

  // ---------------------------------------------------------------------------
  // Type hierarchy edges (D10; dead-code-detection D8)
  // ---------------------------------------------------------------------------

  /**
   * A parameter type, erased, as a key two declarations can be compared by:
   * the qualified name of a repository type, the imported or written name of
   * an outside one, a primitive as written. Null when the type cannot be
   * named for certain (a type variable, a nested or unresolvable type, an
   * outside type from an on-demand import), and whenever the key would not be
   * a dotted name with `[]` dimensions: a malformed name is unknown, never a
   * different type.
   */
  function erasedTypeKey(text, owner) {
    const key = erasedTypeName(text, owner);
    return key !== null && ERASED_KEY_PATTERN.test(key) ? key : null;
  }

  function erasedTypeName(text, owner) {
    const { base, dims } = stripTypeText(text);
    const suffix = '[]'.repeat(dims);
    if (PRIMITIVES.has(base)) return base + suffix;
    const res = resolveType(base, typeScope(owner, false));
    if (res.status === 'repo') return res.type.fqn + suffix;
    if (res.status !== 'external') return null;
    const segments = base.split('.');
    const imported = owner.ctx.singleImports.get(segments[0]);
    if (imported) return [imported, ...segments.slice(1)].join('.') + suffix;
    if (segments.length > 1) return base + suffix;
    return JAVA_LANG.has(base) ? `java.lang.${base}${suffix}` : null;
  }

  function erasedSignature(method) {
    if (method.erasedSignature === undefined) {
      const keys = method.paramTypes.map((t) => erasedTypeKey(t, method.owner));
      method.erasedSignature = keys.includes(null) ? null : keys.join(',');
    }
    return method.erasedSignature;
  }

  /** How two same-arity methods' erased parameter types compare: equal, different, or not known. */
  function compareErased(a, b) {
    const left = erasedSignature(a);
    const right = erasedSignature(b);
    if (left === null || right === null) return 'uncertain';
    return left === right ? 'equal' : 'different';
  }

  /** Declared `static`. A row without modifiers says nothing, so: not static. */
  function isStaticMethod(m) {
    return m.modifiers !== null && m.modifiers.includes('static');
  }

  /** A method dispatch can select: neither `static` nor `private`. */
  function isOverridable(m) {
    return m.visibility !== 'private' && !isStaticMethod(m);
  }

  /**
   * A method with a body: a class method that is not abstract, or an
   * interface `default` method. Without extracted modifiers an interface
   * method with a body counts as `default` (static and private are unknown).
   */
  function isConcrete(m) {
    if (m.abstract) return false;
    if (m.owner.kind !== 'interface') return true;
    return m.modifiers === null || m.modifiers.includes('default');
  }

  /**
   * Whether `target` can be overridden or implemented from `type`: a
   * package-access method only from its own package. 'unknown' when either
   * package name is malformed, which never reads as a different package.
   * @returns {'yes'|'no'|'unknown'}
   */
  function packageReach(target, type) {
    if (target.visibility !== 'package') return 'yes';
    const own = target.owner.ctx.pkg;
    const other = type.ctx.pkg;
    if (own === other) return 'yes';
    return isPackageName(own) && isPackageName(other) ? 'no' : 'unknown';
  }

  const abstractCache = new Map();
  /** The abstract methods a type declares that can be paired (they have an id). */
  function abstractMethodsOf(type) {
    let list = abstractCache.get(type);
    if (!list) {
      list = [];
      for (const methods of type.methodsByName.values()) {
        for (const m of methods) if (m.abstract && m.id != null && isOverridable(m)) list.push(m);
      }
      abstractCache.set(type, list);
    }
    return list;
  }

  const defaultCache = new Map();
  /** The `default` methods an interface declares that can be paired (they have an id). */
  function defaultMethodsOf(type) {
    let list = defaultCache.get(type);
    if (!list) {
      list = [];
      if (type.kind === 'interface') {
        for (const methods of type.methodsByName.values()) {
          for (const m of methods) if (m.id != null && isConcrete(m) && isOverridable(m)) list.push(m);
        }
      }
      defaultCache.set(type, list);
    }
    return list;
  }

  const superclassCache = new Map();
  /**
   * A class's repository superclasses through `extends`, nearest first,
   * ending where the chain leaves the repository.
   */
  function superclassChain(type) {
    let chain = superclassCache.get(type);
    if (chain) return chain;
    chain = [];
    const seen = new Set([type]);
    let current = type;
    while (current.kind === 'class') {
      const ext = supertypesOf(current).find((s) => s.relation === 'extends');
      if (!ext || ext.res.status !== 'repo' || seen.has(ext.res.type)) break;
      seen.add(ext.res.type);
      chain.push(ext.res.type);
      current = ext.res.type;
    }
    superclassCache.set(type, chain);
    return chain;
  }

  /**
   * For each repository ancestor of a type, the line of the type's own
   * supertype declaration it is reached through (the first in source order
   * when several reach it).
   */
  function supertypeLines(type) {
    const lines = new Map();
    const direct = supertypesOf(type).filter((s) => s.res.status === 'repo').sort((a, b) => a.line - b.line);
    for (const s of direct) {
      for (const t of hierarchy(s.res.type).types) if (!lines.has(t)) lines.set(t, s.line);
    }
    return lines;
  }

  const ancestorSets = new Map();
  /** Whether `ancestor` is the type itself or one of its repository ancestors. */
  function isSubtypeOf(type, ancestor) {
    let set = ancestorSets.get(type);
    if (!set) {
      set = new Set(hierarchy(type).types);
      ancestorSets.set(type, set);
    }
    return set.has(ancestor);
  }

  /** Whether a type declares a method that may be the one `target` names (an equal or an uncertain signature). */
  function declaresOwn(type, target) {
    for (const own of type.methodsByName.get(target.name) ?? []) {
      if (own.paramTypes.length === target.paramTypes.length && compareErased(own, target) !== 'different') return true;
    }
    return false;
  }

  /**
   * Type hierarchy edges and the pairs that cannot be told apart
   * (dead-code-detection D8). Every pair is a same-name, same-arity method
   * pair; an erased signature that cannot be named on either side makes it
   * an uncertain pair, never an edge and never dropped.
   */
  function computeHierarchy() {
    const typeEdges = [];
    const methodEdges = [];
    const overrideEdges = [];
    const pairKey = (m, a) => `${m.id}\u0000${a.id}`;
    /** relation -> key -> edge bound through a type that inherits the method */
    const inherited = { implements: new Map(), overrides: new Map() };
    /** key -> { pair, own } */
    const uncertain = new Map();
    const byEvidence = (x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : x.line - y.line);

    const noteUncertain = (m, a, relation, file, line, own) => {
      const key = pairKey(m, a);
      const pair = { source: m.id, target: a.id, relation, file, line };
      const seen = uncertain.get(key);
      // A pair a method's own declaration states keeps its evidence; one
      // seen through several inheriting types keeps the smallest.
      if (!seen || (own && !seen.own) || (!own && !seen.own && byEvidence(pair, seen.pair) < 0)) uncertain.set(key, { pair, own });
    };

    // (1) A concrete method (an interface `default` method included) and the
    // methods it is declared over: every abstract one it implements, and the
    // nearest concrete one on each supertype path that it overrides.
    const pairOwnMethod = (type, method, ancestors) => {
      const covered = new Set();
      for (const ancestor of ancestors) {
        const targets = ancestor.methodsByName.get(method.name);
        if (!targets) continue;
        const overridesHere = !covered.has(ancestor);
        let overridden = false;
        for (const target of targets) {
          if (target.id == null || target.paramTypes.length !== method.paramTypes.length) continue;
          if (!isOverridable(target)) continue;
          const reach = packageReach(target, type);
          if (reach === 'no') continue;
          if (target.abstract) {
            const cmp = compareErased(method, target);
            if (cmp === 'equal' && reach === 'yes') {
              methodEdges.push({ source: method.id, target: target.id, file: type.path, line: method.lineRange[0] });
            } else if (cmp !== 'different') {
              noteUncertain(method, target, 'implements', type.path, method.lineRange[0], true);
            }
          } else if (overridesHere && isConcrete(target)) {
            const cmp = compareErased(method, target);
            if (cmp === 'equal' && reach === 'yes') {
              overrideEdges.push({ source: method.id, target: target.id, file: type.path, line: method.lineRange[0] });
              overridden = true;
            } else if (cmp !== 'different') {
              // It may be an overload: a further ancestor may still be the one overridden.
              noteUncertain(method, target, 'overrides', type.path, method.lineRange[0], true);
            }
          }
        }
        // What the overridden method itself overrides is its own edge.
        if (overridden) for (const t of hierarchy(ancestor).types) covered.add(t);
      }
    };

    const noteInherited = (relation, m, a, file, line) => {
      const key = pairKey(m, a);
      const edge = { source: m.id, target: a.id, file, line };
      const seen = inherited[relation].get(key);
      if (!seen || byEvidence(edge, seen) < 0) inherited[relation].set(key, edge);
    };

    // (2) A method `target` of an ancestor that a class, enum or record does
    // not declare itself, bound to the method the type inherits from its
    // superclass chain instead: for an abstract `target` the implementation
    // (`implements`), for an interface `default` `target` the class method
    // that wins over it (`overrides`). The walk ends at the type declaring
    // `target` and at an abstract re-declaration of it. A method whose own
    // type is a subtype of `target`'s is left to (1), so no pair is repeated
    // with other evidence. Evidence is the type's supertype declaration that
    // brings `target` in. An interface `default` method can implement an
    // abstract `target` only from a sub-interface of the one declaring it,
    // where (1) already pairs it: javac rejects a class that inherits an
    // abstract method and an unrelated default one of the same signature,
    // and a default above `target`'s interface is re-abstracted by it.
    const bindInherited = (type, target, line, relation) => {
      // Once a nearer method may have been the one inherited, a further one
      // is no longer certain.
      let doubtful = false;
      for (const superclass of superclassChain(type)) {
        // The abstract declaration itself: its other methods are overloads.
        if (superclass === target.owner) return;
        let found = false;
        for (const m of superclass.methodsByName.get(target.name) ?? []) {
          if (m.paramTypes.length !== target.paramTypes.length || !isOverridable(m)) continue;
          const cmp = compareErased(m, target);
          if (m.abstract) {
            if (cmp === 'equal') found = true; // declared abstract again: nothing is inherited
            continue;
          }
          const reach = packageReach(target, superclass);
          if (reach === 'no') continue;
          // A method whose own type already has `target`'s type as an
          // ancestor is paired with it by (1), which keeps only the nearest
          // override on each supertype path.
          const paired = isSubtypeOf(superclass, target.owner);
          if (cmp === 'different') continue;
          const certain = cmp === 'equal' && reach === 'yes';
          if (certain && !doubtful) {
            if (m.id != null && !paired) noteInherited(relation, m, target, type.path, line);
          } else if (m.id != null && !paired) {
            noteUncertain(m, target, relation, type.path, line, false);
          }
          if (certain) found = true;
          else if (cmp === 'equal') doubtful = true;
        }
        if (found) return;
      }
    };

    for (const types of typesByFqn.values()) {
      for (const type of types) {
        if (type.id === null) continue;
        for (const s of supertypesOf(type)) {
          if (s.res.status !== 'repo' || s.res.type.id === null) continue;
          typeEdges.push({
            source: type.id,
            target: s.res.type.id,
            type: s.relation === 'extends' ? 'inherits' : 'implements',
            file: type.path,
            line: s.line,
          });
        }
        const ancestors = hierarchy(type).types.slice(1);
        if (ancestors.length === 0) continue;
        for (const methods of type.methodsByName.values()) {
          for (const method of methods) {
            if (method.id == null || !isConcrete(method) || !isOverridable(method)) continue;
            pairOwnMethod(type, method, ancestors);
          }
        }
      }
    }

    // Inherited pairs. An abstract class binds them too: its anonymous
    // subclasses are not types.
    for (const types of typesByFqn.values()) {
      for (const type of types) {
        if (type.id === null || type.kind === 'interface') continue;
        const ancestors = hierarchy(type).types.slice(1);
        let lines = null;
        for (const ancestor of ancestors) {
          for (const [targets, relation] of [[abstractMethodsOf(ancestor), 'implements'], [defaultMethodsOf(ancestor), 'overrides']]) {
            for (const target of targets) {
              if (declaresOwn(type, target)) continue;
              lines ??= supertypeLines(type);
              bindInherited(type, target, lines.get(ancestor), relation);
            }
          }
        }
      }
    }

    const byPair = (x, y) => (x.source < y.source ? -1 : x.source > y.source ? 1 : x.target < y.target ? -1 : x.target > y.target ? 1 : 0);
    methodEdges.push(...[...inherited.implements.values()].sort(byPair));
    overrideEdges.push(...[...inherited.overrides.values()].sort(byPair));
    const uncertainPairs = [...uncertain.values()].map((u) => u.pair).sort(byPair);
    return { typeEdges, methodEdges, overrideEdges, uncertainPairs };
  }

  /** Sorted distinct ids of candidate methods; undefined when any has no id of its own. */
  function candidateIds(candidates) {
    if (!candidates || candidates.some((m) => m.id == null)) return undefined;
    return [...new Set(candidates.map((m) => m.id))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** One site's report-mode record (D13). */
  function reportSite(state, index, result) {
    const record = result.outcome === 'edge'
      ? { outcome: 'edge', callerId: result.callerId, targetId: result.target.id, outsideHierarchy: result.outsideHierarchy === true }
      : { outcome: result.outcome };
    let lookupType = result.lookupType ?? null;
    if (result.outcome === AMBIGUOUS) {
      const ids = candidateIds(result.candidates);
      if (ids) record.candidates = ids;
    } else if (result.outcome === CALLER_UNRESOLVED) {
      const probe = probeSite(state, index);
      if (probe) {
        lookupType = probe.lookupType;
        if (probe.result.outcome === 'edge') record.target = probe.result.target.id;
        else if (probe.result.outcome === AMBIGUOUS) {
          const ids = candidateIds(probe.result.candidates);
          if (ids) record.candidates = ids;
        }
      }
    }
    if (lookupType) record.receiverType = lookupType.fqn;
    return record;
  }

  return {
    /**
     * Type hierarchy facts between repository declarations (D10;
     * dead-code-detection D8):
     * - `typeEdges`: a type to each supertype that resolves into the
     *   repository, `inherits` for `extends` and `implements` for
     *   `implements`, at the supertype's line;
     * - `methodEdges` (`implements`): a concrete method (an interface
     *   `default` method included) to each abstract method of a repository
     *   ancestor with the same name and erased parameter types, at the
     *   method's first line; and an inherited implementation — the method a
     *   class, enum or record inherits from its superclass chain for an
     *   abstract method of an ancestor it does not declare itself — at that
     *   type's supertype declaration;
     * - `overrideEdges` (`overrides`): a concrete method to the nearest
     *   concrete method it overrides on each supertype path, at the method's
     *   first line; and an inherited override — the class method a class,
     *   enum or record inherits from its superclass chain for an interface
     *   `default` method of an ancestor it does not declare itself (the class
     *   method wins) — at that type's supertype declaration;
     * - `uncertainPairs`: same-name, same-arity ancestor/descendant pairs
     *   either rule would relate but where either side's erased parameter
     *   types cannot all be determined,
     *   `{ source, target, relation, file, line }`, one per pair, by ids.
     * `static` and `private` methods and constructors take part in none.
     */
    hierarchyEdges() {
      return computeHierarchy();
    },

    /**
     * Outcomes for every call site of one Java row, index for index with
     * `row.callGraph`: `{ outcome: 'edge', callerId, targetId }` or
     * `{ outcome: <bucket> }`. With `{ report: true }` (D13) a site also
     * carries, when known:
     * - `outsideHierarchy` (edges): whether the lookup type's hierarchy
     *   reaches outside the repository;
     * - `receiverType`: the qualified name of the repository type the
     *   method lookup ran on;
     * - `candidates` (`calls-ambiguous`): the sorted ids of every
     *   declaration the call may bind to — absent means the set is unknown,
     *   never that it is empty;
     * - `target` (`calls-caller-unresolved`): the id of the one declaration
     *   the call resolves to in its enclosing type's scope; when it resolves
     *   there to several, their `candidates` instead. A site outside every
     *   method and constructor body (caller `<clinit>` / `<init>`) is such a
     *   site: no declaration has its caller's name.
     */
    resolveFileCalls(row, { report = false } = {}) {
      const state = stateOf(row);
      const out = (row.callGraph ?? []).map((_, index) => {
        const result = resolveSite(state, index);
        if (!report) {
          if (result.outcome !== 'edge') return { outcome: result.outcome };
          return { outcome: 'edge', callerId: result.callerId, targetId: result.target.id };
        }
        return reportSite(state, index, result);
      });
      fileState.delete(row.path);
      return out;
    },
  };
}
