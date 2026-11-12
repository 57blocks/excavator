// The default output directory is written twice: as `OUT="$PROJECT_ROOT/<path>"`
// in SKILL.md and as DEFAULT_OUT in aggregate.mjs, which `outIsDefault` (and so the
// reply's save offer) compares against. Keep the two equal.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

import { DEFAULT_OUT } from '../../../skills/excavator-prd-report/lib/aggregate.mjs';
import { repoRoot } from './helpers.mjs';

describe('the default output directory', () => {
  it('is the same path in SKILL.md and in aggregate.mjs', () => {
    const skill = readFileSync(join(repoRoot, 'skills/excavator-prd-report/SKILL.md'), 'utf-8');
    const found = [...skill.matchAll(/^\s*OUT="\$PROJECT_ROOT\/([^"]+)"/gm)].map((m) => m[1]);
    expect(found).toHaveLength(1);
    expect(DEFAULT_OUT.split(sep).join(posix.sep)).toBe(found[0]);
  });
});
