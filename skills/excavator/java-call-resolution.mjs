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

function isObjectMethod(name, argCount) {
  return OBJECT_METHODS.get(name)?.includes(argCount) ?? false;
}

function capitalize(name) {
  return name.length > 0 ? name[0].toUpperCase() + name.slice(1) : name;
}

function lastSegment(dotted) {
  const i = dotted.lastIndexOf('.');
  return i < 0 ? dotted : dotted.slice(i + 1);
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

/** Argument counts a method accepts: exactly its arity, or more with varargs. */
function applicable(method, argCount) {
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
 * }} args `functionIds` / `classIds` map a row's path to the node ids of its
 *   `functions` / `classes` entries, index for index; null marks an id shared
 *   with another declaration, which is never an edge endpoint.
 */
export function createJavaCallResolver({ rows, functionIds, classIds = new Map() }) {
  /** fqn -> TypeInfo[] (more than one when two files declare the same name) */
  const typesByFqn = new Map();
  const packages = new Set();
  const contextByPath = new Map();
  /** path -> simple name -> TypeInfo, for the types a file declares */
  const typesByPath = new Map();

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
    for (const imp of row.imports ?? []) {
      const star = imp.specifiers?.length === 1 && imp.specifiers[0] === '*';
      if (imp.static === true) {
        if (star) {
          staticOnDemand.push(imp.source);
        } else {
          const i = imp.source.lastIndexOf('.');
          if (i < 0) continue;
          const member = imp.source.slice(i + 1);
          if (!staticSingle.has(member)) staticSingle.set(member, []);
          staticSingle.get(member).push(imp.source.slice(0, i));
        }
      } else if (star) {
        onDemand.push(imp.source);
      } else {
        singleImports.set(lastSegment(imp.source), imp.source);
      }
    }
    // The directory the package path starts in: types declared under the
    // same source root are what this file is compiled against first.
    const dir = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
    const pkgDir = pkg.replace(/\./g, '/');
    const sourceRoot = pkgDir && (dir === pkgDir || dir.endsWith(`/${pkgDir}`))
      ? dir.slice(0, dir.length - pkgDir.length)
      : dir;
    return { row, path: row.path, pkg, singleImports, onDemand, staticSingle, staticOnDemand, sourceRoot };
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
    return local.length === 1 ? repoRef(local[0], true) : R_AMBIGUOUS;
  }

  function isRepoTypePrefix(segments) {
    for (let i = segments.length - 1; i > 0; i--) {
      if (typesByFqn.has(segments.slice(0, i).join('.'))) return true;
    }
    return false;
  }

  function isRepoPackagePrefix(segments) {
    for (let i = segments.length - 1; i > 0; i--) {
      if (packages.has(segments.slice(0, i).join('.'))) return true;
    }
    return false;
  }

  /** A fully qualified name written in an import or in code. */
  function resolveFqn(fqn, ctx) {
    const hit = lookupFqn(fqn, ctx);
    if (hit) return hit;
    const segments = fqn.split('.');
    // A nested type of a repository type, or a type missing from a
    // repository package: in the repository, but not resolvable.
    if (isRepoTypePrefix(segments)) return R_UNKNOWN;
    if (packages.has(segments.slice(0, -1).join('.'))) return R_UNKNOWN;
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
    const samePackage = lookupFqn(ctx.pkg ? `${ctx.pkg}.${name}` : name, ctx);
    if (samePackage) return samePackage;
    const found = [];
    for (const prefix of ctx.onDemand) {
      const hit = lookupFqn(`${prefix}.${name}`, ctx);
      if (hit) found.push(hit);
    }
    if (found.length > 0) {
      if (found.length > 1 || JAVA_LANG.has(name) || found[0].status !== 'repo') return R_AMBIGUOUS;
      return found[0];
    }
    if (JAVA_LANG.has(name)) return R_EXTERNAL_STATIC;
    return null;
  }

  function isOutsideScope(name) {
    return !packages.has(name) && !typesByFqn.has(name) && !isRepoTypePrefix(name.split('.'));
  }

  /** An on-demand import of something outside the repository. */
  function hasExternalOnDemand(ctx) {
    ctx.externalOnDemand ??= ctx.onDemand.some(isOutsideScope);
    return ctx.externalOnDemand;
  }

  /** A static on-demand import of a type outside the repository. */
  function hasExternalStaticOnDemand(ctx) {
    ctx.externalStaticOnDemand ??= ctx.staticOnDemand.some((t) => resolveFqn(t, ctx).status !== 'repo');
    return ctx.externalStaticOnDemand;
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

  /** Whether `name` is a method the source does not declare (D6). */
  function isGenerated(type, name, argCount) {
    for (const t of hierarchy(type).types) {
      if (t.kind === 'enum' && ((name === 'values' && argCount === 0) || (name === 'valueOf' && argCount === 1))) return true;
      if (t.kind === 'record' && argCount === 0 && t.fields.has(name)) return true;
      if ((name === 'builder' || name === 'toBuilder') && argCount === 0
        && [...t.annotations].some((a) => BUILDER_ANNOTATIONS.has(a))) return true;
      for (const field of t.fields.keys()) {
        const cap = capitalize(field);
        if (argCount === 0 && (name === `get${cap}` || name === `is${cap}`)) return true;
        if (argCount === 1 && name === `set${cap}`) return true;
        // Lombok names a boolean `isActive` field's accessors isActive / setActive.
        if (/^is[A-Z]/.test(field)) {
          if (argCount === 0 && name === field) return true;
          if (argCount === 1 && name === `set${field.slice(2)}`) return true;
        }
      }
    }
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
    if (candidates.length === 1) result = { outcome: 'edge', target: candidates[0] };
    else if (candidates.length > 1) result = { outcome: AMBIGUOUS };
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
          // field or a type an outside on-demand import brings in, or a
          // package outside the repository.
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
   * (`hidden`) or an outside static on-demand import (`outside`) may.
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
    return { res: null, hidden, outside: hasExternalStaticOnDemand(scope.ctx) };
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
      } else if (res.status === 'external') {
        // A static field of an outside type has an outside type.
        return R_EXTERNAL;
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
        const inner = resolveSite(file, receiver.site);
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

  /** Outcome of one call site, memoized: `{ outcome, callerId?, target? }`. */
  function resolveSite(state, index) {
    const cached = state.outcomes[index];
    if (cached) return cached;
    const site = state.row.callGraph[index];
    if (state.resolving.has(index) || !site) return { outcome: UNRESOLVED };
    state.resolving.add(index);
    const owner = typeof site.enclosingType === 'string' ? state.types.get(site.enclosingType) ?? null : null;
    const caller = owner ? resolveCaller(state, site, owner) : null;
    let result;
    // A null id is a node shared with another declaration (identity
    // collision): an edge to or from it would be an edge to the wrong one.
    if (!caller || caller.id == null) {
      result = { outcome: CALLER_UNRESOLVED };
    } else {
      const scope = {
        ctx: state.ctx,
        owner,
        typeVars: new Map([...owner.typeParams, ...(caller.fn.typeParameters ?? []).map((p) => [p.name, p.bound])]),
        exact: true,
      };
      // Lookup results are shared through caches; copy before adding the caller.
      result = { ...resolveTarget(state, site, { scope }, owner), callerId: caller.id };
      if (result.outcome === 'edge' && result.target.id == null) result = { outcome: AMBIGUOUS, target: result.target };
    }
    state.resolving.delete(index);
    state.outcomes[index] = result;
    return result;
  }

  function resolveTarget(state, site, context, owner) {
    const receiver = site.receiver;
    const argCount = Number.isInteger(site.argCount) ? site.argCount : null;
    if (!receiver || argCount === null) return { outcome: UNRESOLVED };
    if (receiver.kind === 'construct') return resolveConstruction(receiver.type, context.scope, argCount);
    const name = methodName(site);
    switch (receiver.kind) {
      case 'none':
        return resolveBareCall(owner, name, argCount, context.scope);
      case 'this':
        return lookupOn(owner, name, argCount);
      case 'super':
        return resolveSuperCall(owner, name, argCount);
      default:
        return callOn(resolveReceiver(receiver, context, state), name, argCount);
    }
  }

  function callOn(res, name, argCount) {
    switch (res.status) {
      case 'repo':
        return lookupOn(res.type, name, argCount);
      case 'external':
        return { outcome: EXTERNAL };
      case 'ambiguous':
        return { outcome: AMBIGUOUS };
      case 'array':
        return { outcome: isObjectMethod(name, argCount) ? EXTERNAL : UNRESOLVED };
      default:
        return { outcome: UNRESOLVED };
    }
  }

  /** `super.m()`: the superclass's hierarchy. */
  function resolveSuperCall(owner, name, argCount) {
    const superclass = owner.kind === 'class'
      ? supertypesOf(owner).find((s) => s.relation === 'extends')
      : null;
    if (superclass) return callOn(superclass.res, name, argCount);
    if (owner.kind === 'enum') return { outcome: EXTERNAL };
    return { outcome: isObjectMethod(name, argCount) ? EXTERNAL : UNRESOLVED };
  }

  /**
   * A bare call `m()` (D7): the enclosing type's hierarchy; only when no
   * method of that name is declared there, single then on-demand static
   * imports.
   */
  function resolveBareCall(owner, name, argCount, scope) {
    if (declaresMethodNamed(owner, name)) return lookupOn(owner, name, argCount);
    const h = hierarchy(owner);
    // A method an outside or unresolvable supertype declares would shadow
    // the static imports.
    const hidden = methodsMaybeOutside(owner);

    const fromImports = (typeNames) => {
      const candidates = [];
      let outside = false;
      for (const typeName of typeNames) {
        const res = resolveFqn(typeName, scope.ctx);
        if (res.status === 'repo') {
          for (const m of findMethods(res.type, name, argCount)) candidates.push(m);
        } else {
          outside = true;
        }
      }
      return { candidates, outside };
    };

    const single = scope.ctx.staticSingle.get(name);
    if (single) {
      const { candidates, outside } = fromImports(single);
      if (candidates.length === 1 && !outside && !hidden) return { outcome: 'edge', target: candidates[0] };
      if (candidates.length > 0) return { outcome: AMBIGUOUS };
      if (outside) return { outcome: h.hasUnknown ? UNRESOLVED : EXTERNAL };
    }
    const { candidates, outside } = fromImports(scope.ctx.staticOnDemand);
    if (candidates.length === 1 && !outside && !hidden) return { outcome: 'edge', target: candidates[0] };
    if (candidates.length > 0) return { outcome: AMBIGUOUS };
    if (isObjectMethod(name, argCount)) return { outcome: EXTERNAL };
    if (isGenerated(owner, name, argCount)) return { outcome: GENERATED };
    if (h.hasUnknown) return { outcome: UNRESOLVED };
    if (h.hasExternal || h.implicitExternal || outside) return { outcome: EXTERNAL };
    return { outcome: UNRESOLVED };
  }

  /** `new X(...)` (D9). */
  function resolveConstruction(typeText, scope, argCount) {
    const res = asInstance(resolveType(typeText, scope));
    if (res.status === 'external') return { outcome: EXTERNAL };
    if (res.status === 'ambiguous') return { outcome: AMBIGUOUS };
    if (res.status !== 'repo') return { outcome: UNRESOLVED };
    const type = res.type;
    const candidates = type.constructors.filter((c) => applicable(c, argCount));
    if (candidates.length === 1) return { outcome: 'edge', target: candidates[0] };
    if (candidates.length > 1) return { outcome: AMBIGUOUS };
    if (type.constructors.length === 0 && argCount === 0) return { outcome: GENERATED };
    if (type.kind === 'record') return { outcome: GENERATED };
    if ([...type.annotations].some((a) => CONSTRUCTOR_ANNOTATIONS.has(a))) return { outcome: GENERATED };
    return { outcome: UNRESOLVED };
  }

  // ---------------------------------------------------------------------------
  // Type hierarchy edges (D10)
  // ---------------------------------------------------------------------------

  /**
   * A parameter type, erased, as a key two declarations can be compared by:
   * the qualified name of a repository type, the imported or written name of
   * an outside one, a primitive as written. Null when the type cannot be
   * named for certain (a type variable, a nested or unresolvable type, an
   * outside type from an on-demand import).
   */
  function erasedTypeKey(text, owner) {
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

  return {
    /**
     * Type hierarchy edges between repository declarations (D10):
     * - `typeEdges`: a type to each supertype that resolves into the
     *   repository, `inherits` for `extends` and `implements` for
     *   `implements`, at the supertype's line;
     * - `methodEdges`: a concrete method of a class, enum or record to each
     *   abstract method of a repository ancestor with the same name and the
     *   same erased parameter types, at the method's first line.
     */
    hierarchyEdges() {
      const typeEdges = [];
      const methodEdges = [];
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
          if (type.kind === 'interface') continue;
          const ancestors = hierarchy(type).types.slice(1);
          if (ancestors.length === 0) continue;
          for (const methods of type.methodsByName.values()) {
            for (const method of methods) {
              if (method.abstract || method.id == null) continue;
              let signature;
              for (const ancestor of ancestors) {
                for (const target of ancestor.methodsByName.get(method.name) ?? []) {
                  if (!target.abstract || target.id == null || target.paramTypes.length !== method.paramTypes.length) continue;
                  signature ??= erasedSignature(method);
                  if (signature === null) break;
                  if (erasedSignature(target) !== signature) continue;
                  methodEdges.push({ source: method.id, target: target.id, file: type.path, line: method.lineRange[0] });
                }
              }
            }
          }
        }
      }
      return { typeEdges, methodEdges };
    },

    /**
     * Outcomes for every call site of one Java row, index for index with
     * `row.callGraph`: `{ outcome: 'edge', callerId, targetId }` or
     * `{ outcome: <bucket> }`.
     */
    resolveFileCalls(row) {
      const state = stateOf(row);
      const out = (row.callGraph ?? []).map((_, index) => {
        const result = resolveSite(state, index);
        return result.outcome === 'edge'
          ? { outcome: 'edge', callerId: result.callerId, targetId: result.target.id }
          : { outcome: result.outcome };
      });
      fileState.delete(row.path);
      return out;
    },
  };
}
