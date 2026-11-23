import type { FrameworkConfig, RouteRules } from "../languages/types.js";
import type {
  RouteAnchor,
  RouteFacts,
  RouteHandler,
  RouteMount,
  RoutePath,
  RouteSite,
  StructuralAnalysis,
} from "../types.js";
import type { TreeSitterNode as Node } from "./extractors/types.js";

/**
 * Framework-neutral route registration facts. Every framework-specific string
 * (factories, verbs, tags, keys, types) comes from `FrameworkConfig.routes`;
 * nothing here knows a framework. Reads syntax only, evaluates nothing.
 */

type Join = RouteRules["join"];
type Part = { lit: string } | { text: string };
type Receiver = { anchor: RouteAnchor; prefix: RoutePath };
type Placed<T> = { at: number; value: T };

const ROOT: RouteAnchor = { kind: "root" };
const EMPTY: RoutePath = { literal: "" };
const FUNCTION_TYPES = new Set([
  "arrow_function", "function_expression", "function", "generator_function", "func_literal",
]);

const line = (n: Node): number => n.startPosition.row + 1;
const clip = (text: string): string => text.slice(0, 80);
const named = (n: Node): Node[] => n.namedChildren.filter((c) => c.type !== "comment");

function* preorder(root: Node): Generator<Node> {
  const stack = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    yield n;
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i)!);
  }
}

function isLiteralNode(n: Node, go: boolean): boolean {
  if (go) return n.type === "interpreted_string_literal" || n.type === "raw_string_literal";
  if (n.type === "string") return true;
  return n.type === "template_string" && !n.namedChildren.some((c) => c.type === "template_substitution");
}

function literalOf(n: Node, go: boolean): string | undefined {
  return isLiteralNode(n, go) ? n.text.slice(1, -1) : undefined;
}

function partOf(n: Node | undefined | null, go: boolean): Part {
  if (!n) return { lit: "" };
  const lit = literalOf(n, go);
  return lit === undefined ? { text: clip(n.text) } : { lit };
}

function appendPath(prefix: string, part: string): string {
  const p = prefix.replace(/\/+$/, "");
  const q = part.replace(/^\/+/, "");
  let r = q === "" ? p : `${p}/${q}`;
  if (!r.startsWith("/")) r = `/${r}`;
  r = r.length > 1 ? r.replace(/\/+$/, "") : r;
  return r === "" ? "/" : r;
}

function compose(prefix: RoutePath, part: Part, kind: "own" | "prefix", join: Join): RoutePath {
  if (join === "nested" && "lit" in part && part.lit.startsWith("/")) {
    return { literal: appendPath("", part.lit) };
  }
  if ("unresolved" in prefix) return { unresolved: "prefix", text: prefix.text };
  if ("text" in part) return { unresolved: kind, text: part.text };
  if (part.lit === "") return prefix;
  return { literal: appendPath(prefix.literal, part.lit) };
}

function isDotted(n: Node): boolean {
  if (n.type === "identifier" || n.type === "this") return true;
  if (n.type === "member_expression") {
    const o = n.childForFieldName("object");
    return o !== null && isDotted(o);
  }
  if (n.type === "selector_expression") {
    const o = n.childForFieldName("operand");
    return o !== null && isDotted(o);
  }
  return false;
}

function callArguments(call: Node): Node[] {
  const args = call.childForFieldName("arguments");
  return args ? named(args) : [];
}

function calleeParts(call: Node): { obj: Node; prop: string } | undefined {
  const f = call.childForFieldName("function");
  if (!f) return undefined;
  const obj = f.childForFieldName(f.type === "selector_expression" ? "operand" : "object");
  const prop = f.childForFieldName(f.type === "selector_expression" ? "field" : "property");
  if (!obj || !prop || (f.type !== "member_expression" && f.type !== "selector_expression")) return undefined;
  return { obj, prop: prop.text };
}

function requireSource(call: Node, go: boolean): string | undefined {
  if (call.type !== "call_expression") return undefined;
  const f = call.childForFieldName("function");
  if (f?.type !== "identifier" || f.text !== "require") return undefined;
  const first = callArguments(call)[0];
  return first ? literalOf(first, go) : undefined;
}

function dynamicImportSource(value: Node, go: boolean): { source: string; line: number } | undefined {
  for (const n of preorder(value)) {
    if (n.type !== "call_expression" || n.childForFieldName("function")?.type !== "import") continue;
    const first = callArguments(n)[0];
    const lit = first ? literalOf(first, go) : undefined;
    if (lit !== undefined) return { source: lit, line: line(n) };
  }
  return undefined;
}

function classifyHandler(raw: Node | null | undefined, js: boolean): RouteHandler | null {
  if (!raw) return null;
  let value = raw;
  if (value.type === "jsx_expression") {
    const inner = named(value);
    if (inner.length === 1) value = inner[0];
  }
  if (js) {
    const mod = dynamicImportSource(value, false);
    if (mod) return { kind: "module", source: mod.source, line: mod.line };
  }
  let wrappedBy: string | undefined;
  if (value.type === "call_expression") {
    const args = callArguments(value);
    const callee = value.childForFieldName("function");
    if (args.length === 1 && callee && (isDotted(args[0]) || FUNCTION_TYPES.has(args[0].type))) {
      wrappedBy = callee.text;
      value = args[0];
    }
  }
  const wrap = wrappedBy === undefined ? {} : { wrappedBy };
  if (isDotted(value) && value.type !== "this") {
    return { kind: "name", text: value.text, line: line(value), ...wrap };
  }
  if (value.type === "jsx_self_closing_element" || value.type === "jsx_element") {
    const open = value.type === "jsx_element" ? value.childForFieldName("open_tag") : value;
    const tag = open?.childForFieldName("name");
    if (tag) return { kind: "name", text: tag.text, line: line(value) };
  }
  if (FUNCTION_TYPES.has(value.type)) {
    return { kind: "inline", line: line(value), endLine: value.endPosition.row + 1, ...wrap };
  }
  return { kind: "other", text: clip(value.text), line: line(value) };
}

function elementTag(el: Node): string | undefined {
  const open = el.type === "jsx_element" ? el.childForFieldName("open_tag") : el;
  return open?.childForFieldName("name")?.text;
}

function elementAttribute(el: Node, name: string): { value: Node | null } | undefined {
  const open = el.type === "jsx_element" ? el.childForFieldName("open_tag") : el;
  if (!open) return undefined;
  for (const attr of named(open)) {
    if (attr.type !== "jsx_attribute") continue;
    const parts = named(attr);
    if (parts[0]?.text === name) return { value: parts[1] ?? null };
  }
  return undefined;
}

function singleInner(n: Node): Node {
  if (n.type !== "jsx_expression") return n;
  const inner = named(n);
  return inner.length === 1 ? inner[0] : n;
}

function enclosingDeclarationName(node: Node): string {
  let cur = node;
  while (cur.parent && cur.parent.type !== "program") cur = cur.parent;
  if (!cur.parent) return "";
  if (cur.type === "export_statement") cur = cur.childForFieldName("declaration") ?? cur;
  if (cur.type === "function_declaration" || cur.type === "generator_function_declaration") {
    return cur.childForFieldName("name")?.text ?? "";
  }
  if (cur.type === "lexical_declaration" || cur.type === "variable_declaration") {
    for (const d of named(cur)) {
      if (d.type === "variable_declarator" && d.startIndex <= node.startIndex && d.endIndex >= node.endIndex) {
        return d.childForFieldName("name")?.text ?? "";
      }
    }
  }
  return "";
}

function exportsValueOf(nodes: Node[]): RouteFacts["exportsValue"] {
  let found: RouteFacts["exportsValue"];
  for (const n of nodes) {
    if (n.type !== "assignment_expression") continue;
    if (n.childForFieldName("left")?.text !== "module.exports") continue;
    const right = n.childForFieldName("right");
    if (!right) continue;
    if (right.type === "identifier") {
      found = { local: right.text, factory: false, line: line(n) };
    } else if (right.type === "arrow_function" || right.type === "function_expression" || right.type === "function") {
      const body = right.childForFieldName("body");
      if (body?.type !== "statement_block") continue;
      const returns = named(body).filter((c) => c.type === "return_statement");
      const value = returns.length === 1 ? named(returns[0])[0] : undefined;
      if (value?.type === "identifier") found = { local: value.text, factory: true, line: line(n) };
    }
  }
  return found;
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function extractRouteFacts(
  rootNode: Node,
  languageId: string,
  imports: StructuralAnalysis["imports"],
  configs: FrameworkConfig[],
): RouteFacts | undefined {
  const lang = languageId === "tsx" ? "typescript" : languageId;
  const go = lang === "go";
  const js = lang === "typescript" || lang === "javascript";
  if (!go && !js) return undefined;
  const candidates = configs.filter((c) => c.routes && c.languages.includes(lang));
  if (candidates.length === 0) return undefined;

  const known = new Set(imports.map((i) => i.source));
  const unmet = (c: FrameworkConfig) => !c.routes!.importSources.some((s) => known.has(s));
  if (js && candidates.some(unmet)) {
    for (const n of preorder(rootNode)) {
      const src = requireSource(n, false);
      if (src !== undefined) known.add(src);
    }
  }
  const active = candidates.filter((c) => !unmet(c));
  if (active.length === 0) return undefined;

  const nodes = [...preorder(rootNode)];
  const importBindings = new Set<string>();
  for (const imp of imports) for (const b of imp.bindings ?? []) importBindings.add(b.local);

  const sites: Placed<RouteSite>[] = [];
  const mounts: Placed<RouteMount>[] = [];
  const ignoredMounts: Placed<RouteFacts["ignoredMounts"][number]>[] = [];
  const ruleUse: Record<string, { kind: "http" | "ui"; join: Join }> = {};

  for (const config of active) {
    const rules = config.routes!;
    const sitesBefore = sites.length;
    const mountsBefore = mounts.length;
    const ignoredBefore = ignoredMounts.length;
    const rec = rules.receivers ?? {};
    const receivers = new Map<string, Receiver>();
    const routerNames = new Set<string>();
    const requireLocals = new Map<string, { source: string; called: boolean }>();
    const containerRe = rules.objects?.containerTypes?.length
      ? new RegExp(`\\b(?:${rules.objects.containerTypes.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`)
      : undefined;

    const initialise = (name: string, value: Node | null | undefined) => {
      if (!value || value.type !== "call_expression") return;
      if (js) {
        const direct = requireSource(value, go);
        const inner = value.childForFieldName("function");
        const called = inner ? requireSource(inner, go) : undefined;
        if (direct !== undefined) requireLocals.set(name, { source: direct, called: false });
        else if (called !== undefined) requireLocals.set(name, { source: called, called: true });
      }
      const calleeText = value.childForFieldName("function")?.text ?? "";
      if (rec.rootFactories?.includes(calleeText)) {
        receivers.set(name, { anchor: ROOT, prefix: EMPTY });
      } else if (rec.routerFactories?.includes(calleeText)) {
        receivers.set(name, { anchor: { kind: "local", name }, prefix: EMPTY });
        routerNames.add(name);
      } else {
        const parts = calleeParts(value);
        const parent = parts?.obj.type === "identifier" ? receivers.get(parts.obj.text) : undefined;
        if (parts && parent && rec.groupMethods?.includes(parts.prop)) {
          const first = callArguments(value)[0];
          const prefix = first ? compose(parent.prefix, partOf(first, go), "prefix", rules.join) : parent.prefix;
          receivers.set(name, { anchor: parent.anchor, prefix });
        }
      }
    };

    // Pass 1, source order: receivers, require locals, route containers.
    for (const n of nodes) {
      if (js && n.type === "variable_declarator") {
        const id = n.childForFieldName("name");
        if (id?.type === "identifier") {
          initialise(id.text, n.childForFieldName("value"));
          const type = n.childForFieldName("type");
          if (containerRe && type && containerRe.test(type.text)) routerNames.add(id.text);
        }
      } else if (js && n.type === "assignment_expression") {
        const left = n.childForFieldName("left");
        if (left?.type === "identifier") initialise(left.text, n.childForFieldName("right"));
      } else if (go && n.type === "short_var_declaration") {
        const left = n.childForFieldName("left");
        const right = n.childForFieldName("right");
        if (left && right) {
          const rs = named(right);
          named(left).forEach((id, i) => id.type === "identifier" && initialise(id.text, rs[i]));
        }
      } else if (go && n.type === "var_spec") {
        const values = n.childForFieldName("value");
        const rs = values ? named(values) : [];
        n.childrenForFieldName("name").forEach((id, i) => id.type === "identifier" && initialise(id.text, rs[i]));
      } else if (go && n.type === "parameter_declaration") {
        const type = n.childForFieldName("type")?.text;
        if (type === undefined) continue;
        for (const id of n.childrenForFieldName("name")) {
          if (rec.rootParamTypes?.includes(type)) {
            receivers.set(id.text, { anchor: ROOT, prefix: EMPTY });
          } else if (rec.prefixParamTypes?.includes(type)) {
            receivers.set(id.text, { anchor: { kind: "parameter", name: id.text, type }, prefix: EMPTY });
          }
        }
      }
    }

    const classifyTarget = (id: Node): RouteMount["target"] => {
      const name = id.text;
      if (routerNames.has(name)) return { kind: "local", name };
      if (importBindings.has(name)) return { kind: "binding", name };
      const req = requireLocals.get(name);
      if (req) return { kind: "require", source: req.source, called: req.called };
      return { kind: "other", text: clip(name) };
    };

    // The target of a mount-method call: an identifier, `require('x')` or `require('x')(...)`.
    const classifyCallTarget = (arg: Node): RouteMount["target"] | undefined => {
      if (arg.type === "identifier") return classifyTarget(arg);
      if (arg.type !== "call_expression") return undefined;
      const direct = requireSource(arg, go);
      if (direct !== undefined) return { kind: "require", source: direct, called: false };
      const inner = arg.childForFieldName("function");
      const called = inner ? requireSource(inner, go) : undefined;
      return called === undefined ? undefined : { kind: "require", source: called, called: true };
    };

    const addMount = (at: Node, path: RoutePath, anchor: RouteAnchor, id: Node) => {
      pushMount(at, path, anchor, classifyTarget(id));
    };
    const pushMount = (at: Node, path: RoutePath, anchor: RouteAnchor, target: RouteMount["target"]) => {
      mounts.push({
        at: at.startIndex,
        value: { framework: config.id, line: line(at), path, anchor, target },
      });
    };

    // A list element of a route container: an identifier or `...identifier` is a mount.
    const mountListElement = (el: Node, path: RoutePath, anchor: RouteAnchor): boolean => {
      const id = el.type === "spread_element" ? named(el)[0] : el;
      if (id?.type !== "identifier") return false;
      addMount(el, path, anchor, id);
      return true;
    };

    const objects = rules.objects;
    const processObject = (obj: Node, parentPath: RoutePath, anchor: RouteAnchor) => {
      if (!objects) return;
      const keys = new Map<string, Node>();
      for (const c of named(obj)) {
        if (c.type === "pair") {
          const k = c.childForFieldName("key");
          const v = c.childForFieldName("value");
          if (k && v) {
            const key = k.type === "string" ? k.text.slice(1, -1) : k.text;
            if (!keys.has(key)) keys.set(key, v);
          }
        } else if (c.type === "shorthand_property_identifier" && !keys.has(c.text)) {
          keys.set(c.text, c);
        }
      }
      const isIndex = objects.indexKey !== undefined && keys.get(objects.indexKey)?.type === "true";
      const pathValue = keys.get(objects.pathKey);
      const path = isIndex || !pathValue
        ? parentPath
        : compose(parentPath, partOf(pathValue, false), "own", rules.join);
      const handlerKey = objects.handlerKeys.find((k) => keys.has(k));
      sites.push({
        at: obj.startIndex,
        value: {
          framework: config.id, form: "object", line: line(obj), method: null, path, anchor,
          handler: handlerKey ? classifyHandler(keys.get(handlerKey), js) : null,
        },
      });
      const children = keys.get(objects.childrenKey);
      if (!children) return;
      if (children.type === "identifier") {
        addMount(children, path, anchor, children);
      } else if (children.type === "array") {
        for (const el of named(children)) {
          if (el.type === "object") processObject(el, path, anchor);
          else mountListElement(el, path, anchor);
        }
      }
    };
    const processList = (list: Node, anchor: RouteAnchor) => {
      for (const el of named(list)) {
        if (el.type === "object") processObject(el, EMPTY, anchor);
        else mountListElement(el, EMPTY, anchor);
      }
    };

    // JSX elements.
    const elements = rules.elements;
    const infoCache = new Map<number, RoutePath>();
    const routeAncestor = (el: Node): Node | undefined => {
      let prev = el;
      for (let cur = el.parent; cur; prev = cur, cur = cur.parent) {
        const cameFromAttributes = prev.type === "jsx_opening_element";
        if (cur.type === "jsx_element" && !cameFromAttributes && elements!.tags.includes(elementTag(cur) ?? "")) return cur;
      }
      return undefined;
    };
    const anchorOfElement = (el: Node): RouteAnchor => {
      let prev = el;
      for (let cur = el.parent; cur; prev = cur, cur = cur.parent) {
        if (cur.type === "jsx_element" && prev.type !== "jsx_opening_element" && elements!.rootTags?.includes(elementTag(cur) ?? "")) return ROOT;
      }
      return { kind: "local", name: enclosingDeclarationName(el) };
    };
    const elementPath = (el: Node): RoutePath => {
      const cached = infoCache.get(el.id);
      if (cached) return cached;
      const parent = routeAncestor(el);
      const parentPath = parent ? elementPath(parent) : EMPTY;
      const index = elements!.indexAttribute ? elementAttribute(el, elements!.indexAttribute) : undefined;
      const isIndex = index !== undefined && !(index.value && singleInner(index.value).text === "false");
      const attr = elementAttribute(el, elements!.pathAttribute);
      let result = parentPath;
      if (!isIndex && attr?.value) {
        const inner = singleInner(attr.value);
        const lit = literalOf(inner, false);
        const part: Part = lit !== undefined ? { lit } : { text: clip(attr.value.text) };
        result = compose(parentPath, part, "own", rules.join);
      }
      infoCache.set(el.id, result);
      return result;
    };

    // Pass 2: uses.
    for (const n of nodes) {
      if (n.type === "call_expression") {
        const parts = calleeParts(n);
        const recv = parts?.obj.type === "identifier" ? receivers.get(parts.obj.text) : undefined;
        if (parts && recv) {
          const args = callArguments(n);
          const method = rules.calls?.verbs[parts.prop];
          if (method !== undefined && rules.calls && args.length >= 2) {
            sites.push({
              at: n.startIndex,
              value: {
                framework: config.id, form: "call", line: line(n), method,
                path: compose(recv.prefix, partOf(args[rules.calls.pathArgument], go), "own", rules.join),
                anchor: recv.anchor,
                handler: classifyHandler(args[args.length - 1], js),
              },
            });
          } else if (rules.mounts?.methods.includes(parts.prop)) {
            const last = args[args.length - 1];
            const target = last ? classifyCallTarget(last) : undefined;
            if (!last || !target) {
              ignoredMounts.push({
                at: n.startIndex,
                value: { framework: config.id, line: line(n), text: last ? clip(last.text) : "" },
              });
            } else {
              const first = args.length >= 2 && args[0].id !== last.id ? args[0] : undefined;
              const path = compose(recv.prefix, partOf(first, go), "prefix", rules.join);
              pushMount(n, path, recv.anchor, target);
            }
          }
        } else if (objects?.rootFactories?.includes(n.childForFieldName("function")?.text ?? "")) {
          for (const arg of callArguments(n)) {
            if (arg.type === "array") processList(arg, ROOT);
            else if (arg.type === "identifier") addMount(arg, EMPTY, ROOT, arg);
          }
        }
      } else if (objects && containerRe && js && n.type === "variable_declarator") {
        const type = n.childForFieldName("type");
        const id = n.childForFieldName("name");
        const value = n.childForFieldName("value");
        if (type && id && value && containerRe.test(type.text)) {
          const anchor: RouteAnchor = { kind: "local", name: id.text };
          if (value.type === "object") processObject(value, EMPTY, anchor);
          else if (value.type === "array") processList(value, anchor);
        }
      } else if (elements && (n.type === "jsx_element" || n.type === "jsx_self_closing_element")) {
        if (!elements.tags.includes(elementTag(n) ?? "")) continue;
        const handlerAttr = elements.handlerAttributes.find((a) => elementAttribute(n, a));
        sites.push({
          at: n.startIndex,
          value: {
            framework: config.id, form: "element", line: line(n), method: null,
            path: elementPath(n), anchor: anchorOfElement(n),
            handler: handlerAttr ? classifyHandler(elementAttribute(n, handlerAttr)!.value, js) : null,
          },
        });
      }
    }
    if (sites.length > sitesBefore || mounts.length > mountsBefore || ignoredMounts.length > ignoredBefore) {
      ruleUse[config.id] = { kind: rules.kind, join: rules.join };
    }
  }

  const exportsValue = js ? exportsValueOf(nodes) : undefined;
  if (sites.length === 0 && mounts.length === 0 && ignoredMounts.length === 0 && !exportsValue) return undefined;
  const bySource = <T>(list: Placed<T>[]): T[] =>
    list.map((p, i) => ({ p, i })).sort((a, b) => a.p.at - b.p.at || a.i - b.i).map((x) => x.p.value);
  return {
    sites: bySource(sites),
    mounts: bySource(mounts),
    ignoredMounts: bySource(ignoredMounts),
    rules: sortedRecord(ruleUse),
    ...(exportsValue ? { exportsValue } : {}),
  };
}
