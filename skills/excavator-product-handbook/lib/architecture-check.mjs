/**
 * The architecture fact sheet (openspec change handbook-architecture-chapter, D3): `<out>/architecture.json`, the components of
 * the system (users, frontends, backends, databases, external and cloud services) and the links between them, each with passages
 * copied from project files. The chapter `chapters/architecture.md` next to it is checked by `checkChapter` unchanged.
 *
 * Refused (every problem in one run): a wrong shape, a kind outside the list, a repeated component id, an application root that is
 * not exactly one frontend or backend component, an application that is no root, a link whose ends are not declared components, a
 * link to itself, the same direction of a pair twice, a link text over 16 characters, a citation that is missing, outside the
 * project or not in its file. The reader text (labels, stacks, link texts, unknowns) only produces notes, as a chapter does.
 * Pure apart from reading the project through `files`.
 */

import { scanProject } from './applications.mjs';
import { bannedFragments, outsideLabels } from './banned-words.mjs';
import { citationProblems } from './citations.mjs';
import { narrativeProblem } from './narrative.mjs';
import { arrayOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const ARCHITECTURE_FILE = 'architecture.json';
export const ARCHITECTURE_CHAPTER_FILE = 'chapters/architecture.md';
export const ARCHITECTURE_FORMAT = 'excavator-product-handbook-architecture/1';
export const KINDS = Object.freeze(['users', 'frontend', 'backend', 'database', 'external', 'cloud']);
export const LINK_TEXT_MAX = 16;
/** The layer each kind is drawn in, from the left. */
export const LAYER_OF = Object.freeze({ users: 0, frontend: 1, backend: 2, database: 3, external: 3, cloud: 3 });
const APPLICATION_KINDS = ['frontend', 'backend'];

const evidence = arrayOf(objectOf({ file: nonEmptyString, passage: nonEmptyString }));
// The kind is a string here and checked against the list below, so a wrong kind does not hide the other problems.
const SCHEMA = objectOf({
  format: literal(ARCHITECTURE_FORMAT),
  components: arrayOf(objectOf({ id: nonEmptyString, label: nonEmptyString, kind: nonEmptyString, evidence }, { application: nonEmptyString, stack: nonEmptyString })),
  links: arrayOf(objectOf({ from: nonEmptyString, to: nonEmptyString, text: nonEmptyString, evidence })),
  unknowns: arrayOf(objectOf({ item: nonEmptyString, searched: nonEmptyString })),
});

const points = (text) => [...text].length;
const quoted = JSON.stringify;

/** The notes of one reader text: code-shaped words and the run's language. */
function textNotes(path, text, { memberDirs, languageCheck }) {
  const notes = [];
  for (const hit of outsideLabels(bannedFragments(text, { memberDirs }), text, new Set())) {
    notes.push({ id: path, kind: 'code', detail: `${quoted(hit.fragment)} is not allowed in reader text (${hit.category}); write it in plain words` });
  }
  const wrong = languageCheck === null ? null : narrativeProblem(text, new Set(), languageCheck.language);
  if (wrong !== null) notes.push({ id: path, kind: 'language', detail: wrong });
  return notes;
}

function citationLines(path, list, files) {
  if (list.length === 0) return [`${path}.evidence: at least one citation is needed`];
  return list.flatMap((entry, at) => citationProblems(files, { path: `${path}.evidence[${at}]`, file: entry.file, passage: entry.passage }));
}

/**
 * Check a parsed architecture.json. `ctx`: `files` (project-files.mjs), `memberDirs`, `languageCheck` and optionally `roots`
 * (the application roots; the scan `handbook.mjs applications` prints is made from the project when it is not given).
 * Returns `{ problems, notes, noteLines, counts, model }`; `model` (null on a problem) is what the outputs draw.
 */
export function architectureProblems(doc, { files, memberDirs = [], languageCheck = null, roots = null }) {
  const empty = { notes: [], noteLines: [], counts: { components: 0, links: 0, citations: 0 }, model: null };
  const shape = shapeProblems(doc, SCHEMA);
  if (shape.length > 0) return { problems: shape, ...empty };
  const problems = [];
  const notes = [];
  const applicationRoots = roots ?? scanProject(files.root).roots;
  const firstOf = new Map();
  let citations = 0;
  doc.components.forEach((component, at) => {
    const path = `components[${at}]`;
    if (!KINDS.includes(component.kind)) problems.push(`${path}.kind: ${quoted(component.kind)} is not a kind (${KINDS.join(', ')})`);
    if (firstOf.has(component.id)) problems.push(`${path}.id: ${quoted(component.id)} is used more than once (first at components[${firstOf.get(component.id)}])`);
    else firstOf.set(component.id, at);
    if (component.application !== undefined) {
      if (!APPLICATION_KINDS.includes(component.kind)) problems.push(`${path}.application: only a frontend or a backend has an application root`);
      else if (!applicationRoots.includes(component.application)) problems.push(`${path}.application: ${quoted(component.application)} is not an application root (roots: ${applicationRoots.map(quoted).join(', ') || 'none'})`);
    } else if (APPLICATION_KINDS.includes(component.kind)) {
      problems.push(`${path}: a frontend or a backend needs an application root (roots: ${applicationRoots.map(quoted).join(', ') || 'none'})`);
    }
    problems.push(...citationLines(path, component.evidence, files));
    citations += component.evidence.length;
    for (const key of ['label', 'stack']) if (component[key] !== undefined) notes.push(...textNotes(`${path}.${key}`, component[key], { memberDirs, languageCheck }));
  });
  for (const root of applicationRoots) {
    const found = doc.components.filter((component) => APPLICATION_KINDS.includes(component.kind) && component.application === root).length;
    if (found !== 1) problems.push(`application root ${quoted(root)} is not exactly one frontend or backend component (found ${found})`);
  }
  const pairs = new Map();
  doc.links.forEach((link, at) => {
    const path = `links[${at}]`;
    for (const end of ['from', 'to']) if (!firstOf.has(link[end])) problems.push(`${path}.${end}: ${quoted(link[end])} is not a declared component`);
    if (link.from === link.to) problems.push(`${path}: ${quoted(link.from)} is linked to itself`);
    else if (firstOf.has(link.from) && firstOf.has(link.to)) {
      const key = `${link.from}\u0000${link.to}`;
      if (pairs.has(key)) problems.push(`${path}: ${link.from} -> ${link.to} is already links[${pairs.get(key)}]`);
      else pairs.set(key, at);
    }
    const length = points(link.text);
    if (length > LINK_TEXT_MAX) problems.push(`${path}.text: ${length} characters; at most ${LINK_TEXT_MAX}; write the rest in the chapter`);
    problems.push(...citationLines(path, link.evidence, files));
    citations += link.evidence.length;
    notes.push(...textNotes(`${path}.text`, link.text, { memberDirs, languageCheck }));
  });
  doc.unknowns.forEach((unknown, at) => {
    for (const key of ['item', 'searched']) notes.push(...textNotes(`unknowns[${at}].${key}`, unknown[key], { memberDirs, languageCheck }));
  });
  const counts = { components: doc.components.length, links: doc.links.length, citations };
  const noteList = notes.map(({ id, kind, detail }) => ({ id, kind, detail }));
  return {
    problems,
    notes: noteList,
    noteLines: noteList.map((note) => `note: ${note.id} ${note.kind}: ${note.detail}`),
    counts,
    model: problems.length > 0 ? null : {
      components: doc.components.map((component) => ({ id: component.id, label: component.label, kind: component.kind, layer: LAYER_OF[component.kind], ...(component.application === undefined ? {} : { application: component.application }), ...(component.stack === undefined ? {} : { stack: component.stack }) })),
      links: doc.links.map((link) => ({ from: link.from, to: link.to, text: link.text })),
    },
  };
}

export const architectureCountsLine = (counts) => `Architecture: ${counts.components} components, ${counts.links} links, ${counts.citations} citations`;
