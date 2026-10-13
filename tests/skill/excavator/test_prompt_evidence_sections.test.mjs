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

describe('the javaee and jsf addenda (javaee-jsf-framework-knowledge, D8)', () => {
  const catalog = JSON.parse(readRepoFile('skills/excavator/catalogs/name-bindings.json'));
  const catalogIds = new Set(
    ['xmlBinders', 'annotationBinders', 'xmlInjections', 'annotationInjections', 'expressionLanguages']
      .flatMap((key) => catalog[key].map((entry) => entry.id)),
  );
  const ADDENDA = {
    javaee: {
      // one rule per kind of relation an addendum infers; every one has an "exactly one / zero or several" pair
      rules: 4,
      edgeTypes: ['injects', 'references', 'mentions', 'implements', 'calls'],
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
          for (const [, catalogId] of source.matchAll(/`([a-z-]+)`/g)) {
            expect(catalogIds.has(catalogId), `${catalogId} is not an entry of name-bindings.json`).toBe(true);
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

    it('infers an injection by type only from exactly one non-abstract implementation, producers counted, and never guesses qualifiers', () => {
      expect(text).toContain('producer methods count as candidates');
      expect(text).toContain('Qualifiers, `@Alternative`');
      expect(text).toContain('decided at deployment');
      expect(text).toContain('Never use them to pick one of several candidates');
    });

    it('counts the candidates of an injection by type through the incoming implements and inherits edges, transitively', () => {
      // the edges point from the subtype to the type: the walk goes against them
      expect(text).toContain('an `implements` or `inherits` edge points from the subtype to the type');
      expect(text).toContain('follow its incoming `implements` and `inherits` edges transitively');
      expect(text).toContain('collect every non-abstract class you reach');
      expect(text).toContain('The implementation of a sub-interface counts, and so does a subclass of an implementation.');
      expect(text).toContain('The declared type itself counts when it is a concrete class.');
      expect(text).toContain('with interface `A`, `B implements A` and `C extends B`, there are two candidates (`B` and `C`): draw no edge');
      expect(text).toContain('whose type is the declared type or one of those subtypes');
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

    it('assembles a JAX-RS route from its four parts into the method description and makes no route node', () => {
      for (const part of ['`@ApplicationPath` value', 'class-level `@Path`', 'method-level `@Path`', 'HTTP method annotation']) expect(text).toContain(part);
      expect(text).toContain("into the handler method's semantic description");
      expect(text).toContain('Create no route nodes');
    });

    it('pairs message-driven beans and CDI events only on the same destination literal or the same event type', () => {
      expect(text).toContain('both ends name the same destination literal');
      expect(text).toContain('both ends name the same event type');
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
