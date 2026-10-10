// java-member-call-resolution, tasks 4.1–4.2: Java type hierarchy edges in
// the fact graph, and traversal from a call to an interface method through to
// its implementation. Real tree-sitter extraction end to end.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { boundedShortestPath } from '../../skills/excavator/retrieve.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

function graphOf(files) {
  const rows = Object.entries(files).map(([path, lines]) => {
    const source = [...lines, ''].join('\n');
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, source);
    expect(extracted.structureOutcome).toBe('succeeded');
    return buildResult(file, lines.length, lines.length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  });
  const scan = {
    files: rows.map((r) => ({ path: r.path, language: 'java', fileCategory: 'code', sizeLines: r.totalLines })),
    skipped: [],
    coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
  };
  const importMap = { importMap: Object.fromEntries(rows.map((r) => [r.path, []])), unresolved: {} };
  return buildFactGraph({ scan, structureAll: { results: rows }, importMap });
}

/** Hierarchy edges as `Source -type-> Target @file:line`, nodes named `Owner#name` or `Class`. */
function hierarchy(graph) {
  const name = new Map(graph.nodes.map((n) => [n.id, n.owner ? `${n.owner}#${n.name}` : n.name]));
  return graph.edges
    .filter((e) => e.type === 'inherits' || e.type === 'implements')
    .map((e) => {
      expect(e.provenance).toBe('extracted');
      expect(e.evidence).toHaveLength(1);
      return `${name.get(e.source)} -${e.type}-> ${name.get(e.target)} @${e.evidence[0].file.split('/').pop()}:${e.evidence[0].line}`;
    })
    .sort();
}

const P = 'src/main/java/p';

const PAYMENTS = {
  [`${P}/PaymentService.java`]: [
    'package p;',
    'public interface PaymentService {',
    '  void pay(long amount);',
    '  default void refund(long amount) {}',
    '}',
  ],
  [`${P}/PaymentServiceImpl.java`]: [
    'package p;',
    'public class PaymentServiceImpl implements PaymentService {',
    '  public void pay(long amount) {}',
    '  public void pay(String amount) {}',
    '}',
  ],
  [`${P}/Checkout.java`]: [
    'package p;',
    'public class Checkout {',
    '  private PaymentService payments;',
    '  void complete() { payments.pay(1L); }',
    '}',
  ],
};

describe('Java type hierarchy edges', () => {
  it('a class implementing an interface: a class edge and a method edge', () => {
    expect(hierarchy(graphOf(PAYMENTS))).toEqual([
      'PaymentServiceImpl -implements-> PaymentService @PaymentServiceImpl.java:2',
      'PaymentServiceImpl#pay -implements-> PaymentService#pay @PaymentServiceImpl.java:3',
    ]);
  });

  it('inherits for class to class and interface to interface; abstract methods of every repository ancestor', () => {
    const graph = graphOf({
      [`${P}/Named.java`]: ['package p;', 'public interface Named { String label(); }'],
      [`${P}/Titled.java`]: ['package p;', 'public interface Titled extends Named { String title(int width); }'],
      [`${P}/Base.java`]: [
        'package p;',
        'public abstract class Base implements Titled {',
        '  protected abstract void hook(java.util.List<String> items);',
        '  public String label() { return ""; }',
        '}',
      ],
      [`${P}/Child.java`]: [
        'package p;',
        'import java.util.List;',
        'public class Child extends Base {',
        '  protected void hook(List<String> items) {}',
        '  public String title(int width) { return ""; }',
        '  public String title(long width) { return ""; }',
        '}',
      ],
      [`${P}/Kind.java`]: [
        'package p;',
        'public enum Kind implements Named {',
        '  A;',
        '  public String label() { return name(); }',
        '}',
      ],
    });
    expect(hierarchy(graph)).toEqual([
      'Base -implements-> Titled @Base.java:2',
      'Base#label -implements-> Named#label @Base.java:4',
      'Child -inherits-> Base @Child.java:3',
      'Child#hook -implements-> Base#hook @Child.java:4',
      'Child#title -implements-> Titled#title @Child.java:5',
      'Kind -implements-> Named @Kind.java:2',
      'Kind#label -implements-> Named#label @Kind.java:4',
      'Titled -inherits-> Named @Titled.java:2',
    ]);
  });

  it('no edge to a supertype outside the repository', () => {
    const graph = graphOf({
      [`${P}/Loan.java`]: ['package p;', 'public class Loan {}'],
      [`${P}/LoanRepository.java`]: [
        'package p;',
        'import org.springframework.data.jpa.repository.JpaRepository;',
        'public interface LoanRepository extends JpaRepository<Loan, Long> {',
        '  Loan findByCode(String code);',
        '}',
      ],
      [`${P}/Job.java`]: [
        'package p;',
        'public class Job extends Thread implements Runnable {',
        '  public void run() {}',
        '}',
      ],
    });
    expect(hierarchy(graph)).toEqual([]);
  });

  it('no method edge when a parameter type cannot be named for certain', () => {
    const graph = graphOf({
      [`${P}/Loan.java`]: ['package p;', 'public class Loan {}'],
      [`${P}/Repo.java`]: ['package p;', 'public interface Repo<T> { void save(T item); }'],
      [`${P}/LoanRepo.java`]: [
        'package p;',
        'public class LoanRepo implements Repo<Loan> {',
        '  public void save(Loan item) {}',
        '}',
      ],
    });
    expect(hierarchy(graph)).toEqual(['LoanRepo -implements-> Repo @LoanRepo.java:2']);
  });
});

describe('traversal over hierarchy edges', () => {
  it('reaches the implementation from a call to the interface method, through calls and implements', () => {
    const graph = graphOf(PAYMENTS);
    const id = (owner, name) => graph.nodes.find((n) => n.owner === owner && n.name === name).id;
    const caller = id('Checkout', 'complete');
    const implementation = graph.nodes.find((n) => n.owner === 'PaymentServiceImpl' && n.name === 'pay'
      && graph.edges.some((e) => e.type === 'implements' && e.source === n.id)).id;
    const { path, edges } = boundedShortestPath(graph.edges, [caller], [implementation]);
    expect(path).toEqual([caller, id('PaymentService', 'pay'), implementation]);
    expect(edges.map((e) => e.type)).toEqual(['calls', 'implements']);
  });
});
