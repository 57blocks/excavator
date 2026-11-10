/**
 * The diagrams of an entry (openspec change handbook-deep-entry, design D4),
 * computed from the verified items only: nothing in them is written by a model.
 *
 * The sequence of an operation: the first participant is the starter, a fixed
 * text chosen by how readers reach the feature; then, in the order they first
 * appear, the application whose root holds the file of each step's first
 * citation (the overview's name for it when the overview is verified, else its
 * directory; a file under no root is the fixed text for other code). Step n is
 * an arrow from the participant of step n-1 (the starter for step 1) to its
 * own, marked n only: the steps are listed under the diagram with the same
 * numbers. An arrow shows the order of the steps, not a call.
 *
 * The states of an entry: its transitions, each state named once in the order
 * it first appears.
 */

import { owningApplication } from './entities.mjs';
import { transitionList } from './entry-parts.mjs';

const OTHER = '\0other';
const STARTER = '\0starter';

/**
 * The sequence of `operation` (an entry operation with evidence): `{ participants, steps }`, where `participants`
 * are names and each step is `{ from, to }`, indices into `participants`. `reach` is the feature's reach;
 * `applications` the rows `{ dir, name }` of the system facts (name null when the overview has none);
 * `t` reads the run's fixed-text table.
 */
export function operationSequence(operation, reach, applications, t) {
  const dirs = applications.map((application) => application.dir);
  const nameOf = new Map(applications.map((application) => [application.dir, application.name ?? application.dir]));
  const keys = [STARTER];
  const participants = [t(`md.flow.actor.${reach}`)];
  const indexOf = (key, name) => {
    let at = keys.indexOf(key);
    if (at === -1) {
      keys.push(key);
      participants.push(name);
      at = keys.length - 1;
    }
    return at;
  };
  const steps = [];
  let previous = 0;
  for (const sentence of operation.sentences) {
    const file = sentence.evidence?.[0]?.file;
    const dir = file === undefined ? null : owningApplication(dirs, file);
    const to = dir === null ? indexOf(OTHER, t('md.flow.other')) : indexOf(dir, nameOf.get(dir));
    steps.push({ from: previous, to });
    previous = to;
  }
  return { participants, steps };
}

/** The states of an entry's transitions, each label once in the order it first appears, and the transitions as indices into them. */
export function stateGraph(entry) {
  const states = [];
  const indexOf = (label) => {
    if (!states.includes(label)) states.push(label);
    return states.indexOf(label);
  };
  const edges = transitionList(entry).map((transition) => ({ from: indexOf(transition.from), to: indexOf(transition.to), by: transition.by }));
  return { states, edges };
}

/** Text that is safe inside a mermaid label: no line break and none of the characters mermaid reads as syntax. */
export const mermaidText = (text) => text.replace(/[\r\n"#;:<>{}[\]`|%]/g, ' ').replace(/\s+/g, ' ').trim() || '-';

/** The lines of a mermaid sequence diagram of a sequence (`operationSequence`), in a fenced block. */
export function sequenceMermaid({ participants, steps }) {
  return [
    '```mermaid',
    'sequenceDiagram',
    ...participants.map((name, at) => `  participant P${at} as ${mermaidText(name)}`),
    ...steps.map((step, at) => `  P${step.from}->>P${step.to}: ${at + 1}`),
    '```',
  ];
}

/** The lines of a mermaid state diagram of a state graph (`stateGraph`), in a fenced block. */
export function stateMermaid({ states, edges }) {
  return [
    '```mermaid',
    'stateDiagram-v2',
    ...states.map((label, at) => `  state "${mermaidText(label)}" as S${at}`),
    ...edges.map((edge) => `  S${edge.from} --> S${edge.to}: ${mermaidText(edge.by)}`),
    '```',
  ];
}
