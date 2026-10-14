// jaxrs-route-facts, tasks 1.1-1.2: the declarative route catalog
// (skills/excavator/catalogs/routes.json, version 1) and its strict loader. The
// shipped catalog loads and is frozen; a catalog with an unknown key, a missing
// field, a wrong type, an empty list (the client annotations excepted), a
// repeated family id or verb, an annotation that is both a verb and a path, or a
// version other than 1 does not load at all.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_ROUTE_CATALOG, loadRouteCatalog, parseRouteCatalog } from '../../skills/excavator/route-catalog.mjs';

const shipped = () => JSON.parse(JSON.stringify(loadRouteCatalog()));
const mutate = (edit) => {
  const raw = shipped();
  edit(raw);
  return raw;
};
const rejects = (edit, message) => expect(() => parseRouteCatalog(mutate(edit))).toThrow(message);
const FAMILY = (raw) => raw.routeFamilies[0];

describe('the shipped catalog', () => {
  const catalog = loadRouteCatalog();
  const [jaxrs] = catalog.routeFamilies;

  it('has version 1 and one family, with an id and a basis', () => {
    expect(catalog.version).toBe(1);
    expect(catalog.routeFamilies).toHaveLength(1);
    expect(jaxrs.id).toBe('jaxrs');
    expect(jaxrs.basis.length).toBeGreaterThan(20);
  });

  it('reads the root path and the method path from the value argument of the Path annotation of both namespaces', () => {
    const both = ['javax.ws.rs.Path', 'jakarta.ws.rs.Path'];
    expect(jaxrs.rootPath).toEqual({ annotations: both, argument: 'value' });
    expect(jaxrs.methodPath).toEqual({ annotations: both, argument: 'value' });
  });

  it('has the seven HTTP methods, each named by the annotation of the javax and of the jakarta namespace', () => {
    expect(jaxrs.verbs.map((entry) => entry.verb)).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']);
    for (const { verb, annotations } of jaxrs.verbs) {
      expect(annotations).toEqual([`javax.ws.rs.${verb}`, `jakarta.ws.rs.${verb}`]);
    }
  });

  it('marks the MicroProfile client annotation, and exposes only public methods', () => {
    expect(jaxrs.clientAnnotations).toEqual(['org.eclipse.microprofile.rest.client.inject.RegisterRestClient']);
    expect(jaxrs.publicOnly).toBe(true);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.routeFamilies)).toBe(true);
    expect(Object.isFrozen(jaxrs)).toBe(true);
    expect(Object.isFrozen(jaxrs.verbs[0])).toBe(true);
    expect(Object.isFrozen(jaxrs.verbs[0].annotations)).toBe(true);
    expect(Object.isFrozen(jaxrs.rootPath)).toBe(true);
  });

  it('is a copy: changing the parsed input afterwards does not reach the catalog', () => {
    const raw = shipped();
    const parsed = parseRouteCatalog(raw);
    raw.routeFamilies[0].id = 'changed';
    expect(parsed.routeFamilies[0].id).toBe('jaxrs');
  });
});

describe('the loader reads the file it is given', () => {
  it('loads the shipped file by default and names it', () => {
    expect(SHIPPED_ROUTE_CATALOG.endsWith('/skills/excavator/catalogs/routes.json')).toBe(true);
    expect(loadRouteCatalog()).toEqual(loadRouteCatalog(SHIPPED_ROUTE_CATALOG));
  });

  it('fails for a file that is not there, and for one that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-route-catalog-'));
    try {
      expect(() => loadRouteCatalog(join(dir, 'missing.json'))).toThrow(/route-catalog: cannot read .*missing\.json/);
      const broken = join(dir, 'broken.json');
      writeFileSync(broken, '{ "version": 1, ');
      expect(() => loadRouteCatalog(broken)).toThrow(/route-catalog: cannot read .*broken\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates what it reads: a file that is valid JSON and not a catalog does not load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-route-catalog-'));
    try {
      const file = join(dir, 'routes.json');
      writeFileSync(file, JSON.stringify(mutate((raw) => { FAMILY(raw).extra = true; })));
      expect(() => loadRouteCatalog(file)).toThrow(/unknown key "extra"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('strict validation: nothing loads partially', () => {
  it('accepts the shipped catalog, and one with several families', () => {
    expect(() => parseRouteCatalog(shipped())).not.toThrow();
    const second = mutate((raw) => {
      const other = structuredClone(FAMILY(raw));
      other.id = 'other';
      other.rootPath = { annotations: ['org.acme.Route'], argument: 'path' };
      other.methodPath = { annotations: ['org.acme.Route'], argument: 'path' };
      other.verbs = [{ verb: 'GET', annotations: ['org.acme.Get'] }];
      other.clientAnnotations = [];
      other.publicOnly = false;
      raw.routeFamilies.push(other);
    });
    expect(parseRouteCatalog(second).routeFamilies.map((family) => family.id)).toEqual(['jaxrs', 'other']);
  });

  it('fails for a catalog of another version, naming the version before anything else', () => {
    rejects((raw) => { raw.version = 2; }, /route-catalog\.version: expected the number 1/);
    rejects((raw) => { raw.version = '1'; }, /route-catalog\.version: expected the number 1/);
    // an older shape with no families at all is still "wrong version" first
    expect(() => parseRouteCatalog({ version: 0 })).toThrow(/route-catalog\.version: expected the number 1/);
  });

  it('fails for something that is not an object, and for a missing version', () => {
    expect(() => parseRouteCatalog(null)).toThrow(/route-catalog: expected an object/);
    expect(() => parseRouteCatalog([])).toThrow(/route-catalog: expected an object/);
    expect(() => parseRouteCatalog('routes')).toThrow(/route-catalog: expected an object/);
    rejects((raw) => { delete raw.version; }, /route-catalog: missing "version"/);
  });

  describe('unknown keys, at every level', () => {
    it.each([
      ['the catalog', (raw) => { raw.extra = 1; }, /route-catalog: unknown key "extra"/],
      ['a family', (raw) => { FAMILY(raw).extra = 1; }, /routeFamilies\[0\]: unknown key "extra"/],
      ['the root path', (raw) => { FAMILY(raw).rootPath.extra = 1; }, /routeFamilies\[0\]\.rootPath: unknown key "extra"/],
      ['the method path', (raw) => { FAMILY(raw).methodPath.extra = 1; }, /routeFamilies\[0\]\.methodPath: unknown key "extra"/],
      ['a verb', (raw) => { FAMILY(raw).verbs[3].extra = 1; }, /routeFamilies\[0\]\.verbs\[3\]: unknown key "extra"/],
    ])('fails for one in %s', (_where, edit, message) => rejects(edit, message));
  });

  describe('missing fields, at every level', () => {
    it.each([
      ['routeFamilies', (raw) => { delete raw.routeFamilies; }, /route-catalog: missing "routeFamilies"/],
      ['the family id', (raw) => { delete FAMILY(raw).id; }, /routeFamilies\[0\]: missing "id"/],
      ['the family basis', (raw) => { delete FAMILY(raw).basis; }, /routeFamilies\[0\]: missing "basis"/],
      ['the root path', (raw) => { delete FAMILY(raw).rootPath; }, /routeFamilies\[0\]: missing "rootPath"/],
      ['the method path', (raw) => { delete FAMILY(raw).methodPath; }, /routeFamilies\[0\]: missing "methodPath"/],
      ['the verbs', (raw) => { delete FAMILY(raw).verbs; }, /routeFamilies\[0\]: missing "verbs"/],
      ['the client annotations', (raw) => { delete FAMILY(raw).clientAnnotations; }, /routeFamilies\[0\]: missing "clientAnnotations"/],
      ['publicOnly', (raw) => { delete FAMILY(raw).publicOnly; }, /routeFamilies\[0\]: missing "publicOnly"/],
      ['the root path annotations', (raw) => { delete FAMILY(raw).rootPath.annotations; }, /rootPath: missing "annotations"/],
      ['the root path argument', (raw) => { delete FAMILY(raw).rootPath.argument; }, /rootPath: missing "argument"/],
      ['the method path annotations', (raw) => { delete FAMILY(raw).methodPath.annotations; }, /methodPath: missing "annotations"/],
      ['the method path argument', (raw) => { delete FAMILY(raw).methodPath.argument; }, /methodPath: missing "argument"/],
      ['the verb name', (raw) => { delete FAMILY(raw).verbs[0].verb; }, /verbs\[0\]: missing "verb"/],
      ['the verb annotations', (raw) => { delete FAMILY(raw).verbs[0].annotations; }, /verbs\[0\]: missing "annotations"/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));
  });

  describe('wrong types', () => {
    it.each([
      ['a family that is not an object', (raw) => { raw.routeFamilies[0] = 'jaxrs'; }, /routeFamilies\[0\]: expected an object/],
      ['routeFamilies that is not an array', (raw) => { raw.routeFamilies = {}; }, /route-catalog\.routeFamilies: expected an array/],
      ['an id that is not a string', (raw) => { FAMILY(raw).id = 7; }, /routeFamilies\[0\]\.id: expected a string/],
      ['an empty id', (raw) => { FAMILY(raw).id = ''; }, /routeFamilies\[0\]\.id: expected a non-empty string/],
      ['a basis that is not a string', (raw) => { FAMILY(raw).basis = ['text']; }, /routeFamilies\[0\]\.basis: expected a string/],
      ['an empty basis', (raw) => { FAMILY(raw).basis = ''; }, /routeFamilies\[0\]\.basis: expected a non-empty string/],
      ['a root path that is not an object', (raw) => { FAMILY(raw).rootPath = ['javax.ws.rs.Path']; }, /rootPath: expected an object/],
      ['root path annotations that are not an array', (raw) => { FAMILY(raw).rootPath.annotations = 'javax.ws.rs.Path'; }, /rootPath\.annotations: expected an array/],
      ['a root path annotation that is not a string', (raw) => { FAMILY(raw).rootPath.annotations[0] = 3; }, /rootPath\.annotations\[0\]: expected a string/],
      ['a root path argument that is not a string', (raw) => { FAMILY(raw).rootPath.argument = 1; }, /rootPath\.argument: expected a string/],
      ['an empty method path argument', (raw) => { FAMILY(raw).methodPath.argument = ''; }, /methodPath\.argument: expected a non-empty string/],
      ['verbs that are not an array', (raw) => { FAMILY(raw).verbs = { GET: [] }; }, /verbs: expected an array/],
      ['a verb entry that is not an object', (raw) => { FAMILY(raw).verbs[0] = 'GET'; }, /verbs\[0\]: expected an object/],
      ['a verb that is not a string', (raw) => { FAMILY(raw).verbs[0].verb = 1; }, /verbs\[0\]\.verb: expected a string/],
      ['a verb with whitespace in it', (raw) => { FAMILY(raw).verbs[0].verb = 'G ET'; }, /verbs\[0\]\.verb: expected a verb without whitespace/],
      ['verb annotations that are not an array', (raw) => { FAMILY(raw).verbs[0].annotations = 'javax.ws.rs.GET'; }, /verbs\[0\]\.annotations: expected an array/],
      ['client annotations that are not an array', (raw) => { FAMILY(raw).clientAnnotations = 'x.Y'; }, /clientAnnotations: expected an array/],
      ['a client annotation that is not a string', (raw) => { FAMILY(raw).clientAnnotations = [1]; }, /clientAnnotations\[0\]: expected a string/],
      ['publicOnly that is not a boolean', (raw) => { FAMILY(raw).publicOnly = 'true'; }, /publicOnly: expected a boolean/],
      ['publicOnly that is null', (raw) => { FAMILY(raw).publicOnly = null; }, /publicOnly: expected a boolean/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));

    it.each([
      ['a root path annotation', (raw) => { FAMILY(raw).rootPath.annotations = ['Path']; }, /rootPath\.annotations\[0\]: expected a qualified name/],
      ['a method path annotation', (raw) => { FAMILY(raw).methodPath.annotations = ['ws.Path', 'Path']; }, /methodPath\.annotations\[1\]: expected a qualified name/],
      ['a verb annotation', (raw) => { FAMILY(raw).verbs[1].annotations = ['POST']; }, /verbs\[1\]\.annotations\[0\]: expected a qualified name/],
      ['a client annotation', (raw) => { FAMILY(raw).clientAnnotations = ['RegisterRestClient']; }, /clientAnnotations\[0\]: expected a qualified name/],
      ['an annotation with a trailing dot', (raw) => { FAMILY(raw).clientAnnotations = ['a.b.']; }, /clientAnnotations\[0\]: expected a qualified name/],
    ])('fails for %s that is a simple name or malformed: the identity of an annotation is its qualified name', (_what, edit, message) => rejects(edit, message));
  });

  describe('empty lists', () => {
    it.each([
      ['no families', (raw) => { raw.routeFamilies = []; }, /route-catalog\.routeFamilies: expected at least one entry/],
      ['no root path annotations', (raw) => { FAMILY(raw).rootPath.annotations = []; }, /rootPath\.annotations: expected at least one entry/],
      ['no method path annotations', (raw) => { FAMILY(raw).methodPath.annotations = []; }, /methodPath\.annotations: expected at least one entry/],
      ['no verbs', (raw) => { FAMILY(raw).verbs = []; }, /verbs: expected at least one entry/],
      ['a verb with no annotations', (raw) => { FAMILY(raw).verbs[2].annotations = []; }, /verbs\[2\]\.annotations: expected at least one entry/],
    ])('fails for %s', (_what, edit, message) => rejects(edit, message));

    it('accepts no client annotations: a family with no client declarations', () => {
      const catalog = parseRouteCatalog(mutate((raw) => { FAMILY(raw).clientAnnotations = []; }));
      expect(catalog.routeFamilies[0].clientAnnotations).toEqual([]);
    });
  });

  describe('repeats', () => {
    it('fails for a family id written twice', () => {
      rejects((raw) => {
        const copy = structuredClone(FAMILY(raw));
        copy.verbs = [{ verb: 'GET', annotations: ['org.acme.Get'] }];
        raw.routeFamilies.push(copy);
      }, /routeFamilies\[1\]: duplicate id "jaxrs"/);
    });

    it('fails for a verb written twice in a family', () => {
      rejects((raw) => { FAMILY(raw).verbs.push({ verb: 'GET', annotations: ['org.acme.Get'] }); }, /verbs\[7\]\.verb: duplicate verb "GET"/);
    });

    it('fails for an annotation that names two verbs, which would make what a method writes depend on the order', () => {
      rejects((raw) => { FAMILY(raw).verbs[1].annotations.push('javax.ws.rs.GET'); }, /verbs\[1\]\.annotations\[2\]: "javax\.ws\.rs\.GET" already names the verb "GET"/);
    });

    it('fails for an annotation written twice in one list', () => {
      rejects((raw) => { FAMILY(raw).verbs[0].annotations.push('javax.ws.rs.GET'); }, /verbs\[0\]\.annotations\[2\]: duplicate annotation "javax\.ws\.rs\.GET"/);
      rejects((raw) => { FAMILY(raw).rootPath.annotations.push('javax.ws.rs.Path'); }, /rootPath\.annotations\[2\]: duplicate annotation "javax\.ws\.rs\.Path"/);
      rejects((raw) => { FAMILY(raw).clientAnnotations.push(FAMILY(raw).clientAnnotations[0]); }, /clientAnnotations\[1\]: duplicate annotation/);
    });

    it('accepts the same verb in two families, and the same annotation as root path and method path of one family', () => {
      const catalog = parseRouteCatalog(mutate((raw) => {
        const other = structuredClone(FAMILY(raw));
        other.id = 'other';
        raw.routeFamilies.push(other);
      }));
      expect(catalog.routeFamilies).toHaveLength(2);
      expect(catalog.routeFamilies[0].rootPath.annotations).toEqual(catalog.routeFamilies[0].methodPath.annotations);
    });
  });

  describe('an annotation that is both an HTTP method and a path', () => {
    it('fails when a verb annotation is a root path annotation', () => {
      rejects((raw) => { FAMILY(raw).rootPath.annotations.push('javax.ws.rs.GET'); }, /verbs\[0\]\.annotations\[0\]: "javax\.ws\.rs\.GET" is also a path annotation of the family/);
    });

    it('fails when a verb annotation is a method path annotation', () => {
      rejects((raw) => { FAMILY(raw).methodPath.annotations.push('jakarta.ws.rs.POST'); }, /verbs\[1\]\.annotations\[1\]: "jakarta\.ws\.rs\.POST" is also a path annotation of the family/);
    });

    it('fails when a path annotation is listed as a verb', () => {
      rejects((raw) => { FAMILY(raw).verbs[0].annotations.push('javax.ws.rs.Path'); }, /verbs\[0\]\.annotations\[2\]: "javax\.ws\.rs\.Path" is also a path annotation of the family/);
    });

    it('allows it across families: the rule is per family', () => {
      const catalog = parseRouteCatalog(mutate((raw) => {
        const other = structuredClone(FAMILY(raw));
        other.id = 'other';
        other.rootPath = { annotations: ['javax.ws.rs.GET'], argument: 'value' };
        other.methodPath = { annotations: ['javax.ws.rs.GET'], argument: 'value' };
        other.verbs = [{ verb: 'POST', annotations: ['javax.ws.rs.POST'] }];
        raw.routeFamilies.push(other);
      }));
      expect(catalog.routeFamilies).toHaveLength(2);
    });
  });
});
