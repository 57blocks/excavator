/**
 * The /excavator-view skill's translation step and the translator agent are prompts (openspec: changes/view-name-translation,
 * design D3, D6, tasks 3.1-3.2): the rules only hold if each sits where the model acts on it. These tests pin them to
 * their place in the text and check that what the agent says about its files is what `translations.mjs` writes and reads.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './plugin-fixture.mjs';

const skill = readFileSync(join(repoRoot, 'skills/excavator-view/SKILL.md'), 'utf-8');
const agentPath = join(repoRoot, 'agents/excavator-view-translator.md');
const agent = existsSync(agentPath) ? readFileSync(agentPath, 'utf-8') : '';
const flat = (text) => text.replace(/\s+/g, ' ');
const CJK = new RegExp(`[${String.fromCharCode(0x2e80)}-${String.fromCharCode(0x9fff)}${String.fromCharCode(0xf900)}-${String.fromCharCode(0xfaff)}]`, 'u');

describe('agent excavator-view-translator', () => {
  it('exists with the name of its file, a description, tools Read and Write only, and no model', () => {
    expect(existsSync(agentPath)).toBe(true);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(agent);
    expect(front).not.toBeNull();
    expect(front[1]).toMatch(/^name: excavator-view-translator$/m);
    expect(front[1]).toMatch(/^description:/m);
    expect(front[1]).toMatch(/^tools: Read, Write$/m);
    expect(front[1]).not.toMatch(/^model:/m);
    expect(CJK.test(agent)).toBe(false);
  });

  it('takes one batch file and one result file, reads only the batch file and writes only the result file', () => {
    const text = flat(agent);
    expect(text).toMatch(/batch file/i);
    expect(text).toMatch(/result file/i);
    expect(text).toMatch(/Read only the batch file/i);
    expect(text).toMatch(/Write only the result file/i);
    expect(text).toMatch(/one JSON object/i);
    expect(text).toContain('"1"');
  });

  it('says what a translation is: for a reader who does not read code, code tokens verbatim, one line, no explanation, no trailing punctuation', () => {
    const text = flat(agent);
    expect(text).toMatch(/does not read code/i);
    expect(text).toMatch(/OAuth2/);
    expect(text).toMatch(/verbatim/i);
    expect(text).toMatch(/single line|one line/i);
    expect(text).toMatch(/no explanation/i);
    expect(text).toMatch(/trailing punctuation/i);
    expect(text).toMatch(/literally/i);
    expect(text).toMatch(/never invent/i);
    expect(text).toMatch(/proper name/i);
  });

  it('does not delegate and reads no source, product or table', () => {
    const text = flat(agent);
    expect(text).toMatch(/Do not delegate work or create subagents/);
    expect(text).toMatch(/source code|the project/i);
  });

  it('describes the batch file the way translations.mjs writes it', () => {
    const text = flat(agent);
    for (const field of ['"format"', '"language"', '"round"', '"items"', '"key"', '"hash"', '"en"']) expect(text).toContain(field);
  });
});

describe('SKILL.md', () => {
  it('takes --language <lang> in the hint and in Options', () => {
    const front = /^---\nname: excavator-view\ndescription: (.+)\nargument-hint: "(.+)"\n---\n/.exec(skill);
    expect(front[2]).toBe('[project-path] [--source] [--no-source] [--out <path>] [--language <lang>]');
    const options = skill.split(/^## Options$/m)[1].split(/^---$/m)[0];
    expect(options).toContain('`--language <lang>`');
  });

  it('translates before it packs, only for a language that is not English', () => {
    const plan = skill.indexOf('translations.mjs" plan');
    const check = skill.indexOf('translations.mjs" check');
    const pack = skill.indexOf('pack.mjs" "$PROJECT_ROOT"');
    expect(plan).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(plan);
    expect(pack).toBeGreaterThan(check);
    const text = flat(skill);
    expect(text).toMatch(/only (when|for) .*language other than English/i);
    expect(text).toMatch(/English .* (no|not) .*(plan|translat)/i);
  });

  it('dispatches excavator-view-translator once per batch, in the foreground, never in the background', () => {
    const text = flat(skill);
    expect(text).toContain('`excavator-view-translator`');
    expect(text).toMatch(/foreground/);
    expect(text).toMatch(/never (in the )?background/i);
    expect(text).toMatch(/several Agent calls .* one message/i);
    expect(text).toMatch(/no batch/i);
  });

  it('runs check, dispatches what it prints under retry once, runs check again, then packs with --language', () => {
    const text = flat(skill);
    expect(text).toMatch(/`retry`/);
    expect(text).toMatch(/once/);
    expect(text).toMatch(/run `check` again|`check` again/);
    expect(skill).toMatch(/pack\.mjs"[^\n]*--language/);
  });

  it('lets the table and its work directory beside the page be written, and nothing else under .excavator', () => {
    const text = flat(skill);
    expect(text).toMatch(/other file under `\.excavator\/` than the page and its translation table/);
    expect(text).toMatch(/view-translations/);
    expect(text).toMatch(/--out/);
  });

  it('adds the sixth reply line for a language that is not English, printed by the same command', () => {
    expect(skill).toContain('Translation: <language> <translated>/<names> names (<english> in English)');
    expect(skill.match(/node "[^"\n]*reply\.mjs"/g)).toHaveLength(1);
    expect(flat(skill)).toMatch(/sixth line/i);
  });

  it('keeps the reply language English whatever --language says', () => {
    expect(flat(skill)).toMatch(/`--language` .*does not change .*(language you write|reply)/i);
  });

  it('keeps no source or analysis step and no model other than the translator', () => {
    const text = flat(skill);
    expect(text).toMatch(/Do not start an HTTP server/);
    expect(text).toMatch(/does not call .*model|no model call|makes no model call/i);
    expect(text).toContain('`excavator-view-translator`');
    expect(skill).not.toMatch(/run_in_background|nohup/);
  });
});
