// by-type-injection, tasks 2.1-2.2: the declarative type injection catalog
// (skills/excavator/catalogs/type-injections.json, version 1) and its strict
// loader. The shipped catalog loads, is frozen and says what design D4 lists; a
// catalog with an unknown key, a missing field, a wrong type, an empty family
// annotation or member kind list, an unknown member kind, a repeated family id,
// a name that is not a qualified name, a qualified name that two roles both
// claim, or a version other than 1 does not load at all.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHIPPED_TYPE_INJECTION_CATALOG,
  loadTypeInjectionCatalog,
  parseTypeInjectionCatalog,
} from '../../skills/excavator/type-injection-catalog.mjs';

const shipped = () => JSON.parse(JSON.stringify(loadTypeInjectionCatalog()));
const mutate = (edit) => {
  const raw = shipped();
  edit(raw);
  return raw;
};
const rejects = (edit, message) => expect(() => parseTypeInjectionCatalog(mutate(edit))).toThrow(message);
const accepts = (edit) => parseTypeInjectionCatalog(mutate(edit));
const JSR330 = (raw) => raw.injectionFamilies[0];
const EJB = (raw) => raw.injectionFamilies[1];

// The role objects of the catalog, each with the key of its list of names.
const ROLE_KEYS = {
  namedQualifier: 'annotations',
  producers: 'annotations',
  providerTypes: 'types',
  deploymentDependent: 'annotations',
  notQualifiers: 'annotations',
  businessInterfaces: 'annotations',
};

// A second, valid family whose names collide with nothing in the shipped catalog.
const otherFamily = () => ({
  id: 'other',
  basis: 'A second family used by the tests.',
  annotations: ['org.acme.Wire'],
  on: ['field'],
  readsQualifiers: false,
  singleParameterMethods: false,
  nameArguments: [],
  nameAnnotations: [],
  lookupArguments: [],
  typeArgument: null,
});

describe('the shipped catalog', () => {
  const catalog = loadTypeInjectionCatalog();
  const [jsr330, ejb] = catalog.injectionFamilies;

  it('has version 1 and the two injection families of design D4, each with an id', () => {
    expect(catalog.version).toBe(1);
    expect(catalog.injectionFamilies.map((family) => family.id)).toEqual(['jsr330-inject', 'ejb-inject']);
  });

  it('has a basis of a sentence or more on every family and every role', () => {
    const bases = [
      ...catalog.injectionFamilies.map((family) => family.basis),
      ...Object.keys(ROLE_KEYS).map((role) => catalog[role].basis),
    ];
    expect(bases).toHaveLength(8);
    for (const basis of bases) expect(basis.length).toBeGreaterThan(80);
  });

  it('has the JSR 330 family: Inject of three namespaces on a field, method or constructor, qualifiers read, a Spring Qualifier resolved by name', () => {
    const { basis, ...rest } = jsr330;
    expect(rest).toEqual({
      id: 'jsr330-inject',
      annotations: ['javax.inject.Inject', 'jakarta.inject.Inject', 'com.google.inject.Inject'],
      on: ['field', 'method', 'constructor'],
      readsQualifiers: true,
      singleParameterMethods: false,
      nameArguments: [],
      nameAnnotations: ['org.springframework.beans.factory.annotation.Qualifier'],
      lookupArguments: [],
      typeArgument: null,
    });
    expect(basis).toBeTypeOf('string');
  });

  it('has the EJB family: EJB of two namespaces on a field or a one-parameter method, bean name and JNDI name by name, beanInterface the type', () => {
    const { basis, ...rest } = ejb;
    expect(rest).toEqual({
      id: 'ejb-inject',
      annotations: ['javax.ejb.EJB', 'jakarta.ejb.EJB'],
      on: ['field', 'method'],
      readsQualifiers: false,
      singleParameterMethods: true,
      nameArguments: ['beanName'],
      nameAnnotations: [],
      lookupArguments: ['lookup', 'mappedName'],
      typeArgument: 'beanInterface',
    });
    expect(basis).toBeTypeOf('string');
  });

  it('has the name qualifier: Named of two namespaces by its value, Model giving a bean its default name', () => {
    const { basis, ...rest } = catalog.namedQualifier;
    expect(rest).toEqual({
      annotations: ['javax.inject.Named', 'jakarta.inject.Named'],
      argument: 'value',
      defaultNameStereotypes: ['javax.enterprise.inject.Model', 'jakarta.enterprise.inject.Model'],
    });
    expect(basis).toBeTypeOf('string');
  });

  it('has the producer annotations of CDI, Guice, Dagger and Spring', () => {
    expect(catalog.producers.annotations).toEqual([
      'javax.enterprise.inject.Produces',
      'jakarta.enterprise.inject.Produces',
      'com.google.inject.Provides',
      'dagger.Provides',
      'org.springframework.context.annotation.Bean',
    ]);
  });

  it('has the provider types of JSR 330, Guice and Spring', () => {
    expect(catalog.providerTypes.types).toEqual([
      'javax.inject.Provider',
      'jakarta.inject.Provider',
      'com.google.inject.Provider',
      'org.springframework.beans.factory.FactoryBean',
    ]);
  });

  it('has the annotations that make bean-ness depend on the deployment', () => {
    expect(catalog.deploymentDependent.annotations).toEqual([
      'javax.enterprise.inject.Alternative', 'jakarta.enterprise.inject.Alternative',
      'javax.enterprise.inject.Specializes', 'jakarta.enterprise.inject.Specializes',
      'javax.enterprise.inject.Typed', 'jakarta.enterprise.inject.Typed',
      'javax.enterprise.inject.Vetoed', 'jakarta.enterprise.inject.Vetoed',
      'javax.decorator.Decorator', 'jakarta.decorator.Decorator',
      'javax.interceptor.Interceptor', 'jakarta.interceptor.Interceptor',
    ]);
  });

  it('has the annotations that are never qualifiers, and none of java.lang', () => {
    expect(catalog.notQualifiers.annotations).toEqual(['lombok.Getter', 'lombok.Setter', 'javax.annotation.Nullable']);
    for (const name of catalog.notQualifiers.annotations) expect(name.startsWith('java.lang.')).toBe(false);
  });

  it('has the business interface annotations of both EJB namespaces, read from their value', () => {
    const { basis, ...rest } = catalog.businessInterfaces;
    expect(rest).toEqual({
      annotations: ['javax.ejb.Local', 'javax.ejb.Remote', 'jakarta.ejb.Local', 'jakarta.ejb.Remote'],
      argument: 'value',
    });
    expect(basis).toBeTypeOf('string');
  });

  it('does not put the Guice Named annotation in the name qualifier: Guice does not read it on a class', () => {
    expect(catalog.namedQualifier.annotations).not.toContain('com.google.inject.name.Named');
  });

  it('gives no qualified name two roles', () => {
    const names = [
      ...catalog.injectionFamilies.flatMap((family) => [...family.annotations, ...family.nameAnnotations]),
      ...catalog.namedQualifier.annotations,
      ...catalog.namedQualifier.defaultNameStereotypes,
      ...catalog.producers.annotations,
      ...catalog.providerTypes.types,
      ...catalog.deploymentDependent.annotations,
      ...catalog.notQualifiers.annotations,
      ...catalog.businessInterfaces.annotations,
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.injectionFamilies)).toBe(true);
    expect(Object.isFrozen(jsr330)).toBe(true);
    expect(Object.isFrozen(jsr330.annotations)).toBe(true);
    expect(Object.isFrozen(jsr330.on)).toBe(true);
    expect(Object.isFrozen(ejb.lookupArguments)).toBe(true);
    for (const role of Object.keys(ROLE_KEYS)) {
      expect(Object.isFrozen(catalog[role]), role).toBe(true);
      expect(Object.isFrozen(catalog[role][ROLE_KEYS[role]]), `${role}.${ROLE_KEYS[role]}`).toBe(true);
    }
    expect(Object.isFrozen(catalog.namedQualifier.defaultNameStereotypes)).toBe(true);
  });

  it('is a copy: changing the parsed input afterwards does not reach the catalog', () => {
    const raw = shipped();
    const parsed = parseTypeInjectionCatalog(raw);
    raw.injectionFamilies[0].id = 'changed';
    raw.producers.annotations.push('org.acme.Late');
    expect(parsed.injectionFamilies[0].id).toBe('jsr330-inject');
    expect(parsed.producers.annotations).toHaveLength(5);
  });
});

describe('the loader reads the file it is given', () => {
  it('loads the shipped file by default and names it', () => {
    expect(SHIPPED_TYPE_INJECTION_CATALOG.endsWith('/skills/excavator/catalogs/type-injections.json')).toBe(true);
    expect(loadTypeInjectionCatalog()).toEqual(loadTypeInjectionCatalog(SHIPPED_TYPE_INJECTION_CATALOG));
  });

  it('fails for a file that is not there, and for one that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-type-injection-catalog-'));
    try {
      expect(() => loadTypeInjectionCatalog(join(dir, 'missing.json'))).toThrow(/type-injection-catalog: cannot read .*missing\.json/);
      const broken = join(dir, 'broken.json');
      writeFileSync(broken, '{ "version": 1, ');
      expect(() => loadTypeInjectionCatalog(broken)).toThrow(/type-injection-catalog: cannot read .*broken\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates what it reads: a file that is valid JSON and not a catalog does not load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-type-injection-catalog-'));
    try {
      const file = join(dir, 'type-injections.json');
      writeFileSync(file, JSON.stringify(mutate((raw) => { JSR330(raw).extra = true; })));
      expect(() => loadTypeInjectionCatalog(file)).toThrow(/unknown key "extra"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('strict validation: nothing loads partially', () => {
  it('accepts the shipped catalog, and one with a further family', () => {
    expect(() => parseTypeInjectionCatalog(shipped())).not.toThrow();
    const catalog = accepts((raw) => { raw.injectionFamilies.push(otherFamily()); });
    expect(catalog.injectionFamilies.map((family) => family.id)).toEqual(['jsr330-inject', 'ejb-inject', 'other']);
  });

  it('fails for a catalog of another version, naming the version before anything else', () => {
    rejects((raw) => { raw.version = 2; }, /type-injection-catalog\.version: expected the number 1/);
    rejects((raw) => { raw.version = '1'; }, /type-injection-catalog\.version: expected the number 1/);
    // an older shape with nothing else is still "wrong version" first
    expect(() => parseTypeInjectionCatalog({ version: 0 })).toThrow(/type-injection-catalog\.version: expected the number 1/);
  });

  it('fails for something that is not an object, and for a missing version', () => {
    expect(() => parseTypeInjectionCatalog(null)).toThrow(/type-injection-catalog: expected an object/);
    expect(() => parseTypeInjectionCatalog([])).toThrow(/type-injection-catalog: expected an object/);
    expect(() => parseTypeInjectionCatalog('catalog')).toThrow(/type-injection-catalog: expected an object/);
    rejects((raw) => { delete raw.version; }, /type-injection-catalog: missing "version"/);
  });

  describe('unknown keys, at every level', () => {
    it.each([
      ['the catalog', (raw) => { raw.extra = 1; }, /type-injection-catalog: unknown key "extra"/],
      ['a family', (raw) => { EJB(raw).extra = 1; }, /injectionFamilies\[1\]: unknown key "extra"/],
      ['the name qualifier', (raw) => { raw.namedQualifier.extra = 1; }, /namedQualifier: unknown key "extra"/],
      ['the producers', (raw) => { raw.producers.extra = 1; }, /producers: unknown key "extra"/],
      ['the provider types', (raw) => { raw.providerTypes.extra = 1; }, /providerTypes: unknown key "extra"/],
      ['the deployment dependent annotations', (raw) => { raw.deploymentDependent.extra = 1; }, /deploymentDependent: unknown key "extra"/],
      ['the non-qualifiers', (raw) => { raw.notQualifiers.extra = 1; }, /notQualifiers: unknown key "extra"/],
      ['the business interfaces', (raw) => { raw.businessInterfaces.extra = 1; }, /businessInterfaces: unknown key "extra"/],
      ['a role that took the list key of another', (raw) => { raw.providerTypes.annotations = []; }, /providerTypes: unknown key "annotations"/],
    ])('fails for one in %s', (_where, edit, message) => rejects(edit, message));
  });

  describe('missing fields, at every level', () => {
    it.each([
      ['injectionFamilies', (raw) => { delete raw.injectionFamilies; }, /type-injection-catalog: missing "injectionFamilies"/],
      ['namedQualifier', (raw) => { delete raw.namedQualifier; }, /type-injection-catalog: missing "namedQualifier"/],
      ['producers', (raw) => { delete raw.producers; }, /type-injection-catalog: missing "producers"/],
      ['providerTypes', (raw) => { delete raw.providerTypes; }, /type-injection-catalog: missing "providerTypes"/],
      ['deploymentDependent', (raw) => { delete raw.deploymentDependent; }, /type-injection-catalog: missing "deploymentDependent"/],
      ['notQualifiers', (raw) => { delete raw.notQualifiers; }, /type-injection-catalog: missing "notQualifiers"/],
      ['businessInterfaces', (raw) => { delete raw.businessInterfaces; }, /type-injection-catalog: missing "businessInterfaces"/],
      ['the family id', (raw) => { delete JSR330(raw).id; }, /injectionFamilies\[0\]: missing "id"/],
      ['the family basis', (raw) => { delete JSR330(raw).basis; }, /injectionFamilies\[0\]: missing "basis"/],
      ['the family annotations', (raw) => { delete JSR330(raw).annotations; }, /injectionFamilies\[0\]: missing "annotations"/],
      ['the family member kinds', (raw) => { delete JSR330(raw).on; }, /injectionFamilies\[0\]: missing "on"/],
      ['readsQualifiers', (raw) => { delete JSR330(raw).readsQualifiers; }, /injectionFamilies\[0\]: missing "readsQualifiers"/],
      ['singleParameterMethods', (raw) => { delete JSR330(raw).singleParameterMethods; }, /injectionFamilies\[0\]: missing "singleParameterMethods"/],
      ['the family name arguments', (raw) => { delete EJB(raw).nameArguments; }, /injectionFamilies\[1\]: missing "nameArguments"/],
      ['the family name annotations', (raw) => { delete EJB(raw).nameAnnotations; }, /injectionFamilies\[1\]: missing "nameAnnotations"/],
      ['the family lookup arguments', (raw) => { delete EJB(raw).lookupArguments; }, /injectionFamilies\[1\]: missing "lookupArguments"/],
      ['the family type argument, which is null and not left out when it has none', (raw) => { delete JSR330(raw).typeArgument; }, /injectionFamilies\[0\]: missing "typeArgument"/],
      ['the name qualifier basis', (raw) => { delete raw.namedQualifier.basis; }, /namedQualifier: missing "basis"/],
      ['the name qualifier annotations', (raw) => { delete raw.namedQualifier.annotations; }, /namedQualifier: missing "annotations"/],
      ['the name qualifier argument', (raw) => { delete raw.namedQualifier.argument; }, /namedQualifier: missing "argument"/],
      ['the default name stereotypes', (raw) => { delete raw.namedQualifier.defaultNameStereotypes; }, /namedQualifier: missing "defaultNameStereotypes"/],
      ['the producers basis', (raw) => { delete raw.producers.basis; }, /producers: missing "basis"/],
      ['the producer annotations', (raw) => { delete raw.producers.annotations; }, /producers: missing "annotations"/],
      ['the provider types basis', (raw) => { delete raw.providerTypes.basis; }, /providerTypes: missing "basis"/],
      ['the provider types', (raw) => { delete raw.providerTypes.types; }, /providerTypes: missing "types"/],
      ['the deployment dependent basis', (raw) => { delete raw.deploymentDependent.basis; }, /deploymentDependent: missing "basis"/],
      ['the deployment dependent annotations', (raw) => { delete raw.deploymentDependent.annotations; }, /deploymentDependent: missing "annotations"/],
      ['the non-qualifiers basis', (raw) => { delete raw.notQualifiers.basis; }, /notQualifiers: missing "basis"/],
      ['the non-qualifier annotations', (raw) => { delete raw.notQualifiers.annotations; }, /notQualifiers: missing "annotations"/],
      ['the business interfaces basis', (raw) => { delete raw.businessInterfaces.basis; }, /businessInterfaces: missing "basis"/],
      ['the business interface annotations', (raw) => { delete raw.businessInterfaces.annotations; }, /businessInterfaces: missing "annotations"/],
      ['the business interface argument', (raw) => { delete raw.businessInterfaces.argument; }, /businessInterfaces: missing "argument"/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));
  });

  describe('wrong types', () => {
    it.each([
      ['a family that is not an object', (raw) => { raw.injectionFamilies[0] = 'jsr330-inject'; }, /injectionFamilies\[0\]: expected an object/],
      ['injectionFamilies that is not an array', (raw) => { raw.injectionFamilies = {}; }, /type-injection-catalog\.injectionFamilies: expected an array/],
      ['an id that is not a string', (raw) => { JSR330(raw).id = 7; }, /injectionFamilies\[0\]\.id: expected a string/],
      ['an empty id', (raw) => { JSR330(raw).id = ''; }, /injectionFamilies\[0\]\.id: expected a non-empty string/],
      ['a family basis that is not a string', (raw) => { JSR330(raw).basis = ['text']; }, /injectionFamilies\[0\]\.basis: expected a string/],
      ['an empty family basis', (raw) => { JSR330(raw).basis = ''; }, /injectionFamilies\[0\]\.basis: expected a non-empty string/],
      ['family annotations that are not an array', (raw) => { JSR330(raw).annotations = 'javax.inject.Inject'; }, /injectionFamilies\[0\]\.annotations: expected an array/],
      ['a family annotation that is not a string', (raw) => { JSR330(raw).annotations[1] = 3; }, /injectionFamilies\[0\]\.annotations\[1\]: expected a string/],
      ['member kinds that are not an array', (raw) => { JSR330(raw).on = 'field'; }, /injectionFamilies\[0\]\.on: expected an array/],
      ['a member kind that is not a string', (raw) => { JSR330(raw).on[0] = 1; }, /injectionFamilies\[0\]\.on\[0\]: expected a string/],
      ['readsQualifiers that is not a boolean', (raw) => { JSR330(raw).readsQualifiers = 'true'; }, /injectionFamilies\[0\]\.readsQualifiers: expected a boolean/],
      ['readsQualifiers that is null', (raw) => { JSR330(raw).readsQualifiers = null; }, /injectionFamilies\[0\]\.readsQualifiers: expected a boolean/],
      ['singleParameterMethods that is not a boolean', (raw) => { EJB(raw).singleParameterMethods = 1; }, /injectionFamilies\[1\]\.singleParameterMethods: expected a boolean/],
      ['name arguments that are not an array', (raw) => { EJB(raw).nameArguments = 'beanName'; }, /injectionFamilies\[1\]\.nameArguments: expected an array/],
      ['a name argument that is not a string', (raw) => { EJB(raw).nameArguments = [1]; }, /injectionFamilies\[1\]\.nameArguments\[0\]: expected a string/],
      ['name annotations that are not an array', (raw) => { JSR330(raw).nameAnnotations = 'a.B'; }, /injectionFamilies\[0\]\.nameAnnotations: expected an array/],
      ['a name annotation that is not a string', (raw) => { JSR330(raw).nameAnnotations = [null]; }, /injectionFamilies\[0\]\.nameAnnotations\[0\]: expected a string/],
      ['lookup arguments that are not an array', (raw) => { EJB(raw).lookupArguments = 'lookup'; }, /injectionFamilies\[1\]\.lookupArguments: expected an array/],
      ['a lookup argument that is not a string', (raw) => { EJB(raw).lookupArguments[1] = {}; }, /injectionFamilies\[1\]\.lookupArguments\[1\]: expected a string/],
      ['a type argument that is not a string or null', (raw) => { EJB(raw).typeArgument = 1; }, /injectionFamilies\[1\]\.typeArgument: expected a string/],
      ['an empty type argument', (raw) => { EJB(raw).typeArgument = ''; }, /injectionFamilies\[1\]\.typeArgument: expected a non-empty string/],
      ['a name qualifier that is not an object', (raw) => { raw.namedQualifier = ['javax.inject.Named']; }, /namedQualifier: expected an object/],
      ['a name qualifier basis that is not a string', (raw) => { raw.namedQualifier.basis = 3; }, /namedQualifier\.basis: expected a string/],
      ['name qualifier annotations that are not an array', (raw) => { raw.namedQualifier.annotations = 'javax.inject.Named'; }, /namedQualifier\.annotations: expected an array/],
      ['a name qualifier argument that is not a string', (raw) => { raw.namedQualifier.argument = 1; }, /namedQualifier\.argument: expected a string/],
      ['an empty name qualifier argument', (raw) => { raw.namedQualifier.argument = ''; }, /namedQualifier\.argument: expected a non-empty string/],
      ['default name stereotypes that are not an array', (raw) => { raw.namedQualifier.defaultNameStereotypes = 'x.Model'; }, /namedQualifier\.defaultNameStereotypes: expected an array/],
      ['a default name stereotype that is not a string', (raw) => { raw.namedQualifier.defaultNameStereotypes = [2]; }, /namedQualifier\.defaultNameStereotypes\[0\]: expected a string/],
      ['producers that are not an object', (raw) => { raw.producers = []; }, /producers: expected an object/],
      ['a producers basis that is empty', (raw) => { raw.producers.basis = ''; }, /producers\.basis: expected a non-empty string/],
      ['producer annotations that are not an array', (raw) => { raw.producers.annotations = {}; }, /producers\.annotations: expected an array/],
      ['a producer annotation that is not a string', (raw) => { raw.producers.annotations[2] = false; }, /producers\.annotations\[2\]: expected a string/],
      ['provider types that are not an object', (raw) => { raw.providerTypes = null; }, /providerTypes: expected an object/],
      ['a provider types basis that is not a string', (raw) => { raw.providerTypes.basis = []; }, /providerTypes\.basis: expected a string/],
      ['provider types that are not an array', (raw) => { raw.providerTypes.types = 'javax.inject.Provider'; }, /providerTypes\.types: expected an array/],
      ['a provider type that is not a string', (raw) => { raw.providerTypes.types[0] = 1; }, /providerTypes\.types\[0\]: expected a string/],
      ['deployment dependent annotations that are not an object', (raw) => { raw.deploymentDependent = 'x'; }, /deploymentDependent: expected an object/],
      ['a deployment dependent basis that is empty', (raw) => { raw.deploymentDependent.basis = ''; }, /deploymentDependent\.basis: expected a non-empty string/],
      ['deployment dependent annotations that are not an array', (raw) => { raw.deploymentDependent.annotations = 1; }, /deploymentDependent\.annotations: expected an array/],
      ['a deployment dependent annotation that is not a string', (raw) => { raw.deploymentDependent.annotations[0] = []; }, /deploymentDependent\.annotations\[0\]: expected a string/],
      ['non-qualifiers that are not an object', (raw) => { raw.notQualifiers = 1; }, /notQualifiers: expected an object/],
      ['a non-qualifiers basis that is not a string', (raw) => { raw.notQualifiers.basis = true; }, /notQualifiers\.basis: expected a string/],
      ['non-qualifier annotations that are not an array', (raw) => { raw.notQualifiers.annotations = 'lombok.Getter'; }, /notQualifiers\.annotations: expected an array/],
      ['a non-qualifier annotation that is not a string', (raw) => { raw.notQualifiers.annotations[1] = 2; }, /notQualifiers\.annotations\[1\]: expected a string/],
      ['business interfaces that are not an object', (raw) => { raw.businessInterfaces = false; }, /businessInterfaces: expected an object/],
      ['a business interfaces basis that is empty', (raw) => { raw.businessInterfaces.basis = ''; }, /businessInterfaces\.basis: expected a non-empty string/],
      ['business interface annotations that are not an array', (raw) => { raw.businessInterfaces.annotations = {}; }, /businessInterfaces\.annotations: expected an array/],
      ['a business interface annotation that is not a string', (raw) => { raw.businessInterfaces.annotations[3] = 4; }, /businessInterfaces\.annotations\[3\]: expected a string/],
      ['a business interface argument that is not a string', (raw) => { raw.businessInterfaces.argument = 1; }, /businessInterfaces\.argument: expected a string/],
      ['an empty business interface argument', (raw) => { raw.businessInterfaces.argument = ''; }, /businessInterfaces\.argument: expected a non-empty string/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));
  });

  describe('names that are not qualified names: the identity of an annotation or type is its qualified name', () => {
    it.each([
      ['a family annotation', (raw) => { JSR330(raw).annotations = ['Inject']; }, /injectionFamilies\[0\]\.annotations\[0\]: expected a qualified name/],
      ['a name annotation', (raw) => { JSR330(raw).nameAnnotations = ['Qualifier']; }, /injectionFamilies\[0\]\.nameAnnotations\[0\]: expected a qualified name/],
      ['a name qualifier annotation', (raw) => { raw.namedQualifier.annotations = ['javax.inject.Named', 'Named']; }, /namedQualifier\.annotations\[1\]: expected a qualified name/],
      ['a default name stereotype', (raw) => { raw.namedQualifier.defaultNameStereotypes = ['Model']; }, /namedQualifier\.defaultNameStereotypes\[0\]: expected a qualified name/],
      ['a producer annotation', (raw) => { raw.producers.annotations[0] = 'Produces'; }, /producers\.annotations\[0\]: expected a qualified name/],
      ['a provider type', (raw) => { raw.providerTypes.types[3] = 'FactoryBean'; }, /providerTypes\.types\[3\]: expected a qualified name/],
      ['a deployment dependent annotation', (raw) => { raw.deploymentDependent.annotations[0] = 'Alternative'; }, /deploymentDependent\.annotations\[0\]: expected a qualified name/],
      ['a non-qualifier annotation', (raw) => { raw.notQualifiers.annotations[2] = 'Nullable'; }, /notQualifiers\.annotations\[2\]: expected a qualified name/],
      ['a business interface annotation', (raw) => { raw.businessInterfaces.annotations[0] = 'Local'; }, /businessInterfaces\.annotations\[0\]: expected a qualified name/],
      ['a name with a trailing dot', (raw) => { raw.producers.annotations[0] = 'a.b.'; }, /producers\.annotations\[0\]: expected a qualified name/],
      ['a name with a leading dot', (raw) => { raw.producers.annotations[0] = '.a.B'; }, /producers\.annotations\[0\]: expected a qualified name/],
      ['a name with a space in it', (raw) => { raw.producers.annotations[0] = 'a. B'; }, /producers\.annotations\[0\]: expected a qualified name/],
      ['a name that starts a part with a digit', (raw) => { raw.producers.annotations[0] = 'a.1B'; }, /producers\.annotations\[0\]: expected a qualified name/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));
  });

  describe('argument names: Java identifiers, not dotted names', () => {
    it.each([
      ['a name argument', (raw) => { EJB(raw).nameArguments = ['bean.Name']; }, /injectionFamilies\[1\]\.nameArguments\[0\]: expected an identifier, not a dotted name/],
      ['a lookup argument', (raw) => { EJB(raw).lookupArguments[1] = 'mapped.Name'; }, /injectionFamilies\[1\]\.lookupArguments\[1\]: expected an identifier, not a dotted name/],
      ['a type argument', (raw) => { EJB(raw).typeArgument = 'bean.Interface'; }, /injectionFamilies\[1\]\.typeArgument: expected an identifier, not a dotted name/],
      ['a name qualifier argument', (raw) => { raw.namedQualifier.argument = 'a.value'; }, /namedQualifier\.argument: expected an identifier, not a dotted name/],
      ['a business interface argument', (raw) => { raw.businessInterfaces.argument = 'a.value'; }, /businessInterfaces\.argument: expected an identifier, not a dotted name/],
      ['an argument that starts with a digit', (raw) => { EJB(raw).lookupArguments[0] = '1lookup'; }, /injectionFamilies\[1\]\.lookupArguments\[0\]: expected an identifier/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));
  });

  describe('empty lists', () => {
    it.each([
      ['no family annotations', (raw) => { JSR330(raw).annotations = []; }, /injectionFamilies\[0\]\.annotations: expected at least one entry/],
      ['no family annotations in a later family', (raw) => { EJB(raw).annotations = []; }, /injectionFamilies\[1\]\.annotations: expected at least one entry/],
      ['no member kinds', (raw) => { JSR330(raw).on = []; }, /injectionFamilies\[0\]\.on: expected at least one entry/],
      ['no member kinds in a later family', (raw) => { EJB(raw).on = []; }, /injectionFamilies\[1\]\.on: expected at least one entry/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));

    it('accepts an empty list wherever design D4 does not ask for an entry', () => {
      const catalog = accepts((raw) => {
        EJB(raw).nameArguments = [];
        EJB(raw).lookupArguments = [];
        EJB(raw).typeArgument = null;
        JSR330(raw).nameAnnotations = [];
        raw.namedQualifier.annotations = [];
        raw.namedQualifier.defaultNameStereotypes = [];
        raw.producers.annotations = [];
        raw.providerTypes.types = [];
        raw.deploymentDependent.annotations = [];
        raw.notQualifiers.annotations = [];
        raw.businessInterfaces.annotations = [];
      });
      expect(catalog.producers.annotations).toEqual([]);
      expect(catalog.injectionFamilies[1].nameArguments).toEqual([]);
    });

    it('accepts a catalog with no families', () => {
      expect(accepts((raw) => { raw.injectionFamilies = []; }).injectionFamilies).toEqual([]);
    });
  });

  describe('member kinds', () => {
    it.each([
      ['parameter', 'parameter'],
      ['a class', 'class'],
      ['a record component', 'component'],
      ['a name in the wrong case', 'Field'],
    ])('fails for %s, which no injection annotation of a family sits on', (_what, kind) => {
      rejects((raw) => { JSR330(raw).on.push(kind); }, /injectionFamilies\[0\]\.on\[3\]: expected one of field, method, constructor/);
    });

    it('fails for a member kind written twice', () => {
      rejects((raw) => { JSR330(raw).on.push('field'); }, /injectionFamilies\[0\]\.on\[3\]: duplicate member kind "field"/);
    });

    it('accepts each of the three kinds alone', () => {
      for (const kind of ['field', 'method', 'constructor']) {
        expect(accepts((raw) => { JSR330(raw).on = [kind]; }).injectionFamilies[0].on).toEqual([kind]);
      }
    });
  });

  describe('repeats', () => {
    it('fails for a family id written twice', () => {
      rejects((raw) => {
        const copy = otherFamily();
        copy.id = 'ejb-inject';
        raw.injectionFamilies.push(copy);
      }, /injectionFamilies\[2\]: duplicate id "ejb-inject"/);
    });

    it('fails for a name written twice in one list, in every list of names', () => {
      rejects((raw) => { JSR330(raw).annotations.push('javax.inject.Inject'); }, /injectionFamilies\[0\]\.annotations\[3\]: duplicate name "javax\.inject\.Inject"/);
      rejects((raw) => { JSR330(raw).nameAnnotations.push(JSR330(raw).nameAnnotations[0]); }, /injectionFamilies\[0\]\.nameAnnotations\[1\]: duplicate name/);
      rejects((raw) => { raw.namedQualifier.annotations.push('javax.inject.Named'); }, /namedQualifier\.annotations\[2\]: duplicate name "javax\.inject\.Named"/);
      rejects((raw) => { raw.namedQualifier.defaultNameStereotypes.push('javax.enterprise.inject.Model'); }, /namedQualifier\.defaultNameStereotypes\[2\]: duplicate name/);
      rejects((raw) => { raw.producers.annotations.push('dagger.Provides'); }, /producers\.annotations\[5\]: duplicate name "dagger\.Provides"/);
      rejects((raw) => { raw.providerTypes.types.push('javax.inject.Provider'); }, /providerTypes\.types\[4\]: duplicate name/);
      rejects((raw) => { raw.deploymentDependent.annotations.push('javax.decorator.Decorator'); }, /deploymentDependent\.annotations\[12\]: duplicate name/);
      rejects((raw) => { raw.notQualifiers.annotations.push('lombok.Getter'); }, /notQualifiers\.annotations\[3\]: duplicate name "lombok\.Getter"/);
      rejects((raw) => { raw.businessInterfaces.annotations.push('javax.ejb.Local'); }, /businessInterfaces\.annotations\[4\]: duplicate name "javax\.ejb\.Local"/);
    });

    it('fails for an argument written twice in one list', () => {
      rejects((raw) => { EJB(raw).nameArguments.push('beanName'); }, /injectionFamilies\[1\]\.nameArguments\[1\]: duplicate argument "beanName"/);
      rejects((raw) => { EJB(raw).lookupArguments.push('lookup'); }, /injectionFamilies\[1\]\.lookupArguments\[2\]: duplicate argument "lookup"/);
    });

    it('fails for an argument that is two of a bean name, a JNDI name and a type', () => {
      rejects((raw) => { EJB(raw).nameArguments.push('lookup'); }, /injectionFamilies\[1\]\.lookupArguments\[0\]: argument "lookup" is already the name argument of the family/);
      rejects((raw) => { EJB(raw).typeArgument = 'beanName'; }, /injectionFamilies\[1\]\.typeArgument: argument "beanName" is already the name argument of the family/);
      rejects((raw) => { EJB(raw).typeArgument = 'mappedName'; }, /injectionFamilies\[1\]\.typeArgument: argument "mappedName" is already the lookup argument of the family/);
    });

    it('fails for an annotation that two families both list, which would make a use of it two families', () => {
      rejects((raw) => {
        const second = otherFamily();
        second.annotations.push('javax.inject.Inject');
        raw.injectionFamilies.push(second);
      }, /injectionFamilies\[2\]\.annotations\[1\]: "javax\.inject\.Inject" is already listed as an injection annotation at type-injection-catalog\.injectionFamilies\[0\]\.annotations\[0\]/);
    });

    it('fails for a name annotation that two families both list', () => {
      rejects((raw) => {
        const second = otherFamily();
        second.nameAnnotations.push('org.springframework.beans.factory.annotation.Qualifier');
        raw.injectionFamilies.push(second);
      }, /injectionFamilies\[2\]\.nameAnnotations\[0\]: .* is already listed as a name injection annotation at type-injection-catalog\.injectionFamilies\[0\]\.nameAnnotations\[0\]/);
    });

    it('accepts the same argument name in two families and in two lists of different families', () => {
      const catalog = accepts((raw) => {
        const second = otherFamily();
        second.nameArguments = ['beanName'];
        second.typeArgument = 'beanInterface';
        raw.injectionFamilies.push(second);
      });
      expect(catalog.injectionFamilies).toHaveLength(3);
    });
  });

  describe('a qualified name that two roles both claim', () => {
    // Every list of names, in the order the loader reads them: a name that is
    // already in an earlier one is reported at its later place.
    const LISTS = [
      { role: 'an injection annotation', path: 'injectionFamilies[0].annotations', list: (raw) => JSR330(raw).annotations },
      { role: 'a name injection annotation', path: 'injectionFamilies[0].nameAnnotations', list: (raw) => JSR330(raw).nameAnnotations },
      { role: 'a name qualifier', path: 'namedQualifier.annotations', list: (raw) => raw.namedQualifier.annotations },
      { role: 'a name qualifier', path: 'namedQualifier.defaultNameStereotypes', list: (raw) => raw.namedQualifier.defaultNameStereotypes },
      { role: 'a producer', path: 'producers.annotations', list: (raw) => raw.producers.annotations },
      { role: 'a provider type', path: 'providerTypes.types', list: (raw) => raw.providerTypes.types },
      { role: 'a deployment dependent annotation', path: 'deploymentDependent.annotations', list: (raw) => raw.deploymentDependent.annotations },
      { role: 'a non-qualifier', path: 'notQualifiers.annotations', list: (raw) => raw.notQualifiers.annotations },
      { role: 'a business interface declaration', path: 'businessInterfaces.annotations', list: (raw) => raw.businessInterfaces.annotations },
    ];

    const pairs = [];
    for (let i = 0; i < LISTS.length; i++) {
      for (let j = i + 1; j < LISTS.length; j++) pairs.push([LISTS[i], LISTS[j]]);
    }

    it.each(pairs.map((pair) => [`${pair[0].path} and ${pair[1].path}`, ...pair]))('fails for a name in %s', (_pair, first, later) => {
      const raw = shipped();
      const name = first.list(raw)[0];
      const at = later.list(raw).length;
      later.list(raw).push(name);
      const where = `type-injection-catalog\\.${later.path.replace(/[[\].]/g, '\\$&')}\\[${at}\\]`;
      const held = `type-injection-catalog\\.${first.path.replace(/[[\].]/g, '\\$&')}\\[0\\]`;
      const reason = first.role === later.role
        ? `is already listed as ${first.role} at ${held}`
        : `is already listed as ${first.role} at ${held}, so it cannot also be ${later.role}`;
      expect(() => parseTypeInjectionCatalog(raw)).toThrow(new RegExp(`${where}: ${JSON.stringify(name).replace(/[.]/g, '\\.')} ${reason}`));
    });

    it('reads the injection annotations of every family as one role: the second family cannot take one of the first', () => {
      rejects((raw) => { EJB(raw).annotations.push('javax.inject.Inject'); }, /injectionFamilies\[1\]\.annotations\[2\]: "javax\.inject\.Inject" is already listed as an injection annotation/);
    });

    it('fails for a name that is a family annotation and one of its own name annotations', () => {
      rejects((raw) => { JSR330(raw).nameAnnotations.push('javax.inject.Inject'); }, /injectionFamilies\[0\]\.nameAnnotations\[1\]: "javax\.inject\.Inject" is already listed as an injection annotation/);
    });

    it('accepts a name that differs only in the namespace: javax and jakarta are two names', () => {
      const catalog = accepts((raw) => { raw.notQualifiers.annotations.push('jakarta.annotation.Nullable'); });
      expect(catalog.notQualifiers.annotations).toHaveLength(4);
    });
  });
});
