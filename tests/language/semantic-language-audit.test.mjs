import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditDomainGraphFields,
  auditSemanticCacheFields,
  auditSemanticGraphFields,
  isAcceptedLanguageAudit,
} from '../../skills/excavator/semantic-language-audit.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function factGraph(name = 'submitLeave') {
  return {
    project: { name: 'fixture', languages: ['typescript'], frameworks: [] },
    nodes: [{
      id: `function:src/leave.ts:${name}`,
      type: 'function',
      name,
      filePath: 'src/leave.ts',
      summary: '',
      tags: [],
    }],
    edges: [],
  };
}

function expectConserved(audit) {
  expect(audit.inspected).toBe(audit.accepted.length + audit.rejected.length);
  const paths = [...audit.accepted, ...audit.rejected].map((entry) => entry.fieldPath);
  expect(new Set(paths).size).toBe(paths.length);
}

describe('model-owned semantic language audit', () => {
  it('places every English cache field in the accepted terminal bucket', () => {
    const audit = auditSemanticCacheFields({
      fields: {
        summary: 'Validates the request before writing the article.',
        tags: ['validation', 'article'],
      },
    });

    expect(audit.status).toBe('accepted');
    expect(audit.accepted.map((entry) => entry.fieldPath)).toEqual([
      'summary', 'tags[0]', 'tags[1]',
    ]);
    expect(audit.rejected).toEqual([]);
    expect(isAcceptedLanguageAudit(audit)).toBe(true);
    expectConserved(audit);
  });

  it('rejects Chinese model prose even when contentLanguage is forged as English', () => {
    const audit = auditSemanticCacheFields({
      fields: {
        contentLanguage: 'en',
        summary: '在写入文章前验证请求。',
        tags: ['验证'],
      },
    });

    expect(audit.status).toBe('rejected');
    expect(audit.rejected).toEqual([
      expect.objectContaining({ fieldPath: 'summary', reason: 'noncanonical-language' }),
      expect.objectContaining({ fieldPath: 'tags[0]', reason: 'noncanonical-language' }),
    ]);
    expect(isAcceptedLanguageAudit(audit)).toBe(false);
    expectConserved(audit);
  });

  it('masks an exact source-owned fact span and preserves the original field value', () => {
    const fields = { summary: 'Calls 提交请假 after validation.', tags: ['validation'] };
    const before = structuredClone(fields);
    const audit = auditSemanticCacheFields({ fields, factGraph: factGraph('提交请假') });

    expect(audit.status).toBe('accepted');
    expect(audit.accepted[0]).toEqual({
      fieldPath: 'summary',
      maskedSourceSpans: ['提交请假'],
    });
    expect(fields).toEqual(before);
    expectConserved(audit);
  });

  it('never accepts a model-declared exemption', () => {
    const audit = auditSemanticCacheFields({
      fields: {
        summary: 'Calls 提交请假 after validation.',
        tags: ['validation'],
        exemptions: ['提交请假'],
      },
    });

    expect(audit.rejected).toEqual([
      expect.objectContaining({
        fieldPath: 'summary',
        reason: 'noncanonical-language',
        unverifiedSpans: ['提交请假'],
      }),
    ]);
    expectConserved(audit);
  });

  it('accepts an exact span from the current SourceSnapshot only on an allowed path', () => {
    const root = mkdtempSync(join(tmpdir(), 'semantic-language-source-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'leave.ts'), 'export function 提交请假() {}\n', 'utf-8');
    writeFileSync(join(root, 'src', 'other.ts'), 'export const 仅在其他文件 = true;\n', 'utf-8');
    const snapshot = resolveSourceSnapshot(root);

    const accepted = auditSemanticCacheFields({
      fields: { summary: 'Calls 提交请假 after validation.' },
      sourceSnapshot: snapshot,
      sourcePaths: ['src/leave.ts'],
    });
    const rejected = auditSemanticCacheFields({
      fields: { summary: 'Reads 仅在其他文件 during validation.' },
      sourceSnapshot: snapshot,
      sourcePaths: ['src/leave.ts'],
    });

    expect(accepted.status).toBe('accepted');
    expect(rejected.rejected[0]).toMatchObject({
      fieldPath: 'summary', reason: 'noncanonical-language', unverifiedSpans: ['仅在其他文件'],
    });
    expectConserved(accepted);
    expectConserved(rejected);
  });

  it('audits only semantic-graph model prose and rejects the whole candidate visibly', () => {
    const layers = [{
      id: 'layer:app',
      name: 'Application',
      description: '处理请假请求。',
      nodeIds: ['function:src/leave.ts:submitLeave'],
    }];
    const relations = [{
      id: 'relation:one', type: 'depends_on',
      source: 'a', target: 'b', description: 'Checks policy.',
    }];
    const audit = auditSemanticGraphFields({ layers, relations });

    expect(audit.accepted.map((entry) => entry.fieldPath)).toEqual([
      'layers[0].name', 'relations[0].description',
    ]);
    expect(audit.rejected).toEqual([
      expect.objectContaining({ fieldPath: 'layers[0].description', reason: 'noncanonical-language' }),
    ]);
    expectConserved(audit);
  });

  it('audits every declared domain model-prose field and skips structural fields', () => {
    const domainGraph = {
      contentLanguage: 'en',
      project: {
        name: 'fixture', languages: ['typescript'], frameworks: [],
        description: 'Leave management.',
      },
      nodes: [{
        id: 'domain:leave', type: 'domain', filePath: 'src/leave.ts',
        name: 'Leave Management', summary: 'Handles leave requests.', tags: ['leave'],
        domainMeta: {
          entities: ['Leave Request'],
          businessRules: ['需要附件。'],
          crossDomainInteractions: ['Calls payroll.'],
        },
      }],
      edges: [{ source: 'domain:leave', target: 'flow:leave', type: 'contains', description: 'Contains flows.' }],
    };

    const audit = auditDomainGraphFields({ domainGraph });

    expect(audit.inspected).toBe(8);
    expect(audit.rejected).toEqual([
      expect.objectContaining({
        fieldPath: 'nodes[0].domainMeta.businessRules[0]',
        reason: 'noncanonical-language',
      }),
    ]);
    expect(audit.accepted.some((entry) => entry.fieldPath === 'nodes[0].id')).toBe(false);
    expect(audit.accepted.some((entry) => entry.fieldPath === 'nodes[0].filePath')).toBe(false);
    expectConserved(audit);
  });
});
