---
name: excavator-view
description: Write a static, self-contained HTML view of a project's Excavator analysis that opens in any browser from file://, with no server, no network and no installed tools.
argument-hint: "[project-path] [--out <path>] [--no-source] [--raw] [--source-budget <MB>]"
---

# /excavator-view

Writes `.excavator/view.html`: one HTML file holding the page and the analysis data, which anyone can open by double-clicking. The data travels in the `excavator-view-bundle/1` format described in `FORMAT.md` next to this file; `bundle-codec.mjs` is its single encoder and decoder, shared with the page template in `packages/view`.

The bake never calls a model, never builds or runs the analyzed project, never starts a server or binds a port, and writes nothing but the output file.

## Run the bake

The page template must be built first (`pnpm --filter @excavator/view build` produces `packages/view/dist/index.html`). Then:

```bash
node "$PLUGIN_ROOT/skills/excavator-view/build-view.mjs" "$PROJECT_ROOT" [flags]
```

Flags:

- `--out <path>`: write somewhere other than `$PROJECT_ROOT/.excavator/view.html`.
- `--no-source`: embed no source text (no evidence lines, no excerpts, no comment or string-literal text from the source index). Use it before sending the file outside the team.
- `--raw`: store the data uncompressed, for browsers without `DecompressionStream`.
- `--source-budget <MB>`: budget for embedded source text (default 64). Over budget, the excerpts are dropped first, then the evidence lines, each as a whole.
- `--template <path>`: use another page template.

On success the script prints one JSON line: the output `path`, its `bytes`, the artifact `inventory` (present, missing with the command that generates it, or invalid with the reason), what was `dropped` and why, `freshness` (the fact layer via the shared freshness helper, plus per-item freshness of semantic products), and the header, streamed and decoded `counts`. A stale fact layer still bakes; tell the user to run `/excavator` to refresh. Failures are named (`MissingArtifactError`, `KnowledgeGraphFormatError`, `ViewTooLargeError`, `ViewTemplateError`, `ViewSelfCheckError`) and leave any existing `view.html` byte-identical.
