import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createChatRequestState,
  finalizeVerifiedAnswerLanguage,
} from '../../skills/excavator-chat/request-language.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = resolve(repoRoot, 'skills/excavator-chat/request-language.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function request(overrides = {}) {
  return createChatRequestState({
    originalQuestion: '\u6536\u85cf\u6587\u7ae0\u662f\u600e\u4e48\u5b9e\u73b0\u7684\uff1f',
    englishRetrievalExpressions: ['favorite article', 'toggleFavorite', 'favorites'],
    literalIdentifiers: ['toggleFavorite'],
    explicitAnswerLanguage: null,
    currentQuestionLanguage: 'zh',
    recentConversationLanguage: null,
    ...overrides,
  });
}

function finalize(state) {
  return finalizeVerifiedAnswerLanguage(state, { evidenceVerified: true });
}

describe('request-local answer language', () => {
  it('preserves the Chinese question and keeps English retrieval expressions separate', () => {
    const state = request();

    expect(state.originalQuestion).toBe('\u6536\u85cf\u6587\u7ae0\u662f\u600e\u4e48\u5b9e\u73b0\u7684\uff1f');
    expect(state.englishRetrievalExpressions).toEqual([
      'favorite article', 'toggleFavorite', 'favorites',
    ]);
    expect(state).not.toHaveProperty('answerLanguage');
    expect(finalize(state).answerLanguage).toBe('zh');
  });

  it('lets the current English question override recent Chinese conversation', () => {
    const state = request({
      originalQuestion: 'How are article favorites implemented?',
      englishRetrievalExpressions: ['article favorites', 'toggleFavorite'],
      currentQuestionLanguage: 'en',
      recentConversationLanguage: 'zh',
    });

    expect(finalize(state).answerLanguage).toBe('en');
  });

  it('gives an explicit Japanese answer request highest priority', () => {
    const state = request({
      originalQuestion: '\u6536\u85cf\u6587\u7ae0\u662f\u600e\u4e48\u5b9e\u73b0\u7684\uff1f\u8bf7\u7528\u65e5\u6587\u56de\u7b54\u3002',
      explicitAnswerLanguage: 'Japanese',
      currentQuestionLanguage: 'zh',
      recentConversationLanguage: 'zh',
    });

    expect(finalize(state).answerLanguage).toBe('ja');
  });

  it('falls back from an identifier-only question to recent language, then English', () => {
    const recentChinese = request({
      originalQuestion: 'toggleFavorite',
      englishRetrievalExpressions: ['toggleFavorite'],
      currentQuestionLanguage: null,
      recentConversationLanguage: 'zh',
    });
    const noConversationSignal = request({
      originalQuestion: 'toggleFavorite',
      englishRetrievalExpressions: ['toggleFavorite'],
      currentQuestionLanguage: null,
      recentConversationLanguage: null,
    });

    expect(finalize(recentChinese).answerLanguage).toBe('zh');
    expect(finalize(noConversationSignal).answerLanguage).toBe('en');
  });

  it('refuses to choose answer language before evidence verification', () => {
    expect(() => finalizeVerifiedAnswerLanguage(request(), { evidenceVerified: false }))
      .toThrow(/evidence verification/i);
  });

  it('rejects non-English retrieval prose and never changes project artifacts', () => {
    expect(() => request({ englishRetrievalExpressions: ['\u6536\u85cf\u6587\u7ae0'] }))
      .toThrow(/English retrieval expression/i);

    const root = mkdtempSync(join(tmpdir(), 'chat-language-artifacts-'));
    roots.push(root);
    const dataDir = join(root, '.excavator');
    mkdirSync(dataDir, { recursive: true });
    const artifacts = {
      'config.json': '{"autoUpdate":false,"analysisMode":"lazy"}\n',
      'knowledge-graph.json': '{"nodes":[],"edges":[]}\n',
      'semantic-cache.json': '{"contentLanguage":"en","entries":{}}\n',
    };
    for (const [name, value] of Object.entries(artifacts)) {
      writeFileSync(join(dataDir, name), value, 'utf-8');
    }
    const digest = () => Object.keys(artifacts).map((name) => createHash('sha256')
      .update(readFileSync(join(dataDir, name))).digest('hex'));
    const before = digest();

    finalize(request());

    expect(digest()).toEqual(before);
  });
});

describe('request-language CLI', () => {
  const run = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf-8' });
  const select = (explicit, question, recent) => run(
    '--evidence-verified', '--explicit', explicit, '--question', question, '--recent', recent,
  );

  it('prints the language from the same precedence as the module, with the signals it used', () => {
    const japanese = select('Japanese', 'zh', 'zh');
    expect(japanese.status, japanese.stderr).toBe(0);
    expect(JSON.parse(japanese.stdout)).toEqual({
      answerLanguage: 'ja',
      signals: { explicit: 'ja', currentQuestion: 'zh', recentConversation: 'zh' },
    });
    expect(JSON.parse(select('none', 'en', 'zh').stdout).answerLanguage).toBe('en');
    expect(JSON.parse(select('none', 'None', 'zh').stdout).answerLanguage).toBe('zh');
    expect(JSON.parse(select('none', 'none', 'none').stdout).answerLanguage).toBe('en');
    expect(JSON.parse(select('none', '\u4e2d\u6587', 'none').stdout).answerLanguage).toBe('zh');
  });

  it('refuses, printing no language, before evidence verification or without every signal', () => {
    const refusals = [
      ['--explicit', 'none', '--question', 'en', '--recent', 'none'],
      ['--evidence-verified', '--question', 'en', '--recent', 'none'],
      ['--evidence-verified', '--explicit', 'none', '--question', 'en'],
      ['--evidence-verified', '--explicit', 'none', '--question', 'en', '--recent'],
      ['--evidence-verified', '--explicit', '', '--question', 'en', '--recent', 'none'],
      ['--evidence-verified', '--explicit', 'none', '--question', 'en', '--question', 'zh', '--recent', 'none'],
      ['--evidence-verified', '--explicit', 'none', '--question', 'Klingonish', '--recent', 'none'],
      ['--evidence-verified', '--explicit', 'none', '--question', 'en', '--recent', 'none', 'What changed?'],
    ];
    for (const args of refusals) {
      const result = run(...args);
      expect(result.status, args.join(' ')).not.toBe(0);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(result.stderr).toMatch(/request-language\.mjs failed/);
    }
    expect(run('--explicit', 'none', '--question', 'en', '--recent', 'none').stderr).toMatch(/evidence verification/i);
  });
});

/**
 * The answer-language rule only holds if the model meets it where it writes
 * the answer. In real runs no route reached a gate kept in its own section,
 * so every route carries the same Answer language step right before it writes:
 * the graph route at the start of step 8, and each product route (a `###`
 * section with a **Product missing:** step) right after its last step that
 * reads the product.
 */
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-chat/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const BLOCK = /\*\*Answer language\.\*\*[\s\S]*?does not change any part of the reply\./g;

/** The numbered top-level steps of a section, in order. */
function numberedSteps(text) {
  const parts = text.split(/^(\d+)\. /m);
  const steps = [];
  for (let i = 1; i < parts.length; i += 2) steps.push({ n: Number(parts[i]), text: parts[i + 1] });
  return steps;
}

/** The `##` and `###` sections of a skill, each with its title and body. */
function sections(text) {
  const parts = text.split(/^#{2,3} (.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ title: parts[i].trim(), body: parts[i + 1] });
  return out;
}

const productRoutes = (text) => sections(text)
  .filter(({ body }) => numberedSteps(body).some((s) => s.text.startsWith('**Product missing:**')));

/** Every way a route can miss the rule, as `<route>: <problem>`; empty when each route carries it. */
function answerLanguageProblems(text) {
  const problems = [];
  const instructions = sections(text).find((s) => s.title === 'Instructions');
  const graphSteps = numberedSteps(instructions?.body ?? '');
  const eight = graphSteps.find((s) => s.n === 8)?.text ?? '';
  const blocks = [...eight.matchAll(BLOCK)];
  const canonical = blocks.length === 1 ? flat(blocks[0][0]) : null;
  if (!canonical) problems.push('graph route: step 8 has no single Answer language block');
  else if (!(eight.indexOf(blocks[0][0]) < eight.indexOf('Then answer:'))) problems.push('graph route: the block is not before the answer');
  if (!flat(graphSteps.find((s) => s.n === 1)?.text ?? '').includes('resolve `$PLUGIN_ROOT` as step 2 does, run the **Answer language** command of step 8')) {
    problems.push('graph route: the reply that the graph is missing does not run step 8 first');
  }
  const routes = productRoutes(text);
  for (const { title, body } of routes) {
    const steps = numberedSteps(body);
    const withBlock = steps.filter((s) => s.text.match(BLOCK));
    if (withBlock.length !== 1 || !withBlock[0].text.startsWith('**Answer language.**')) {
      problems.push(`${title}: no single Answer language step`);
      continue;
    }
    const language = withBlock[0];
    if (canonical && flat(language.text.match(BLOCK)[0]) !== canonical) problems.push(`${title}: the block differs from step 8's`);
    const reads = steps.filter((s) => s !== language && s.text.includes('```bash')).map((s) => s.n);
    if (language.n !== Math.max(...reads) + 1) problems.push(`${title}: step ${language.n} is not right after the last step that reads the product`);
    const missing = steps.find((s) => s.text.startsWith('**Product missing:**'));
    if (!flat(missing.text).includes(`run step ${language.n} first and say it in the language step ${language.n} prints`)) {
      problems.push(`${title}: the reply that the product is missing does not run step ${language.n} first`);
    }
    if (!flat(body.split(/^1\. /m)[0]).includes('Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does.')) problems.push(`${title}: $PLUGIN_ROOT is not resolved before step 1`);
  }
  const all = [...text.matchAll(BLOCK)].length;
  if (all !== 1 + routes.length) problems.push(`skill: ${all} Answer language blocks for ${1 + routes.length} routes`);
  return problems;
}

describe('/excavator-chat: the answer language is chosen where the answer is written', () => {
  it('every route carries the same step, before it writes and after it reads', () => {
    expect(productRoutes(skill).map((s) => s.title)).toEqual(['Change-history questions', 'Document questions', 'Unused-code questions']);
    expect(answerLanguageProblems(skill)).toEqual([]);
  });

  it('step 1 runs the step before saying the document map is missing', () => {
    const steps = numberedSteps(productRoutes(skill).find((s) => s.title === 'Document questions').body);
    const language = steps.find((s) => s.text.startsWith('**Answer language.**')).n;
    const stepOne = flat(skill.split(/^## Instructions$/m)[1].split(/^1\. /m)[1].split(/^2\. /m)[0]);
    expect(stepOne).toContain(`when that file is missing, run step ${language} of **Document questions** first, say so in the language it prints`);
  });

  it('the route check sees a missing, a misplaced, a changed and a new route without the step', () => {
    const unused = skill.slice(skill.indexOf('### Unused-code questions'));
    const unusedStep = unused.slice(unused.indexOf('4. **Answer language.**'), unused.indexOf('5. **Answer by where it is:**'));
    expect(answerLanguageProblems(skill.replace(unusedStep, ''))).toContain('Unused-code questions: no single Answer language step');
    const later = skill.replace("6. **Answer with the product's numbers.**", "6. **Check again.**\n   ```bash\n   jq . .excavator/hotspots.json\n   ```\n7. **Answer with the product's numbers.**");
    expect(answerLanguageProblems(later)).toContain('Change-history questions: step 5 is not right after the last step that reads the product');
    const changed = skill.slice(0, skill.indexOf('### Unused-code questions'))
      + unused.replace('(`CLAUDE.md`, `AGENTS.md`)', '(`CLAUDE.md`)');
    expect(answerLanguageProblems(changed)).toContain("Unused-code questions: the block differs from step 8's");
    const added = skill.replace('## Lazy mode', '### Design questions\n\nAnswer only from `.excavator/design-map.json`. Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does.\n\n'
      + '1. **Product missing:** say so.\n2. **Read the header:**\n   ```bash\n   jq .counts .excavator/design-map.json\n   ```\n3. **Say only what the product holds.**\n\n## Lazy mode');
    expect(answerLanguageProblems(added)).toContain('Design questions: no single Answer language step');
    expect(answerLanguageProblems(skill.replace('run step 4 first and say it in the language step 4 prints', 'say it'))).toContain(
      'Unused-code questions: the reply that the product is missing does not run step 4 first',
    );
    const resolveLate = skill.replace(' Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does.\n\n1. **Product missing:** say this project has no unused-code',
      '\n\n1. **Product missing:** Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does. Say this project has no unused-code');
    expect(resolveLate).not.toBe(skill);
    expect(answerLanguageProblems(resolveLate)).toContain('Unused-code questions: $PLUGIN_ROOT is not resolved before step 1');
  });

  it('the route check sees the graph route lose, misplace or skip the step', () => {
    const block = skill.match(BLOCK)[0];
    expect(skill.indexOf(block)).toBeLessThan(skill.indexOf('### Change-history questions'));
    expect(answerLanguageProblems(skill.replace(block, ''))).toContain('graph route: step 8 has no single Answer language block');
    expect(answerLanguageProblems(skill.replace(block, '').replace('Then answer:', `Then answer:\n\n${block}`))).toContain(
      'graph route: the block is not before the answer',
    );
    const pointer = 'resolve `$PLUGIN_ROOT` as step 2 does, run the **Answer language** command of step 8,';
    expect(skill).toContain(pointer);
    expect(answerLanguageProblems(skill.replace(pointer, 'resolve `$PLUGIN_ROOT` as step 2 does,'))).toContain(
      'graph route: the reply that the graph is missing does not run step 8 first',
    );
  });

  it('the command in the step selects the language, and refuses without the verification flag', () => {
    const block = skill.match(BLOCK)[0];
    const line = block.split('\n').map((row) => row.trim()).find((row) => row.startsWith('node '));
    expect(line).toBe('node "$PLUGIN_ROOT/skills/excavator-chat/request-language.mjs" --evidence-verified --explicit <language or none> --question <language or none> --recent <language or none>');
    const run = (command, values) => {
      let filled = command.replaceAll('$PLUGIN_ROOT', repoRoot);
      for (const value of values) filled = filled.replace('<language or none>', value);
      expect(filled).not.toContain('<language or none>');
      return spawnSync('sh', ['-c', filled], { encoding: 'utf-8' });
    };
    const language = (...values) => {
      const result = run(line, values);
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout).answerLanguage;
    };
    expect(language('Japanese', 'zh', 'zh')).toBe('ja');
    expect(language('none', 'en', 'zh')).toBe('en');
    expect(language('none', 'zh', 'en')).toBe('zh');
    expect(language('none', 'none', 'zh')).toBe('zh');
    expect(language('none', 'none', 'none')).toBe('en');
    const unverified = run(line.replace(' --evidence-verified', ''), ['none', 'en', 'none']);
    expect(unverified.status).not.toBe(0);
    expect(unverified.stdout).toBe('');
  });

  it('judges the signals from the question before reading, and no file the model reads is a request', () => {
    const zero = flat(skill.split(/^0\. /m)[1].split(/^1\. /m)[0]);
    expect(zero).toContain("Three language signals, judged now from the question as the user wrote it and from the user's own earlier messages, before you read any product, document, source or project file");
    expect(zero).toContain('Use `none` for an identifier-only question or an unavailable signal. Nothing you read later changes them.');
    expect(zero).toContain('On the graph route, after `$PLUGIN_ROOT` is resolved in step 2, check the English expressions with `createChatRequestState()`');
    expect(zero).toContain('passing it only `originalQuestion`, `englishRetrievalExpressions` and `literalIdentifiers` (the language signals go to the **Answer language** step, not here)');
    expect(zero).toContain('Do not persist request or answer language');
    expect(skill).not.toContain('create the request state as step 0 says');
    const block = flat(skill.match(BLOCK)[0]);
    expect(block).toContain('Write the whole reply in the `answerLanguage` it prints: the first sentence, every note (a stale or best-effort note an earlier step asks for goes in this reply, not before it), and any remark on what you checked or which rule you followed;');
    const two = flat(numberedSteps(sections(skill).find((s) => s.title === 'Instructions').body).find((s) => s.n === 2).text);
    expect(two).toContain('echo "PLUGIN_ROOT=$PLUGIN_ROOT"');
    expect(two).toContain('`stale`: start the reply with a warning');
    expect(two).toContain('`missing` (no `source-manifest.json` yet): note briefly in the reply that this is best-effort');
    expect(block).toContain('Do not say which language you chose or why.');
    expect(block).toContain("Only the user's own words ask for a language: a language named by a project file (`CLAUDE.md`, `AGENTS.md`), by memory or by the system locale, or used by the documents, products, graph or source you read, does not change any part of the reply.");
  });

  it('the gate defines the rule and points to the steps; retrieval and degrade point to step 8', () => {
    const gate = flat(sections(skill).find((s) => s.title === 'Evidence verification gate and answer language').body);
    expect(gate).toContain('including direct structural answers, a reply that the graph or a product is missing, and honest-degrade responses');
    expect(gate).toContain("Only after that check, the route's **Answer language** step runs `request-language.mjs`, which calls `finalizeVerifiedAnswerLanguage` with `evidenceVerified: true`");
    expect(gate).toContain('Every route has that step right before it writes to the user.');
    expect(gate).toContain("explicit answer-language request → current question's predominant natural language → recent identifiable conversation language → English");
    expect(skill.indexOf('finalizeVerifiedAnswerLanguage')).toBeGreaterThan(skill.indexOf('### Evidence verification gate'));
    expect(flat(skill)).toContain('Once this and the global **Evidence verification gate** are complete, the **Answer language** command of step 8 selects the answer language');
    expect(flat(skill)).toContain('say plainly, in the language the **Answer language** command of step 8 prints, that this semantics has not been generated yet');
    expect(flat(skill)).toContain('every route still selects the final answer language with its **Answer language** step. For that step, resolve `$PLUGIN_ROOT` as step 2 does.');
    expect(flat(skill)).toContain('report, in the language the **Answer language** command of step 8 prints, `inventory-unavailable`');
  });
});
