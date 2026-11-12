/**
 * The good chapter and /3 entry of the synthetic fixture project for the tests of
 * openspec change handbook-free-chapter: citations are line ranges of
 * src/forms/order-form.js, src/roles.js and src/menu.js.
 */

import { goodEntry } from './helpers.mjs';

export const FORM = 'src/forms/order-form.js';
const cite = (range, file = FORM) => `\`${file}:${range}\``;

/** A chapter that passes: headings, sentences with one and with two citation groups, a list, a lead-in with a table, and one diagram. */
export const GOOD_CHAPTER = `# Orders

## Placing an order

The clerk fills in the \u201cCustomer Name\u201d field (${cite('5')}). The item count is limited to 35000 (${cite('6')}).

An upload may hold 100000 bytes (${cite('9')}).

- An order is Draft until it is sent (${cite('10')}).
- A sent order is Submitted (${cite('10')}).

Who can do what:

| Role | Can do |
| --- | --- |
| Clerk | Creates an order ${cite('1', 'src/roles.js')} |

\`\`\`mermaid
sequenceDiagram
participant C as Clerk
participant S as System
C->>S: Sends the order
%% ${cite('3-6')}
S-->>C: Confirms the order
%% ${cite('10')}
\`\`\`
`;

/** The counts of GOOD_CHAPTER: 5 sentences (2 + 1 + 2), 1 row, 5 + 1 + 2 citations, 1 diagram with 2 arrows. */
export const GOOD_COUNTS = 'Chapter: 5 sentences, 1 table rows, 8 citations, 1 diagrams, 2 arrows';

/** The /3 fact sheet that passes next to GOOD_CHAPTER: the /2 good entry without operations and fields, hand-overs on top. */
export function goodEntryV3() {
  const entry = JSON.parse(JSON.stringify(goodEntry()));
  entry.format = 'excavator-product-handbook-entry/3';
  entry.screens = entry.screens.map((screen) => ({ name: screen.name, evidence: screen.evidence }));
  delete entry.operations;
  entry.handoffs = [{ feature: 'F2', text: 'Finished orders move to the archive.', evidence: [{ file: FORM, passage: "{ label: 'Customer Name', required: true }," }] }];
  const { format, id, purpose, who, where, screens, handoffs, states, transitions, notifications, automatic, unknowns } = entry;
  return { format, id, purpose, who, where, screens, handoffs, states, transitions, notifications, automatic, unknowns };
}

/** The notes line of a chapter with no finding. */
export const NO_NOTES = 'Notes: 0 (number 0, quote 0, code 0, advice 0, language 0)';
