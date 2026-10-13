/**
 * xml-name-bindings.mjs
 *
 * Reads XML descriptors for the name-binding stage (openspec: changes/
 * name-binding-references, capability `fact-graph`, design D1, D4): the root
 * element of a file, the name bindings its elements declare by the catalog's
 * XML binders, and the elements whose text opens a namespace to expressions
 * (the catalog's `elementTextIn` condition). Pure and build-free: text in,
 * facts out; what a binding's class text names is a later stage's business.
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
