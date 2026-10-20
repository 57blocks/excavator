import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createChatRequestState,
  finalizeVerifiedAnswerLanguage,
} from '../../skills/excavator-chat/request-language.mjs';

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

describe('/excavator-chat request-language contract', () => {
  it('keeps request state in memory and finalizes only after the verification gate', () => {
    const skill = readFileSync(join(process.cwd(), 'skills/excavator-chat/SKILL.md'), 'utf-8');
    expect(skill).toContain('$ORIGINAL_QUESTION');
    expect(skill).toContain('$ENGLISH_RETRIEVAL_EXPRESSIONS');
    expect(skill).toContain('request-language.mjs');
    expect(skill).toContain('Do not persist request or answer language');
    expect(skill.indexOf('finalizeVerifiedAnswerLanguage')).toBeGreaterThan(
      skill.indexOf('Evidence verification gate'),
    );
  });
});
