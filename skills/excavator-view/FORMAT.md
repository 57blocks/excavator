# excavator-view-bundle/1

The data format embedded in a baked `view.html`. `bundle-codec.mjs` is the only implementation: the bake script encodes with it and decodes its own output before writing; the page template imports the same file and decodes with it in the browser.

## Placement

The payload is the text content of the page's single data element:

```html
<script type="text/plain" id="excavator-view-data">
...payload lines...
</script>
```

The unbaked template carries this element empty. A payload line contains only base64 characters, spaces, `@`, `,`, `.`, `_` and `-`, so it can never close the element.

## Lines

```
excavator-view-bundle/1
@<name> json <rawBytes> <storedBytes> <gzip|raw>
<base64 payload>
@<name> i32 <rawBytes> <storedBytes> <gzip|raw> <rows> <col>,<col>,...
<base64 payload>
...
```

- Line 1 is the format identifier. A decoder that does not know it fails with `BundleFormatError`; it never guesses.
- Then one header line and one payload line per segment, in the order the encoder received them. Blank lines before the first line and after the last are ignored; a payload line may itself be empty (an empty raw segment).
- `rawBytes` is the segment's byte length before compression, `storedBytes` after it (equal for `raw`). The decoder checks both.
- `gzip`: the payload is gzip, then base64. `raw`: base64 of the raw bytes (the bake's `--raw`, for browsers without `DecompressionStream`; decoding compressed data without it fails with `BundleDecodeError`).
- Segment names match `[a-z][a-zA-Z0-9.]*`; column names match `[a-z][a-zA-Z0-9]*`; a name appears once.

## Segment kinds

- `json`: UTF-8 JSON text.
- `i32`: a table of Int32 columns, little-endian, column-major: all `rows` values of the first column, then the second, and so on, so `rawBytes = rows * columns * 4`.

## Cells

Every string-valued column holds a cell:

| Cell | Meaning |
|---|---|
| `>= 0` | index into the `strings` segment |
| `-1` | absent (the field was not present) |
| `-2` | `null` |
| `<= -3` | a non-string JSON value: index `-3 - cell` into the `values` segment |

Integer columns (`line0`, `line1`, `line`, `endLine`, `totalLines`, `docLength`) hold the number, or `-1` when absent. An offset/count pair indexes a flat table; a count of `-1` means "not embedded" and is distinct from an empty list (`0`).

## Segments written by the bake

Always present:

| Segment | Kind | Content |
|---|---|---|
| `meta` | json | `format`, `bakedAt`; `graph` (the knowledge-graph header's `keys`, `fields`, `counts`); `counts` (records actually streamed, plus `evidence`); `inventory` (each artifact: `present` / `missing` with the command that generates it / `invalid` with the reason); `embeds` and `dropped` (source segments and why one was dropped: `no-source` or `budget`); `freshness` (`factLayer` from the shared consumer-freshness helper, and summaries for the semantic cache, semantic graph and domain graph); `source` (manifest `sourceRevision`, `selectionDigest`, `pipelineVersion`, source-embedding statistics including files not embedded because their content no longer matches the manifest); `selection` (the manifest's selection funnel with only non-selected entries); `members` (multi-repo targets: first path segment of the selected files, with file counts); `index` (source-index header values, and whether comment/string-literal text is `embedded` or `omitted`); `unembedded` (per record kind, keys the columns do not carry, with counts); `anomalies` (values a column could not represent, with counts) |
| `strings` | json | the global string table |
| `values` | json | distinct non-string JSON values referenced by cells (for example edge weights) |
| `nodes` | i32 | `id`, `type`, `name`, `path`, `line0`, `line1`, `owner`, `complexity`, `anchorSource`, `summary`, `tagOffset`, `tagCount`; in graph order |
| `nodeTags` | i32 | `tag`; the flat tag list `tagOffset`/`tagCount` index |
| `edges` | i32 | `src`, `dst` (node id cells), `type`, `direction`, `weight`, `provenance`, `evCount`, `evOffset`; in graph order |
| `evidence` | i32 | `file`, `line`, `endLine`, `source`, `token`, `context`, `resolution`; contiguous per edge, `evOffset` is the first row |
| `coverage` | json | the graph's coverage record, verbatim (`null` when the graph has none) |
| `gaps` | json | the graph's gap records, verbatim, in order |
| `files` | i32 | `path`, `totalLines`, `contentHash`; one row per manifest entry; `totalLines` is `-1` when `fingerprints.json` is missing or has no count for the file |

Present only when their source exists:

| Segment | Kind | Content |
|---|---|---|
| `graphLayers` | json | the graph's own `layer` records (Full graphs) |
| `tour` | json | the graph's `tour` records, when not empty |
| `index.chunks` | i32 | `node`, `language`, `docLength`, `idOffset`, `idCount`, `commentOffset`, `commentCount`, `stringOffset`, `stringCount`; one row per source-index chunk, in file order (a posting's chunk ordinal is the row) |
| `index.tokens` | i32 | `token`; the flat list the chunk offset/count pairs index |
| `index.terms` | i32 | `term`, `offset`, `count`; one row per posting term, in file order |
| `index.postings` | i32 | `chunk`; the flat chunk-ordinal list the term rows index (term frequencies are not embedded) |
| `semantic` | json | `version`, `contentLanguage`, `entries[]` of `{ nodeId, summary, tags, model, generatedAt, verification, freshness, inGraph }`, where `freshness` is the semantic cache's own verdict (`fresh` / `stale` / `missing` / `noncanonical-language`) against the manifest's per-file `contentHash` |
| `layers` | json | from `semantic-graph.json`: `factDigest`, `headerFactsDigest`, `freshness` (`fresh` when it equals the graph header's `factsDigest`), `contentLanguage`, `layers`, `relations`, `gaps` |
| `domain` | json | `freshness` and `reason` from the domain graph's own usability check against the manifest's `sourceRevision` and the header's `factsDigest`, and the domain `graph` verbatim |
| `evidenceText.strings` | json | the distinct evidence-line texts |
| `evidenceText` | i32 | `text`: per evidence row, an index into `evidenceText.strings`, or `-1` |
| `excerpts.strings` | json | the distinct node source excerpts (the node's `lineRange`, lines joined by `\n`) |
| `excerpts` | i32 | `text`: per node row, an index into `excerpts.strings`, or `-1` |

`evidenceText*` and `excerpts*` are the only segments that grow with source size. They are absent under `--no-source`; over the source budget the bake drops `excerpts*` first, then `evidenceText*`, always whole, and records it in `meta.dropped` and `meta.embeds`. Source text comes only from files whose content matches the manifest.

## Versioning

Any change a version-1 decoder would misread (a new cell meaning, a column reinterpreted, a different layout) changes the identifier to `excavator-view-bundle/2`. Adding a segment or a column does not: decoders look segments and columns up by name.

## Dev fixture

`packages/view/fixtures/sample.bundle.txt` is the payload of a bake of the synthetic project in `tests/view/fixtures/sample-project`, for the page's development server. It holds no real project content.
