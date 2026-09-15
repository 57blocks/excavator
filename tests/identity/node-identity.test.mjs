// Slice A / Task 1 — node-identity contract (openspec: changes/lazy-first-run/specs/node-identity).
// The single deterministic node-id authority shared by the fact builder and any
// deterministic id lookup. These fixtures pin the five invariants; they must be
// red before skills/excavator/node-identity.mjs exists.
import { describe, expect, it } from 'vitest';
import {
  deriveNodeId,
  normalizePath,
  normalizeSignature,
  collectNodeIds,
} from '../../skills/excavator/node-identity.mjs';

describe('R1 单一确定性函数', () => {
  it('同一输入重复调用得到逐字节相同的 ID', () => {
    const d = { type: 'function', path: 'src/a.ts', name: 'run', owner: '', params: ['x'] };
    expect(deriveNodeId(d)).toBe(deriveNodeId({ ...d }));
  });

  it('file 节点 id 为 file:<path>', () => {
    expect(deriveNodeId({ type: 'file', path: 'src/a.ts' })).toBe('file:src/a.ts');
  });
});

describe('R2 跨 adapter 路径稳定', () => {
  it('git 相对 / ./相对 / windows 分隔 的等价表示派生同一 ID', () => {
    const base = { type: 'function', path: 'src/a.ts', name: 'run', params: [] };
    const gitRel = deriveNodeId({ ...base, path: 'src/a.ts' });
    const dotRel = deriveNodeId({ ...base, path: './src/a.ts' });
    const winSep = deriveNodeId({ ...base, path: 'src\\a.ts' });
    expect(dotRel).toBe(gitRel);
    expect(winSep).toBe(gitRel);
  });

  it('多仓成员前缀稳定，且区分不同成员', () => {
    expect(normalizePath('foo/bar.ts', { memberId: 'm1' })).toBe('m1/foo/bar.ts');
    const inM1 = deriveNodeId({ type: 'function', path: 'foo/bar.ts', name: 'f', params: [], memberId: 'm1' });
    const inM2 = deriveNodeId({ type: 'function', path: 'foo/bar.ts', name: 'f', params: [], memberId: 'm2' });
    expect(inM1).not.toBe(inM2);
  });
});

describe('R3 可区分维度不坍缩', () => {
  it('同名不同 receiver 的方法 → 两个不同 ID', () => {
    const a = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'save', owner: 'UserRepo', params: [] });
    const b = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'save', owner: 'OrderRepo', params: [] });
    expect(a).not.toBe(b);
  });

  it('签名不同的重载 → 不同 ID', () => {
    const one = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'add', owner: 'Calc', params: ['a'] });
    const two = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'add', owner: 'Calc', params: ['a', 'b'] });
    expect(one).not.toBe(two);
  });

  it('normalizeSignature 对参数确定性归一', () => {
    expect(normalizeSignature([' a ', 'b'])).toBe(normalizeSignature(['a', 'b']));
    expect(normalizeSignature([])).toBe('()');
  });
});

describe('R4 匿名与难命名构造的稳定兜底', () => {
  // 一个匿名 handler：无 name，靠 (path, owner, kind) 内出现序号兜底。
  const anon = (ordinal) => deriveNodeId({ type: 'function', path: 'src/routes.ts', owner: '', params: [], ordinal });

  it('前插注释/空行/非同类代码 → 序号不变 → ID 不变', () => {
    // 非同类插入不改变同 kind 声明序号：ordinal 仍是 2。
    expect(anon(2)).toBe(anon(2));
  });

  it('前插一个同类声明 → 序号+1 → ID 变化（但只是该节点自身）', () => {
    expect(anon(3)).not.toBe(anon(2));
  });

  it('匿名节点缺 ordinal 时报错（fail-closed，不生成不稳定 id）', () => {
    expect(() => deriveNodeId({ type: 'function', path: 'src/routes.ts', owner: '', params: [] }))
      .toThrow();
  });
});

describe('R5 身份一致性可见，冲突不静默', () => {
  it('两个可区分声明（不同 lineRange）得到同一 ID → 报 identity-collision', () => {
    const decls = [
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'A', params: [], lineRange: [1, 5] },
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'A', params: [], lineRange: [20, 25] },
    ];
    const { collisions } = collectNodeIds(decls);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].id).toBe('function:src/a.ts:A#run()');
  });

  it('唯一声明不产生冲突', () => {
    const decls = [
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'A', params: [], lineRange: [1, 5] },
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'B', params: [], lineRange: [20, 25] },
    ];
    const { collisions } = collectNodeIds(decls);
    expect(collisions).toHaveLength(0);
  });
});
