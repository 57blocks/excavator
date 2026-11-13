import { describe, expect, it } from 'vitest';

import { hasBareState, viewBoxWidth, withoutImports } from '../src/lib/diagram-source';

describe('hasBareState', () => {
  it('is true for a state diagram with a state alone on a line', () => {
    expect(hasBareState('stateDiagram-v2\n  Draft\n  [*] --> Draft')).toBe(true);
    expect(hasBareState('stateDiagram\n  [*] --> A\n  Lonely\n')).toBe(true);
  });
  it('is false when every line is a transition, a keyword or has more on it', () => {
    expect(hasBareState('stateDiagram-v2\n  [*] --> Draft\n  Draft --> Sent : send')).toBe(false);
    expect(hasBareState('stateDiagram-v2\n  direction LR\n  state Sent {\n    [*] --> Open\n  }\n  Draft : a description')).toBe(false);
    expect(hasBareState('stateDiagram-v2\n  state Draft\n  [*] --> Draft')).toBe(false);
  });
  it('is false for any other diagram, even with a lone word', () => {
    expect(hasBareState('flowchart TD\n  Draft\n  A --> B')).toBe(false);
  });
});

describe('withoutImports', () => {
  it('removes every @import rule, also when the url holds a semicolon', () => {
    const svg = "<svg><style>\n  @import url('https://fonts.example/css?family=Inter:wght@400;500&amp;display=swap');\n  text { fill: red; }\n</style></svg>";
    const out = withoutImports(svg);
    expect(out).not.toContain('@import');
    expect(out).not.toContain('fonts.example');
    expect(out).toContain('text { fill: red; }');
  });
  it('removes the string form too', () => {
    expect(withoutImports('<style>@import "x.css"; a{}</style>')).toBe('<style> a{}</style>');
  });
});

describe('viewBoxWidth', () => {
  it('reads the width of the viewBox', () => {
    expect(viewBoxWidth('<svg xmlns="x" viewBox="0 0 169.662 331.462" width="1">')).toBe(169.662);
    expect(viewBoxWidth('<svg viewBox="0 0 10 10">')).toBe(10);
  });
  it('is null without one', () => {
    expect(viewBoxWidth('<svg width="10">')).toBeNull();
  });
});
