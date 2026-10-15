// by-type-injection, task 3.1: the Java call resolver answers read-only type
// queries - every repository type it indexed, a type written in a file
// resolved in scope, the supertypes a type writes, and its ancestors - through
// the scoping rules call resolution already uses. Every case runs real
// tree-sitter extraction, so the rows are the ones the extractor reports.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { createJavaCallResolver } from '../../skills/excavator/java-call-resolution.mjs';
import { createJavaTypeQueries } from '../../skills/excavator/java-type-queries.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

/** Structure rows for `{ path: lines }`, through the real extractor. */
function extract(files) {
  return Object.entries(files).map(([path, lines]) => {
    const source = [...lines, ''].join('\n');
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, source);
    expect(extracted.structureOutcome).toBe('succeeded');
    return buildResult(file, lines.length, lines.length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  });
}

/** A resolver over `files`, with the view of a type by `path` and class name. */
function build(files, { rows = extract(files) } = {}) {
  const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map((fn) => `${fn.owner}#${fn.name}`)]));
  const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((cls) => `class:${row.path}:${cls.name}`)]));
  const resolver = createJavaCallResolver({ rows, functionIds, classIds });
  const view = (path, name) => {
    const found = resolver.declaredTypes().filter((type) => type.path === path && type.name === name);
    expect(found, `${path} ${name}`).toHaveLength(1);
    return found[0];
  };
  return { rows, resolver, view };
}

/** A resolution as one readable value. */
function show(resolution) {
  switch (resolution.status) {
    case 'repo': return `repo ${resolution.type.fqn} (${resolution.type.path})`;
    case 'ambiguous': return resolution.types
      ? `ambiguous ${resolution.types.map((type) => `${type.fqn} (${type.path})`).join(' | ')}`
      : 'ambiguous';
    case 'typeVariable': return `typeVariable ${resolution.name} extends ${resolution.bound}`;
    default: return resolution.status;
  }
}

/** A fixture built when the tests of its block start: the extractor needs the registry that beforeAll loads. */
function fixture(files, options) {
  const built = {};
  beforeAll(() => { Object.assign(built, build(files, options)); });
  return built;
}

const P = 'src/main/java/p';
const Q = 'src/main/java/q';

const PROJECT = {
  [`${P}/Shape.java`]: ['package p;', 'public interface Shape {}'],
  [`${P}/Base.java`]: ['package p;', 'public abstract class Base implements Shape {}'],
  [`${P}/Circle.java`]: [
    'package p;',
    'import java.io.Serializable;',
    'public class Circle extends Base implements Serializable, Comparable<Circle> {}',
  ],
  [`${Q}/Other.java`]: ['package q;', 'public class Other {}', 'class Helper {}'],
  [`${P}/User.java`]: [
    'package p;',
    'import q.Other;',
    'import java.util.List;',
    'import com.acme.Widget;',
    'public class User<T extends Shape> {}',
  ],
};

describe('declaredTypes: every repository type the resolver indexed', () => {
  const f = fixture(PROJECT);
  let listed;
  beforeAll(() => { listed = f.resolver.declaredTypes(); });

  it('lists one view per declaration in rows order, then class order', () => {
    expect(listed.map((type) => [type.fqn, type.name, type.kind, type.path, type.id])).toEqual([
      ['p.Shape', 'Shape', 'interface', `${P}/Shape.java`, `class:${P}/Shape.java:Shape`],
      ['p.Base', 'Base', 'class', `${P}/Base.java`, `class:${P}/Base.java:Base`],
      ['p.Circle', 'Circle', 'class', `${P}/Circle.java`, `class:${P}/Circle.java:Circle`],
      ['q.Other', 'Other', 'class', `${Q}/Other.java`, `class:${Q}/Other.java:Other`],
      ['q.Helper', 'Helper', 'class', `${Q}/Other.java`, `class:${Q}/Other.java:Helper`],
      ['p.User', 'User', 'class', `${P}/User.java`, `class:${P}/User.java:User`],
    ]);
  });

  it('follows the order of the rows it is given, not the names', () => {
    const reversed = build(PROJECT, { rows: [...f.rows].reverse() }).resolver.declaredTypes();
    expect(reversed.map((type) => type.fqn)).toEqual(['p.User', 'q.Other', 'q.Helper', 'p.Circle', 'p.Base', 'p.Shape']);
  });

  it('gives the structure row class entry itself, by reference, and does not freeze it', () => {
    const circle = listed.find((type) => type.name === 'Circle');
    const row = f.rows.find((r) => r.path === `${P}/Circle.java`);
    expect(circle.cls).toBe(row.classes[0]);
    expect(Object.isFrozen(row.classes[0])).toBe(false);
    expect(Object.isFrozen(row)).toBe(false);
  });

  it('gives frozen views, and the same view and the same list on every call', () => {
    expect(Object.isFrozen(listed)).toBe(true);
    for (const type of listed) expect(Object.isFrozen(type)).toBe(true);
    expect(f.resolver.declaredTypes()).toBe(listed);
    expect(f.resolver.declaredTypes()[2]).toBe(listed[2]);
  });

  it('gives a null id for a class the resolver was given no node id for', () => {
    const shared = build(PROJECT);
    const alone = createJavaCallResolver({
      rows: shared.rows,
      functionIds: new Map(),
      classIds: new Map([[`${P}/Shape.java`, [null]]]),
    });
    expect(alone.declaredTypes().find((type) => type.name === 'Shape').id).toBeNull();
    expect(alone.declaredTypes().find((type) => type.name === 'Base').id).toBeNull();
  });

  it('lists a name two files both declare once per declaration', () => {
    const dup = build({
      'src/a/p/Dup.java': ['package p;', 'class Dup {}'],
      'src/b/p/Dup.java': ['package p;', 'class Dup {}'],
    });
    expect(dup.resolver.declaredTypes().map((type) => [type.fqn, type.path])).toEqual([
      ['p.Dup', 'src/a/p/Dup.java'],
      ['p.Dup', 'src/b/p/Dup.java'],
    ]);
  });

  it('lists nothing for a class entry with no qualified name or kind: the resolver does not index it', () => {
    const odd = extract({ [`${P}/Odd.java`]: ['package p;', 'class Odd {}'], [`${P}/Fine.java`]: ['package p;', 'class Fine {}'] });
    delete odd[0].classes[0].qualifiedName;
    expect(build(null, { rows: odd }).resolver.declaredTypes().map((type) => type.name)).toEqual(['Fine']);
    const noKind = extract({ [`${P}/NoKind.java`]: ['package p;', 'class NoKind {}'] });
    delete noKind[0].classes[0].kind;
    expect(build(null, { rows: noKind }).resolver.declaredTypes()).toEqual([]);
  });

  it('lists nothing for no rows, and for a row with no classes', () => {
    expect(build({}, { rows: [] }).resolver.declaredTypes()).toEqual([]);
    expect(build({ [`${P}/package-info.java`]: ['package p;'] }).resolver.declaredTypes()).toEqual([]);
  });
});

describe('resolveTypeText: a type written in a file, in scope', () => {
  const f = fixture({
    ...PROJECT,
    [`${P}/Holder.java`]: [
      'package p;',
      'import java.util.*;',
      'public class Holder<Circle> {',
      '  class Shape {}',
      '}',
    ],
  });
  const user = `${P}/User.java`;
  const resolve = (text, extra = {}) => show(f.resolver.resolveTypeText({ path: user, text, ...extra }));

  it('resolves a repository type: of the package, imported, and fully qualified', () => {
    expect(resolve('Shape')).toBe(`repo p.Shape (${P}/Shape.java)`);
    expect(resolve('Other')).toBe(`repo q.Other (${Q}/Other.java)`);
    expect(resolve('q.Other')).toBe(`repo q.Other (${Q}/Other.java)`);
    expect(resolve('p.Base')).toBe(`repo p.Base (${P}/Base.java)`);
  });

  it('gives the view the resolver listed, the same object', () => {
    const resolution = f.resolver.resolveTypeText({ path: user, text: 'Shape' });
    expect(resolution.status).toBe('repo');
    expect(resolution.type).toBe(f.view(`${P}/Shape.java`, 'Shape'));
    expect(Object.isFrozen(resolution)).toBe(true);
  });

  it('resolves a type outside the repository: imported, in java.lang, fully qualified, and from an outside on-demand import', () => {
    expect(resolve('Widget')).toBe('external');
    expect(resolve('List')).toBe('external');
    expect(resolve('String')).toBe('external');
    expect(resolve('Comparable')).toBe('external');
    expect(resolve('java.util.Map')).toBe('external');
    expect(show(f.resolver.resolveTypeText({ path: `${P}/Holder.java`, text: 'Map' }))).toBe('external');
  });

  it('does not take an undeclared simple name for an outside type: it is unknown', () => {
    expect(resolve('Mystery')).toBe('unknown');
  });

  it('is unknown for a nested type written as Outer.Inner, which the resolver does not resolve', () => {
    expect(resolve('Other.Inner')).toBe('unknown');
    expect(resolve('p.Base.Inner')).toBe('unknown');
  });

  it('is unknown for text it cannot read: empty, malformed or not a string', () => {
    expect(resolve('')).toBe('unknown');
    expect(resolve('a b')).toBe('unknown');
    expect(resolve('p..Base')).toBe('unknown');
    expect(resolve(undefined)).toBe('unknown');
    expect(resolve(null)).toBe('unknown');
    expect(resolve(42)).toBe('unknown');
  });

  it('is an array for any array type, whatever its element, and for varargs', () => {
    expect(resolve('Shape[]')).toBe('array');
    expect(resolve('String[][]')).toBe('array');
    expect(resolve('int[]')).toBe('array');
    expect(resolve('Shape...')).toBe('array');
    expect(resolve('Mystery[]')).toBe('array');
  });

  it('is primitive for the primitive types and void', () => {
    for (const name of ['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void']) {
      expect(resolve(name), name).toBe('primitive');
    }
  });

  it('erases generics, annotations and whitespace the way the resolver does', () => {
    expect(resolve('Shape<String>')).toBe(`repo p.Shape (${P}/Shape.java)`);
    expect(resolve('List<Shape>')).toBe('external');
    expect(resolve('Shape<List<q.Other>>')).toBe(`repo p.Shape (${P}/Shape.java)`);
    expect(resolve('@Nullable Shape')).toBe(`repo p.Shape (${P}/Shape.java)`);
    expect(resolve('q . Other')).toBe(`repo q.Other (${Q}/Other.java)`);
    expect(resolve('Map<String, List<Mystery>>')).toBe('unknown');
  });

  describe('type variables', () => {
    const userType = () => f.view(`${P}/User.java`, 'User');
    const holderType = () => f.view(`${P}/Holder.java`, 'Holder');

    it('reports the type parameter of the owner, with its bound, before anything else', () => {
      expect(resolve('T', { owner: userType() })).toBe('typeVariable T extends Shape');
      // `Circle` is also a repository type; inside Holder<Circle> it is the variable.
      expect(show(f.resolver.resolveTypeText({ path: `${P}/Holder.java`, text: 'Circle', owner: holderType() }))).toBe('typeVariable Circle extends null');
      expect(show(f.resolver.resolveTypeText({ path: `${P}/Holder.java`, text: 'Circle' }))).toBe(`repo p.Circle (${P}/Circle.java)`);
    });

    it('reports a type parameter of the method, which hides one of the owner with the same name', () => {
      expect(resolve('R', { owner: userType(), methodTypeParameters: [{ name: 'R', bound: null }] })).toBe('typeVariable R extends null');
      expect(resolve('T', { owner: userType(), methodTypeParameters: [{ name: 'T', bound: 'Number' }] })).toBe('typeVariable T extends Number');
      expect(resolve('T', { owner: userType(), methodTypeParameters: [{ name: 'R', bound: 'Other' }] })).toBe('typeVariable T extends Shape');
    });

    it('reads a method type parameter that states no bound as unbounded', () => {
      expect(resolve('R', { methodTypeParameters: [{ name: 'R' }] })).toBe('typeVariable R extends null');
    });

    it('reports no variable for text that is not a string, whatever the variables are called', () => {
      expect(resolve(null, { methodTypeParameters: [{ name: 'null', bound: null }] })).toBe('unknown');
      expect(resolve(undefined, { methodTypeParameters: [{ name: 'undefined', bound: null }] })).toBe('unknown');
    });

    it('reports a type parameter of the method with no owner, and none for a name no one declares', () => {
      expect(resolve('R', { methodTypeParameters: [{ name: 'R', bound: 'q.Other' }] })).toBe('typeVariable R extends q.Other');
      expect(resolve('T')).toBe('unknown');
      expect(resolve('T', { methodTypeParameters: [{ name: 'R', bound: null }] })).toBe('unknown');
    });

    it('reads a variable by its erased base name: an array of it is an array and a generic of it is not a variable', () => {
      expect(resolve('T[]', { owner: userType() })).toBe('array');
      expect(resolve('T...', { owner: userType() })).toBe('array');
      expect(resolve('List<T>', { owner: userType() })).toBe('external');
      expect(resolve('@Nullable T', { owner: userType() })).toBe('typeVariable T extends Shape');
    });

    it('does not take a variable of the owner for one in a file scope with no owner', () => {
      expect(resolve('T')).toBe('unknown');
    });
  });

  describe('the scope of the owner', () => {
    it('lets a member type of the owner hide the type of the same name in the package', () => {
      const holder = f.view(`${P}/Holder.java`, 'Holder');
      expect(show(f.resolver.resolveTypeText({ path: `${P}/Holder.java`, text: 'Shape', owner: holder }))).toBe('unknown');
      expect(show(f.resolver.resolveTypeText({ path: `${P}/Holder.java`, text: 'Shape' }))).toBe(`repo p.Shape (${P}/Shape.java)`);
    });
  });

  describe('a name two declarations share', () => {
    const dup = fixture({
      'src/a/p/Dup.java': ['package p;', 'class Dup {}'],
      'src/b/p/Dup.java': ['package p;', 'class Dup {}'],
      'src/a/p/User.java': ['package p;', 'class User {}'],
      'src/b/p/User.java': ['package p;', 'class User {}'],
      'src/c/p/User.java': ['package p;', 'class User {}'],
    });
    const at = (path, text) => show(dup.resolver.resolveTypeText({ path, text }));

    it('prefers the declaration under the source root of the file that writes it, as the resolver does', () => {
      expect(at('src/a/p/User.java', 'Dup')).toBe('repo p.Dup (src/a/p/Dup.java)');
      expect(at('src/b/p/User.java', 'Dup')).toBe('repo p.Dup (src/b/p/Dup.java)');
      expect(at('src/a/p/User.java', 'p.Dup')).toBe('repo p.Dup (src/a/p/Dup.java)');
    });

    it('is ambiguous, with the views in rows order, when the source root decides nothing', () => {
      expect(at('src/c/p/User.java', 'Dup')).toBe('ambiguous p.Dup (src/a/p/Dup.java) | p.Dup (src/b/p/Dup.java)');
    });

    it('gives every alternative the view the resolver listed', () => {
      const resolution = dup.resolver.resolveTypeText({ path: 'src/c/p/User.java', text: 'Dup' });
      const listed = dup.resolver.declaredTypes().filter((type) => type.fqn === 'p.Dup');
      expect(resolution.types).toHaveLength(2);
      expect(resolution.types[0]).toBe(listed[0]);
      expect(resolution.types[1]).toBe(listed[1]);
      expect(Object.isFrozen(resolution.types)).toBe(true);
      expect(Object.isFrozen(resolution)).toBe(true);
    });

    it('is ambiguous when two declarations sit under the source root of the file itself', () => {
      const same = build({
        'src/a/p/Dup.java': ['package p;', 'class Dup {}'],
        'src/a/p/Extra.java': ['package p;', 'class Extra {}', 'class Dup {}'],
        'src/a/p/User.java': ['package p;', 'class User {}'],
      });
      expect(show(same.resolver.resolveTypeText({ path: 'src/a/p/User.java', text: 'Dup' })))
        .toBe('ambiguous p.Dup (src/a/p/Dup.java) | p.Dup (src/a/p/Extra.java)');
    });
  });

  // A package of one segment cannot be imported on demand: the extractor records no import for `import p.*;`.
  it('is ambiguous with no views when an alternative is not a repository type', () => {
    const mixed = build({
      'src/main/java/kit/core/Thing.java': ['package kit.core;', 'public class Thing {}'],
      'src/main/java/kit/core/Outer.java': ['package kit.core;', 'public class Outer { public static class Thing {} }'],
      'src/main/java/kit/view/Use.java': ['package kit.view;', 'import kit.core.*;', 'import kit.core.Outer.*;', 'class Use {}'],
    });
    const resolution = mixed.resolver.resolveTypeText({ path: 'src/main/java/kit/view/Use.java', text: 'Thing' });
    expect(resolution.status).toBe('ambiguous');
    expect(resolution).not.toHaveProperty('types');
  });

  it('is ambiguous with the views when a repository type shares its name with one of java.lang', () => {
    const lang = build({
      'src/main/java/kit/core/Record.java': ['package kit.core;', 'public class Record {}'],
      'src/main/java/kit/view/Use.java': ['package kit.view;', 'import kit.core.*;', 'class Use {}'],
    });
    expect(show(lang.resolver.resolveTypeText({ path: 'src/main/java/kit/view/Use.java', text: 'Record' })))
      .toBe('ambiguous kit.core.Record (src/main/java/kit/core/Record.java)');
  });

  describe('what it refuses', () => {
    const bareFixture = fixture(PROJECT);
    const bare = { resolveTypeText: (...args) => bareFixture.resolver.resolveTypeText(...args) };
    const bareView = (...args) => bareFixture.view(...args);

    it('throws for a path no row has', () => {
      expect(() => bare.resolveTypeText({ path: 'src/Missing.java', text: 'Shape' })).toThrow(/no structure row for "src\/Missing\.java"/);
    });

    it('throws for an owner that is not a view of this resolver', () => {
      expect(() => bare.resolveTypeText({ path: `${P}/User.java`, text: 'T', owner: { fqn: 'p.User' } })).toThrow(/not a type view of this resolver/);
      const other = build(PROJECT);
      expect(() => bare.resolveTypeText({ path: `${P}/User.java`, text: 'T', owner: other.view(`${P}/User.java`, 'User') })).toThrow(/not a type view/);
    });

    it('throws for an owner declared in another file than the path', () => {
      expect(() => bare.resolveTypeText({ path: `${P}/Base.java`, text: 'T', owner: bareView(`${P}/User.java`, 'User') })).toThrow(/declared in .*User\.java/);
    });

    it('throws for method type parameters that are not a list', () => {
      expect(() => bare.resolveTypeText({ path: `${P}/User.java`, text: 'T', methodTypeParameters: 'T' })).toThrow(/methodTypeParameters must be an array/);
    });
  });
});

describe('no fourth state', () => {
  it('throws for a resolution the resolver has no public form for, instead of calling it unknown', () => {
    const queries = createJavaTypeQueries({
      types: [],
      contextOf: () => ({}),
      resolveType: () => ({ status: 'invented' }),
      supertypesOf: () => [],
      hierarchy: () => ({ types: [], hasExternal: false, hasUnknown: false }),
      typeScope: () => ({}),
      stripTypeText: (text) => ({ base: text, dims: 0 }),
    });
    expect(() => queries.resolveTypeText({ path: 'a.java', text: 'X' })).toThrow(/a type resolution outside the known set: "invented"/);
  });
});

describe('directSupertypes: what a type writes after extends and implements', () => {
  const f = fixture({
    ...PROJECT,
    [`${P}/Loan.java`]: [
      'package p;',
      'import com.acme.Auditable;',
      'public class Loan<T> extends Missing<T>',
      '    implements Shape, Auditable<Loan<T>>, com.acme.Other, Base.Inner, Comparable<Loan<T>> {}',
    ],
    [`${P}/Port.java`]: [
      'package p;',
      'public interface Port extends Shape, java.io.Closeable {}',
    ],
    [`${P}/Plain.java`]: ['package p;', 'class Plain {}'],
  });

  it('gives each written supertype with its relation, line, text as written and resolution', () => {
    expect(f.resolver.directSupertypes(f.view(`${P}/Circle.java`, 'Circle')).map((s) => [s.relation, s.line, s.text, show(s.resolution)])).toEqual([
      ['extends', 3, 'Base', `repo p.Base (${P}/Base.java)`],
      ['implements', 3, 'Serializable', 'external'],
      ['implements', 3, 'Comparable<Circle>', 'external'],
    ]);
  });

  it('keeps generics and qualified spellings in the text, and an unresolved supertype is unknown', () => {
    expect(f.resolver.directSupertypes(f.view(`${P}/Loan.java`, 'Loan')).map((s) => [s.relation, s.line, s.text, show(s.resolution)])).toEqual([
      ['extends', 3, 'Missing<T>', 'unknown'],
      ['implements', 4, 'Shape', `repo p.Shape (${P}/Shape.java)`],
      ['implements', 4, 'Auditable<Loan<T>>', 'external'],
      ['implements', 4, 'com.acme.Other', 'external'],
      ['implements', 4, 'Base.Inner', 'unknown'],
      ['implements', 4, 'Comparable<Loan<T>>', 'external'],
    ]);
  });

  it('writes extends for each supertype of an interface', () => {
    expect(f.resolver.directSupertypes(f.view(`${P}/Port.java`, 'Port')).map((s) => [s.relation, s.text, show(s.resolution)])).toEqual([
      ['extends', 'Shape', `repo p.Shape (${P}/Shape.java)`],
      ['extends', 'java.io.Closeable', 'external'],
    ]);
  });

  it('gives the view of a repository supertype the resolver listed', () => {
    const [base] = f.resolver.directSupertypes(f.view(`${P}/Circle.java`, 'Circle'));
    expect(base.resolution.type).toBe(f.view(`${P}/Base.java`, 'Base'));
  });

  it('gives an empty list for a type with no supertype', () => {
    expect(f.resolver.directSupertypes(f.view(`${P}/Plain.java`, 'Plain'))).toEqual([]);
    expect(f.resolver.directSupertypes(f.view(`${P}/Shape.java`, 'Shape'))).toEqual([]);
  });

  it('is frozen, and the same list on every call', () => {
    const circle = f.view(`${P}/Circle.java`, 'Circle');
    const list = f.resolver.directSupertypes(circle);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(Object.isFrozen(list[0].resolution)).toBe(true);
    expect(f.resolver.directSupertypes(circle)).toBe(list);
  });

  it('is ambiguous, with the views, for a supertype two declarations share', () => {
    const dup = build({
      'src/a/p/Dup.java': ['package p;', 'class Dup {}'],
      'src/b/p/Dup.java': ['package p;', 'class Dup {}'],
      'src/c/p/Sub.java': ['package p;', 'class Sub extends Dup {}'],
    });
    const [only] = dup.resolver.directSupertypes(dup.view('src/c/p/Sub.java', 'Sub'));
    expect(show(only.resolution)).toBe('ambiguous p.Dup (src/a/p/Dup.java) | p.Dup (src/b/p/Dup.java)');
  });

  it('throws for a type that is not a view of this resolver', () => {
    expect(() => f.resolver.directSupertypes({ fqn: 'p.Circle' })).toThrow(/not a type view of this resolver/);
    expect(() => f.resolver.directSupertypes(null)).toThrow(/not a type view/);
  });
});

describe('ancestors: the repository types a type reaches', () => {
  const f = fixture({
    [`${P}/A.java`]: ['package p;', 'import com.acme.Ext;', 'public class A implements Ext {}'],
    [`${P}/I1.java`]: ['package p;', 'public interface I1 extends Missing {}'],
    [`${P}/B.java`]: ['package p;', 'public class B extends A implements I1 {}'],
    [`${P}/C.java`]: ['package p;', 'public class C extends B {}'],
    [`${P}/Clean.java`]: ['package p;', 'public interface Clean {}'],
    [`${P}/Child.java`]: ['package p;', 'public class Child implements Clean {}'],
    [`${P}/OnlyExternal.java`]: ['package p;', 'public class OnlyExternal extends java.lang.Thread {}'],
    [`${P}/OnlyUnknown.java`]: ['package p;', 'public class OnlyUnknown extends Mystery {}'],
    [`${P}/Cyclic1.java`]: ['package p;', 'public class Cyclic1 extends Cyclic2 {}'],
    [`${P}/Cyclic2.java`]: ['package p;', 'public class Cyclic2 extends Cyclic1 {}'],
    [`${P}/Diamond.java`]: ['package p;', 'public class Diamond extends B implements Clean, I1 {}'],
  });
  const names = (name) => f.resolver.ancestors(f.view(`${P}/${name}.java`, name)).ancestors.map((type) => type.name);

  it('lists the ancestors nearest first, through two levels, superclass before interfaces', () => {
    expect(names('C')).toEqual(['B', 'A', 'I1']);
    expect(names('B')).toEqual(['A', 'I1']);
  });

  it('does not list the type itself, nor an ancestor twice', () => {
    expect(names('Diamond')).toEqual(['B', 'Clean', 'I1', 'A']);
    for (const name of ['C', 'B', 'A', 'Diamond']) expect(names(name)).not.toContain(name);
  });

  it('says whether a supertype on the way is outside the repository, or cannot be resolved', () => {
    const c = f.resolver.ancestors(f.view(`${P}/C.java`, 'C'));
    expect([c.hasExternal, c.hasUnknown]).toEqual([true, true]);
    const clean = f.resolver.ancestors(f.view(`${P}/Child.java`, 'Child'));
    expect([clean.hasExternal, clean.hasUnknown]).toEqual([false, false]);
    const external = f.resolver.ancestors(f.view(`${P}/OnlyExternal.java`, 'OnlyExternal'));
    expect([external.hasExternal, external.hasUnknown]).toEqual([true, false]);
    const unknown = f.resolver.ancestors(f.view(`${P}/OnlyUnknown.java`, 'OnlyUnknown'));
    expect([unknown.hasExternal, unknown.hasUnknown]).toEqual([false, true]);
  });

  it('reports a supertype that is out of reach only where it is reached from', () => {
    const b = f.resolver.ancestors(f.view(`${P}/B.java`, 'B'));
    expect([b.hasExternal, b.hasUnknown]).toEqual([true, true]);
    const i1 = f.resolver.ancestors(f.view(`${P}/I1.java`, 'I1'));
    expect([i1.ancestors.length, i1.hasExternal, i1.hasUnknown]).toEqual([0, false, true]);
    const a = f.resolver.ancestors(f.view(`${P}/A.java`, 'A'));
    expect([a.ancestors.length, a.hasExternal, a.hasUnknown]).toEqual([0, true, false]);
  });

  it('gives an empty list for a type with no repository ancestor', () => {
    expect(f.resolver.ancestors(f.view(`${P}/Clean.java`, 'Clean'))).toEqual({ ancestors: [], hasExternal: false, hasUnknown: false });
  });

  it('ends for a hierarchy that is a cycle', () => {
    expect(names('Cyclic1')).toEqual(['Cyclic2']);
    expect(names('Cyclic2')).toEqual(['Cyclic1']);
  });

  it('gives the views the resolver listed, frozen, and the same result on every call', () => {
    const c = f.view(`${P}/C.java`, 'C');
    const result = f.resolver.ancestors(c);
    expect(result.ancestors[0]).toBe(f.view(`${P}/B.java`, 'B'));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ancestors)).toBe(true);
    expect(f.resolver.ancestors(c)).toBe(result);
  });

  it('throws for a type that is not a view of this resolver', () => {
    expect(() => f.resolver.ancestors({ fqn: 'p.C' })).toThrow(/not a type view of this resolver/);
  });
});

describe('the queries leave the resolver as it was', () => {
  it('does not change the hierarchy edges, whether they are asked for before or after', () => {
    const files = { ...PROJECT, [`${P}/Loan.java`]: ['package p;', 'public class Loan extends Circle implements Shape {}'] };
    const first = build(files);
    const before = JSON.stringify(first.resolver.hierarchyEdges());
    for (const type of first.resolver.declaredTypes()) {
      first.resolver.directSupertypes(type);
      first.resolver.ancestors(type);
      first.resolver.resolveTypeText({ path: type.path, text: type.name, owner: type });
    }
    expect(JSON.stringify(first.resolver.hierarchyEdges())).toBe(before);
    const second = build(files);
    for (const type of second.resolver.declaredTypes()) second.resolver.ancestors(type);
    expect(JSON.stringify(second.resolver.hierarchyEdges())).toBe(before);
  });
});
