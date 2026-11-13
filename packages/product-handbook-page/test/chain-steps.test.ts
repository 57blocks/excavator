import { describe, expect, it } from 'vitest';

import { chainSteps } from '../src/lib/chain-steps';

const chart = (...lines: string[]): string => ['flowchart TD', ...lines.map((line) => `  ${line}`)].join('\n');

describe('chainSteps', () => {
  it('reads a straight chain on one line or on several, in order', () => {
    expect(chainSteps(chart('A --> B --> C'))).toEqual(['A', 'B', 'C']);
    expect(chainSteps(chart('A --> B', 'B --> C', 'C --> D'))).toEqual(['A', 'B', 'C', 'D']);
    expect(chainSteps(chart('C --> D', 'A --> B', 'B --> C'))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('takes the directions TD, TB and LR and the graph keyword', () => {
    for (const head of ['flowchart TD', 'flowchart TB', 'flowchart LR', 'graph TD', 'graph LR;']) {
      expect(chainSteps(`${head}\n  A --> B --> C`)).toEqual(['A', 'B', 'C']);
    }
    expect(chainSteps('flowchart RL\n  A --> B --> C')).toBeNull();
  });

  it('reads the labels of every node shape, quoted or not, and shows the id when there is none', () => {
    expect(chainSteps(chart('a[Square] --> b(Round) --> c{Choice} --> d([Stadium]) --> e["Quoted: yes"] --> f[[Sub]] --> g((Dot)) --> h'))).toEqual(
      ['Square', 'Round', 'Choice', 'Stadium', 'Quoted: yes', 'Sub', 'Dot', 'h'],
    );
    expect(chainSteps(chart('A[First] --> B', 'B --> C[Third]', 'B[Second]'))).toEqual(['First', 'Second', 'Third']);
  });

  it('is not a chain with text on an edge', () => {
    expect(chainSteps(chart('A -->|yes| B --> C'))).toBeNull();
    expect(chainSteps(chart('A -- yes --> B --> C'))).toBeNull();
  });

  it('is not a chain with a branch, a merge, two starts, fewer than three nodes or a cycle', () => {
    expect(chainSteps(chart('A --> B', 'A --> C', 'B --> D'))).toBeNull();
    expect(chainSteps(chart('A --> C', 'B --> C', 'C --> D'))).toBeNull();
    expect(chainSteps(chart('A --> B', 'C --> D'))).toBeNull();
    expect(chainSteps(chart('A --> B'))).toBeNull();
    expect(chainSteps(chart('A --> B --> C --> A'))).toBeNull();
    expect(chainSteps(chart('A --> B --> C', 'C --> B'))).toBeNull();
    expect(chainSteps(chart('A --> B --> C', 'D --> E --> D'))).toBeNull();
  });

  it('is not a chain when a line is one this reader does not know', () => {
    expect(chainSteps(chart('A --> B --> C', 'classDef hot fill:#f00'))).toBeNull();
    expect(chainSteps(chart('A --> B --> C', 'style A fill:#f00'))).toBeNull();
    expect(chainSteps(chart('subgraph S', 'A --> B --> C', 'end'))).toBeNull();
    expect(chainSteps(chart('A --> B --> C', 'click A callback'))).toBeNull();
    expect(chainSteps('sequenceDiagram\n  A->>B: hi')).toBeNull();
    expect(chainSteps('')).toBeNull();
  });

  it('ignores comments and blank lines', () => {
    expect(chainSteps('flowchart TD\n  %% a note\n\n  A --> B --> C\n')).toEqual(['A', 'B', 'C']);
  });
});
