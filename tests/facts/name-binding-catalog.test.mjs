// name-binding-references, tasks 2.1-2.2, xml-injection-references, tasks 1.1-1.2,
// and annotation-injection-references, tasks 2.1-2.2: the declarative
// name-binding catalog (skills/excavator/catalogs/name-bindings.json, version 3)
// and its strict loader. The shipped catalog loads and is frozen; a catalog with
// an unknown key, a missing field, a wrong type, a duplicate id or a version
// other than 3 does not load at all.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAME_RULES,
  MEMBER_DEFAULT_NAME_RULES,
  MEMBER_KINDS,
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
      'jsf-xml-managed-bean', 'jsf-xml-resource-bundle', 'seam-xml-component', 'spring-xml-bean', 'spring-xml-alias',
    ]);
    expect(catalog.annotationBinders.map((b) => b.id)).toEqual([
      'jsf-annotation-managed-bean', 'cdi-annotation-named', 'cdi-annotation-model',
      'seam-annotation-name', 'seam-annotation-role', 'spring-annotation-stereotype', 'ejb-annotation-session',
      'spring-annotation-advice',
    ]);
    expect(catalog.expressionLanguages.map((l) => l.id)).toEqual(['jsf-jsp-el']);
    expect(catalog.xmlInjections.map((f) => f.id)).toEqual(['spring-xml-injection']);
    expect(catalog.annotationInjections.map((f) => f.id)).toEqual(['spring-annotation-injection', 'seam-annotation-injection', 'ejb-annotation-injection']);
    for (const entry of [...catalog.xmlBinders, ...catalog.annotationBinders, ...catalog.xmlInjections, ...catalog.annotationInjections]) {
      expect(entry.namespace).toMatch(/^[a-z]+$/);
      expect(entry.basis.length).toBeGreaterThan(20);
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
      'jsf-xml-managed-bean': false, 'jsf-xml-resource-bundle': false, 'seam-xml-component': true, 'spring-xml-bean': false, 'spring-xml-alias': false,
    });
    expect(namespaced(catalog.annotationBinders)).toEqual({
      'jsf-annotation-managed-bean': false, 'cdi-annotation-named': true, 'cdi-annotation-model': true,
      'seam-annotation-name': true, 'seam-annotation-role': true, 'spring-annotation-stereotype': false, 'ejb-annotation-session': false,
      'spring-annotation-advice': false,
    });
  });

  it('says what an XML element with a name and no target means: unknown, or configures (Seam component)', () => {
    expect(Object.fromEntries(catalog.xmlBinders.map((b) => [b.id, b.missingTarget]))).toEqual({
      'jsf-xml-managed-bean': 'unknown', 'jsf-xml-resource-bundle': 'unknown', 'seam-xml-component': 'configures', 'spring-xml-bean': 'unknown', 'spring-xml-alias': 'unknown',
    });
  });

  it('lists the 23 implicit names of the union of JSP 2.x and JSF 2.0-4.0, externalContext included', () => {
    const { implicitNames } = catalog.expressionLanguages[0];
    expect(implicitNames).toHaveLength(23);
    expect(new Set(implicitNames).size).toBe(23);
    expect(implicitNames).toEqual(expect.arrayContaining(['externalContext', 'resource', 'flowScope', 'param', 'pageContext']));
  });

  it('declares local names: var, varStatus, rowIndexVar, Facelets param, useBean, and the expression roots of Tomahawk aliasBean', () => {
    const FACELETS = ['http://java.sun.com/jsf/facelets', 'http://xmlns.jcp.org/jsf/facelets', 'jakarta.faces.facelets'];
    expect(catalog.expressionLanguages[0].localDeclarations).toEqual([
      { attribute: 'var' },
      { attribute: 'varStatus' },
      { attribute: 'rowIndexVar' },
      { attribute: 'name', element: 'param', elementNamespaces: FACELETS },
      { attribute: 'id', element: 'useBean' },
      { attribute: 'alias', element: 'aliasBean', elementNamespaces: ['http://myfaces.apache.org/tomahawk'], declares: 'expression-root' },
    ]);
  });

  it('is version 3', () => {
    expect(catalog.version).toBe(3);
  });

  const BEANS_NAMESPACE = 'http://www.springframework.org/schema/beans';

  it('reads a Spring bean only from a Spring beans root or a root with no namespace (design D1)', () => {
    const bean = catalog.xmlBinders.find((b) => b.id === 'spring-xml-bean');
    expect(bean.rootNamespace).toEqual([BEANS_NAMESPACE, null]);
    expect(bean.target).toEqual({ kind: 'class', attribute: 'class', unknownWhen: ['factory-method', 'factory-bean'], inheritFrom: 'parent' });
    expect(bean.basis).toMatch(/factory-method/);
    expect(bean.basis).toMatch(/parent/);
  });

  it('declares the alias binder: the name an alias element gives is looked up like a bean name and takes the target of the bean it names (design D1)', () => {
    const alias = catalog.xmlBinders.find((b) => b.id === 'spring-xml-alias');
    expect(alias).toMatchObject({
      namespace: 'spring',
      root: 'beans',
      rootNamespace: [BEANS_NAMESPACE, null],
      element: 'alias',
      parent: 'beans',
      name: { attribute: ['alias'] },
      target: { kind: 'name', attribute: 'name' },
      namespacedNames: false,
      missingTarget: 'unknown',
    });
    expect(alias.target.unknownWhen).toBeUndefined();
    expect(alias.target.inheritFrom).toBeUndefined();
  });

  describe('the Spring injection family (design D1)', () => {
    const [family] = catalog.xmlInjections ?? [];

    it('is in the Spring namespace, rooted at beans, with the bean element as consumer read by the bean binder', () => {
      expect(catalog.xmlInjections).toHaveLength(1);
      expect(family).toMatchObject({
        id: 'spring-xml-injection',
        namespace: 'spring',
        root: 'beans',
        rootNamespace: [BEANS_NAMESPACE, null],
        consumer: { element: 'bean', binder: 'spring-xml-bean' },
      });
    });

    it('lists the 11 sites in the design order, each with the scope the design gives it', () => {
      expect(family.sites.map((s) => [s.id, s.scope ?? 'unit'])).toEqual([
        ['spring-property-ref', 'unit'],
        ['spring-constructor-arg-ref', 'unit'],
        ['spring-ref-bean', 'unit'],
        ['spring-ref-local', 'file'],
        ['spring-ref-parent', 'outside'],
        ['spring-entry-key-ref', 'unit'],
        ['spring-entry-value-ref', 'unit'],
        ['spring-lookup-method', 'unit'],
        ['spring-replaced-method', 'unit'],
        ['spring-p-ref', 'unit'],
        ['spring-c-ref', 'unit'],
      ]);
    });

    it('writes each site as an element and attribute, or an attribute namespace and suffix', () => {
      const shape = (s) => (s.element === undefined
        ? { attributeNamespace: s.attributeNamespace, attributeSuffix: s.attributeSuffix }
        : { element: s.element, attribute: s.attribute });
      expect(Object.fromEntries(family.sites.map((s) => [s.id, shape(s)]))).toEqual({
        'spring-property-ref': { element: 'property', attribute: 'ref' },
        'spring-constructor-arg-ref': { element: 'constructor-arg', attribute: 'ref' },
        'spring-ref-bean': { element: 'ref', attribute: 'bean' },
        'spring-ref-local': { element: 'ref', attribute: 'local' },
        'spring-ref-parent': { element: 'ref', attribute: 'parent' },
        'spring-entry-key-ref': { element: 'entry', attribute: 'key-ref' },
        'spring-entry-value-ref': { element: 'entry', attribute: 'value-ref' },
        'spring-lookup-method': { element: 'lookup-method', attribute: 'bean' },
        'spring-replaced-method': { element: 'replaced-method', attribute: 'replacer' },
        'spring-p-ref': { attributeNamespace: 'http://www.springframework.org/schema/p', attributeSuffix: '-ref' },
        'spring-c-ref': { attributeNamespace: 'http://www.springframework.org/schema/c', attributeSuffix: '-ref' },
      });
    });

    it('counts the reference shapes it does not read: the ref attribute, the -ref suffix, the ref and idref elements', () => {
      expect(family.census).toEqual({ attributes: ['ref'], attributeSuffixes: ['-ref'], elements: ['ref', 'idref'] });
    });

    it('says why idref is not a site: it passes the bean id, not the bean', () => {
      expect(family.sites.some((s) => s.element === 'idref')).toBe(false);
      expect(family.basis).toMatch(/idref/);
      expect(family.basis).toMatch(/lookup-method/);
      expect(family.basis).toMatch(/replaced-method/);
    });

    it('has site ids no binder id repeats, and a consumer binder that is a Spring class binder', () => {
      const binderIds = new Set([...catalog.xmlBinders, ...catalog.annotationBinders].map((b) => b.id));
      expect(family.sites.filter((s) => binderIds.has(s.id))).toEqual([]);
      const consumer = catalog.xmlBinders.find((b) => b.id === family.consumer.binder);
      expect(consumer.namespace).toBe(family.namespace);
      expect(consumer.target.kind).toBe('class');
    });
  });

  describe('annotation binders added in version 3 (annotation-injection-references design D3)', () => {
    it('adds the EJB session binder: the name element of Stateless, Stateful and Singleton, defaulting to the simple name unchanged', () => {
      const ejb = catalog.annotationBinders.find((b) => b.id === 'ejb-annotation-session');
      expect(ejb).toMatchObject({
        namespace: 'ejb',
        nameArguments: ['name'],
        defaultName: 'simple-name',
        namespacedNames: false,
      });
      expect(ejb.annotations).toEqual([
        'javax.ejb.Stateless', 'javax.ejb.Stateful', 'javax.ejb.Singleton',
        'jakarta.ejb.Stateless', 'jakarta.ejb.Stateful', 'jakarta.ejb.Singleton',
      ]);
      expect(ejb.basis).toMatch(/ejb-name/);
    });

    it('adds the two stereotypes whose value is the name to the Spring stereotype binder, and keeps its rules', () => {
      const spring = catalog.annotationBinders.find((b) => b.id === 'spring-annotation-stereotype');
      expect(spring.annotations).toEqual([
        'org.springframework.stereotype.Component', 'org.springframework.stereotype.Service',
        'org.springframework.stereotype.Repository', 'org.springframework.stereotype.Controller',
        'org.springframework.context.annotation.Configuration',
        'org.springframework.web.bind.annotation.RestController',
      ]);
      expect(spring).toMatchObject({ namespace: 'spring', nameArguments: ['value'], defaultName: 'java-beans-decapitalize', namespacedNames: false });
      expect(spring.basis).toMatch(/Component/);
    });

    it('gives the controller advice annotations their own binder, reading name and never value, which is the base packages', () => {
      const advice = catalog.annotationBinders.find((b) => b.id === 'spring-annotation-advice');
      expect(advice.annotations).toEqual([
        'org.springframework.web.bind.annotation.ControllerAdvice',
        'org.springframework.web.bind.annotation.RestControllerAdvice',
      ]);
      expect(advice).toMatchObject({ namespace: 'spring', nameArguments: ['name'], defaultName: 'java-beans-decapitalize', namespacedNames: false });
      expect(advice.basis).toMatch(/basePackages/);
    });
  });

  describe('the annotation injection families (annotation-injection-references design D3)', () => {
    const families = catalog.annotationInjections ?? [];
    const family = (id) => families.find((f) => f.id === id);
    const site = (id) => families.flatMap((f) => f.sites).find((s) => s.id === id);
    const withoutBasis = (entry) => {
      const copy = { ...entry };
      delete copy.basis;
      return copy;
    };

    it('lists the three families and the four sites of the design, in its order', () => {
      expect(families.map((f) => [f.id, f.sites.map((s) => s.id)])).toEqual([
        ['spring-annotation-injection', ['spring-qualifier', 'spring-resource']],
        ['seam-annotation-injection', ['seam-in']],
        ['ejb-annotation-injection', ['ejb-bean-name']],
      ]);
    });

    it('says for each family its namespace, the binders its names are looked up in and the binders that manage a consumer', () => {
      expect(families.map(({ id, namespace, binders, consumer }) => ({ id, namespace, binders, consumer }))).toEqual([
        {
          id: 'spring-annotation-injection', namespace: 'spring', binders: undefined,
          consumer: { managedBy: ['spring-xml-bean', 'spring-annotation-stereotype', 'spring-annotation-advice'] },
        },
        {
          id: 'seam-annotation-injection', namespace: 'el',
          binders: ['seam-annotation-name', 'seam-annotation-role', 'seam-xml-component'],
          consumer: { managedBy: ['seam-annotation-name', 'seam-annotation-role', 'seam-xml-component'] },
        },
        { id: 'ejb-annotation-injection', namespace: 'ejb', binders: undefined, consumer: { managedBy: [] } },
      ]);
      // the Seam limit is what keeps JSF and CDI beans, which share the el namespace, from being Seam components
      expect(family('seam-annotation-injection').binders).not.toContain('jsf-annotation-managed-bean');
      expect(family('seam-annotation-injection').binders).not.toContain('cdi-annotation-named');
    });

    it('reads Qualifier on a field or a parameter, by its value, with no default name and no fall back to the type', () => {
      expect(withoutBasis(site('spring-qualifier'))).toEqual({
        id: 'spring-qualifier',
        annotations: ['org.springframework.beans.factory.annotation.Qualifier'],
        on: ['field', 'parameter'],
        nameArguments: ['value'],
        defaultName: null,
        fallbackToType: false,
        expressionPrefix: null,
      });
    });

    it('reads Resource, javax and jakarta, on a field or a method, by its name, defaulting to the member name and falling back to the type', () => {
      expect(withoutBasis(site('spring-resource'))).toEqual({
        id: 'spring-resource',
        annotations: ['javax.annotation.Resource', 'jakarta.annotation.Resource'],
        on: ['field', 'method'],
        nameArguments: ['name'],
        defaultName: 'member-java-beans',
        fallbackToType: true,
        expressionPrefix: null,
      });
    });

    it('reads Seam In on a field or a method, by its value, defaulting to the Seam member name, with #{ as an expression', () => {
      expect(withoutBasis(site('seam-in'))).toEqual({
        id: 'seam-in',
        annotations: ['org.jboss.seam.annotations.In'],
        on: ['field', 'method'],
        nameArguments: ['value'],
        defaultName: 'member-seam',
        fallbackToType: false,
        expressionPrefix: '#{',
      });
    });

    it('reads EJB, javax and jakarta, on a field or a method, by its beanName, with no default name and no fall back to the type', () => {
      expect(withoutBasis(site('ejb-bean-name'))).toEqual({
        id: 'ejb-bean-name',
        annotations: ['javax.ejb.EJB', 'jakarta.ejb.EJB'],
        on: ['field', 'method'],
        nameArguments: ['beanName'],
        defaultName: null,
        fallbackToType: false,
        expressionPrefix: null,
      });
    });

    it('gives every family and every site a basis, and no site an id that a binder or a family already has', () => {
      expect(families).toHaveLength(3);
      for (const f of families) {
        expect(f.basis.length).toBeGreaterThan(20);
        for (const s of f.sites) expect(s.basis.length).toBeGreaterThan(20);
      }
      const ids = new Set([...catalog.xmlBinders, ...catalog.annotationBinders, ...catalog.expressionLanguages, ...catalog.xmlInjections, ...families].map((e) => e.id));
      expect(families.flatMap((f) => f.sites).filter((s) => ids.has(s.id))).toEqual([]);
    });

    it('has site ids no XML site repeats, and writes every annotation once across all the sites', () => {
      expect(families).toHaveLength(3);
      const all = [...catalog.xmlInjections, ...families].flatMap((f) => f.sites.map((s) => s.id));
      expect(new Set(all).size).toBe(all.length);
      const annotations = families.flatMap((f) => f.sites.flatMap((s) => s.annotations));
      expect(new Set(annotations).size).toBe(annotations.length);
    });
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.xmlBinders)).toBe(true);
    expect(Object.isFrozen(catalog.xmlBinders[0].target)).toBe(true);
    expect(Object.isFrozen(catalog.expressionLanguages[0].sees[1].when.elementTextIn.anyOf)).toBe(true);
    expect(() => { catalog.xmlBinders[0].id = 'x'; }).toThrow(TypeError);
    expect(() => { catalog.unitDescriptors.push('x'); }).toThrow(TypeError);
    expect(Object.isFrozen(catalog.xmlBinders[3].rootNamespace)).toBe(true);
    expect(Object.isFrozen(catalog.xmlBinders[3].target.unknownWhen)).toBe(true);
    expect(Object.isFrozen(catalog.xmlInjections)).toBe(true);
    expect(Object.isFrozen(catalog.xmlInjections[0].sites[0])).toBe(true);
    expect(Object.isFrozen(catalog.xmlInjections[0].census.elements)).toBe(true);
    expect(() => { catalog.xmlInjections[0].sites.push({}); }).toThrow(TypeError);
    expect(Object.isFrozen(catalog.annotationInjections)).toBe(true);
    expect(Object.isFrozen(catalog.annotationInjections[0].consumer.managedBy)).toBe(true);
    expect(Object.isFrozen(catalog.annotationInjections[1].binders)).toBe(true);
    expect(Object.isFrozen(catalog.annotationInjections[0].sites[1].annotations)).toBe(true);
    expect(Object.isFrozen(catalog.annotationInjections[0].sites[1].on)).toBe(true);
    expect(() => { catalog.annotationInjections[0].sites.push({}); }).toThrow(TypeError);
    expect(() => { catalog.annotationInjections[0].sites[0].on.push('constructor'); }).toThrow(TypeError);
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
    rejects((c) => { c.version = '1'; }, /name-bindings\.version: expected the number 3/);
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
    const declarations = loadNameBindingCatalog().expressionLanguages[0].localDeclarations;
    const param = declarations.findIndex((d) => d.element === 'param');
    const alias = declarations.findIndex((d) => d.element === 'aliasBean');
    rejects((c) => { declaration(c)[0].elementNamespaces = ['urn:x']; }, /localDeclarations\[0\]: "elementNamespaces" needs "element"/);
    rejects((c) => { declaration(c)[param].elementNamespaces = []; }, new RegExp(`localDeclarations\\[${param}\\]\\.elementNamespaces: expected at least one entry`));
    rejects((c) => { declaration(c)[param].elementNamespaces = 'urn:x'; }, new RegExp(`localDeclarations\\[${param}\\]\\.elementNamespaces: expected an array`));
    rejects((c) => { declaration(c)[param].elementNamespaces = [3]; }, new RegExp(`localDeclarations\\[${param}\\]\\.elementNamespaces\\[0\\]: expected a string`));
    rejects((c) => { declaration(c)[alias].declares = 'root'; }, new RegExp(`localDeclarations\\[${alias}\\]\\.declares: expected "literal" or "expression-root"`));
    rejects((c) => { declaration(c)[alias].declares = true; }, new RegExp(`localDeclarations\\[${alias}\\]\\.declares: expected "literal" or "expression-root"`));
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
    rejects((c) => { c.xmlBinders[0].target = { kind: 'file', child: 'x' }; }, /xmlBinders\[0\]\.target\.kind: expected "class", "bundle" or "name"/);
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
    rejects((c) => { c.expressionLanguages[0].files = { extensions: [], templateExtensions: [], xmlRoots: [] }; }, /files: expected at least one extension or XML root/);
    rejects((c) => { c.expressionLanguages[0].files.xmlRoots[0] = { rootNamespace: [] }; }, /xmlRoots\[0\]: missing "root"/);
    rejects((c) => { delete c.expressionLanguages[0].files.templateExtensions; }, /files: missing "templateExtensions"/);
    rejects((c) => { c.expressionLanguages[0].files.templateExtensions = ['vm']; }, /templateExtensions\[0\]: "vm" is not one of the extensions/);
  });

  // ---- catalog version 2 (xml-injection-references, design D1) ----
  // Positions in the shipped lists, asserted by the shipped-catalog tests above.
  const SPRING_BEAN = 3;
  const SPRING_ALIAS = 4;
  const accepts = (edit) => expect(() => parseNameBindingCatalog(mutate(edit))).not.toThrow();

  it('rejects a catalog of version 1 or 2, naming the version, even one that has no xmlInjections or annotationInjections at all', () => {
    rejects((c) => { c.version = 1; }, /name-bindings\.version: expected the number 3/);
    rejects((c) => { c.version = 1; delete c.xmlInjections; }, /name-bindings\.version: expected the number 3/);
    rejects((c) => { c.version = 2; }, /name-bindings\.version: expected the number 3/);
    rejects((c) => { c.version = 2; delete c.annotationInjections; }, /name-bindings\.version: expected the number 3/);
    rejects((c) => { c.version = 4; }, /name-bindings\.version: expected the number 3/);
    rejects((c) => { delete c.version; }, /name-bindings: missing "version"/);
  });

  it('lets a root namespace list hold null, and rejects an entry that is neither a non-empty string nor null', () => {
    for (const list of [[null], ['urn:x', null], [null, 'urn:x']]) {
      accepts((c) => { c.xmlBinders[0].rootNamespace = list; });
      accepts((c) => { c.xmlInjections[0].rootNamespace = list; });
    }
    rejects((c) => { c.xmlBinders[SPRING_BEAN].rootNamespace = [1]; }, /xmlBinders\[3\]\.rootNamespace\[0\]: expected a non-empty string or null/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].rootNamespace = [null, '']; }, /xmlBinders\[3\]\.rootNamespace\[1\]: expected a non-empty string or null/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].rootNamespace = []; }, /xmlBinders\[3\]\.rootNamespace: expected at least one entry/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].rootNamespace = null; }, /xmlBinders\[3\]\.rootNamespace: expected an array/);
    // null is for a binder's and a family's root; the expression language's XML roots stay strings only
    rejects((c) => { c.expressionLanguages[0].files.xmlRoots[1].rootNamespace = [null]; }, /xmlRoots\[1\]\.rootNamespace\[0\]: expected a string/);
  });

  it('accepts target kind "name" and names all three kinds when another is written', () => {
    accepts((c) => { c.xmlBinders[0].target = { kind: 'name', child: 'alias-of' }; });
    rejects((c) => { c.xmlBinders[SPRING_ALIAS].target.kind = 'bean'; }, /xmlBinders\[4\]\.target\.kind: expected "class", "bundle" or "name"/);
  });

  it('allows target unknownWhen and inheritFrom only on a target of kind "class"', () => {
    rejects((c) => { c.xmlBinders[1].target.unknownWhen = ['factory-method']; }, /xmlBinders\[1\]\.target: "unknownWhen" needs "kind": "class"/);
    rejects((c) => { c.xmlBinders[1].target.inheritFrom = 'parent'; }, /xmlBinders\[1\]\.target: "inheritFrom" needs "kind": "class"/);
    rejects((c) => { c.xmlBinders[SPRING_ALIAS].target.unknownWhen = ['x']; }, /xmlBinders\[4\]\.target: "unknownWhen" needs "kind": "class"/);
    rejects((c) => { c.xmlBinders[SPRING_ALIAS].target.inheritFrom = 'x'; }, /xmlBinders\[4\]\.target: "inheritFrom" needs "kind": "class"/);
    accepts((c) => { c.xmlBinders[0].target.unknownWhen = ['x']; c.xmlBinders[0].target.inheritFrom = 'y'; });
  });

  it('rejects an unknownWhen that is not a non-empty list of attribute names, and an inheritFrom that is not a name', () => {
    rejects((c) => { c.xmlBinders[SPRING_BEAN].target.unknownWhen = []; }, /xmlBinders\[3\]\.target\.unknownWhen: expected at least one entry/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].target.unknownWhen = 'factory-method'; }, /xmlBinders\[3\]\.target\.unknownWhen: expected an array/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].target.unknownWhen = [1]; }, /xmlBinders\[3\]\.target\.unknownWhen\[0\]: expected a string/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].target.unknownWhen = ['a', '']; }, /xmlBinders\[3\]\.target\.unknownWhen\[1\]: expected a non-empty string/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].target.inheritFrom = ''; }, /xmlBinders\[3\]\.target\.inheritFrom: expected a non-empty string/);
    rejects((c) => { c.xmlBinders[SPRING_BEAN].target.inheritFrom = ['parent']; }, /xmlBinders\[3\]\.target\.inheritFrom: expected a string/);
  });

  it('requires the xmlInjections list, and each family to be an object', () => {
    rejects((c) => { delete c.xmlInjections; }, /name-bindings: missing "xmlInjections"/);
    rejects((c) => { c.xmlInjections = {}; }, /name-bindings\.xmlInjections: expected an array/);
    rejects((c) => { c.xmlInjections[0] = 'spring-xml-injection'; }, /xmlInjections\[0\]: expected an object/);
    accepts((c) => { c.xmlInjections = []; });
  });

  it('names an unknown key or a missing field of a family, its consumer, its census and a site', () => {
    rejects((c) => { c.xmlInjections[0].extra = 1; }, /xmlInjections\[0\]: unknown key "extra"/);
    for (const key of ['id', 'namespace', 'basis', 'root', 'consumer', 'sites', 'census']) {
      rejects((c) => { delete c.xmlInjections[0][key]; }, new RegExp(`xmlInjections\\[0\\]: missing "${key}"`));
    }
    rejects((c) => { c.xmlInjections[0].consumer.extra = 1; }, /xmlInjections\[0\]\.consumer: unknown key "extra"/);
    rejects((c) => { delete c.xmlInjections[0].consumer.binder; }, /xmlInjections\[0\]\.consumer: missing "binder"/);
    rejects((c) => { delete c.xmlInjections[0].consumer.element; }, /xmlInjections\[0\]\.consumer: missing "element"/);
    rejects((c) => { c.xmlInjections[0].census.extra = []; }, /xmlInjections\[0\]\.census: unknown key "extra"/);
    rejects((c) => { delete c.xmlInjections[0].census.elements; }, /xmlInjections\[0\]\.census: missing "elements"/);
    rejects((c) => { c.xmlInjections[0].sites[2].extra = 1; }, /xmlInjections\[0\]\.sites\[2\]: unknown key "extra"/);
    rejects((c) => { delete c.xmlInjections[0].sites[2].id; }, /xmlInjections\[0\]\.sites\[2\]: missing "id"/);
  });

  it('names a wrong type in a family', () => {
    rejects((c) => { c.xmlInjections[0].id = 7; }, /xmlInjections\[0\]\.id: expected a string/);
    rejects((c) => { c.xmlInjections[0].namespace = ''; }, /xmlInjections\[0\]\.namespace: expected a non-empty string/);
    rejects((c) => { c.xmlInjections[0].root = 3; }, /xmlInjections\[0\]\.root: expected a string/);
    rejects((c) => { c.xmlInjections[0].consumer = 'bean'; }, /xmlInjections\[0\]\.consumer: expected an object/);
    rejects((c) => { c.xmlInjections[0].consumer.element = 3; }, /xmlInjections\[0\]\.consumer\.element: expected a string/);
    rejects((c) => { c.xmlInjections[0].sites = 'x'; }, /xmlInjections\[0\]\.sites: expected an array/);
    rejects((c) => { c.xmlInjections[0].sites = []; }, /xmlInjections\[0\]\.sites: expected at least one entry/);
    rejects((c) => { c.xmlInjections[0].sites[1] = 'spring-ref-bean'; }, /xmlInjections\[0\]\.sites\[1\]: expected an object/);
    rejects((c) => { c.xmlInjections[0].census = []; }, /xmlInjections\[0\]\.census: expected an object/);
    rejects((c) => { c.xmlInjections[0].census.attributes = 'ref'; }, /xmlInjections\[0\]\.census\.attributes: expected an array/);
    rejects((c) => { c.xmlInjections[0].census.attributeSuffixes = [1]; }, /xmlInjections\[0\]\.census\.attributeSuffixes\[0\]: expected a string/);
    rejects((c) => { c.xmlInjections[0].census.elements = ['ref', '']; }, /xmlInjections\[0\]\.census\.elements\[1\]: expected a non-empty string/);
  });

  it('rejects a family id that any other entry already has, and a family listed twice', () => {
    rejects((c) => { c.xmlInjections[0].id = 'spring-xml-bean'; }, /xmlInjections\[0\]: duplicate id "spring-xml-bean"/);
    rejects((c) => { c.xmlInjections[0].id = 'jsf-jsp-el'; }, /xmlInjections\[0\]: duplicate id "jsf-jsp-el"/);
    rejects((c) => { c.xmlBinders[0].id = 'spring-xml-injection'; }, /xmlInjections\[0\]: duplicate id "spring-xml-injection"/);
    rejects((c) => {
      const second = structuredClone(c.xmlInjections[0]);
      second.sites = [{ id: 'second-only', element: 'a', attribute: 'b' }];
      c.xmlInjections.push(second);
    }, /xmlInjections\[1\]: duplicate id "spring-xml-injection"/);
  });

  it('rejects a site id used twice, in one family or across families', () => {
    rejects((c) => { c.xmlInjections[0].sites[1].id = c.xmlInjections[0].sites[0].id; }, /xmlInjections\[0\]\.sites\[1\]: duplicate site id "spring-property-ref"/);
    rejects((c) => {
      c.xmlInjections.push({
        id: 'other-family', namespace: 'spring', basis: 'A second family, for the test of site ids across families.', root: 'beans',
        consumer: { element: 'bean', binder: 'spring-xml-bean' },
        sites: [{ id: 'fresh-site', element: 'x', attribute: 'y' }, { id: 'spring-ref-bean', element: 'x', attribute: 'z' }],
        census: { attributes: ['y'], attributeSuffixes: [], elements: [] },
      });
    }, /xmlInjections\[1\]\.sites\[1\]: duplicate site id "spring-ref-bean"/);
  });

  it('rejects a consumer binder that is not an XML binder of the family namespace with a target of kind "class"', () => {
    rejects((c) => { c.xmlInjections[0].consumer.binder = 'no-such-binder'; }, /xmlInjections\[0\]\.consumer\.binder: no XML binder with the id "no-such-binder"/);
    // an annotation binder is a binder, but not an XML one
    rejects((c) => { c.xmlInjections[0].consumer.binder = 'spring-annotation-stereotype'; }, /xmlInjections\[0\]\.consumer\.binder: no XML binder with the id "spring-annotation-stereotype"/);
    rejects((c) => { c.xmlInjections[0].consumer.binder = 'jsf-xml-managed-bean'; }, /xmlInjections\[0\]\.consumer\.binder: "jsf-xml-managed-bean" is in the namespace "el", not "spring"/);
    rejects((c) => { c.xmlInjections[0].consumer.binder = 'spring-xml-alias'; }, /xmlInjections\[0\]\.consumer\.binder: "spring-xml-alias" must have a target of kind "class", not "name"/);
    rejects((c) => {
      c.xmlInjections[0].namespace = 'el';
      c.xmlInjections[0].consumer.binder = 'jsf-xml-resource-bundle';
    }, /xmlInjections\[0\]\.consumer\.binder: "jsf-xml-resource-bundle" must have a target of kind "class", not "bundle"/);
    accepts((c) => {
      c.xmlInjections[0].namespace = 'el';
      c.xmlInjections[0].consumer.binder = 'jsf-xml-managed-bean';
    });
  });

  it('wants a site to be exactly one of the two shapes: element and attribute, or attribute namespace and suffix', () => {
    const shapes = /xmlInjections\[0\]\.sites\[0\]: expected either "element" and "attribute", or "attributeNamespace" and "attributeSuffix"/;
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x' }; }, shapes);
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', scope: 'file' }; }, shapes);
    const mixed = /xmlInjections\[0\]\.sites\[0\]: the "element"/;
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', element: 'a', attribute: 'b', attributeNamespace: 'urn:p', attributeSuffix: '-ref' }; }, mixed);
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', element: 'a', attributeSuffix: '-ref' }; }, mixed);
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', attribute: 'a', attributeNamespace: 'urn:p' }; }, mixed);
    // a half shape is a missing field, not a different shape
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', element: 'a' }; }, /xmlInjections\[0\]\.sites\[0\]: missing "attribute"/);
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', attribute: 'a' }; }, /xmlInjections\[0\]\.sites\[0\]: missing "element"/);
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', attributeNamespace: 'urn:p' }; }, /xmlInjections\[0\]\.sites\[0\]: missing "attributeSuffix"/);
    rejects((c) => { c.xmlInjections[0].sites[0] = { id: 'x', attributeSuffix: '-ref' }; }, /xmlInjections\[0\]\.sites\[0\]: missing "attributeNamespace"/);
    rejects((c) => { c.xmlInjections[0].sites[0].element = 3; }, /xmlInjections\[0\]\.sites\[0\]\.element: expected a string/);
    rejects((c) => { c.xmlInjections[0].sites[9].attributeSuffix = ''; }, /xmlInjections\[0\]\.sites\[9\]\.attributeSuffix: expected a non-empty string/);
    accepts((c) => { c.xmlInjections[0].sites[0] = { id: 'x', attributeNamespace: 'urn:p', attributeSuffix: '-ref' }; });
  });

  it('wants a site scope to be unit, file or outside, and lets it be left out', () => {
    rejects((c) => { c.xmlInjections[0].sites[0].scope = 'global'; }, /xmlInjections\[0\]\.sites\[0\]\.scope: expected "unit", "file" or "outside"/);
    rejects((c) => { c.xmlInjections[0].sites[0].scope = 1; }, /xmlInjections\[0\]\.sites\[0\]\.scope: expected "unit", "file" or "outside"/);
    rejects((c) => { c.xmlInjections[0].sites[0].scope = null; }, /xmlInjections\[0\]\.sites\[0\]\.scope: expected "unit", "file" or "outside"/);
    for (const scope of ['unit', 'file', 'outside']) accepts((c) => { c.xmlInjections[0].sites[0].scope = scope; });
    accepts((c) => { delete c.xmlInjections[0].sites[0].scope; });
  });

  it('wants a census with at least one entry in one of its three lists', () => {
    rejects((c) => { c.xmlInjections[0].census = { attributes: [], attributeSuffixes: [], elements: [] }; },
      /xmlInjections\[0\]\.census: expected at least one entry in "attributes", "attributeSuffixes" or "elements"/);
    accepts((c) => { c.xmlInjections[0].census = { attributes: ['ref'], attributeSuffixes: [], elements: [] }; });
    accepts((c) => { c.xmlInjections[0].census = { attributes: [], attributeSuffixes: ['-ref'], elements: [] }; });
    accepts((c) => { c.xmlInjections[0].census = { attributes: [], attributeSuffixes: [], elements: ['ref'] }; });
  });

  // ---- catalog version 3 (annotation-injection-references, design D3) ----
  // Positions in the shipped lists, asserted by the shipped-catalog tests above.
  const SPRING_INJECTION = 0;
  const SEAM_INJECTION = 1;
  const EJB_INJECTION = 2;
  const STEREOTYPE = 5;

  it('takes the simple-name rule for a binder, and no member rule', () => {
    accepts((c) => { c.annotationBinders[1].defaultName = 'simple-name'; });
    rejects((c) => { c.annotationBinders[1].defaultName = 'member-seam'; }, /annotationBinders\[1\]\.defaultName: unknown rule "member-seam"/);
    rejects((c) => { c.annotationBinders[1].defaultName = 'member-java-beans'; }, /annotationBinders\[1\]\.defaultName: unknown rule "member-java-beans"/);
    expect(STEREOTYPE).toBe(loadNameBindingCatalog().annotationBinders.findIndex((b) => b.id === 'spring-annotation-stereotype'));
  });

  describe('an annotation injection family that does not load', () => {
    it('requires the annotationInjections list, and each family to be an object', () => {
      rejects((c) => { delete c.annotationInjections; }, /name-bindings: missing "annotationInjections"/);
      rejects((c) => { c.annotationInjections = {}; }, /name-bindings\.annotationInjections: expected an array/);
      rejects((c) => { c.annotationInjections[0] = 'spring-annotation-injection'; }, /annotationInjections\[0\]: expected an object/);
      accepts((c) => { c.annotationInjections = []; });
    });

    it('names an unknown key or a missing field of a family, its consumer and a site', () => {
      rejects((c) => { c.annotationInjections[0].extra = 1; }, /annotationInjections\[0\]: unknown key "extra"/);
      for (const key of ['id', 'namespace', 'basis', 'consumer', 'sites']) {
        rejects((c) => { delete c.annotationInjections[1][key]; }, new RegExp(`annotationInjections\\[1\\]: missing "${key}"`));
      }
      accepts((c) => { delete c.annotationInjections[SEAM_INJECTION].binders; });
      rejects((c) => { c.annotationInjections[0].consumer.extra = []; }, /annotationInjections\[0\]\.consumer: unknown key "extra"/);
      rejects((c) => { delete c.annotationInjections[0].consumer.managedBy; }, /annotationInjections\[0\]\.consumer: missing "managedBy"/);
      rejects((c) => { c.annotationInjections[0].sites[1].extra = 1; }, /annotationInjections\[0\]\.sites\[1\]: unknown key "extra"/);
      for (const key of ['id', 'basis', 'annotations', 'on', 'nameArguments', 'defaultName', 'fallbackToType', 'expressionPrefix']) {
        rejects((c) => { delete c.annotationInjections[1].sites[0][key]; }, new RegExp(`annotationInjections\\[1\\]\\.sites\\[0\\]: missing "${key}"`));
      }
    });

    it('names a wrong type in a family and its consumer', () => {
      rejects((c) => { c.annotationInjections[0].id = 7; }, /annotationInjections\[0\]\.id: expected a string/);
      rejects((c) => { c.annotationInjections[0].namespace = ''; }, /annotationInjections\[0\]\.namespace: expected a non-empty string/);
      rejects((c) => { c.annotationInjections[0].basis = ''; }, /annotationInjections\[0\]\.basis: expected a non-empty string/);
      rejects((c) => { c.annotationInjections[0].consumer = 'managed'; }, /annotationInjections\[0\]\.consumer: expected an object/);
      rejects((c) => { c.annotationInjections[0].consumer.managedBy = 'spring-xml-bean'; }, /annotationInjections\[0\]\.consumer\.managedBy: expected an array/);
      rejects((c) => { c.annotationInjections[0].consumer.managedBy[1] = 3; }, /annotationInjections\[0\]\.consumer\.managedBy\[1\]: expected a string/);
      rejects((c) => { c.annotationInjections[0].consumer.managedBy[0] = ''; }, /annotationInjections\[0\]\.consumer\.managedBy\[0\]: expected a non-empty string/);
      rejects((c) => { c.annotationInjections[0].sites = 'spring-qualifier'; }, /annotationInjections\[0\]\.sites: expected an array/);
      rejects((c) => { c.annotationInjections[0].sites = []; }, /annotationInjections\[0\]\.sites: expected at least one entry/);
      rejects((c) => { c.annotationInjections[0].sites[1] = 'spring-resource'; }, /annotationInjections\[0\]\.sites\[1\]: expected an object/);
    });

    it('rejects a family id that any other entry already has, and a family listed twice', () => {
      rejects((c) => { c.annotationInjections[0].id = 'spring-xml-bean'; }, /annotationInjections\[0\]: duplicate id "spring-xml-bean"/);
      rejects((c) => { c.annotationInjections[0].id = 'ejb-annotation-session'; }, /annotationInjections\[0\]: duplicate id "ejb-annotation-session"/);
      rejects((c) => { c.annotationInjections[0].id = 'jsf-jsp-el'; }, /annotationInjections\[0\]: duplicate id "jsf-jsp-el"/);
      rejects((c) => { c.annotationInjections[0].id = 'spring-xml-injection'; }, /annotationInjections\[0\]: duplicate id "spring-xml-injection"/);
      rejects((c) => { c.annotationInjections[1].id = c.annotationInjections[0].id; }, /annotationInjections\[1\]: duplicate id "spring-annotation-injection"/);
      rejects((c) => { c.xmlBinders[0].id = 'seam-annotation-injection'; }, /annotationInjections\[1\]: duplicate id "seam-annotation-injection"/);
    });

    it('wants a `binders` limit, when given, to be a non-empty list of binders of the family namespace', () => {
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders = 'seam-xml-component'; }, /annotationInjections\[1\]\.binders: expected an array/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders = []; }, /annotationInjections\[1\]\.binders: expected at least one entry/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders[1] = 4; }, /annotationInjections\[1\]\.binders\[1\]: expected a string/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders[2] = 'no-such-binder'; }, /annotationInjections\[1\]\.binders\[2\]: no binder with the id "no-such-binder"/);
      // an expression language, a family and a site id are not binders
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders[0] = 'jsf-jsp-el'; }, /annotationInjections\[1\]\.binders\[0\]: no binder with the id "jsf-jsp-el"/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders[0] = 'seam-in'; }, /annotationInjections\[1\]\.binders\[0\]: no binder with the id "seam-in"/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders[1] = 'spring-annotation-stereotype'; },
        /annotationInjections\[1\]\.binders\[1\]: "spring-annotation-stereotype" is in the namespace "spring", not "el"/);
      rejects((c) => { c.annotationInjections[SPRING_INJECTION].binders = ['spring-xml-bean', 'ejb-annotation-session']; },
        /annotationInjections\[0\]\.binders\[1\]: "ejb-annotation-session" is in the namespace "ejb", not "spring"/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].binders[2] = 'seam-annotation-name'; },
        /annotationInjections\[1\]\.binders\[2\]: duplicate binder id "seam-annotation-name"/);
      // an XML binder is a binder, whatever its target
      accepts((c) => { c.annotationInjections[SPRING_INJECTION].binders = ['spring-xml-bean', 'spring-xml-alias', 'spring-annotation-stereotype']; });
    });

    it('wants each binder that manages a consumer to exist, be of the family namespace and, when XML, have a target of kind "class"', () => {
      rejects((c) => { c.annotationInjections[0].consumer.managedBy[0] = 'no-such-binder'; }, /annotationInjections\[0\]\.consumer\.managedBy\[0\]: no binder with the id "no-such-binder"/);
      rejects((c) => { c.annotationInjections[0].consumer.managedBy[1] = 'seam-annotation-name'; },
        /annotationInjections\[0\]\.consumer\.managedBy\[1\]: "seam-annotation-name" is in the namespace "el", not "spring"/);
      rejects((c) => { c.annotationInjections[EJB_INJECTION].consumer.managedBy = ['spring-annotation-stereotype']; },
        /annotationInjections\[2\]\.consumer\.managedBy\[0\]: "spring-annotation-stereotype" is in the namespace "spring", not "ejb"/);
      rejects((c) => { c.annotationInjections[0].consumer.managedBy = ['spring-xml-bean', 'spring-xml-alias']; },
        /annotationInjections\[0\]\.consumer\.managedBy\[1\]: "spring-xml-alias" must have a target of kind "class", not "name"/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].consumer.managedBy = ['jsf-xml-resource-bundle']; },
        /annotationInjections\[1\]\.consumer\.managedBy\[0\]: "jsf-xml-resource-bundle" must have a target of kind "class", not "bundle"/);
      rejects((c) => { c.annotationInjections[0].consumer.managedBy[1] = c.annotationInjections[0].consumer.managedBy[0]; },
        /annotationInjections\[0\]\.consumer\.managedBy\[1\]: duplicate binder id "spring-xml-bean"/);
      // no binder manages a consumer: the family does not ask for it
      accepts((c) => { c.annotationInjections[SPRING_INJECTION].consumer.managedBy = []; });
      accepts((c) => { c.annotationInjections[SPRING_INJECTION].consumer.managedBy = ['spring-annotation-stereotype']; });
    });

    it('rejects a site id used twice: in one family, across annotation families, or with an XML site', () => {
      rejects((c) => { c.annotationInjections[0].sites[1].id = 'spring-qualifier'; }, /annotationInjections\[0\]\.sites\[1\]: duplicate site id "spring-qualifier"/);
      rejects((c) => { c.annotationInjections[EJB_INJECTION].sites[0].id = 'seam-in'; }, /annotationInjections\[2\]\.sites\[0\]: duplicate site id "seam-in"/);
      rejects((c) => { c.annotationInjections[0].sites[0].id = 'spring-ref-bean'; }, /annotationInjections\[0\]\.sites\[0\]: duplicate site id "spring-ref-bean"/);
      rejects((c) => { c.xmlInjections[0].sites[0].id = 'seam-in'; }, /annotationInjections\[1\]\.sites\[0\]: duplicate site id "seam-in"/);
    });

    it('wants a site\'s annotations to be a non-empty list of qualified names, each read by one site only', () => {
      const site = (c) => c.annotationInjections[SPRING_INJECTION].sites[1];
      rejects((c) => { site(c).annotations = []; }, /annotationInjections\[0\]\.sites\[1\]\.annotations: expected at least one entry/);
      rejects((c) => { site(c).annotations = 'javax.annotation.Resource'; }, /annotationInjections\[0\]\.sites\[1\]\.annotations: expected an array/);
      rejects((c) => { site(c).annotations[1] = 1; }, /annotationInjections\[0\]\.sites\[1\]\.annotations\[1\]: expected a string/);
      rejects((c) => { site(c).annotations[1] = ''; }, /annotationInjections\[0\]\.sites\[1\]\.annotations\[1\]: expected a non-empty string/);
      // a simple name could match the annotation of any package
      rejects((c) => { site(c).annotations[1] = 'Resource'; }, /annotationInjections\[0\]\.sites\[1\]\.annotations\[1\]: expected a qualified name/);
      rejects((c) => { site(c).annotations[1] = 'jakarta..Resource'; }, /annotationInjections\[0\]\.sites\[1\]\.annotations\[1\]: expected a qualified name/);
      rejects((c) => { site(c).annotations[1] = 'jakarta.annotation.Resource.'; }, /annotationInjections\[0\]\.sites\[1\]\.annotations\[1\]: expected a qualified name/);
      rejects((c) => { site(c).annotations[1] = site(c).annotations[0]; }, /annotationInjections\[0\]\.sites\[1\]\.annotations\[1\]: duplicate annotation "javax\.annotation\.Resource"/);
      rejects((c) => { c.annotationInjections[EJB_INJECTION].sites[0].annotations[1] = 'javax.annotation.Resource'; },
        /annotationInjections\[2\]\.sites\[0\]\.annotations\[1\]: "javax\.annotation\.Resource" is already read by the site "spring-resource"/);
      rejects((c) => { c.annotationInjections[SEAM_INJECTION].sites[0].annotations = ['org.springframework.beans.factory.annotation.Qualifier']; },
        /annotationInjections\[1\]\.sites\[0\]\.annotations\[0\]: "org\.springframework\.beans\.factory\.annotation\.Qualifier" is already read by the site "spring-qualifier"/);
      accepts((c) => { site(c).annotations = ['com.acme.Outer.Inner']; });
    });

    it('wants a site\'s `on` to be a non-empty list of distinct member kinds', () => {
      const site = (c) => c.annotationInjections[SEAM_INJECTION].sites[0];
      rejects((c) => { site(c).on = []; }, /annotationInjections\[1\]\.sites\[0\]\.on: expected at least one entry/);
      rejects((c) => { site(c).on = 'field'; }, /annotationInjections\[1\]\.sites\[0\]\.on: expected an array/);
      rejects((c) => { site(c).on[1] = 3; }, /annotationInjections\[1\]\.sites\[0\]\.on\[1\]: expected a string/);
      rejects((c) => { site(c).on[1] = 'class'; }, /annotationInjections\[1\]\.sites\[0\]\.on\[1\]: expected "field", "method", "constructor", "parameter" or "component"/);
      rejects((c) => { site(c).on[0] = 'Field'; }, /annotationInjections\[1\]\.sites\[0\]\.on\[0\]: expected "field", "method", "constructor", "parameter" or "component"/);
      rejects((c) => { site(c).on[1] = 'field'; }, /annotationInjections\[1\]\.sites\[0\]\.on\[1\]: duplicate member kind "field"/);
      accepts((c) => { site(c).on = ['field', 'method', 'constructor', 'parameter', 'component']; });
      accepts((c) => { site(c).on = ['component']; });
    });

    it('wants a site\'s `nameArguments` to be a list of distinct argument keys, which may be empty', () => {
      const site = (c) => c.annotationInjections[SEAM_INJECTION].sites[0];
      rejects((c) => { site(c).nameArguments = 'value'; }, /annotationInjections\[1\]\.sites\[0\]\.nameArguments: expected an array/);
      rejects((c) => { site(c).nameArguments = [3]; }, /annotationInjections\[1\]\.sites\[0\]\.nameArguments\[0\]: expected a string/);
      rejects((c) => { site(c).nameArguments = ['value', '']; }, /annotationInjections\[1\]\.sites\[0\]\.nameArguments\[1\]: expected a non-empty string/);
      rejects((c) => { site(c).nameArguments = ['value', 'value']; }, /annotationInjections\[1\]\.sites\[0\]\.nameArguments\[1\]: duplicate name argument "value"/);
      accepts((c) => { site(c).nameArguments = []; });
      accepts((c) => { site(c).nameArguments = ['value', 'name']; });
    });

    it('wants a site\'s `defaultName` to be null or a member rule, not one of the rules of a binder', () => {
      const site = (c) => c.annotationInjections[SPRING_INJECTION].sites[0];
      for (const rule of [null, 'member-java-beans', 'member-seam']) accepts((c) => { site(c).defaultName = rule; });
      rejects((c) => { site(c).defaultName = 'uppercase'; }, /annotationInjections\[0\]\.sites\[0\]\.defaultName: unknown rule "uppercase"/);
      rejects((c) => { site(c).defaultName = 'lowercase-first'; }, /annotationInjections\[0\]\.sites\[0\]\.defaultName: unknown rule "lowercase-first"/);
      rejects((c) => { site(c).defaultName = 'simple-name'; }, /annotationInjections\[0\]\.sites\[0\]\.defaultName: unknown rule "simple-name"/);
      rejects((c) => { site(c).defaultName = ''; }, /annotationInjections\[0\]\.sites\[0\]\.defaultName: unknown rule ""/);
      rejects((c) => { site(c).defaultName = 3; }, /annotationInjections\[0\]\.sites\[0\]\.defaultName: expected a rule name or null/);
      rejects((c) => { site(c).defaultName = false; }, /annotationInjections\[0\]\.sites\[0\]\.defaultName: expected a rule name or null/);
    });

    it('wants a site\'s `fallbackToType` to be a boolean, true only for a site that has a default name', () => {
      const resource = (c) => c.annotationInjections[SPRING_INJECTION].sites[1];
      rejects((c) => { resource(c).fallbackToType = 'yes'; }, /annotationInjections\[0\]\.sites\[1\]\.fallbackToType: expected a boolean/);
      rejects((c) => { resource(c).fallbackToType = 1; }, /annotationInjections\[0\]\.sites\[1\]\.fallbackToType: expected a boolean/);
      rejects((c) => { resource(c).fallbackToType = null; }, /annotationInjections\[0\]\.sites\[1\]\.fallbackToType: expected a boolean/);
      // a name that is never defaulted has no type to fall back to
      rejects((c) => { c.annotationInjections[SPRING_INJECTION].sites[0].fallbackToType = true; },
        /annotationInjections\[0\]\.sites\[0\]: "fallbackToType" needs a "defaultName" that is not null/);
      rejects((c) => { resource(c).defaultName = null; }, /annotationInjections\[0\]\.sites\[1\]: "fallbackToType" needs a "defaultName" that is not null/);
      accepts((c) => { resource(c).fallbackToType = false; });
      accepts((c) => { c.annotationInjections[SEAM_INJECTION].sites[0].fallbackToType = true; });
    });

    it('wants a site\'s `expressionPrefix` to be null or a non-empty string', () => {
      const site = (c) => c.annotationInjections[SEAM_INJECTION].sites[0];
      rejects((c) => { site(c).expressionPrefix = ''; }, /annotationInjections\[1\]\.sites\[0\]\.expressionPrefix: expected a non-empty string or null/);
      rejects((c) => { site(c).expressionPrefix = 3; }, /annotationInjections\[1\]\.sites\[0\]\.expressionPrefix: expected a non-empty string or null/);
      rejects((c) => { site(c).expressionPrefix = ['#{']; }, /annotationInjections\[1\]\.sites\[0\]\.expressionPrefix: expected a non-empty string or null/);
      accepts((c) => { site(c).expressionPrefix = null; });
      accepts((c) => { site(c).expressionPrefix = '${'; });
    });

    it('wants a site\'s id and basis to be non-empty strings', () => {
      rejects((c) => { c.annotationInjections[0].sites[0].id = 5; }, /annotationInjections\[0\]\.sites\[0\]\.id: expected a string/);
      rejects((c) => { c.annotationInjections[0].sites[0].basis = ''; }, /annotationInjections\[0\]\.sites\[0\]\.basis: expected a non-empty string/);
    });

    it('lets a site count what it cannot name: no name argument and no default name', () => {
      accepts((c) => {
        const site = c.annotationInjections[EJB_INJECTION].sites[0];
        site.nameArguments = [];
        site.defaultName = null;
      });
    });
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
  it('names exactly the three the design lists', () => {
    expect(Object.keys(DEFAULT_NAME_RULES).sort()).toEqual(['java-beans-decapitalize', 'lowercase-first', 'simple-name']);
  });

  it('simple-name is the class\'s simple name, unchanged (annotation-injection-references design D3)', () => {
    const rule = DEFAULT_NAME_RULES['simple-name'];
    expect(rule('OrderBean')).toBe('OrderBean');
    expect(rule('URLHelper')).toBe('URLHelper');
    expect(rule('a')).toBe('a');
    expect(rule('X1')).toBe('X1');
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

describe('the member default-name rules and member kinds an injection site may name (design D3, D4)', () => {
  it('lists the two default-name rules of a member and the five kinds of member', () => {
    expect([...MEMBER_DEFAULT_NAME_RULES]).toEqual(['member-java-beans', 'member-seam']);
    expect([...MEMBER_KINDS]).toEqual(['field', 'method', 'constructor', 'parameter', 'component']);
    expect(Object.isFrozen(MEMBER_DEFAULT_NAME_RULES)).toBe(true);
    expect(Object.isFrozen(MEMBER_KINDS)).toBe(true);
  });

  it('keeps the member rules apart from the class rules: a binder takes no member rule and a site takes no class rule', () => {
    for (const rule of MEMBER_DEFAULT_NAME_RULES) expect(Object.hasOwn(DEFAULT_NAME_RULES, rule)).toBe(false);
  });
});
