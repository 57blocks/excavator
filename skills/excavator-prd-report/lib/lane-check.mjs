/**
 * The two files a feature lane writes (openspec change prd-feature-pipeline,
 * design D3): `features/<id>.md` and `findings/<id>.json`. The chapter needs
 * front-matter that matches the index, with the actors, permission roles,
 * flows and open items it declares matching its `###` headings and one `##`
 * heading (change prd-report-prd-shape, design D3), a mermaid block, a
 * `<details>` evidence block and `path:line[-line]` anchors that resolve
 * inside the project, outside the directories that hold dependencies or
 * build output (D8); each finding needs a known class, no advice in its statement and
 * evidence passages that occur exactly once in their files. When every
 * finding passes, the line each passage starts on is written back.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.mjs';
import { parseFrontMatter } from './front-matter.mjs';
import { INDEX_FILE, MAX_ATTEMPTS, loadIndex } from './index-check.mjs';
import { isObject, isString, isStringArray, readJson, writeJson } from './json-file.mjs';
import { findOnce, normalize } from './normalize.mjs';
import { projectFiles, skippedDirectoryReason } from './project-files.mjs';
import { projectRootProblem } from './project-root.mjs';

const cjk = (...points) => String.fromCodePoint(...points);

/**
 * Words that make a finding's statement advice rather than a statement of the
 * defect. Code spans (`...`) are removed first: a statement may name a key or
 * a flag. English words match only in lower case and only as a word of their
 * own, with no letter, digit, underscore or hyphen on either side (the three
 * marked stems also with an ending: recommended, suggests, refactoring), so
 * names such as Leave-Recommend, RecommendMail or should-not pass; the
 * Chinese ones (built from their code points) match anywhere. Words that
 * also state a fact (must, consider, improve, needs to be: "the user must be
 * an admin") are not in the list.
 */
export const ADVICE_WORDS = Object.freeze([
  'should', 'recommend', 'suggest', 'refactor', 'ought to', 'better to', 'it would be better',
  cjk(0x5efa, 0x8bae), cjk(0x5e94, 0x8be5), cjk(0x5e94, 0x5f53), cjk(0x63a8, 0x8350), cjk(0x91cd, 0x6784), cjk(0x4f18, 0x5316),
]);
const STEMS = new Set(['recommend', 'suggest', 'refactor']);
const ADVICE_MATCHERS = ADVICE_WORDS.map((word) => {
  if (/[^\x00-\x7f]/.test(word)) return { word, test: (text) => text.includes(word) };
  const body = word.split(' ').join('\\s+');
  const regex = new RegExp(`(?<![\\w-])${body}${STEMS.has(word) ? '\\w*' : ''}(?![\\w-])`);
  return { word, test: (text) => regex.test(text) };
});

/** The first advice word in `statement`, or null. */
export function adviceWord(statement) {
  const text = normalize(statement.replace(/`[^`]*`/g, ' ')).text;
  return ADVICE_MATCHERS.find((matcher) => matcher.test(text))?.word ?? null;
}

export const FINDING_CLASSES = Object.freeze(['product', 'technical']);
const FINDING_KEYS = Object.freeze(['id', 'class', 'statement', 'flows', 'evidence']);
const EVIDENCE_KEYS = Object.freeze(['file', 'passage', 'line']);
const ANCHOR = /`([^`\s]+):(\d+)(?:-(\d+))?`/g;
const MERMAID = /^```mermaid[ \t]*$/gm;
const DETAILS = /<details>[\s\S]*?<\/details>/g;

export const chapterPath = (id) => `features/${id}.md`;
export const findingsPath = (id) => `findings/${id}.json`;

/** The headings of a Markdown body, outside code fences: { level, text } in order. */
function headingsOf(body) {
  const headings = [];
  let fence = null;
  for (const line of body.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (marker !== undefined) {
      fence = { char: marker[0], length: marker.length };
      continue;
    }
    const match = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2] });
  }
  return headings;
}

/** Problems of the declared structure: the lists of the front-matter against the body's headings (design D3). */
function structureProblems(data, body, feature) {
  const problems = [];
  const headings = headingsOf(body);
  const sub = headings.filter((heading) => heading.level === 3).map((heading) => heading.text);
  if (Object.hasOwn(data, 'roles')) problems.push('front-matter roles is no longer read; write actors and permissionRoles');
  const lists = {};
  for (const key of ['actors', 'permissionRoles', 'flows']) {
    if (isStringArray(data[key])) lists[key] = data[key];
    else problems.push(`front-matter ${key} is not a list`);
  }
  if (lists.actors && lists.permissionRoles) {
    for (const name of lists.actors) if (lists.permissionRoles.includes(name)) problems.push(`${name} is both an actor and a permission role`);
  }
  if (lists.flows) {
    for (const title of lists.flows) if (!sub.includes(title)) problems.push(`flow "${title}" is not a ### heading of the chapter`);
    if (feature.kind === 'reference') {
      if (lists.flows.length > 0) problems.push('a reference feature lists flows');
    } else if (lists.flows.length === 0) {
      problems.push(`${feature.kind === 'automated' ? 'an' : 'a'} ${feature.kind} feature lists no flow`);
    }
  }
  if (Object.hasOwn(data, 'openItems')) {
    const title = data.openItems;
    if (typeof title !== 'string' || !sub.includes(title)) problems.push(`open items heading "${title}" is not a ### heading of the chapter`);
    else if (sub.at(-1) !== title) problems.push(`open items heading "${title}" is not the last ### heading`);
  }
  const chapters = headings.filter((heading) => heading.level === 2).length;
  if (chapters !== 1 || headings[0]?.level !== 2) {
    problems.push(`the chapter has ${chapters} ## headings; it has one, ## ${feature.name}, as its first heading`);
  }
  return problems;
}

/** Problems of the chapter file, and its counts. */
function chapterProblems(text, feature, files) {
  const problems = [];
  const add = (problem) => problems.push(`${feature.id}: ${problem}`);
  const front = parseFrontMatter(text);
  let body = text;
  let actors = [];
  if (!front.ok) {
    add(`${chapterPath(feature.id)} ${front.reason}`);
  } else {
    body = front.body;
    const data = front.data;
    if (data.id !== feature.id) add(`front-matter id is ${JSON.stringify(data.id ?? null)}, not ${feature.id}`);
    if (!isString(data.name)) add('front-matter name is missing');
    if (data.kind !== feature.kind) add(`front-matter kind is ${JSON.stringify(data.kind ?? null)}, not the index's ${feature.kind}`);
    if (data.chapter !== feature.chapter) add(`front-matter chapter is ${JSON.stringify(data.chapter ?? null)}, not the index's ${feature.chapter}`);
    if (!isStringArray(data.triggers)) add('front-matter triggers is not a list');
    for (const problem of structureProblems(data, body, feature)) add(problem);
    if (isStringArray(data.actors)) actors = data.actors;
  }
  const diagrams = (body.match(MERMAID) ?? []).length;
  if (diagrams === 0) add('no mermaid block');
  const blocks = body.match(DETAILS) ?? [];
  if (blocks.length === 0) add('no <details> evidence block');
  let evidence = 0;
  for (const block of blocks) {
    for (const match of block.matchAll(ANCHOR)) {
      evidence += 1;
      const [raw, path, startText, endText] = match;
      const anchor = raw.slice(1, -1);
      const skipped = skippedDirectoryReason(path);
      if (skipped !== null) {
        add(`anchor ${anchor}: the path ${skipped}`);
        continue;
      }
      const file = files.resolve(path);
      if (!file.ok) {
        add(`anchor ${anchor}: the path ${file.reason}`);
        continue;
      }
      const start = Number(startText);
      const end = endText === undefined ? start : Number(endText);
      if (start < 1 || end < start) add(`anchor ${anchor}: the line range is not ascending from line 1`);
      else if (end > file.lines) add(`anchor ${anchor}: line ${end} is past the end of the file (${file.lines} lines)`);
    }
  }
  if (blocks.length > 0 && evidence === 0) add('no anchor in the <details> evidence blocks: write each anchor in backticks, as `path:line` or `path:line-line`, with the path from the project root');
  return { problems, diagrams, evidence, actors };
}

/** Problems of the findings file; `resolved` carries each passage's line when there are none. */
function findingsProblems(value, feature, featureIds, files) {
  const problems = [];
  if (!isObject(value) || !Array.isArray(value.findings)) {
    return { problems: [`${feature.id}: ${findingsPath(feature.id)} is not { "findings": [ ... ] }`], counts: null };
  }
  const idPattern = new RegExp(`^${feature.id}-[1-9]\\d*$`);
  const seen = new Set();
  const counts = { product: 0, technical: 0 };
  const lines = [];
  value.findings.forEach((finding, at) => {
    const subject = isObject(finding) && isString(finding.id) && idPattern.test(finding.id) ? finding.id : `${feature.id} findings[${at}]`;
    const add = (problem) => problems.push(`${subject}: ${problem}`);
    if (!isObject(finding)) return add('is not an object');
    for (const key of Object.keys(finding)) {
      if (!FINDING_KEYS.includes(key)) add(`key "${key}" is not allowed; a finding holds ${FINDING_KEYS.join(', ')}`);
    }
    if (!isString(finding.id) || !idPattern.test(finding.id)) add(`id ${JSON.stringify(finding.id ?? null)} is not ${feature.id}-<n>`);
    else if (seen.has(finding.id)) add('the finding id repeats');
    seen.add(finding.id);
    if (!FINDING_CLASSES.includes(finding.class)) add(`class ${JSON.stringify(finding.class ?? null)} is not product or technical`);
    else counts[finding.class] += 1;
    if (!isString(finding.statement)) {
      add('statement is missing');
    } else {
      const word = adviceWord(finding.statement);
      if (word !== null) add(`the statement gives advice (${JSON.stringify(word)}); state the defect as it is`);
    }
    if (!isStringArray(finding.flows)) {
      add('flows is not a list of feature ids');
    } else {
      if (!finding.flows.includes(feature.id)) add(`flows does not include ${feature.id}`);
      for (const flow of finding.flows) if (!featureIds.has(flow)) add(`flows names ${flow}, which is not a feature`);
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      add('has no evidence');
      return;
    }
    finding.evidence.forEach((item, k) => {
      if (!isObject(item)) return add(`evidence[${k}] is not { file, passage }`);
      for (const key of Object.keys(item)) {
        if (!EVIDENCE_KEYS.includes(key)) add(`evidence[${k}] key "${key}" is not allowed; evidence holds file and passage`);
      }
      if (!isString(item.passage)) return add(`evidence[${k}] has no passage`);
      const skipped = skippedDirectoryReason(item.file);
      if (skipped !== null) return add(`evidence[${k}] file ${JSON.stringify(item.file)} ${skipped}`);
      const file = files.resolve(item.file);
      if (!file.ok) return add(`evidence[${k}] file ${JSON.stringify(item.file ?? null)} ${file.reason}`);
      const found = findOnce(file.text, item.passage);
      if (found.count === 0) add(`the passage is not in ${item.file}`);
      else if (found.count > 1) add(`the passage occurs ${found.count} times in ${item.file}; quote more of it until it occurs once`);
      else lines.push({ at, k, line: found.line });
    });
  });
  if (problems.length === 0) {
    for (const { at, k, line } of lines) value.findings[at].evidence[k].line = line;
  }
  return { problems, counts };
}

/**
 * The problems of one lane (pure apart from reading the project), its counts,
 * the chapter's front-matter actors, and the findings value with lines filled
 * in when every finding passed.
 */
export function laneResult(outDir, index, feature, root) {
  const files = projectFiles(root);
  const problems = [];
  const counts = { diagrams: 0, evidence: 0, findings: { product: 0, technical: 0 } };
  let actors = [];
  const chapterFile = join(outDir, chapterPath(feature.id));
  const findingsFile = join(outDir, findingsPath(feature.id));
  for (const rel of [chapterPath(feature.id), findingsPath(feature.id)]) {
    if (!existsSync(join(outDir, rel))) problems.push(`${feature.id}: lane-wrote-nothing: ${rel} is missing`);
  }
  if (existsSync(chapterFile)) {
    const read = readText(chapterFile);
    if (read.ok) {
      const chapter = chapterProblems(read.text, feature, files);
      problems.push(...chapter.problems);
      counts.diagrams = chapter.diagrams;
      counts.evidence = chapter.evidence;
      actors = chapter.actors;
    } else {
      problems.push(`${feature.id}: ${chapterPath(feature.id)} ${read.reason}`);
    }
  }
  let findings = null;
  if (existsSync(findingsFile)) {
    const read = readJson(findingsFile);
    if (!read.ok) {
      problems.push(`${feature.id}: ${findingsPath(feature.id)} ${read.reason}`);
    } else {
      const featureIds = new Set(index.features.map((f) => f.id));
      const checked = findingsProblems(read.value, feature, featureIds, files);
      problems.push(...checked.problems);
      if (checked.counts) counts.findings = checked.counts;
      if (checked.problems.length === 0) findings = read.value;
    }
  }
  return { problems, counts, findings, actors };
}

function readText(path) {
  try {
    return { ok: true, text: readFileSync(path, 'utf-8') };
  } catch (error) {
    return { ok: false, reason: `cannot be read (${error.message})` };
  }
}

/** The last line of a failed check-lane: the next step for the orchestrator (design D6). */
function nextLine(id, attempts) {
  return attempts < MAX_ATTEMPTS
    ? `Next: delete ${id}'s files, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`
    : `Next: ${id} stays failed (2 of 2 attempts)`;
}

/** Run check-lane for feature `id` of `<out>`. Returns { status, lines }. */
export function checkLane(outDir, id, root) {
  const read = loadIndex(outDir);
  if (read.stale) return { status: 1, lines: [read.line] };
  if (!read.ok) throw new UsageError(`${INDEX_FILE} ${read.reason}; run check-index first`);
  const index = read.value;
  if (!isObject(index) || !Array.isArray(index.features) || !isString(index.projectRoot)) {
    throw new UsageError(`${INDEX_FILE} has no features or projectRoot; run check-index first`);
  }
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };
  const feature = index.features.find((f) => isObject(f) && f.id === id);
  if (!feature) throw new UsageError(`feature ${id} is not in ${INDEX_FILE}`);
  const result = laneResult(outDir, index, feature, root);
  if (result.findings !== null) writeJson(join(outDir, findingsPath(id)), result.findings);
  const failed = result.problems.length > 0;
  // The result is recorded under the feature; aggregate keeps a recorded
  // check-lane failure until check-lane passes again.
  const recorded = failed
    ? { ...feature, status: 'failed', failure: { step: 'check-lane', reasons: result.problems } }
    : { ...feature, status: feature.status === 'verified' ? 'verified' : 'checked', failure: null };
  const features = index.features.map((f) => (f === feature ? recorded : f));
  writeJson(join(outDir, INDEX_FILE), { ...index, features });
  if (failed) return { status: 1, lines: [...result.problems, nextLine(id, feature.attempts ?? 0)] };
  return { status: 0, lines: [`${id}: ok`] };
}
