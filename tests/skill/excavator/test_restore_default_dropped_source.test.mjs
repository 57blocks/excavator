/**
 * restore-default-dropped-source: the ignore preflight (SKILL.md Phase 0 step
 * 6.4) restores a source package that a default directory rule dropped by
 * name. Each rule is asserted in the step where the model makes that decision:
 * proposing candidates (3), reviewing the comparison (5), reporting (8).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator/SKILL.md'), 'utf-8');

const flat = (text) => text.replace(/\s+/g, ' ');
function step(from, to) {
  const start = skill.indexOf(from);
  expect(start, `SKILL.md should contain ${from}`).toBeGreaterThanOrEqual(0);
  const end = skill.indexOf(to, start);
  expect(end, `SKILL.md should contain ${to} after ${from}`).toBeGreaterThan(start);
  return flat(skill.slice(start, end));
}

describe('ignore preflight restores source a default directory rule dropped', () => {
  const discover = step('   3. Discover candidates', '   4. If candidates exist');
  const compare = step('   5. Compare `before.json` and `after.json`.', '   6. If no project rule is approved');
  const report = step('   8. For a non-Git project', '6.5. **Resolve the analysis mode');

  it('looks for dropped source while it proposes candidates', () => {
    expect(discover).toContain('Also look the other way, for source that a default directory rule dropped.');
    expect(discover).toContain('select(.kind == "filtered-by-defaults" and .detail == "default-pattern")');
  });

  it('takes only the file\'s own package declaration as evidence', () => {
    expect(discover).toContain('A directory is a source package only when a file\'s own `package` (or `namespace`) declaration contains every directory on that file\'s path that a default directory rule matched');
    expect(discover).toContain('Its candidate is the negation of that one directory, `!src/main/java/org/acme/out/`');
    expect(discover).toContain('A directory name, a source extension or files that look hand-written are not evidence');
    expect(discover).toContain('When the declaration contains only some of the matched directories, propose nothing for that path.');
  });

  it('reviews every restored path and drops a negation that restores anything else or nothing', () => {
    expect(compare).toContain('For a negation candidate, also review every path that is `selected` after and was not `selected` before.');
    expect(compare).toContain('If a negation restores anything else, drop it.');
    expect(compare).toContain('Also drop a negation that changes no selection');
    expect(compare).toContain('rebuild `after.json` from the remaining candidates');
  });

  it('reports what each approved negation restored and why', () => {
    expect(report).toContain('for each approved negation the paths it restored and the package declaration that justified it');
  });
});
