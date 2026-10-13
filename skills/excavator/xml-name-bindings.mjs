/**
 * xml-name-bindings.mjs
 *
 * Reads XML descriptors for the name-binding stage (openspec: changes/
 * name-binding-references, capability `fact-graph`, design D1, D4; changes/
 * xml-injection-references, design D4, D5): the root element of a file, the name
 * bindings its elements declare by the catalog's XML binders, the injection
 * sites its elements write (an attribute that names another declaration) by the
 * catalog's injection families, and the elements whose text opens a namespace to
 * expressions (the catalog's `elementTextIn` condition). Pure and build-free:
 * text in, facts out; what a binding's class text names, and what a site's name
 * names, is a later stage's business.
 *
 * The reading is tolerant: the files are real descriptors, some of them not
 * well-formed. It builds the tree from what it can read and never throws; text
 * it cannot make sense of yields fewer facts, not wrong ones. Comments are
 * masked first (a commented-out bean declares nothing), CDATA is text, entity
 * references in names and targets are decoded.
 *
 * Elements are matched by local name (a prefix is no part of it); the root's
 * namespace is its default namespace, or the namespace its own prefix is bound
 * to.
 */

import { findClose, lineAt, lineStarts, maskMarkupComments, parseAttributes } from './text-mentions.mjs';
import { decodeXmlText } from './xml-entities.mjs';

const NAME = /[A-Za-z_][\w.:-]*/y;
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

const localNameOf = (qname) => qname.slice(qname.lastIndexOf(':') + 1);
const prefixOf = (qname) => (qname.includes(':') ? qname.slice(0, qname.lastIndexOf(':')) : null);

/** Offset just past the `<!...>` declaration at `lt`: quotes and an internal subset in brackets are skipped. */
function skipDeclaration(text, lt) {
  let quote = '';
  let subset = false;
  for (let i = lt + 2; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      subset = true;
    } else if (ch === ']') {
      subset = false;
    } else if (ch === '>' && !subset) {
      return i + 1;
    }
  }
  return text.length;
}

/**
 * The tree of an XML text.
 *
 * @param {string} text
 * @param {{ maskComments?: boolean, rootOnly?: boolean }} [options]
 *   `maskComments` false is the test seam of the mutation tripwire. `rootOnly`
 *   stops after the root element's start tag.
 * @returns {{ root: object|null, elements: object[] }}
 *   every element in document order, `{ qname, local, prefix, line, attributes: [{ name, value, line }],
 *   parent, children, parts }`; `root` is the first element, or null for a text
 *   that is not XML (anything but whitespace before the first element).
 */
export function parseXml(text, { maskComments = true, rootOnly = false } = {}) {
  // Reading only the root stops at the first element, so the prolog's comments are
  // skipped where they stand instead of masking the whole text first.
  const source = maskComments && !rootOnly ? maskMarkupComments(text) : text;
  const starts = lineStarts(text);
  const elements = [];
  const stack = [];
  let root = null;
  let pos = 0;

  const addText = (start, end, cdata = false) => {
    if (end <= start) return true;
    const piece = source.slice(start, end);
    if (stack.length > 0) {
      stack[stack.length - 1].parts.push({ text: piece, start, cdata });
      return true;
    }
    // Outside every element: only whitespace (and a byte-order mark) before the root.
    return root !== null || /^[\s﻿]*$/.test(piece);
  };

  while (pos < source.length) {
    const lt = source.indexOf('<', pos);
    if (lt < 0) {
      if (!addText(pos, source.length)) return { root: null, elements: [] };
      break;
    }
    if (!addText(pos, lt)) return { root: null, elements: [] };

    if (source.startsWith('<![CDATA[', lt)) {
      const close = source.indexOf(']]>', lt + 9);
      addText(lt + 9, close < 0 ? source.length : close, true);
      pos = close < 0 ? source.length : close + 3;
    } else if (source.startsWith('<?', lt)) {
      const close = source.indexOf('?>', lt + 2);
      pos = close < 0 ? source.length : close + 2;
    } else if (source.startsWith('<!--', lt) && rootOnly) {
      const close = source.indexOf('-->', lt + 4);
      pos = close < 0 ? source.length : close + 3;
    } else if (!maskComments && source.startsWith('<!--', lt)) {
      pos = lt + 4; // tripwire seam: with the mask off, what a comment holds is markup
    } else if (source.startsWith('<!', lt)) {
      pos = skipDeclaration(source, lt);
    } else if (source[lt + 1] === '/') {
      NAME.lastIndex = lt + 2;
      const named = NAME.exec(source);
      let end = named ? lt + 2 + named[0].length : -1;
      while (end >= 0 && isSpace(source[end])) end++;
      if (end < 0 || source[end] !== '>') {
        pos = lt + 1;
        continue;
      }
      const open = stack.findLastIndex((element) => element.qname === named[0]);
      if (open >= 0) stack.length = open; // an end tag also closes anything left open inside it
      pos = end + 1;
    } else {
      NAME.lastIndex = lt + 1;
      const named = NAME.exec(source);
      if (!named) {
        pos = lt + 1;
        continue;
      }
      const nameEnd = lt + 1 + named[0].length;
      const end = findClose(source, nameEnd, '>');
      if (end < 0) {
        pos = lt + 1;
        continue;
      }
      const element = {
        qname: named[0],
        local: localNameOf(named[0]),
        prefix: prefixOf(named[0]),
        line: lineAt(starts, lt),
        attributes: parseAttributes(source, nameEnd, end).map((attribute) => ({
          name: attribute.name,
          value: decodeXmlText(source.slice(attribute.start, attribute.end)),
          line: lineAt(starts, attribute.start),
        })),
        parent: stack.length > 0 ? stack[stack.length - 1] : null,
        children: [],
        parts: [],
      };
      if (root === null) root = element;
      element.parent?.children.push(element);
      elements.push(element);
      pos = end + 1;
      if (!source.slice(nameEnd, end).trimEnd().endsWith('/')) stack.push(element);
      if (rootOnly) break;
    }
  }
  // Line of a text position, kept on the tree for `textOf`.
  return { root, elements, starts };
}

/** The trimmed text directly inside `element` (CDATA included, references decoded), or '' for none. */
export function textOf(element) {
  return element.parts.map((part) => (part.cdata ? part.text : decodeXmlText(part.text))).join('').trim();
}

/** The line of the first non-blank character of the text directly inside `element`, or the element's own line. */
function textLine(element, starts) {
  for (const part of element.parts) {
    const found = /\S/.exec(part.text);
    if (found) return lineAt(starts, part.start + found.index);
  }
  return element.line;
}

/**
 * The root element of a text: `{ local, prefix, namespace }`, the namespace
 * being the default one or the one the root's own prefix is bound to; null for
 * a text that is not XML.
 */
export function readRootElement(text) {
  const { root } = parseXml(text, { rootOnly: true });
  return root === null ? null : rootInfo(root);
}

function rootInfo(root) {
  const declared = root.attributes.find((attribute) => attribute.name === (root.prefix === null ? 'xmlns' : `xmlns:${root.prefix}`));
  return { local: root.local, prefix: root.prefix, namespace: declared ? declared.value : null };
}

/**
 * Does the root satisfy a binder's (or an expression language's) `root` and
 * `rootNamespace`? A `null` in the namespace list stands for a root that
 * declares no namespace (`info.namespace` is null then), as in a DTD-form file.
 */
export function rootMatches(info, rootName, rootNamespace) {
  return info.local === rootName && (rootNamespace === undefined || rootNamespace.includes(info.namespace));
}

function namesOf(element, source, starts) {
  const found = [];
  if (source.child !== undefined) {
    const child = element.children.find((candidate) => candidate.local === source.child);
    const text = child ? textOf(child) : '';
    if (text !== '') found.push({ name: text, line: textLine(child, starts) });
  } else {
    for (const attributeName of source.attribute) {
      const attribute = element.attributes.find((candidate) => candidate.name === attributeName);
      if (!attribute) continue;
      // `split` maps an attribute to the characters that separate the names
      // written in it; an attribute it does not list holds one name, whole.
      const separators = source.split?.[attributeName];
      const pieces = separators === undefined
        ? [attribute.value]
        : attribute.value.split(new RegExp(`[${separators.replace(/[\\\]^-]/g, '\\$&')}]`));
      for (const piece of pieces) {
        if (piece.trim() !== '') found.push({ name: piece.trim(), line: attribute.line });
      }
    }
  }
  // An id and a name that write the same name are one name.
  return found.filter((entry, i) => found.findIndex((other) => other.name === entry.name) === i);
}

/**
 * What the catalog's target rules say about an element: the first of the
 * `unknownWhen` attributes (in the catalog's order, not the file's) the element
 * writes, whether or not it has a value; and the trimmed value of the
 * `inheritFrom` attribute, null when it is not written or blank. Whether either
 * decides the binding's target is the resolution stage's business.
 */
function targetRulesOf(element, target) {
  const written = (name) => element.attributes.find((candidate) => candidate.name === name);
  const unknownBecause = (target.unknownWhen ?? []).find((name) => written(name) !== undefined) ?? null;
  const inherited = target.inheritFrom === undefined ? '' : written(target.inheritFrom)?.value.trim() ?? '';
  return { unknownBecause, inherits: inherited === '' ? null : inherited };
}

function targetOf(element, target) {
  let text = '';
  if (target.child !== undefined) {
    const child = element.children.find((candidate) => candidate.local === target.child);
    text = child ? textOf(child) : '';
  } else {
    text = element.attributes.find((candidate) => candidate.name === target.attribute)?.value.trim() ?? '';
  }
  return text === '' ? null : { kind: target.kind, text };
}

/**
 * The name bindings of a parsed descriptor, by the catalog's XML binders: for
 * each element a binder names whose direct parent is the binder's parent, one
 * `{ binder, name, line, target, missingTarget, unknownBecause, inherits }` per
 * name (`target` is `{ kind, text }`, or null for a name with no target text;
 * `missingTarget` is what the binder means by that, as the catalog says it;
 * `unknownBecause` is the attribute of the binder's `unknownWhen` the element
 * writes, `inherits` the value of its `inheritFrom` attribute - both null when
 * the binder has no such rule or the element does not write the attribute). An
 * element with no name declares no binding and is counted for its binder in
 * `missing`.
 *
 * @param {{ root: object|null, elements: object[], starts?: number[] }} tree
 * @param {Array<object>} xmlBinders the catalog's
 * @param {{ mutations?: { anyParent?: boolean } }} [options] `anyParent` is the
 *   test seam of a mutation tripwire: the parent element is not consulted
 * @returns {{ bindings: object[], missing: Record<string, number> }}
 */
export function bindingsOfTree(tree, xmlBinders, { mutations = {} } = {}) {
  const result = { bindings: [], missing: {} };
  if (tree.root === null) return result;
  const info = rootInfo(tree.root);
  for (const binder of xmlBinders) {
    if (!rootMatches(info, binder.root, binder.rootNamespace)) continue;
    for (const element of tree.elements) {
      if (element.local !== binder.element) continue;
      if (!mutations.anyParent && element.parent?.local !== binder.parent) continue;
      const names = namesOf(element, binder.name, tree.starts);
      if (names.length === 0) {
        result.missing[binder.id] = (result.missing[binder.id] ?? 0) + 1;
        continue;
      }
      const target = targetOf(element, binder.target);
      const { unknownBecause, inherits } = targetRulesOf(element, binder.target);
      for (const { name, line } of names) {
        result.bindings.push({ binder: binder.id, name, line, target, missingTarget: binder.missingTarget, unknownBecause, inherits });
      }
    }
  }
  return result;
}

/** `bindingsOfTree` over a text. */
export function readXmlBindings(text, xmlBinders, { mutations = {} } = {}) {
  return bindingsOfTree(parseXml(text, { maskComments: !mutations.noCommentMask }), xmlBinders, { mutations });
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `xmlns` and `xmlns:*` declare a namespace; they are never a site and never a census item. */
const isNamespaceDeclaration = (name) => name === 'xmlns' || name.startsWith('xmlns:');

/** The namespace a prefix is bound to at `element`: the nearest `xmlns:prefix` on it or its ancestors, or null. */
function namespaceOfPrefix(element, prefix) {
  const declaration = `xmlns:${prefix}`;
  for (let node = element; node; node = node.parent) {
    const declared = node.attributes.find((attribute) => attribute.name === declaration);
    if (declared) return declared.value;
  }
  return null;
}

/**
 * Does `attribute` of `element` write this site? An element and attribute site
 * wants the element's local name and the attribute exactly as written (a
 * prefixed attribute is another attribute); a namespace site wants the
 * attribute's prefix to be bound, where it is written, to the namespace and its
 * local name to end with the suffix. An attribute with no prefix is in no
 * namespace.
 */
function siteMatches(site, element, attribute, local) {
  if (site.element !== undefined) return element.local === site.element && attribute.name === site.attribute;
  const prefix = prefixOf(attribute.name);
  return prefix !== null && local.endsWith(site.attributeSuffix) && namespaceOfPrefix(element, prefix) === site.attributeNamespace;
}

/** Is this attribute, by its local name, one of the reference shapes the family's census counts? */
const isCensusAttribute = (census, local) => census.attributes.includes(local) || census.attributeSuffixes.some((suffix) => local.endsWith(suffix));

/**
 * The injection sites of a parsed descriptor, by the catalog's injection
 * families whose root (local name, and namespace - a `null` in the family's list
 * is a root with none) it has: the attributes that write the name of another
 * declaration, and what the family's census counts and no site read.
 *
 * A site is an attribute whose element and name, or namespace and name suffix,
 * a site of the family lists; its name is the value, trimmed. Its row is
 * `{ family, site, name, line, scope, consumer }`: `line` is the attribute's,
 * `scope` the site's (`unit` when the catalog does not say), `consumer` the
 * element itself or the nearest ancestor with the family's consumer element's
 * local name - an inner or anonymous bean included - as `{ line, target,
 * unknownBecause, inherits }`, read by the consumer binder's target rules as a
 * binding's are, or null when no element around is one. An element may write
 * several sites. An empty value is no site and is counted under
 * `element@attribute`.
 *
 * The census counts, per family, what looks like a reference and no site read:
 * an element whose local name is in `census.elements`, by that name, unless a
 * site came from it; an attribute whose local name is in `census.attributes` or
 * ends with one of `census.attributeSuffixes`, as `element@attribute` (the
 * element's local name, the attribute as written), unless a site came from it.
 * Keys come out in order.
 *
 * @param {{ root: object|null, elements: object[] }} tree
 * @param {{ xmlBinders: object[], xmlInjections: object[] }} catalog
 * @param {{ mutations?: { outermostConsumer?: boolean, anyRootNamespace?: boolean, noCensus?: boolean } }} [options]
 *   `mutations` are the test seams of the mutation tripwires: the outermost
 *   consumer element instead of the nearest; the family's root namespace not
 *   consulted; nothing counted.
 * @returns {{ sites: object[], uncovered: Record<string, number>, families: string[] }}
 *   `families` are the ids of the families whose root the file has, whether or
 *   not it wrote a site: the files a family read
 */
export function injectionsOfTree(tree, catalog, { mutations = {} } = {}) {
  const result = { sites: [], uncovered: {}, families: [] };
  if (tree.root === null) return result;
  const info = rootInfo(tree.root);
  const binders = new Map(catalog.xmlBinders.map((binder) => [binder.id, binder]));
  const count = mutations.noCensus ? () => {} : (key) => { result.uncovered[key] = (result.uncovered[key] ?? 0) + 1; };

  for (const family of catalog.xmlInjections) {
    if (!rootMatches(info, family.root, mutations.anyRootNamespace ? undefined : family.rootNamespace)) continue;
    result.families.push(family.id);
    const binder = binders.get(family.consumer.binder);

    const consumers = new Map();
    const consumerOf = (element) => {
      let consumer = null;
      for (let node = element; node; node = node.parent) {
        if (node.local !== family.consumer.element) continue;
        consumer = node;
        if (!mutations.outermostConsumer) break; // the nearest; the seam walks on to the outermost
      }
      if (consumer === null) return null;
      if (!consumers.has(consumer)) {
        consumers.set(consumer, { line: consumer.line, target: targetOf(consumer, binder.target), ...targetRulesOf(consumer, binder.target) });
      }
      return consumers.get(consumer);
    };

    for (const element of tree.elements) {
      let produced = 0;
      for (const attribute of element.attributes) {
        if (isNamespaceDeclaration(attribute.name)) continue;
        const local = localNameOf(attribute.name);
        const matching = family.sites.filter((site) => siteMatches(site, element, attribute, local));
        const asWritten = `${element.local}@${attribute.name}`;
        if (matching.length > 0) {
          const name = attribute.value.trim();
          if (name === '') {
            count(asWritten);
            continue;
          }
          for (const site of matching) {
            result.sites.push({ family: family.id, site: site.id, name, line: attribute.line, scope: site.scope ?? 'unit', consumer: consumerOf(element) });
            produced += 1;
          }
        } else if (isCensusAttribute(family.census, local)) {
          count(asWritten);
        }
      }
      if (produced === 0 && family.census.elements.includes(element.local)) count(element.local);
    }
  }
  result.uncovered = Object.fromEntries(Object.entries(result.uncovered).sort(([a], [b]) => compareText(a, b)));
  return result;
}

/** `injectionsOfTree` over a text. */
export function readXmlInjections(text, catalog, { mutations = {} } = {}) {
  return injectionsOfTree(parseXml(text, { maskComments: !mutations.noCommentMask }), catalog, { mutations });
}

/**
 * The places in a parsed descriptor where an element named by `condition`
 * holds exactly one of its values as text: `{ line, text }` each. Nothing when
 * the root is not `condition.root`.
 *
 * @param {{ root: object|null, elements: object[], starts?: number[] }} tree
 * @param {{ root: string, elements: string[], anyOf: string[] }} condition the catalog's `elementTextIn`
 */
export function textConditionHitsOfTree(tree, condition) {
  if (tree.root === null || tree.root.local !== condition.root) return [];
  const hits = [];
  for (const element of tree.elements) {
    if (!condition.elements.includes(element.local)) continue;
    const text = textOf(element);
    if (condition.anyOf.includes(text)) hits.push({ line: textLine(element, tree.starts), text });
  }
  return hits;
}

/** `textConditionHitsOfTree` over a text. */
export function readElementTextConditions(text, condition, { mutations = {} } = {}) {
  return textConditionHitsOfTree(parseXml(text, { maskComments: !mutations.noCommentMask }), condition);
}
