/**
 * The /excavator-domain skill dispatches one analyzer per area and merges
 * with a coverage report; the analyzer prompt has no project-wide cap on
 * domains or flows. These are prose contracts, so they are pinned on the
 * text: each assertion names a line whose absence brings the old failure
 * back (one analyzer for the whole project, a cap of about 30 flows, a
 * script path resolved against the analysed project, reports under
 * .excavator/excavator/).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-domain/SKILL.md'), 'utf-8');
const agent = readFileSync(resolve(repoRoot, 'agents/excavator-domain-analyzer.md'), 'utf-8');
const planner = readFileSync(resolve(repoRoot, 'agents/excavator-domain-planner.md'), 'utf-8');

describe('/excavator-domain skill', () => {
  it('runs the extractor, the split and the merge from the plugin root', () => {
    expect(skill).toContain('python3 "$PLUGIN_ROOT/skills/excavator-domain/extract-domain-context.py" "$PROJECT_ROOT"');
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-domain/split-domain-areas.mjs" "$PROJECT_ROOT"');
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-domain/merge-domain-areas.mjs" "$PROJECT_ROOT"');
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-domain/annotate-domain.mjs" "$PROJECT_ROOT"');
  });

  it('has no script path that resolves against the analysed project or an undefined placeholder', () => {
    expect(skill).not.toContain('./extract-domain-context.py');
    expect(skill).not.toContain('<SKILL_DIR>');
  });

  it('dispatches one analyzer per area and retries the areas the merge did not accept', () => {
    expect(skill).toMatch(/one subagent per area/i);
    expect(skill).toContain('exits 3');
    expect(skill).toContain('silent-zero');
  });

  it('passes the knowledge graph to the split only on the graph path', () => {
    expect(skill).toContain('--graph "$DATA_DIR/knowledge-graph.jsonl"');
  });

  it('publishes reports into the reports directory, not .excavator/excavator/', () => {
    expect(skill).toContain('--reports-dir "$DATA_DIR/reports"');
  });

  it('cleans the area directory with the other intermediates', () => {
    expect(skill).toContain('$DATA_DIR/intermediate/domain-areas');
  });
});

describe('/excavator-domain domain plan', () => {
  it('prepares and accepts one plan per module set and reuses it', () => {
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-domain/plan-domains.mjs" prepare "$PROJECT_ROOT"');
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-domain/plan-domains.mjs" accept "$PROJECT_ROOT"');
    expect(skill).toMatch(/one planner subagent/i);
    expect(skill).toContain('plan=reused');
    expect(skill).toContain('--replan');
    expect(skill).toContain('$DATA_DIR/domain-plan.json');
  });

  it('stops after a second rejected plan and on a conservation failure', () => {
    expect(skill).toMatch(/If it exits 3 again, \*\*STOP\*\*/);
    expect(skill).toMatch(/If it exits 4[^\n]*\*\*STOP\*\*/);
  });

  // The hand-written alias table was the unrepeatable judgement this change removes.
  it('has no alias step and forbids editing plan or outputs by hand', () => {
    expect(skill).not.toMatch(/alias/i);
    expect(skill).toContain('Never write, copy or edit the plan output or `domain-plan.json` yourself.');
  });
});

describe('domain-planner prompt', () => {
  it('reads the plan input and writes the fixed output shape', () => {
    expect(planner).toContain('planRun');
    expect(planner).toContain('"assignments"');
    expect(planner).toContain('"kind": "business"');
    expect(planner).toContain('maxBusinessDomains');
  });

  it('defines business areas, features and support domains', () => {
    expect(planner).toContain('A **feature is not a domain.**');
    expect(planner).toMatch(/data-model directory is never a business domain/);
    expect(planner).toMatch(/existing assignments cannot change/);
  });

  it('forbids reusing an earlier output', () => {
    expect(planner).toMatch(/never copy/i);
    expect(planner).toContain('domain-plan.json');
  });
});

describe('domain-analyzer prompt', () => {
  it('writes flows, not domains, under Option C and names the starting module', () => {
    expect(agent).toContain('**Under Option C you write flows and steps, not domains.**');
    expect(agent).toContain('`domainMeta.module`');
  });

  it('describes the area context input and the token it must echo', () => {
    expect(agent).toContain('Option C');
    expect(agent).toContain('areaRun');
    expect(agent).toContain('skippedModules');
  });

  it('sets no project-wide cap on domains or flows', () => {
    expect(agent).not.toMatch(/Aim for 2-6 domains/);
    expect(agent).not.toMatch(/2-5 flows per domain/);
  });

  it('forbids reusing an earlier output', () => {
    expect(agent).toMatch(/never copy/i);
    expect(agent).toContain('domain-graph.json');
  });
});
