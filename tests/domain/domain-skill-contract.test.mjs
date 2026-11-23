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
    expect(skill).toContain('Never write, copy or edit the plan output, `domain-plan.json` or an area context yourself.');
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

// Flows that start in a directory holding several business areas, or in a
// support directory, are homed on the domain the analyzer chooses from the
// plan's fixed list. The analyzer can only choose from a list it has, so the
// plan is settled before any area is dispatched.
describe('/excavator-domain homing of mixed and support modules', () => {
  it('settles the plan before dispatching the areas', () => {
    const accept = skill.indexOf('node "$PLUGIN_ROOT/skills/excavator-domain/plan-domains.mjs" accept "$PROJECT_ROOT"');
    const areas = skill.search(/one subagent per area/i);
    expect(accept).toBeGreaterThan(-1);
    expect(areas).toBeGreaterThan(accept);
    expect(skill).not.toMatch(/the planner are independent/i);
    expect(skill).toContain('domainPlan');
  });

  it('reports the flows that ended in a support domain without a choice', () => {
    expect(skill).toContain('support-unchosen');
    expect(skill).toMatch(/fallback/);
  });

  it('has the planner mark mixed modules and keep business directories out of support domains', () => {
    expect(planner).toContain('"mixed"');
    expect(planner).toMatch(/holds only modules with no business behaviour/);
    expect(planner).toMatch(/scheduled jobs/);
    expect(planner).toMatch(/existing marks cannot change/);
  });

  it('has the analyzer choose a planned domain for flows of modules marked choose, with a reason', () => {
    expect(agent).toContain('domainPlan');
    expect(agent).toContain('`domainMeta.domain`');
    expect(agent).toContain('`domainMeta.domainReason`');
    expect(agent).toContain('"choose": true');
    expect(agent).toMatch(/only ids listed in `domainPlan.domains`/);
  });
});

// A flow of a choose module without a reasoned choice fails the area's
// acceptance; the analyzer checks its own output first, and the skill
// re-dispatches once before the fallback may take over.
describe('/excavator-domain choice check', () => {
  it('has the analyzer run the context check command and fix rejected-choice lines', () => {
    expect(agent).toContain('`check`');
    expect(agent).toContain('rejected-choice');
    expect(agent).toMatch(/run the context's `check` command exactly as written/);
    expect(agent).toMatch(/The choice is required, not optional/);
  });

  it('re-dispatches a rejected-choice area once before accepting it with --accept-unchosen', () => {
    const redispatch = skill.indexOf("adding that area's `rejected-choice` lines to its prompt");
    const override = skill.indexOf('run the merge once more with `--accept-unchosen`');
    expect(redispatch).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(redispatch);
    expect(skill).toMatch(/Use `--accept-unchosen` only after that one re-dispatch/);
    expect(skill).toMatch(/run the context's `check` command on its output before it returns/);
  });
});
