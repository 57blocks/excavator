import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf-8');

describe('/excavator has one canonical semantic storage language', () => {
  const skill = read('skills/excavator/SKILL.md');

  it('removes the old language option and reports it as unsupported before writes', () => {
    const frontmatter = skill.slice(0, skill.indexOf('---', 4) + 3);
    expect(frontmatter).not.toContain('--language');
    expect(skill).toContain('`--language` is no longer supported');
    expect(skill).toContain('STOP before creating or changing `.excavator/` files');
  });

  it('has no stored-language variables or locale injection', () => {
    expect(skill).not.toContain('$LANGUAGE_DIRECTIVE');
    expect(skill).not.toContain('$OUTPUT_LANGUAGE');
    expect(skill).not.toContain('Output locale injection');
    expect(skill).not.toContain('./locales/');
  });

  it('requires English at every code semantic generation dispatch', () => {
    expect(skill).toContain('Write every model-owned project description in English');
    expect(skill).toContain('Write every model-owned `summary`, `tags`, and `languageNotes` value in English');
    expect(skill).toContain('Write every model-owned layer name and description in English');

    expect(read('agents/excavator-project-scanner.md'))
      .toContain('Write the model-owned project description in English');
    expect(read('agents/excavator-file-analyzer.md'))
      .toContain('Write every model-owned `summary`, `tags`, and `languageNotes` value in English');
    expect(read('agents/excavator-architecture-analyzer.md'))
      .toContain('Write every model-owned layer `name` and `description` in English');
    expect(read('agents/excavator-domain-analyzer.md'))
      .toContain('Write every model-owned domain field in English');
  });
});

describe('Figma keeps an independent request-local language option', () => {
  const figma = read('skills/excavator-figma/SKILL.md');

  it('defines and uses its own directive without referencing Excavator storage language', () => {
    expect(figma).toContain('--language <lang>');
    expect(figma).toContain('$FIGMA_LANGUAGE_DIRECTIVE');
    expect(figma).toContain('Figma-only language directive');
    expect(figma).not.toContain('$LANGUAGE_DIRECTIVE');
    expect(figma).not.toContain('reuse `/excavator`');
    expect(figma).not.toContain('outputLanguage');
  });
});

describe('public documentation distinguishes storage language from answer language', () => {
  const readme = read('README.md');

  it('does not advertise the removed analyzer option', () => {
    expect(readme).not.toContain('/excavator --language');
    expect(readme).toContain('Persisted model-generated semantics use English');
    expect(readme).toContain('answers follow the language of each question');
  });
});
