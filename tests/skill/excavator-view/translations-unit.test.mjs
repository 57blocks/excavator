/**
 * The pure parts of `translations.mjs` (openspec: changes/view-name-translation, design D2-D4): the language name,
 * the names the page shows, the code tokens a translation has to keep.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { codeTokens, displayedNames, hashName, normalizeLanguage } from '../../../skills/excavator-view/translations.mjs';
import { makeGitProject } from './fixture.mjs';
import { explorerPage } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';
import { DISPLAYED, sha256, writeTranslatableProducts } from './translation-fixture.mjs';

describe('normalizeLanguage', () => {
  it.each(['en', 'EN', ' english ', 'English', 'en-GB', 'en-us', 'EN-AU', 'en_US', 'EN_gb'])('%j is English', (raw) => {
    expect(normalizeLanguage(raw)).toEqual({ english: true });
  });

  it.each([['zh', 'zh'], [' ZH-CN ', 'zh-cn'], ['pt_BR', 'pt_br'], ['Français', 'français'], ['de2', 'de2'], ['eng', 'eng'], ['enx', 'enx']])('%j is the name %j', (raw, name) => {
    expect(normalizeLanguage(raw)).toEqual({ english: false, name });
  });

  it('takes letters of another script', () => {
    const word = String.fromCharCode(0x4e2d, 0x6587);
    expect(normalizeLanguage(word)).toEqual({ english: false, name: word });
  });

  it.each(['', '   ', '../x', 'a/b', 'a\\b', 'a b', 'zh.json', 'zh:cn', '.hidden', undefined, null])('%j throws, and the message names the allowed characters', (raw) => {
    expect(() => normalizeLanguage(raw)).toThrow(/letters.*digits/);
  });
});

describe('hashName and codeTokens', () => {
  it('hashes the English text with SHA-256 as lower-case hex', () => {
    expect(hashName('Billing')).toBe(sha256('Billing'));
    expect(hashName('Billing')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('finds words with a digit or two capitals in a row, HTTP verbs as whole words, and the text inside backticks', () => {
    expect(codeTokens('Validate OAuth2 token')).toEqual(['OAuth2']);
    expect(codeTokens('Enable CORS for the S3 bucket')).toEqual(['CORS', 'S3']);
    expect(codeTokens('Verify the PKCE challenge')).toEqual(['PKCE']);
    expect(codeTokens('Handle GET request')).toEqual(['GET']);
    expect(codeTokens('POST, PUT, PATCH, DELETE, HEAD and OPTIONS calls')).toEqual(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
    expect(codeTokens('Run `make build` first')).toEqual(['make build']);
  });

  it('finds none in a plain phrase or a capitalised ordinary word', () => {
    expect(codeTokens('Validate the token')).toEqual([]);
    expect(codeTokens('Get the budget')).toEqual([]);
    expect(codeTokens('Update Header values')).toEqual([]);
    expect(codeTokens('Update HEADER values')).toEqual(['HEADER']); // two capitals in a row make any word a code token
    expect(codeTokens('Posting a message')).toEqual([]);
  });

  it('treats identifiers joined by underscore or dot as one code token', () => {
    expect(codeTokens('Read user_id')).toEqual(['user_id']);
    expect(codeTokens('Upgrade to payment_v2')).toEqual(['payment_v2']);
    expect(codeTokens('Load config.yaml now')).toEqual(['config.yaml']);
    expect(codeTokens('Sign in to Node.js')).toEqual(['Node.js']);
    expect(codeTokens('Sign in to Node.js.')).toEqual(['Node.js']);
    expect(codeTokens('Sign in.')).toEqual([]);
  });

  it('still splits at hyphens', () => {
    expect(codeTokens('Sign-in page')).toEqual([]);
  });

  it('lists each token once', () => {
    expect(codeTokens('GET or GET again with OAuth2 and OAuth2')).toEqual(['GET', 'OAuth2']);
  });
});

describe('displayedNames', () => {
  let project;
  let templateDir;
  let templatePath;
  beforeAll(() => {
    project = makeGitProject();
    ({ dir: templateDir, path: templatePath } = writeTemplate());
  });
  afterAll(() => {
    project.cleanup();
    rmSync(templateDir, { recursive: true, force: true });
  });
  beforeEach(() => rmSync(join(project.root, '.excavator'), { recursive: true, force: true }));

  const dataOf = () => {
    const result = packProject(project.root, { explorerTemplate: templatePath });
    return explorerPage(readFileSync(result.out, 'utf-8')).data;
  };

  it('is the page\'s own display names and domain, flow and step names, once each, sorted', () => {
    writeTranslatableProducts(project);
    expect(displayedNames(dataOf())).toEqual(DISPLAYED);
  });

  it('is empty for a page with no graph and no domain graph', () => {
    expect(displayedNames({})).toEqual([]);
    expect(displayedNames({ 'knowledge-graph.json': { nodes: [] } })).toEqual([]);
  });

  it('skips empty and non-string names, and takes a domain graph name only for a domain, flow or step', () => {
    const data = {
      'knowledge-graph.json': { nodes: [{ displayName: 'Kept' }, { displayName: '' }, { name: 'code name only' }, { displayName: 7 }] },
      'domain-graph.json': { nodes: [{ type: 'domain', name: 'D' }, { type: 'flow', name: 'F' }, { type: 'step', name: 'S' }, { type: 'concept', name: 'C' }, { type: 'step', name: '' }] },
    };
    expect(displayedNames(data)).toEqual(['D', 'F', 'Kept', 'S']);
  });

  it('takes the relations graph\'s unit names, external system labels and reasons of at most 60 characters', () => {
    const long = `Sends ${'x'.repeat(60)}`;
    const data = {
      'relations-graph.json': {
        units: [{ id: 'unit:web', name: 'Web shop' }, { id: 'unit:api', name: ' api ' }, { id: 'unit:x', name: '' }],
        externals: [{ id: 'external:mail' }, { id: 'external:' }, { id: 'payments' }, { id: 7 }],
        relations: [
          { id: 'rel:1', reason: ' Loads the order list ' },
          { id: 'rel:2', reason: long },
          { id: 'rel:3', reason: 'Two\nlines' },
          { id: 'rel:4', reason: 'Web shop' },
          { id: 'rel:5' },
        ],
      },
    };
    expect(displayedNames(data)).toEqual(['Loads the order list', 'Web shop', 'api', 'mail', 'payments']);
  });

  it('counts a relations name once when the graph or the domain graph shows the same words', () => {
    const data = {
      'knowledge-graph.json': { nodes: [{ displayName: 'Billing' }] },
      'relations-graph.json': { units: [{ id: 'unit:b', name: 'Billing' }], externals: [], relations: [] },
    };
    expect(displayedNames(data)).toEqual(['Billing']);
  });
});

describe('nameTranslationsFor', () => {
  it('keeps a name spelled like an object prototype key as an ordinary entry', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { nameTranslationsFor, TABLE_FORMAT } = await import('../../../skills/excavator-view/translation-names.mjs');
    const pageDir = mkdtempSync(join(tmpdir(), 'xv-proto-'));
    try {
      mkdirSync(join(pageDir, 'view-translations'));
      const english = '__proto__';
      const table = { format: TABLE_FORMAT, language: 'fr', entries: { [hashName(english)]: { en: english, text: 'prototype' } } };
      writeFileSync(join(pageDir, 'view-translations', 'fr.json'), JSON.stringify(table));
      const { value } = nameTranslationsFor({ pageDir, name: 'fr', names: [english] });
      expect(JSON.parse(JSON.stringify(value)).names).toEqual(JSON.parse('{"__proto__":"prototype"}'));
      expect(value.counts.translated).toBe(1);
    } finally {
      rmSync(pageDir, { recursive: true, force: true });
    }
  });
});
