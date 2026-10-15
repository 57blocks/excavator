/**
 * The ②b prompt additions are ADDITIVE by contract: the direction for this
 * step is that UA's pipeline semantics stay as they are and excavator only
 * supplements. For the two agent prompts that carry UA's analysis logic that
 * means new sections at the END and not one changed or removed line above.
 *
 * "No removed lines" is asserted structurally rather than by parsing a diff:
 * the frozen baseline below (the file's UTF-8 byte length and SHA-256 as of
 * commit 5a10e468 on main's history, before the ②b additions) must match the
 * first bytes of the working copy exactly. A byte-exact prefix cannot have
 * had a line deleted, reworded, or reordered — every change since is
 * necessarily an append. The baseline lives here rather than behind a git
 * ref so the check needs no branch and no network fetch, and it can never
 * silently skip.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DETERMINISTIC_EDGE_TYPES } from '../../../skills/excavator/retrieve.mjs';
import { BUSINESS_INTERFACE_GAP_KIND, TYPE_INJECTION_GAP_KINDS } from '../../../skills/excavator/type-injection-resolution.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

/** The UA-semantics files this step is only allowed to append to, with their frozen baselines. */
const ADDITIVE_ONLY_BASELINES = [
  {
    path: 'agents/excavator-file-analyzer.md',
    bytes: 34886,
    sha256: '872620f1344acf255469d14c4569ee2900bcf7bcd8385fad37a7612575d00301',
  },
];

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

/** One line: hard-wrapped prose and bold markers do not break a phrase match. */
const flat = (text) => text.replace(/\*\*/g, '').replace(/\s+/g, ' ');

const fileAnalyzer = readRepoFile('agents/excavator-file-analyzer.md');
const domainAnalyzer = readRepoFile('agents/excavator-domain-analyzer.md');

describe('UA prompt files are only ever appended to', () => {
  it.each(ADDITIVE_ONLY_BASELINES)('$path: the frozen baseline is a byte-exact prefix', ({ path, bytes, sha256 }) => {
    const current = readFileSync(resolve(repoRoot, path));

    expect(current.length).toBeGreaterThan(bytes);
    const prefixHash = createHash('sha256').update(current.subarray(0, bytes)).digest('hex');
    expect(
      prefixHash,
      `the first ${bytes} bytes of ${path} no longer match the frozen UA baseline: a line above the appended sections was changed or removed`,
    ).toBe(sha256);
  });
});

describe('SKILL.md service-only contract', () => {
  it('keeps evidence phases while removing presentation mode', () => {
    const current = readRepoFile('skills/excavator/SKILL.md');
    expect(current).toContain('## Phase 2.3 — ANNOTATE');
    expect(current).toContain('## Phase 2.5 — VERIFY');
    expect(current).toContain('## Phase 6b — VALIDATE');
    expect(current).toContain('## Phase 5 — SERVICE OUTPUT');
    expect(current).not.toContain('--terminal-only');
    expect(current).not.toContain('--with-dashboard');
  });
});

describe('file-analyzer evidence section', () => {
  it('adds the section without disturbing the existing headings', () => {
    expect(fileAnalyzer).toContain('## Evidence Fields (added — nothing above changes)');
    // The pre-existing headings are all still present and still ahead of it.
    for (const heading of [
      '## Phase 1 -- Structural Extraction (Bundled Script)',
      '## Phase 2 -- Semantic Analysis',
      '### Step 3 -- Create Edges',
      '## Critical Constraints',
      '## Writing Results — single or multi-part',
    ]) {
      expect(fileAnalyzer).toContain(heading);
      expect(fileAnalyzer.indexOf(heading)).toBeLessThan(
        fileAnalyzer.indexOf('## Evidence Fields (added — nothing above changes)'),
      );
    }
  });

  it('requires an evidence entry whose line is copied, not estimated', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('## Evidence Fields (added — nothing above changes)'),
    );
    expect(section).toContain('"source": "model"');
    expect(section).toContain('copied from the extraction results');
    expect(section).toMatch(/never\s+estimated/);
    // Every structural edge type has a named line source.
    for (const type of ['contains', 'exports', 'calls', 'imports']) {
      expect(section).toContain(`\`${type}\``);
    }
    expect(section).toContain('startLine');
    expect(section).toContain('lineNumber');
    expect(section).toContain('exports[].line');
    expect(section).toContain('imports[].line');
  });

  it('routes an uncopyable line to inferred rather than to a guess', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('## Evidence Fields (added — nothing above changes)'),
    );
    expect(section).toContain('"provenance": "inferred"');
    expect(section).toContain('Never write `"provenance": "extracted"` yourself.');
  });

  it('keeps no-extractor and parse-failed files to a file node only', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('### Files with no structural records'),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('`no-extractor`');
    expect(section).toContain('`parse-failed`');
    expect(section).toContain('Still create exactly one node for the file');
    expect(section).toContain('Do **NOT** invent `function:` or `class:` nodes for them');
    expect(section).toContain('Do **NOT** emit `calls` edges for them');
    // The existing 1:1 imports rule must be preserved, not weakened.
    expect(section).toContain('`imports` edges are unaffected');
    expect(section).toContain('batchImportData');
  });

  it('keeps a reported owner and forbids inventing one', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('### Keep `owner` when it is given'),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('copy it verbatim onto the node as `"owner": "<value>"`');
    expect(section).toContain('leave the field off');
    expect(section).toContain('Do not change the node `id` because of an `owner`');
  });
});

describe('file-analyzer framework guidance hook', () => {
  const section = () =>
    fileAnalyzer.slice(fileAnalyzer.indexOf('## Framework Guidance (added — nothing above changes)'));

  it('points at the frameworks directory next to the dispatching skill', () => {
    expect(fileAnalyzer).toContain('## Framework Guidance (added — nothing above changes)');
    expect(section()).toContain('<SKILL_DIR>/frameworks/<framework-id-lowercase>.md');
    expect(section()).toContain('<SKILL_DIR>/frameworks/README.md');
  });

  it('makes a missing addendum silence rather than a licence to guess', () => {
    expect(section()).toContain('continue silently');
    expect(section()).toMatch(/not licence to\s+reconstruct them/);
  });

  it('does not let a convention stand in for a cited line', () => {
    expect(section()).toContain('An addendum never outranks the evidence rules.');
    expect(section()).toContain('"provenance": "inferred"');
  });
});

describe('frameworks/README.md explains the hook', () => {
  const readme = readRepoFile('skills/excavator/frameworks/README.md');

  it('names both readers and the file-naming rule: the FrameworkConfig id', () => {
    expect(readme).toContain('excavator-architecture-analyzer');
    expect(readme).toContain('excavator-file-analyzer');
    expect(flat(readme)).toContain("The file name is the `id` of the framework's `FrameworkConfig`, plus `.md`.");
    expect(readme).not.toContain('lower-cased framework id');
  });

  it('says the fact build writes the detected ids into the header and both readers take files by them', () => {
    const naming = flat(readme.slice(readme.indexOf('## Naming'), readme.indexOf('## A missing file')));
    expect(naming).toContain("graph header's `project.frameworks`");
    expect(naming).toContain('Both readers take files by that id.');
    expect(naming).toContain('every registered config has an addendum of that name');
    expect(naming).toContain('every addendum here belongs to a registered config');
    expect(flat(readme)).toContain('for every id in the graph header\'s `project.frameworks`');
  });

  it('puts the JAX-RS route to its handler in the deterministic home, the route catalog, and leaves only its application prefix to javaee.md (jaxrs-route-facts)', () => {
    const where = flat(readme.slice(readme.indexOf('What is where today:'), readme.indexOf('## Present today')));
    expect(where).toContain('| JAX-RS route (class and method `@Path`, HTTP method annotation) to the method that handles it | deterministic, `catalogs/routes.json` |');
    expect(where).toContain('| JMS and CDI event pairs, the application prefix of JAX-RS routes (`javaee.md`) | addenda |');
    expect(where).not.toContain('JAX-RS route assembly');
    const homes = flat(readme.slice(readme.indexOf('Framework knowledge has three homes'), readme.indexOf('What is where today:')));
    expect(homes).toContain('route registration (Express `app.use`, Gin `r.Group`, Spring annotations)');
    expect(homes).toContain('`../catalogs/routes.json` for routes');
    expect(homes).toContain('The route catalog is such a catalog');
  });

  it('puts injection by type (JSR 330 Inject, an unnamed EJB) and the business interfaces to the deterministic home, the type injection catalog, and takes them out of the addenda row (by-type-injection)', () => {
    const where = flat(readme.slice(readme.indexOf('What is where today:'), readme.indexOf('## Present today')));
    expect(where).toContain('| Injection by type (JSR 330 `@Inject` and an unnamed `@EJB`) to the one class or producer method that can satisfy the type, and the business interfaces a class declares by `@Local` and `@Remote` class literals | deterministic, `catalogs/type-injections.json` |');
    expect(where).toContain('| DI by type (Spring, Angular, FastAPI, …; JSR 330 `@Inject` and unnamed `@EJB` excepted), component roles, HTTP routes (Spring, Java EE, Angular, Express, Gin, FastAPI, …), JAX-RS routes excepted | addenda |');
    const homes = flat(readme.slice(readme.indexOf('Framework knowledge has three homes'), readme.indexOf('What is where today:')));
    expect(homes).toContain('dependency injection by type (Spring `@Autowired`, an Angular constructor parameter, FastAPI `Depends`)');
    expect(homes).toContain('JSR 330 `@Inject` and an unnamed `@EJB` on Java are not here: the fact graph has them (third home)');
    expect(homes).toContain('A third is an injection point filled by type (`@Inject`, an unnamed `@EJB`)');
    expect(homes).toContain('`../catalogs/type-injections.json` for injection by type');
    // the catalog the rows name exists
    expect(readRepoFile('skills/excavator/catalogs/type-injections.json')).toContain('"injectionFamilies"');
  });

  it('lists javaee.md and jsf.md as present, and says where their knowledge lives', () => {
    const present = readme.slice(readme.indexOf('## Present today'));
    expect(present).toContain('`javaee.md`');
    expect(present).toContain('`jsf.md`');
    const where = readme.slice(readme.indexOf('What is where today:'), readme.indexOf('## Present today'));
    expect(where).toContain('`javaee.md`');
    expect(where).toContain('`jsf.md`');
  });

  it('states that a missing addendum is skipped, not reconstructed', () => {
    expect(readme).toContain('A missing file is silence, not a licence');
    expect(readme).toContain('skip it and continue');
  });

  it('says the framework readers are tracked as OpenSpec changes, naming the targets', () => {
    expect(readme).toContain('openspec/changes');
    expect(readme).toContain('angular');
    expect(readme).toContain('maui');
  });

  it('lists every addendum file that exists in the directory', () => {
    const dir = resolve(repoRoot, 'skills/excavator/frameworks');
    const addenda = readdirSync(dir)
      .filter(name => name.endsWith('.md') && name !== 'README.md')
      .sort();
    expect(addenda.length).toBeGreaterThan(0);
    for (const name of addenda) {
      expect(readme, `README.md should list ${name}`).toContain(`\`${name}\``);
    }
  });
});

describe('domain-analyzer step anchors', () => {
  const section = () =>
    domainAnalyzer.slice(domainAnalyzer.indexOf('## Step Anchors (added — nothing above changes)'));

  it('asks for real graph ids on step nodes', () => {
    expect(domainAnalyzer).toContain('## Step Anchors (added — nothing above changes)');
    expect(section()).toContain('`nodeIds`');
    expect(section()).toContain('real ids of the');
    expect(section()).toContain('copied verbatim');
  });

  it('accepts omission marked inferred but not an id that is not in the graph', () => {
    expect(section()).toContain('omit `nodeIds`');
    expect(section()).toContain('"provenance": "inferred"');
    expect(section()).toMatch(/a `nodeIds`\s+entry that is not in the graph is not/);
  });
});

describe('SKILL.md injects framework addenda by the graph header ids (javaee-jsf-framework-knowledge, D5)', () => {
  const skill = readRepoFile('skills/excavator/SKILL.md');
  const between = (from, to) => {
    const start = skill.indexOf(from);
    expect(start, `SKILL.md should contain ${from}`).toBeGreaterThanOrEqual(0);
    const end = skill.indexOf(to, start);
    expect(end, `SKILL.md should contain ${to} after ${from}`).toBeGreaterThan(start);
    return flat(skill.slice(start, end));
  };

  it('Phase 4 step 3 takes the ids from project.frameworks, reads frameworks/<id>.md and skips a missing file silently', () => {
    const step = between('3. **Framework addendum injection:**', 'Append the language/framework context');
    expect(step).toContain("graph header's `project.frameworks`");
    expect(step).toContain('knowledge-graph-store.mjs');
    expect(step).toContain('read the file at `./frameworks/<id>.md`');
    expect(step).toContain('append its full content after the language context');
    expect(step).toContain('skip it silently and continue');
    expect(step).not.toContain('Phase 1');
  });

  it('the Additional context of Phase 4 reports the header ids', () => {
    const context = between('> **Additional context from main session:**', 'Directory tree');
    expect(context).toContain('Frameworks detected: `<project.frameworks from the graph header>`');
    expect(skill).not.toContain('<frameworks from Phase 1>');
  });

  it('the Phase F2 dispatch prompt lists the header ids for the file-analyzer', () => {
    const prompt = between('> Produce a semantic patch for each fact node below', 'Write output to:');
    expect(prompt).toContain('Frameworks detected: `<project.frameworks from the graph header>`');
    // the line sits with the project root, ahead of the fact node list
    expect(prompt.indexOf('Frameworks detected:')).toBeLessThan(prompt.indexOf('Fact nodes for this batch:'));
    expect(prompt.indexOf('Project root:')).toBeLessThan(prompt.indexOf('Frameworks detected:'));
  });

  it('Phase F3 still takes the context injection from Phase 4 itself', () => {
    expect(flat(skill)).toContain("language/framework context injection identical to Phase 4's own steps 2-3");
  });
});

describe('Phase F3 gives the architecture analyzer node semantics and page references (architecture-input)', () => {
  const skill = readRepoFile('skills/excavator/SKILL.md');
  const rebuild = (() => {
    const start = skill.indexOf('**If `rebuild`:** first build');
    expect(start, 'Phase F3 should open its rebuild branch by building the input').toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('Then dispatch `excavator-assemble-reviewer`', start);
    expect(end).toBeGreaterThan(start);
    // drop the blockquote markers so a phrase of the dispatch prompt matches across its wrapped lines
    return flat(skill.slice(start, end).replace(/^> ?/gm, ''));
  })();
  const prompt = rebuild.slice(rebuild.indexOf('Analyze this codebase'));

  it('takes fresh semantics from the shared reuse plan, into files of its own, and never from the graph nodes', () => {
    expect(rebuild).toContain('node "<SKILL_DIR>/select-stale-semantics.mjs" "$PROJECT_ROOT"');
    expect(rebuild).toContain('--out "$DATA_DIR/intermediate/architecture-semantics.json"');
    expect(rebuild).toContain('--files-out "$DATA_DIR/intermediate/architecture-stale-files.json"');
    expect(rebuild).toContain("Its `plan.reuse[]` lists every node with a fresh `semantic-cache.json` entry, with that entry's `summary` and `tags`.");
    expect(rebuild).toContain('it gets no `tags` or `summary` in the input, and you do not write them for it.');
    expect(rebuild).toContain('Never read `summary`/`tags` from `knowledge-graph.jsonl` nodes');
  });

  it('lists every node with its owner, the tags of a fresh node and the summary of a fresh file node', () => {
    expect(rebuild).toContain('One entry per node in `knowledge-graph.jsonl`: `{id, type, name, filePath}`, plus `owner` when the node has one');
    expect(rebuild).toContain('plus `tags` when the node is in `plan.reuse[]`, plus that entry\'s `summary` when the node is also a `file` node.');
    expect(rebuild).toContain('(if .owner then {owner} else {} end)');
    expect(rebuild).toContain('(if $fresh[.id] then {tags: $fresh[.id].tags} else {} end)');
    expect(rebuild).toContain('(if $fresh[.id] and .type == "file" then {summary: $fresh[.id].summary} else {} end)');
  });

  it('gives the imports edges and the references edges with the line and chain of each evidence, without the bindings', () => {
    expect(rebuild).toContain('select(.type == "imports" or .type == "references")');
    expect(rebuild).toContain('{evidence: [.evidence[] | {line, chain}]}');
    expect(rebuild).toContain("Leave out the evidence's bindings.");
    expect(prompt).toContain('Fact nodes: `<the node list from step 2>`');
    expect(prompt).toContain('Import and page-reference edges: `<the edge list from step 3>`');
    expect(skill).not.toContain('<{id, type, name, filePath} for every node in knowledge-graph.jsonl>');
  });

  it('tells the analyzer where the tags come from, what a references edge says, and to layer by the addenda', () => {
    expect(prompt).toContain('were written in Phase F2 by reading its source with the framework addenda injected into this prompt');
    expect(prompt).toContain('a tag names the role the addendum assigns from annotations, descriptor entries or page references');
    expect(prompt).toContain('A node without `tags` has no fresh semantics in this run.');
    expect(prompt).toContain('A `references` edge runs from a page to a class the page binds through an EL expression; each evidence `chain` names the members the page uses');
    expect(prompt).toContain('Assign layers by the layer table in the framework addenda');
    expect(prompt).toContain('use the node\'s tags and its page references, not its name or class-name suffix.');
    // the statements sit in the dispatch prompt, ahead of the output instruction
    expect(prompt.indexOf('Assign layers by the layer table')).toBeLessThan(prompt.indexOf('Write output to:'));
  });
});

describe('the javaee and jsf addenda (javaee-jsf-framework-knowledge, D8)', () => {
  const catalog = JSON.parse(readRepoFile('skills/excavator/catalogs/name-bindings.json'));
  const routeCatalog = JSON.parse(readRepoFile('skills/excavator/catalogs/routes.json'));
  const typeCatalog = JSON.parse(readRepoFile('skills/excavator/catalogs/type-injections.json'));
  const catalogIds = new Set([
    ...['xmlBinders', 'annotationBinders', 'xmlInjections', 'annotationInjections', 'expressionLanguages']
      .flatMap((key) => catalog[key].map((entry) => entry.id)),
    // the route families of routes.json (jaxrs-route-facts)
    ...routeCatalog.routeFamilies.map((family) => family.id),
    // the injection families of type-injections.json (by-type-injection)
    ...typeCatalog.injectionFamilies.map((family) => family.id),
  ]);
  const ADDENDA = {
    javaee: {
      // one rule per kind of relation an addendum infers; every one has an "exactly one / zero or several" pair. javaee.md has
      // three: the application prefix, the message destinations and the CDI events - injection by type is a fact, no rule (by-type-injection)
      rules: 3,
      edgeTypes: ['injects', 'references', 'routes', 'mentions', 'implements', 'calls'],
      roles: ['Session bean', 'Message-driven bean', 'JAX-RS resource', 'JAX-RS provider', 'Interceptor', 'Entity', 'Producer', 'Descriptor'],
    },
    jsf: {
      rules: 3,
      edgeTypes: ['references', 'mentions', 'implements', 'calls'],
      roles: ['Page', 'Template', 'Composite component', 'Backing bean', 'Converter', 'Validator', 'Descriptor'],
    },
  };

  for (const [id, expected] of Object.entries(ADDENDA)) {
    describe(`${id}.md`, () => {
      const raw = readRepoFile(`skills/excavator/frameworks/${id}.md`);
      const text = flat(raw);
      const section = (heading) => {
        const start = raw.indexOf(heading);
        expect(start, `${id}.md should contain ${heading}`).toBeGreaterThanOrEqual(0);
        const end = raw.indexOf('\n### ', start + heading.length);
        return raw.slice(start, end === -1 ? undefined : end);
      };

      it('has an "Already in the fact graph" section, before the edge patterns, that says not to redraw', () => {
        expect(raw).toContain('### Already in the fact graph');
        expect(raw.indexOf('### Already in the fact graph')).toBeLessThan(raw.indexOf('### Edge Patterns to Look For'));
        expect(flat(section('### Already in the fact graph'))).toContain('Do not redraw any of them');
      });

      it('lists only edge types and name-binding catalog entries that exist, and every deterministic one it should', () => {
        const rows = section('### Already in the fact graph').split('\n').filter((line) => line.startsWith('| `'));
        const listed = new Set();
        for (const row of rows) {
          const [, edges, , source] = row.split('|').map((cell) => cell.trim());
          for (const [, type] of edges.matchAll(/`([a-z]+)`/g)) {
            listed.add(type);
            expect(DETERMINISTIC_EDGE_TYPES, `${type} is not a deterministic edge type`).toContain(type);
          }
          for (const [, catalogId] of source.matchAll(/`([a-z0-9-]+)`/g)) {
            expect(catalogIds.has(catalogId), `${catalogId} is not an entry of name-bindings.json or a family of routes.json or type-injections.json`).toBe(true);
          }
        }
        for (const type of expected.edgeTypes) expect(listed.has(type), `${type} should be listed`).toBe(true);
      });

      it('phrases every inference rule as exactly one candidate connects, zero or several do not', () => {
        const exactlyOne = raw.match(/Exactly one/g) ?? [];
        const zeroOrSeveral = raw.match(/Zero or several/g) ?? [];
        expect(exactlyOne.length).toBe(expected.rules);
        expect(zeroOrSeveral.length).toBe(expected.rules);
        expect(text).toContain('Connect only when the set has exactly one member.');
        expect(text).toContain('For zero or several candidates, draw nothing and say so');
      });

      it('marks what it infers as inferred and without evidence', () => {
        expect(text).toContain('Every relation drawn from these conventions is `"provenance": "inferred"` with no `evidence`.');
        expect(text).toContain('Conventions are not evidence');
      });

      it('names every component role', () => {
        const roles = section('### Canonical File Roles');
        for (const role of expected.roles) expect(roles, `${role} should be a role`).toContain(role);
        expect(raw).toContain('### Architectural Layers for');
      });

      it('writes no line number', () => {
        expect(raw).not.toMatch(/:\d+/);
        expect(raw).not.toMatch(/\blines? \d+/i);
      });
    });
  }

  describe('javaee.md, the points its spec requires', () => {
    const text = flat(readRepoFile('skills/excavator/frameworks/javaee.md'));

    it('does not redraw by-name injection, EL references, descriptor mentions, implements and calls', () => {
      expect(text).toContain('`@EJB(beanName = "…")`');
      expect(text).toContain('`@Named`');
      for (const name of ['ejb-jar.xml', 'persistence.xml', 'web.xml', '`implements`', '`calls`']) expect(text).toContain(name);
    });

    it('lists the by-type injects edge and the declared implements edge as facts it does not redraw, with the type injection catalog as their source', () => {
      const facts = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Already in the fact graph')[1].split('### Canonical File Roles')[0]);
      expect(facts).toContain('| `injects` | The consumer class to the one class, or the one `@Produces` method, that can satisfy the type an injection point declares:');
      expect(facts).toContain('`@Inject` on a field, a setter or a constructor (one edge per parameter)');
      expect(facts).toContain('an `@EJB` that writes no `beanName` and no JNDI name on a field or a one-parameter setter (`@EJB(beanInterface = X.class)` restates the type)');
      expect(facts).toContain('It is drawn only when the repository has exactly one candidate');
      expect(facts).toContain('and that candidate is a class or a producer method, the two that have a node | Type injection catalog (`jsr330-inject`, `ejb-inject`) |');
      expect(facts).toContain('| `implements` | A session bean class to a business interface it declares by annotation: `@Local` or `@Remote` with a class literal as its value, on a class that does not already reach that interface through its Java supertypes.');
      expect(facts).toContain('| Type injection catalog (`businessInterfaces`) |');
      // the by-name row is still there, and named as the by-name one
      expect(facts).toContain('The consumer class to the class an injection names by name');
      // the sources are the catalog's own: its two families and its business interface section exist
      expect(typeCatalog.injectionFamilies.map((family) => family.id)).toEqual(['jsr330-inject', 'ejb-inject']);
      expect(typeCatalog.businessInterfaces.annotations).toEqual(expect.arrayContaining(['javax.ejb.Local', 'javax.ejb.Remote']));
    });

    it('leaves injection by type to the fact graph: an edge in the graph is not redrawn, a point in a type-injection- gap gets no guessed target, and no candidate set is left to the model', () => {
      const rule = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('**Injection by type**')[1].split('**JAX-RS application prefix**')[0]);
      expect(rule).toContain('the `injects` edge from the consumer to the one class or producer method that can satisfy the declared type is a fact');
      expect(rule).toContain('so is the `implements` edge of a business interface that a `@Local` or `@Remote` class literal declares');
      expect(rule).toContain('An edge that is already in the graph is not redrawn: no inferred `depends_on` edge for the same injection');
      expect(rule).toContain('A point in a `type-injection-` gap has no edge because a static read cannot settle its target');
      expect(rule).toContain('Do not guess the target.');
      expect(rule).toContain("Do not walk the declared type's `implements` and `inherits` edges to pick an implementation");
      expect(rule).toContain('do not take the one implementation you can see');
      expect(rule).toContain('do not use a qualifier, `@Alternative`, `@Specializes` or the alternatives enabled in `beans.xml` to choose');
      expect(rule).toContain('A semantic description may state the declared type of the point and say the target is decided by the deployment; it must not name a target.');
      expect(rule).toContain('A business interface in a `business-interface-unresolved` gap is treated the same way: draw no `implements` edge for it.');
      // the rule infers nothing: no pair of exactly one / zero or several, no inferred edge type
      expect(rule).not.toContain('Exactly one');
      expect(rule).not.toContain('Zero or several');
      expect(rule).not.toContain('connect with an `inferred`');
      // the old instructions, which built the candidate set in the prompt and connected to the one member, are gone
      for (const gone of [
        'Build the candidate set from the graph.',
        'follow its **incoming** `implements` and `inherits` edges transitively',
        'collect every non-abstract class you reach',
        'producer methods count as candidates',
        'with interface `A`, `B implements A` and `C extends B`, there are two candidates',
        'Exactly one candidate: connect with an `inferred` `depends_on` edge from the injecting class to it',
        'connect only if that candidate visibly carries the same qualifier annotation',
        'Never use them to pick one of several candidates',
        'A single implementation makes the wiring readable',
      ]) expect(text, gone).not.toContain(gone);
      // the intro of the rules says by-type injection is the exception
      expect(text).toContain('Injection by type is the exception: the fact build settles it, and it asks nothing of you but to leave its gaps alone.');
    });

    it('explains every type-injection- gap kind and the business interface gap, one line each, and names the prefixes among the gaps not to close by guessing', () => {
      const facts = readRepoFile('skills/excavator/frameworks/javaee.md').split('### Already in the fact graph')[1].split('### Canonical File Roles')[0];
      expect(flat(facts)).toContain('(kinds that start with `injection-`, `name-reference-`, `mention-`, `route-` or `type-injection-`, and `business-interface-unresolved`)');
      const kinds = [...new Set(Object.values(TYPE_INJECTION_GAP_KINDS)), BUSINESS_INTERFACE_GAP_KIND];
      expect(kinds).toHaveLength(6);
      for (const kind of kinds) {
        const lines = facts.split('\n').filter((line) => line.startsWith(`  - \`${kind}\`: `));
        expect(lines, `one line for ${kind}`).toHaveLength(1);
      }
      expect(facts).toContain('An injection point that the fact build could not settle by type gets no edge, and a business interface it could not read gets no `implements` edge.');
    });

    it('says in the languageLesson that the fact build turns one candidate into an edge and every other case into a type-injection- gap', () => {
      const lessons = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Notable Patterns to Capture in languageLesson')[1]);
      expect(lessons).toContain('The fact build turns the case a static read can settle, one candidate in the repository, into an `injects` edge.');
      expect(lessons).toContain('it records a `type-injection-` gap, because the deployment decides.');
    });

    it('puts a @Named class that pages bind by EL in layer:ui, as jsf.md does, and the other CDI beans in layer:service', () => {
      const roles = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Canonical File Roles')[1].split('### Edge Patterns')[0]);
      expect(roles).toContain('`@Named` or `@Model` classes that pages bind by EL (they have incoming `references` edges from view files)');
      expect(roles).toContain('Backing bean — the same role as in the JSF addendum, in `layer:ui`');
      expect(roles).toContain('Other `@ApplicationScoped`');
      const layers = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Architectural Layers for Java EE')[1].split('### Notable Patterns')[0]);
      expect(layers).toContain('| `layer:ui` | UI Layer | Backing beans: the `@Named` and `@Model` classes that view files bind by EL');
      expect(layers).toContain('the other CDI managed beans (those no page binds)');
    });

    it('keeps a session bean that pages bind by EL in layer:service, in both addenda', () => {
      const roles = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Canonical File Roles')[1].split('### Edge Patterns')[0]);
      expect(roles).toContain('(they have incoming `references` edges from view files) and that are not session beans | Backing bean');
      for (const id of ['javaee', 'jsf']) {
        expect(flat(readRepoFile(`skills/excavator/frameworks/${id}.md`))).toContain('stays a session bean in `layer:service` even when pages bind it by EL; only the other page-bound classes are backing beans.');
      }
      const layers = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Architectural Layers for Java EE')[1].split('### Notable Patterns')[0]);
      expect(layers).toContain('| `layer:service` | Service Layer | Session beans (also those pages bind by EL)');
    });

    it('lists the JAX-RS route as a fact it does not redraw: the endpoint node, the routes edge, the route catalog and the route- gaps', () => {
      const facts = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Already in the fact graph')[1].split('### Canonical File Roles')[0]);
      expect(facts).toContain('| `routes` | An `endpoint` node to the method that handles it.');
      expect(facts).toContain('named by the route relative to the application\'s root (`GET /orders/{id}`)');
      expect(facts).toContain('| Route catalog (`jaxrs`) |');
      expect(facts).toContain('(kinds that start with `injection-`, `name-reference-`, `mention-`, `route-` or `type-injection-`, and `business-interface-unresolved`)');
      for (const kind of ['route-verb-unresolved', 'route-root-unresolved', 'route-path-unresolved', 'route-handler-unresolved']) expect(facts).toContain(`\`${kind}\``);
      expect(facts).toContain('Private methods and `@RegisterRestClient` interfaces are counted and are no gap.');
    });

    it('leaves a JAX-RS route to the fact graph and adds only the application prefix, to a description, from exactly one @ApplicationPath of the deployment unit', () => {
      const rule = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('**JAX-RS application prefix**')[1].split('**Message-driven beans')[0]);
      expect(rule).toContain('names every endpoint by its route relative to the application\'s root');
      expect(rule).toContain('The endpoint and its `routes` edge are facts: create no route nodes, and no inferred edge for a route.');
      expect(rule).toContain('Exactly one `@ApplicationPath` class in the deployment unit of the handler method');
      expect(rule).toContain('`pom.xml`, `build.gradle`, `build.gradle.kts`, `build.xml` or `build.sbt`');
      expect(rule).toContain('write the full path, for example `GET /api/orders/{id}` for `@ApplicationPath("api")`');
      expect(rule).toContain('into the semantic description of the endpoint node or of the handler method');
      expect(rule).toContain('Zero or several `@ApplicationPath` classes in that unit: do not prefix. Write the route as the endpoint names it, and say the application prefix is unknown.');
      expect(rule).toContain('A method that has a `route-` gap has no route to prefix: do not write one for it.');
      // the old rule, which assembled the route from its parts, is gone
      const text = flat(readRepoFile('skills/excavator/frameworks/javaee.md'));
      expect(text).not.toContain('a route is assembled from four parts');
      expect(text).not.toContain("into the handler method's semantic description");
    });

    it('says in the languageLesson that an endpoint\'s name is its route below the application\'s root, and puts the endpoint nodes in the API layer', () => {
      const lessons = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Notable Patterns to Capture in languageLesson')[1]);
      expect(lessons).toContain("An endpoint's name is its route below the application's root:");
      expect(lessons).toContain('`GET /orders/{id}` is not the URL a client requests.');
      const layers = flat(readRepoFile('skills/excavator/frameworks/javaee.md').split('### Architectural Layers for Java EE')[1].split('### Notable Patterns')[0]);
      expect(layers).toContain('| `layer:api` | API Layer | JAX-RS resources, the `endpoint` nodes of their routes and their activator, servlets |');
    });

    it('pairs message-driven beans and CDI events only on the same destination literal or the same event type', () => {
      expect(text).toContain('both ends name the same destination literal');
      expect(text).toContain('both ends name the same event type');
    });
  });

  describe('spring.md and the JSR 330 Inject point (by-type-injection)', () => {
    const text = flat(readRepoFile('skills/excavator/frameworks/spring.md'));

    it('leaves a JSR 330 Inject point to the fact graph and its gaps, and keeps Autowired and constructor injection as the model\'s to infer', () => {
      expect(text).toContain('When a class injects a dependency via `@Autowired` or constructor injection, create `depends_on` edges from the consumer to the injected bean.');
      expect(text).toContain('A JSR 330 `@Inject` point (`javax.inject` or `jakarta.inject`) is not one of them: the fact graph already has an `injects` edge from the consumer to the one class or producer method that can satisfy the declared type, and a point it could not settle is a visible `type-injection-` gap.');
      expect(text).toContain('Draw no `depends_on` edge for an `@Inject` point, and do not guess the target of one in a gap.');
      expect(text).not.toContain('constructor injection, or `@Inject`');
    });
  });

  describe('jsf.md, the points its spec requires', () => {
    const text = flat(readRepoFile('skills/excavator/frameworks/jsf.md'));

    it('does not redraw page EL references, template and navigation mentions, or faces-config class mentions', () => {
      for (const name of ['`@ManagedBean`', '`@Named`', '`managed-bean`', '`template=`', '`ui:include`', '`ui:decorate`', '`to-view-id`', '`managed-bean-class`']) {
        expect(text).toContain(name);
      }
    });

    it('resolves an outcome only to exactly one page, from-outcome first, a relative outcome from the current directory', () => {
      expect(text).toContain('`from-outcome` comes before implicit navigation');
      expect(text).toContain('An outcome with no leading `/` is relative to the directory of the current view');
      expect(text).toContain('Exactly one page file in the repository matches');
      expect(text).toContain('Zero or several page files match');
      expect(text).toContain('a `detail.xhtml` in the current view\'s directory and another in the web root');
    });

    it('matches a navigation rule by an equal, absent, wildcard or prefix-pattern from-view-id, in faces-config.xml or elsewhere', () => {
      expect(text).toContain('`from-view-id` equals the current view, is `*`, is absent, or is a prefix pattern such as `/admin/*` that covers the current view');
      expect(text).toContain("Seam's `pages.xml` and `*.page.xml`");
      expect(text).toContain('A navigation case with no `from-outcome` (in Seam, a `rule` with no `if-outcome`) applies to every outcome, so it names this outcome too.');
      expect(text).toContain('A case (or a Seam `<navigation>`) with a `from-action` applies only to the outcome of that action expression: a literal `action="…"` matches no `from-action`, and when you cannot tell which action produced the outcome, the rule cannot be decided.');
    });

    it('does not fall back to implicit navigation past a rule it cannot decide', () => {
      expect(text).toContain('If any rule names this outcome but you cannot decide whether it applies to the current view');
      expect(text).toContain('a pattern you cannot evaluate, a condition, an EL expression in the rule');
      expect(text).toContain('do not fall back to implicit navigation. Draw nothing and say the outcome is unresolved.');
    });

    it('uses implicit navigation only when the project visibly targets JSF 2.0 or later', () => {
      expect(text).toContain('Implicit navigation exists only from JSF 2.0.');
      expect(text).toContain('Use it only when the web module that holds the current view visibly targets JSF 2.0 or later');
      expect(text).toContain('its `faces-config.xml` has a `version` of 2.0 or later, or its build file declares a JSF 2.x (or later) or Jakarta Faces API dependency');
      expect(text).toContain('Decide per web module, not for the whole repository.');
      expect(text).toContain('With JSF 1.x, or when no version is visible, do not use implicit navigation: draw nothing and say so.');
    });

    it('treats a @Named class as a backing bean only when view files bind it, in layer:ui as javaee.md says', () => {
      const raw = readRepoFile('skills/excavator/frameworks/jsf.md');
      const roles = flat(raw.split('### Canonical File Roles')[1].split('### Edge Patterns')[0]);
      expect(roles).toContain('`@Named` or `@Model` classes that pages bind by EL (they have incoming `references` edges from view files)');
      const layers = flat(raw.split('### Architectural Layers for JSF')[1].split('### Notable Patterns')[0]);
      expect(layers).toContain('a `@Named` or `@Model` class counts only when view files bind it — it has incoming `references` edges from them — and it is not a session bean');
      expect(layers).toContain('A `@Named` class that no view file binds is not a backing bean');
      expect(layers).toContain('which puts the other CDI beans in the service layer');
    });

    it('lets neither the Bean nor the Controller suffix decide a role on its own', () => {
      const roles = readRepoFile('skills/excavator/frameworks/jsf.md').split('### Canonical File Roles')[1].split('### Edge Patterns')[0];
      const backingRow = roles.split('\n').find((line) => line.includes('| Backing bean'));
      expect(backingRow).toBeDefined();
      expect(backingRow).not.toContain('*Controller.java');
      expect(backingRow).not.toContain('*Bean.java');
      expect(flat(roles)).toContain('so neither `*Bean.java` nor `*Controller.java` alone decides a role');
    });

    it('maps a composite component to resources/<library>/<tag>.xhtml', () => {
      expect(text).toContain('`resources/<library>/<tag>.xhtml`');
      expect(text).toContain('Exactly one such file in the repository');
    });

    it('treats the tags of component libraries as opaque, every named prefix included', () => {
      expect(text).toContain('Component library tags are opaque');
      for (const prefix of ['`h:`', '`f:`', '`ui:`', '`p:`', '`rich:`', '`a4j:`', '`ice:`', '`t:`', '`o:`']) expect(text).toContain(prefix);
      expect(text).toContain("Do not connect a page to a library's internals");
      expect(text).toContain('Only the EL in a tag\'s attributes carries meaning, and EL is already a fact.');
    });

    it('connects a converter or validator by id only when exactly one declaration uses the id', () => {
      expect(text).toContain('Exactly one declaration uses the id');
      expect(text).toContain('Zero or several declarations use the id');
    });
  });
});
