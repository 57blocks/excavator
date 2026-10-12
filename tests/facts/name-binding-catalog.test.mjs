// name-binding-references, tasks 2.1-2.2: the declarative name-binding catalog
// (skills/excavator/catalogs/name-bindings.json) and its strict loader. The
// shipped catalog loads and is frozen; a catalog with an unknown key, a missing
// field, a wrong type or a duplicate id does not load at all.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAME_RULES,
  SHIPPED_NAME_BINDING_CATALOG,
  loadNameBindingCatalog,
  parseNameBindingCatalog,
} from '../../skills/excavator/name-binding-catalog.mjs';

const shipped = () => structuredClone(JSON.parse(JSON.stringify(loadNameBindingCatalog())));
const mutate = (edit) => {
  const raw = shipped();
  edit(raw);
  return raw;
};
const rejects = (edit, message) => expect(() => parseNameBindingCatalog(mutate(edit))).toThrow(message);

describe('the shipped catalog', () => {
  const catalog = loadNameBindingCatalog();

  it('declares the binders the design lists, each with an id, a namespace and a basis', () => {
    expect(catalog.xmlBinders.map((b) => b.id)).toEqual([
      'jsf-xml-managed-bean', 'jsf-xml-resource-bundle', 'seam-xml-component', 'spring-xml-bean',
    ]);
    expect(catalog.annotationBinders.map((b) => b.id)).toEqual([
      'jsf-annotation-managed-bean', 'cdi-annotation-named', 'cdi-annotation-model',
      'seam-annotation-name', 'seam-annotation-role', 'spring-annotation-stereotype',
    ]);
    expect(catalog.expressionLanguages.map((l) => l.id)).toEqual(['jsf-jsp-el']);
    for (const binder of [...catalog.xmlBinders, ...catalog.annotationBinders]) {
      expect(binder.namespace).toMatch(/^[a-z]+$/);
      expect(binder.basis.length).toBeGreaterThan(20);
    }
    expect(catalog.expressionLanguages[0].basis.length).toBeGreaterThan(20);
  });

  it('lists the unit descriptors and the namespaces the expression language sees', () => {
    expect(catalog.unitDescriptors).toEqual(['pom.xml', 'build.gradle', 'build.gradle.kts', 'build.xml', 'build.sbt']);
    const [language] = catalog.expressionLanguages;
    expect(language.sees.map((s) => s.namespace)).toEqual(['el', 'spring']);
    expect(language.sees[0].when).toBeUndefined();
    expect(language.sees[1].when.elementTextIn.anyOf).toEqual([
      'org.springframework.web.jsf.el.SpringBeanFacesELResolver',
      'org.springframework.web.jsf.DelegatingVariableResolver',
      'org.springframework.web.jsf.SpringBeanVariableResolver',
    ]);
    expect(language.sees[1].when.elementTextIn.anyOf).not.toContain('org.springframework.web.jsf.el.WebApplicationContextFacesELResolver');
  });

  it('keeps Spring beans in their own namespace, and the Spring default name rule keeps leading capitals', () => {
    const spring = catalog.annotationBinders.find((b) => b.id === 'spring-annotation-stereotype');
    expect(spring.namespace).toBe('spring');
    expect(spring.defaultName).toBe('java-beans-decapitalize');
    expect(catalog.xmlBinders.find((b) => b.id === 'spring-xml-bean').name).toEqual({ attribute: ['id', 'name'], split: { name: ',; ' } });
    expect(catalog.annotationBinders.find((b) => b.id === 'seam-annotation-name').defaultName).toBeNull();
  });

  it('says for every binder whether its dotted names are namespaces to the expression resolver (D1)', () => {
    const namespaced = (binders) => Object.fromEntries(binders.map((b) => [b.id, b.namespacedNames]));
    expect(namespaced(catalog.xmlBinders)).toEqual({
      'jsf-xml-managed-bean': false, 'jsf-xml-resource-bundle': false, 'seam-xml-component': true, 'spring-xml-bean': false,
    });
    expect(namespaced(catalog.annotationBinders)).toEqual({
      'jsf-annotation-managed-bean': false, 'cdi-annotation-named': true, 'cdi-annotation-model': true,
      'seam-annotation-name': true, 'seam-annotation-role': true, 'spring-annotation-stereotype': false,
    });
  });

  it('says what an XML element with a name and no target means: unknown, or configures (Seam component)', () => {
    expect(Object.fromEntries(catalog.xmlBinders.map((b) => [b.id, b.missingTarget]))).toEqual({
      'jsf-xml-managed-bean': 'unknown', 'jsf-xml-resource-bundle': 'unknown', 'seam-xml-component': 'configures', 'spring-xml-bean': 'unknown',
    });
  });

  it('lists the 23 implicit names of the union of JSP 2.x and JSF 2.0-4.0, externalContext included', () => {
    const { implicitNames } = catalog.expressionLanguages[0];
    expect(implicitNames).toHaveLength(23);
    expect(new Set(implicitNames).size).toBe(23);
    expect(implicitNames).toEqual(expect.arrayContaining(['externalContext', 'resource', 'flowScope', 'param', 'pageContext']));
  });

  it('declares local names: var, varStatus, Facelets param, useBean, and the expression roots of Tomahawk aliasBean', () => {
    const FACELETS = ['http://java.sun.com/jsf/facelets', 'http://xmlns.jcp.org/jsf/facelets', 'jakarta.faces.facelets'];
    expect(catalog.expressionLanguages[0].localDeclarations).toEqual([
      { attribute: 'var' },
      { attribute: 'varStatus' },
      { attribute: 'name', element: 'param', elementNamespaces: FACELETS },
      { attribute: 'id', element: 'useBean' },
      { attribute: 'alias', element: 'aliasBean', elementNamespaces: ['http://myfaces.apache.org/tomahawk'], declares: 'expression-root' },
    ]);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.xmlBinders)).toBe(true);
    expect(Object.isFrozen(catalog.xmlBinders[0].target)).toBe(true);
    expect(Object.isFrozen(catalog.expressionLanguages[0].sees[1].when.elementTextIn.anyOf)).toBe(true);
    expect(() => { catalog.xmlBinders[0].id = 'x'; }).toThrow(TypeError);
    expect(() => { catalog.unitDescriptors.push('x'); }).toThrow(TypeError);
  });

  it('loads from the shipped path, which exists beside the skill', () => {
    expect(SHIPPED_NAME_BINDING_CATALOG).toMatch(/skills\/excavator\/catalogs\/name-bindings\.json$/);
  });
});

describe('a malformed catalog does not load', () => {
  it('names an undefined key on a binder (spec: catalog format error)', () => {
    rejects((c) => { c.xmlBinders[1].extra = 1; }, /xmlBinders\[1\]: unknown key "extra"/);
    rejects((c) => { c.annotationBinders[0].aliases = []; }, /annotationBinders\[0\]: unknown key "aliases"/);
  });

  it('names an unknown key at the top, in a nested object and in a `when`', () => {
    rejects((c) => { c.extra = 1; }, /name-bindings: unknown key "extra"/);
    rejects((c) => { c.xmlBinders[0].target.mode = 'x'; }, /xmlBinders\[0\]\.target: unknown key "mode"/);
    rejects((c) => { c.expressionLanguages[0].files.glob = []; }, /expressionLanguages\[0\]\.files: unknown key "glob"/);
    rejects((c) => { c.expressionLanguages[0].sees[1].when.allOf = []; }, /sees\[1\]\.when: unknown key "allOf"/);
  });

  it('names a missing field', () => {
    rejects((c) => { delete c.xmlBinders[0].element; }, /xmlBinders\[0\]: missing "element"/);
    rejects((c) => { delete c.annotationBinders[2].defaultName; }, /annotationBinders\[2\]: missing "defaultName"/);
    rejects((c) => { delete c.annotationBinders[0].basis; }, /annotationBinders\[0\]: missing "basis"/);
    rejects((c) => { delete c.unitDescriptors; }, /name-bindings: missing "unitDescriptors"/);
    rejects((c) => { delete c.expressionLanguages[0].implicitNames; }, /expressionLanguages\[0\]: missing "implicitNames"/);
    rejects((c) => { delete c.expressionLanguages[0].sees[1].when.elementTextIn.anyOf; }, /elementTextIn: missing "anyOf"/);
  });

  it('names a wrong type', () => {
    rejects((c) => { c.version = '1'; }, /name-bindings\.version: expected the number 1/);
    rejects((c) => { c.annotationBinders[0].annotations = 'javax.inject.Named'; }, /annotationBinders\[0\]\.annotations: expected an array/);
    rejects((c) => { c.annotationBinders[0].nameArguments = [1]; }, /annotationBinders\[0\]\.nameArguments\[0\]: expected a string/);
    rejects((c) => { c.annotationBinders[0].annotations = []; }, /annotationBinders\[0\]\.annotations: expected at least one entry/);
    rejects((c) => { c.expressionLanguages[0].delimiters = '#{'; }, /expressionLanguages\[0\]\.delimiters: expected an array/);
    rejects((c) => { c.xmlBinders[0].id = 7; }, /xmlBinders\[0\]\.id: expected a string/);
    rejects((c) => { c.xmlBinders[0].namespace = ''; }, /xmlBinders\[0\]\.namespace: expected a non-empty string/);
    rejects((c) => { c.xmlBinders[0].rootNamespace = 'urn:x'; }, /xmlBinders\[0\]\.rootNamespace: expected an array/);
    rejects((c) => { c.expressionLanguages[0].localDeclarations[0] = 'var'; }, /localDeclarations\[0\]: expected an object/);
  });

  it('rejects a binder that does not say whether its dotted names are namespaces, or says it with a non-boolean', () => {
    rejects((c) => { delete c.xmlBinders[0].namespacedNames; }, /xmlBinders\[0\]: missing "namespacedNames"/);
    rejects((c) => { delete c.annotationBinders[1].namespacedNames; }, /annotationBinders\[1\]: missing "namespacedNames"/);
    rejects((c) => { c.xmlBinders[0].namespacedNames = 'yes'; }, /xmlBinders\[0\]\.namespacedNames: expected a boolean/);
    rejects((c) => { c.annotationBinders[0].namespacedNames = 1; }, /annotationBinders\[0\]\.namespacedNames: expected a boolean/);
  });

  it('rejects an XML binder with no meaning for a missing target, or one that is not unknown or configures', () => {
    rejects((c) => { delete c.xmlBinders[2].missingTarget; }, /xmlBinders\[2\]: missing "missingTarget"/);
    rejects((c) => { c.xmlBinders[2].missingTarget = 'ignore'; }, /xmlBinders\[2\]\.missingTarget: expected "unknown" or "configures"/);
    rejects((c) => { c.annotationBinders[0].missingTarget = 'unknown'; }, /annotationBinders\[0\]: unknown key "missingTarget"/);
  });

  it('rejects a `split` that is not a map from a listed attribute to its separator characters', () => {
    rejects((c) => { c.xmlBinders[3].name.split = ',; '; }, /xmlBinders\[3\]\.name\.split: expected an object/);
    rejects((c) => { c.xmlBinders[3].name.split = { class: ',' }; }, /xmlBinders\[3\]\.name\.split: "class" is not one of the listed attributes/);
    rejects((c) => { c.xmlBinders[3].name.split = {}; }, /xmlBinders\[3\]\.name\.split: expected at least one entry/);
    rejects((c) => { c.xmlBinders[3].name.split = { name: '' }; }, /xmlBinders\[3\]\.name\.split\.name: expected a non-empty string/);
    rejects((c) => { c.xmlBinders[3].name.split = { name: 7 }; }, /xmlBinders\[3\]\.name\.split\.name: expected a string/);
    rejects((c) => { c.xmlBinders[0].name = { child: 'a', split: { a: ',' } }; }, /xmlBinders\[0\]\.name: "split" needs "attribute"/);
  });

  it('rejects local-name declarations whose element namespaces or `declares` are malformed', () => {
    const declaration = (c) => c.expressionLanguages[0].localDeclarations;
    rejects((c) => { declaration(c)[0].elementNamespaces = ['urn:x']; }, /localDeclarations\[0\]: "elementNamespaces" needs "element"/);
    rejects((c) => { declaration(c)[2].elementNamespaces = []; }, /localDeclarations\[2\]\.elementNamespaces: expected at least one entry/);
    rejects((c) => { declaration(c)[2].elementNamespaces = 'urn:x'; }, /localDeclarations\[2\]\.elementNamespaces: expected an array/);
    rejects((c) => { declaration(c)[2].elementNamespaces = [3]; }, /localDeclarations\[2\]\.elementNamespaces\[0\]: expected a string/);
    rejects((c) => { declaration(c)[4].declares = 'root'; }, /localDeclarations\[4\]\.declares: expected "literal" or "expression-root"/);
    rejects((c) => { declaration(c)[4].declares = true; }, /localDeclarations\[4\]\.declares: expected "literal" or "expression-root"/);
    rejects((c) => { declaration(c)[0].scope = 'file'; }, /localDeclarations\[0\]: unknown key "scope"/);
    expect(() => parseNameBindingCatalog(mutate((c) => { declaration(c)[0].declares = 'literal'; }))).not.toThrow();
  });

  it('rejects an id used twice, across the three binder lists', () => {
    rejects((c) => { c.xmlBinders[1].id = c.xmlBinders[0].id; }, /duplicate id "jsf-xml-managed-bean"/);
    rejects((c) => { c.annotationBinders[0].id = 'spring-xml-bean'; }, /duplicate id "spring-xml-bean"/);
    rejects((c) => { c.expressionLanguages[0].id = 'cdi-annotation-named'; }, /duplicate id "cdi-annotation-named"/);
  });

  it('rejects a default-name rule the loader has no algorithm for', () => {
    rejects((c) => { c.annotationBinders[1].defaultName = 'uppercase'; }, /annotationBinders\[1\]\.defaultName: unknown rule "uppercase"/);
    rejects((c) => { c.annotationBinders[1].defaultName = undefined; }, /missing "defaultName"/);
  });

  it('rejects an XML name or target that does not say where it is read from, exactly once', () => {
    rejects((c) => { c.xmlBinders[0].name = {}; }, /xmlBinders\[0\]\.name: expected exactly one of "child" or "attribute"/);
    rejects((c) => { c.xmlBinders[0].name = { child: 'a', attribute: ['b'] }; }, /xmlBinders\[0\]\.name: expected exactly one of "child" or "attribute"/);
    rejects((c) => { c.xmlBinders[0].name = { child: 'a', split: ',' }; }, /xmlBinders\[0\]\.name: "split" needs "attribute"/);
    rejects((c) => { c.xmlBinders[0].name = { attribute: [] }; }, /xmlBinders\[0\]\.name\.attribute: expected at least one entry/);
    rejects((c) => { c.xmlBinders[0].target = { kind: 'class' }; }, /xmlBinders\[0\]\.target: expected exactly one of "child" or "attribute"/);
    rejects((c) => { c.xmlBinders[0].target = { kind: 'file', child: 'x' }; }, /xmlBinders\[0\]\.target\.kind: expected "class" or "bundle"/);
    rejects((c) => { c.xmlBinders[0].target = { kind: 'class', child: 'x', attribute: 'y' }; }, /expected exactly one of "child" or "attribute"/);
  });

  it('rejects a `when` that is not the one supported shape', () => {
    rejects((c) => { c.expressionLanguages[0].sees[1].when = {}; }, /sees\[1\]\.when: missing "elementTextIn"/);
    rejects((c) => { c.expressionLanguages[0].sees[1].when = { elementTextIn: 'x' }; }, /elementTextIn: expected an object/);
    rejects((c) => { c.expressionLanguages[0].sees[1].when.elementTextIn.anyOf = []; }, /elementTextIn\.anyOf: expected at least one entry/);
    rejects((c) => { c.expressionLanguages[0].sees[1].when.elementTextIn.elements = 'el-resolver'; }, /elementTextIn\.elements: expected an array/);
    rejects((c) => { c.expressionLanguages[0].sees[1].when.elementTextIn.root = 3; }, /elementTextIn\.root: expected a string/);
  });

  it('rejects an expression-language file class with neither extensions nor roots, and a bad root entry', () => {
    rejects((c) => { c.expressionLanguages[0].files = { extensions: [], xmlRoots: [] }; }, /files: expected at least one extension or XML root/);
    rejects((c) => { c.expressionLanguages[0].files.xmlRoots[0] = { rootNamespace: [] }; }, /xmlRoots\[0\]: missing "root"/);
  });

  it('fails on a file that is not JSON or is missing, naming it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-catalog-'));
    try {
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{ "version": 1,');
      expect(() => loadNameBindingCatalog(bad)).toThrow(/name-binding-catalog: cannot read .*bad\.json/);
      expect(() => loadNameBindingCatalog(join(dir, 'absent.json'))).toThrow(/name-binding-catalog: cannot read .*absent\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the default-name algorithms', () => {
  it('names exactly the two the design lists', () => {
    expect(Object.keys(DEFAULT_NAME_RULES).sort()).toEqual(['java-beans-decapitalize', 'lowercase-first']);
  });

  it('lowercase-first lowers the first character only', () => {
    const rule = DEFAULT_NAME_RULES['lowercase-first'];
    expect(rule('CustomerBean')).toBe('customerBean');
    expect(rule('URLHelper')).toBe('uRLHelper');
    expect(rule('A')).toBe('a');
    expect(rule('already')).toBe('already');
  });

  it('java-beans-decapitalize keeps a name whose first two characters are upper case', () => {
    const rule = DEFAULT_NAME_RULES['java-beans-decapitalize'];
    expect(rule('CustomerBean')).toBe('customerBean');
    expect(rule('URLHelper')).toBe('URLHelper');
    expect(rule('X')).toBe('x');
    expect(rule('X1')).toBe('x1');
    expect(rule('Ab')).toBe('ab');
  });
});
