/**
 * java-type-queries.mjs
 *
 * Read-only type queries on the Java call resolver (openspec: changes/
 * by-type-injection, capability `fact-graph`, design D6). A stage that reasons
 * about the repository's types - which of them can be an injected value, which
 * are ancestors of which - must read them the way call resolution does: one
 * set of Java scoping rules, not a second copy. The resolver builds these
 * queries over its own internals (the type index, `resolveType`,
 * `supertypesOf`, `hierarchy`) and hands the result out beside
 * `hierarchyEdges` and `resolveFileCalls`.
 *
 * What the queries give out is a public form of what the resolver keeps:
 * - a type is a frozen view `{ id, fqn, name, kind, path, cls }`, the same
 *   object on every query, so it is a Map key and goes back into the other
 *   queries. `cls` is the structure row's class entry itself, by reference;
 * - a resolution is a frozen `{ status }` with `status` one of `repo` (the
 *   `type` view), `external` (provably outside the repository), `unknown`,
 *   `ambiguous` (the `types` views when every alternative is a repository
 *   type), `array`, `primitive` or `typeVariable` (its `name` and `bound`).
 *   Nothing lands in a fourth state: an input is one of these.
 *
 * Nothing here changes what the resolver resolves.
 */

const UNKNOWN = Object.freeze({ status: 'unknown' });
const AMBIGUOUS = Object.freeze({ status: 'ambiguous' });
const EXTERNAL = Object.freeze({ status: 'external' });
const ARRAY = Object.freeze({ status: 'array' });
const PRIMITIVE = Object.freeze({ status: 'primitive' });

/**
 * @param {{
 *   types: object[],
 *   contextOf: (path: string) => object | undefined,
 *   resolveType: Function,
 *   supertypesOf: Function,
 *   hierarchy: Function,
 *   typeScope: Function,
 *   stripTypeText: Function,
 * }} internals the resolver's own: `types` its indexed types in rows order
 *   then class order, `contextOf` the file context of a row's path
 */
export function createJavaTypeQueries({ types, contextOf, resolveType, supertypesOf, hierarchy, typeScope, stripTypeText }) {
  const viewOf = new Map();
  const typeOf = new WeakMap();
  const views = Object.freeze(types.map((type) => {
    const view = Object.freeze({ id: type.id, fqn: type.fqn, name: type.name, kind: type.kind, path: type.path, cls: type.cls });
    viewOf.set(type, view);
    typeOf.set(view, type);
    return view;
  }));

  /** The resolver's type behind a view this resolver handed out. */
  function internal(view) {
    const type = typeOf.get(view);
    if (!type) throw new TypeError('java-call-resolution: not a type view of this resolver');
    return type;
  }

  /** The public form of one of the resolver's resolution results. */
  function publicResolution(res) {
    switch (res.status) {
      case 'repo':
        return Object.freeze({ status: 'repo', type: viewOf.get(res.type) });
      case 'ambiguous':
        return res.types ? Object.freeze({ status: 'ambiguous', types: Object.freeze(res.types.map((type) => viewOf.get(type))) }) : AMBIGUOUS;
      case 'external':
        return EXTERNAL;
      case 'array':
        return ARRAY;
      case 'primitive':
        return PRIMITIVE;
      case 'unknown':
        return UNKNOWN;
      default:
        throw new Error(`java-call-resolution: a type resolution outside the known set: ${JSON.stringify(res.status)}`);
    }
  }

  const supertypeCache = new Map();
  const ancestorCache = new Map();

  return {
    /**
     * Every repository type the resolver indexed, one view per declaration
     * and so once per declaration of a name two files both declare: rows
     * order, then the order of a row's classes. A class entry with no
     * qualified name or kind is not indexed.
     */
    declaredTypes() {
      return views;
    },

    /**
     * A type written in a file, resolved the way the resolver resolves one.
     * `owner` is the top-level type view the text is written in, or null for
     * file scope; the owner's type parameters and the `methodTypeParameters`
     * (`[{ name, bound }]` as in `functions[].typeParameters`) are the type
     * variables in scope, the method's over the owner's. A text whose
     * erased base name is one of them is a `typeVariable`, checked before
     * anything else: it is no type the repository or an import could supply.
     * Generics, annotations and array dimensions are read as the resolver
     * reads them (`stripTypeText`): `List<T>` is `List`, `T[]` is an array.
     */
    resolveTypeText({ path, text, owner = null, methodTypeParameters = [] }) {
      const ctx = contextOf(path);
      if (!ctx) throw new Error(`java-call-resolution: no structure row for ${JSON.stringify(path)}`);
      const ownerType = owner === null ? null : internal(owner);
      if (ownerType && ownerType.path !== path) {
        throw new Error(`java-call-resolution: ${JSON.stringify(ownerType.fqn)} is declared in ${JSON.stringify(ownerType.path)}, not in ${JSON.stringify(path)}`);
      }
      if (!Array.isArray(methodTypeParameters)) throw new TypeError('java-call-resolution: methodTypeParameters must be an array');
      const typeVars = new Map([
        ...(ownerType ? ownerType.typeParams : []),
        ...methodTypeParameters.map((p) => [p.name, p.bound ?? null]),
      ]);
      if (typeof text === 'string') {
        const { base, dims } = stripTypeText(text);
        if (dims === 0 && typeVars.has(base)) {
          return Object.freeze({ status: 'typeVariable', name: base, bound: typeVars.get(base) });
        }
      }
      const scope = ownerType ? { ...typeScope(ownerType, false), typeVars } : { ctx, owner: null, typeVars, exact: false };
      return publicResolution(resolveType(text, scope));
    },

    /**
     * The supertypes a type writes, in source order: `{ relation, line, text,
     * resolution }` with `text` the supertype as written (generics included)
     * and `resolution` read in the type's own file, as the hierarchy reads it.
     */
    directSupertypes(type) {
      const found = internal(type);
      let list = supertypeCache.get(found);
      if (!list) {
        const written = found.cls.supertypes ?? [];
        list = Object.freeze(supertypesOf(found).map((s, i) => Object.freeze({
          relation: s.relation,
          line: s.line,
          text: written[i].type,
          resolution: publicResolution(s.res),
        })));
        supertypeCache.set(found, list);
      }
      return list;
    },

    /**
     * The repository ancestors of a type, nearest first (superclass before
     * interfaces at each level), the type itself not among them, with whether
     * a supertype on the way lies outside the repository (`hasExternal`) or
     * cannot be resolved (`hasUnknown`): `{ ancestors, hasExternal, hasUnknown }`.
     */
    ancestors(type) {
      const found = internal(type);
      let result = ancestorCache.get(found);
      if (!result) {
        const h = hierarchy(found);
        result = Object.freeze({
          ancestors: Object.freeze(h.types.filter((t) => t !== found).map((t) => viewOf.get(t))),
          hasExternal: h.hasExternal,
          hasUnknown: h.hasUnknown,
        });
        ancestorCache.set(found, result);
      }
      return result;
    },
  };
}
