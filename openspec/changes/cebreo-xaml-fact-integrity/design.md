## Context

See `proposal.md` for the failure. The current reader scans physical lines with regexes and chooses one file-wide `x:DataType`; that cannot distinguish XML comments or nested element scopes. Its consumers already accept `StructuralAnalysis.sections` and `.definitions`, so this change needs no new output field or persisted schema.

## Goals / Non-Goals

**Goals:** Keep only source-visible live facts, retain original line anchors, and assign a binding's type context from its own element scope. Preserve deterministic ordering and the existing single-file output contract.

**Non-Goals:** XML schema validation, runtime `BindingContext` inference, Prism convention resolution, member existence checks, XAML-to-C# edges, or new HTML/XML/Gradle readers. A `context=` value is a lexical XAML hint, not proof of a C# member owner.

## Decisions

1. **Mask comments before extraction.** Replace characters inside `<!-- ... -->` with spaces while preserving newlines and string offsets. This includes inline and multi-line comments, and keeps the original line map. Ignore processing instructions, declarations, and CDATA as non-element content. Alternative—run the existing regexes then try to subtract commented matches—risks leaking a commented `x:DataType` into the context pre-pass.
2. **Use a minimal quote-aware XML-tag walk.** Recognize complete start/end/self-closing tags and their quoted attributes; keep a stack of open elements. Resolve a start tag's local `x:DataType` before evaluating any binding attribute, so attribute order is irrelevant. A local type replaces the inherited type, `{x:Null}` clears it, and closing a tag restores the parent. Alternative—a file-wide unique-type rule—is the bug; a new XML dependency is unnecessary for this bounded extraction.
3. **Classify only attributes of live start tags.** Continue emitting the same definition kinds and `lineRange` based on the attribute's original start line. A `{Binding}` attribute with `Source=` or `RelativeSource=` receives `context=none`, even inside a typed template; it retains the extracted path and line. The reader does not resolve `x:Reference` or infer the owner from its target name.
4. **Fail closed on untrustworthy context.** If a tag cannot be tokenized or nesting becomes ambiguous, do not assign a specific inherited type to subsequently anchored bindings. The acceptance fixtures use well-formed XAML; malformed-input behavior must not fabricate a type.

## Frozen Acceptance Oracle

The following synthetic cases are fixed before implementation. Test fixtures must use invented identifiers, not real-project source or paths.

| Case | Positive signal / known false | Required result |
|---|---|---|
| Instrument control | One live page type, binding, command, and named element | All live definitions and source lines are observed. |
| Comment fabrication | Inline and multi-line comments containing complete page markup, binding, command, name, and type | Zero comment-derived sections/definitions; live neighbors retain lines. |
| Comment contamination | Live `vm:Page` plus commented `vm:Ghost` | Live binding has `context=vm:Page`; no `vm:Ghost` datatype. |
| Scope before/within/after template | Root `vm:Page`, nested `vm:Row`, three distinct bindings | Context sequence `vm:Page`, `vm:Row`, `vm:Page`. |
| Template-only type | Untyped root plus typed template | Outer binding `none`, template binding `vm:Row`. |
| Explicit source | Typed template binding with `Source={x:Reference Root}` or `RelativeSource=...` | Binding path/line retained; `context=none`, no member edge. |
| Consumer projection | Synthetic commented binding plus live binding passed through extraction and fact-graph projection | Live concept present, commented concept absent; no false node even if coverage reports zero gaps. |
| Repeatability | Same input twice | Byte-identical sections and definitions. |

First show the instrument sees a deliberately live fixture and the current parser fails at least one known-false fixture (red); only then fix and re-run the same oracle (green). For local read-only real-project checks, compare representative comment and nested-template cases plus one ordinary typed page. Record fabricated facts and omitted facts separately; do not commit real-project code, paths, or generated output.

## Risks / Trade-offs

- [A lightweight scanner misses valid but unusual XAML syntax] → Keep tests for multi-line start tags, quoted `>` and self-closing elements; emit `context=none` rather than a guessed type when parsing is ambiguous.
- [Removing false facts changes retrieval results] → Assert the downstream projection loses only comment-derived nodes and still contains live bindings; treat this as a correctness fix, not compatibility behavior.
- [Lexical `x:DataType` is mistaken for runtime `BindingContext`] → Explicit-source bindings clear context, and the reader still emits no member-level edge.

## Migration Plan

No data migration. Re-run extraction to replace old XAML-derived artifacts after deployment. Keep the parser change and focused tests as one revertable code step; revert that step if the frozen oracle or broader test suite fails.
