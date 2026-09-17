## Why

The XAML reader currently treats bindings inside XML comments as live facts and applies one file-wide `x:DataType` to unrelated bindings. A real-project check exposed both behaviors. Comment-derived facts violate the zero-fabrication gate; incorrect type context can mislead source retrieval. These are deterministic reader errors, so a skill or prompt cannot reliably repair the stored facts after extraction.

## What Changes

- Ignore XML comments when identifying the view and extracting `x:Class`, `x:DataType`, `x:Name`, bindings, and commands; preserve original source line anchors.
- Replace file-wide `x:DataType` assignment with lexical element-scope inheritance. A nested template type must not change an outer binding's context.
- Treat bindings with an explicit alternate `Source` or `RelativeSource` as unresolved type context. Do not infer a ViewModel member or cross-file edge.
- Add positive and known-false acceptance fixtures, plus a read-only real-project regression check. Report fabricated facts and omitted facts separately.
- Update the XAML reader contract and its tests without adding a general XAML-to-C# resolver or readers for unrelated file types.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `xaml-extraction`: Live-markup-only extraction and binding context scoped to the binding's element, with explicit-source uncertainty retained.

## Impact

- `packages/core/src/plugins/parsers/xaml-parser.ts` and focused parser tests.
- The existing `StructuralAnalysis` output shape and line-number contract remain unchanged; some previously emitted false definitions disappear, and `context=` becomes more precise.
- No new runtime dependency, persisted schema, cross-file edge, or global file-type reader is planned.
