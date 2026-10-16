# Static view

`/excavator-view` writes the project's analysis into one self-contained HTML file, `.excavator/view.html`, and opens it in the default browser. The file holds both the page and the data. It opens from `file://` by double-click: no server, no network, no installed tools on the reader's machine.

The bake is a deterministic script. It makes no model calls, never builds or runs the analyzed project, and writes nothing but the output file. It needs `.excavator/knowledge-graph.jsonl` and `.excavator/source-manifest.json` (run `/excavator` first); coverage and gaps are records inside `knowledge-graph.jsonl`, not separate files. The optional artifacts, `fingerprints.json`, `source-index.jsonl`, `semantic-cache.json` (summaries), `semantic-graph.json` (architecture layers) and `domain-graph.json` (domain flows), are embedded when present; a missing one is listed with the command that produces it.

## Usage

```bash
/excavator-view                     # bake .excavator/view.html and open it
/excavator-view --no-source         # embed no source text, for sharing outside the team
/excavator-view path/to/project --out /tmp/view.html --no-open
```

| Flag | Effect |
|---|---|
| `--out <path>` | Write somewhere other than `.excavator/view.html`. |
| `--no-source` | Embed no source text: no evidence lines, no symbol excerpts, no comment or string-literal text from the source index. Search then covers identifiers only, and the page says so. |
| `--raw` | Store the data uncompressed, for browsers without `DecompressionStream`. About 4.7 times larger. |
| `--source-budget <MB>` | Budget for embedded source text (default 64). Over budget, symbol excerpts, then source-index literals, then evidence lines are dropped, each as a whole; the page and the terminal report list what was dropped. |
| `--no-open` | Print the path instead of opening the file. |

The terminal report gives the output path and size, which artifacts were embedded, missing or invalid, what was dropped, the freshness of the analysis, and the graph counts. A stale analysis still bakes; the page and the terminal both say it is stale, and re-running `/excavator` refreshes it.

## Prerequisites

The bake injects data into a prebuilt page template, `packages/view/dist/index.html`. `pnpm install --frozen-lockfile && pnpm -r build` in the plugin checkout produces it (the same build the MCP server needs, see [MCP setup](mcp.md)); if it is missing, the skill builds it on first use, which needs Node.js 22+ and pnpm.

## Sharing

The file is the whole thing: send it, attach it, put it on a shared drive, or commit it. Readers need only a browser.

By default it embeds source text verbatim (evidence lines, symbol excerpts, and comments and string literals from the source index). Before sending it outside the team, bake with `--no-source`. The structure, graph, layers, domain flows, gaps and identifier search remain.

## Browser requirements

- Chrome or Edge 80 or later
- Safari 16.4 or later
- Firefox 113 or later

The page decodes its data with `DecompressionStream` and runs decoding and search in Web Workers. For an older browser without `DecompressionStream`, bake with `--raw`.

## Size

The data is stored column-wise with interned strings, gzip-compressed and base64-encoded. Measured sizes:

| Project | Default | `--no-source` |
|---|---|---|
| Web application, about 2,100 files and 370,000 lines | 4–5 MB | about 1.5 MB |
| Apache Hadoop, about 3 million lines of Java | about 41 MB (symbol excerpts dropped by the default budget) | about 17 MB |

The page template itself accounts for about 0.53 MB of each file.

`--raw` multiplies these by about 4.7; on very large projects that can exceed the bake's hard limit of 256 MB of encoded data, which fails with a named `ViewTooLargeError` and leaves any existing file unchanged.

## Opening another analysis

The page can also read a `.excavator/` directory directly, without a new bake: click **Open directory** or drag the folder onto the page. The browser reads the files locally; nothing is uploaded. In this mode the page has no access to the project's source, so evidence lines and symbol excerpts are not shown and fact-layer freshness is reported as not checked.

## Security

The page carries a Content-Security-Policy that blocks every network request: no scripts, styles, fonts, images or connections from anywhere else. It reads only its own embedded data, or the directory a reader explicitly opens.

## Known limitations

- Very dense directories (hundreds of nodes and links in one level) still render as a crowded graph; drill into a file or a symbol neighbourhood for a readable picture. Each level draws at most 400 items and a bounded number of links, and reports what it left out.
- The full-text search index is built on the first search; on a project of Hadoop's size with source text embedded that takes a few seconds.
- Semantic products (architecture layers, domain graph) are marked fresh or stale by their content hashes only.
- Graphs that are not of a codebase (a `kind` of `knowledge` or `design`) render with the same views, but those views have not been validated against such graphs.
- The file is a snapshot. It does not follow later changes to the project; bake again after re-running `/excavator`.
