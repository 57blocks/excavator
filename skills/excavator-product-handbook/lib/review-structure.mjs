/**
 * What a feature chapter holds, counted from its Markdown with the headings of the run's fixed text
 * (openspec change handbook-design-review, D2): the operations (level-3 headings of the operations
 * section) and the steps of each (its top-level list items), the states and transitions of the state
 * diagrams in the states section, the steps after the server-steps line, and the hand-overs. A level-2
 * heading that is not one of the fixed ones is not counted and is named in `uncounted`, as is a list
 * of steps outside an operation heading. Pure; reads no file.
 */

import { FEATURE_HEADING_KEYS } from './chapter-lint.mjs';

const HEADING = /^(#{2,4})\s+(.*?)\s*#*\s*$/;
const TOP_ITEM = /^(?:[-*]|\d+\.)\s+\S/;
const FENCE = /^\s*```(.*)$/;

/** The states and arrows of the lines of one state diagram. */
function diagramCounts(lines) {
  const states = new Set();
  let transitions = 0;
  for (const line of lines) {
    if (!line.includes('-->')) continue;
    transitions += 1;
    const [left, rest] = line.split('-->');
    const right = rest.split(':')[0];
    for (const name of [left.trim(), right.trim()]) if (name !== '' && name !== '[*]') states.add(name);
  }
  return { states, transitions };
}

/** `{ operations, steps: [n per operation], states, transitions, serverSteps, handovers, uncounted: [text] }`. */
export function chapterCounts(text, strings) {
  const fixed = new Set(FEATURE_HEADING_KEYS.map((key) => strings[key]));
  const section = (key) => strings[`chapter.section.${key}`];
  const out = { operations: 0, steps: [], states: 0, transitions: 0, serverSteps: 0, handovers: 0, uncounted: [] };
  const stateNames = new Set();
  let h2 = null;
  let operation = null;
  let afterServerLine = false;
  let outsideOperation = 0;
  let inTable = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const fence = FENCE.exec(raw);
    if (fence !== null) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !FENCE.test(lines[j])) {
        body.push(lines[j]);
        j += 1;
      }
      const first = body.find((line) => line.trim() !== '' && !line.trim().startsWith('%%'));
      if (h2 === section('states') && fence[1].trim().toLowerCase() === 'mermaid' && first !== undefined && /^\s*stateDiagram/.test(first)) {
        const counted = diagramCounts(body);
        counted.states.forEach((name) => stateNames.add(name));
        out.transitions += counted.transitions;
      }
      i = j;
      inTable = false;
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      const level = heading[1].length;
      inTable = false;
      afterServerLine = false;
      if (level === 2) {
        h2 = heading[2].trim();
        operation = null;
        if (!fixed.has(h2)) out.uncounted.push(h2);
      } else if (level === 3 && h2 === section('operations')) {
        out.operations += 1;
        operation = out.steps.length;
        out.steps.push(0);
      } else if (h2 === section('operations')) operation = null;
      continue;
    }
    if (h2 === section('operations')) {
      if (raw.trim() === strings['chapter.serverSteps']?.trim()) afterServerLine = true;
      if (TOP_ITEM.test(raw)) {
        if (operation === null) outsideOperation += 1;
        else {
          out.steps[operation] += 1;
          if (afterServerLine) out.serverSteps += 1;
        }
      }
    }
    if (h2 === section('handovers')) {
      if (raw.trimStart().startsWith('|')) {
        const separator = raw.trim().replace(/^\||\|$/g, '').split('|').every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
        if (!separator) {
          if (inTable) out.handovers += 1;
          inTable = true;
        }
      } else {
        inTable = false;
        if (TOP_ITEM.test(raw)) out.handovers += 1;
      }
    }
  }
  out.states = stateNames.size;
  if (outsideOperation > 0) out.uncounted.push(`${section('operations')}: ${outsideOperation} list items outside a level-3 operation heading`);
  return out;
}
