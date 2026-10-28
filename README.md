<h1 align="center">Excavator</h1>

<p align="center">
  <strong>Investigate codebases with deterministic facts, source evidence, and AI-guided explanations.</strong>
  <br />
  <em>Works with Claude Code and Codex.</em>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue" alt="Quick Start" /></a>
  <a href="https://github.com/57blocks/excavator/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
</p>

---

**You just joined a new team. The codebase is 200,000 lines of code. Where do you even start?**

Excavator is a code investigation plugin for [Claude Code](https://code.claude.com/docs/en/plugins) and a set of Skills for Codex. It extracts structural facts from supported source files, records coverage and gaps, and helps the host AI answer questions with source evidence. Separate skills analyze Karpathy-pattern wikis, map documents to code, and recover product documentation.

> **The goal isn't a graph that wows you with how complex your codebase is — it's a graph that quietly teaches you how every piece fits together.**

---

## ✨ Features

### Query the structural graph

Ask about files, functions, classes, dependencies, and request flows. The host AI combines graph facts with source evidence; node summaries are generated and cached when needed. Missing or unresolved evidence remains visible as gaps.

### Understand business logic

Extract how code maps to real business processes — domains, flows, and steps — and query those relationships from the terminal.

### Analyze knowledge bases

Point `/excavator:excavator-knowledge` at a [Karpathy-pattern LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The deterministic parser extracts wikilinks and categories from `index.md`, then LLM agents discover implicit relationships, extract entities, and surface claims.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>💬 Terminal Q&amp;A</h3>
      <p>Ask architecture and business-flow questions without starting a browser or local web server.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Hybrid Retrieval</h3>
      <p>Combine exact identifier matches, BM25, source search, and fresh cached summaries. The host AI chooses search terms and checks the evidence behind its answer.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Diff Impact Analysis</h3>
      <p>See which parts of the system your changes affect before you commit. Understand ripple effects across the codebase.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🧾 Evidence Tracking</h3>
      <p>Trace graph statements back to source files and validation results.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Architecture Layers</h3>
      <p>Full mode can generate architectural layers and cross-node relationships on top of the fact graph. Scoped Full runs skip the whole-project architecture pass.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Coverage &amp; Gaps</h3>
      <p>Inspect selected, skipped, unsupported, and unresolved inputs alongside the facts, rather than assuming complete analysis.</p>
    </td>
  </tr>
</table>

---

## 🚀 Quick Start

### 1. Prepare and load the plugin

Follow [Installation](#-installation) to download the public repository, install dependencies, build the plugin, and load it in Claude Code or Codex. The current `install.sh` only links a local copy into Codex; it is not a download-and-install bootstrap script.

The command examples below use Claude Code's plugin namespace. In Codex, use the skill's name with `$` instead: `/excavator:excavator-chat` becomes `$excavator-chat`.

### 2. Analyze your codebase

In a session opened at your target project, run:

```text
/excavator:excavator
```

The default mode is **Lazy** unless `.excavator/config.json` stores another `analysisMode`. A deterministic driver scans the selected snapshot, extracts supported structural facts, validates them, and saves `.excavator/knowledge-graph.jsonl` (one JSON record per line), a source manifest, and a retrieval index. Coverage and gaps describe what was included, skipped, or unresolved; the graph is not a guarantee that every symbol or dependency was resolved.

Then ask questions:

```text
/excavator:excavator-chat How does the request flow work?
```

**Source baseline:** when the analysis target is a Git repository root, facts describe committed `HEAD`, not staged, unstaged, or untracked changes. A plain directory target, including a non-root subdirectory inside a repository, uses current directory contents and content-based revisions; a parent containing member repositories uses a multi-repo snapshot. Each Git worktree keeps its own `.excavator/` cache; removing the worktree removes that cache.

**Model usage:** the Lazy fact-building driver makes no model or subagent calls. The host AI still interprets the skill and your questions, and may review ignore rules before the driver runs, so this is not a promise of zero tokens for the whole interaction. Questions that need semantics can generate and cache node-local English summaries. `/excavator:excavator --mode=full` pre-generates missing or stale summaries and architecture; `--full` also forces the rebuild path. See [Lazy Mode](docs/lazy-mode.md).

Excavator runs through the host and local scripts, without a persistent web application server. `/excavator:excavator-view`, `/excavator:excavator-prd-report`, and `/excavator:skopo-report` can write standalone HTML pages.

For seven bounded local MCP tools, see [MCP setup](docs/mcp.md). Installing Skills alone does not register MCP in Codex; the server also needs dependencies and the core build in its own plugin directory.

**Language behavior (code analysis):** Persisted model-generated semantics use English. Source-owned identifiers, paths, and literal excerpts remain unchanged. Chat answers follow the language of each question unless you request another answer language. Report and Figma skills have their own language options.

### 3. Ask and analyze

```bash
# Ask anything about the codebase
/excavator:excavator-chat How does the payment flow work?

# Analyze impact of your current changes
/excavator:excavator-diff

# Deep-dive into a specific file or function
/excavator:excavator-explain src/auth/login.ts

# Generate an onboarding guide for new team members
/excavator:excavator-onboard

# Extract business domain knowledge (domains, flows, steps)
/excavator:excavator-domain

# Analyze a Karpathy-pattern LLM wiki knowledge base
/excavator:excavator-knowledge ~/path/to/wiki

# Generate one As-Is PRD document for the project, or for one area with --scope (default audience: product manager)
/excavator:excavator-prd

# Generate PRD chapters, checked findings with P0/P1/P2 priorities, and a standalone HTML report
# Default: .excavator/prd-report/; --out changes it; --concurrency defaults to 3
# Reruns resume unfinished features at the same source revision
/excavator:excavator-prd-report

# Verify an As-Is document (e.g. a PRD) against the code; --fix corrects it in place
/excavator:excavator-verify docs/PRD.md

# Find the methods and functions nothing uses, each with a confidence (never edits code)
/excavator:excavator-unused-code

# Rank the files and directories that change most, from Git history (no advice, never edits code)
/excavator:excavator-hotspots

# Pack the products in .excavator/ into one HTML file, .excavator/explorer.html, and open it in the browser: no server, no network, nothing to install to open it
# (the page is built by `pnpm build` from packages/explorer; --no-source leaves the source text out of the file, --out <path> writes it elsewhere)
/excavator:excavator-view

# List the functions a folder of documents describes, each tied to a checked quote and to the code that does it,
# and count the project's files with and without a function's evidence, by directory
/excavator:excavator-doc-map ~/path/to/docs

# Write a 5-15 step learning tour of the project to .excavator/tour.json for the viewer: steps chosen from computed candidates,
# every sentence checked by a subagent against the code it cites, contradicted sentences removed and recorded (no advice)
/excavator:excavator-tour

# Analyze a Figma file (requires FIGMA_TOKEN; calls the Figma REST API)
/excavator:excavator-figma <figma-file-url-or-key>

# Plan, write, and report a Skopo intent-documentation recovery
/excavator:skopo-plan
/excavator:skopo-create
/excavator:skopo-report

# Refresh the selected snapshot; fresh node semantics can be reused
/excavator:excavator

# Enable Claude Code hook prompts that propose updates after commits (requires consent)
/excavator:excavator --auto-update

# Analyze a non-root subdirectory's current directory contents
/excavator:excavator src/frontend

# From the repository root: whole-project HEAD facts, semantics scoped to one area
/excavator:excavator --full --scope src/frontend
```

---

## 🌐 Installation

Excavator supports Claude Code (native plugin) and Codex (Skills). The shell examples assume Bash or a compatible shell.

### Prepare a local copy

Requirements: Git, Node.js **22+**, and **pnpm 10.6.2** (the version pinned in `package.json`). Python 3 is also needed by Python-backed skills such as wiki analysis and document mapping. Some skill commands use `python`; ensure it resolves to Python 3 when running those commands.

Obtain the complete project, then install and build the plugin itself:

```bash
git clone https://github.com/57blocks/excavator.git ~/.excavator-plugin
cd ~/.excavator-plugin
pnpm install --frozen-lockfile
pnpm -r build
```

A complete source ZIP downloaded from the public repository and unpacked into the same location also works; keep that directory for future runs. These commands prepare Excavator, not the project you want to analyze.

### Claude Code (Native)

Load the prepared local plugin from the **target project** directory:

```bash
cd /path/to/target-project
claude --plugin-dir "$HOME/.excavator-plugin"
```

In that session, invoke `/excavator:excavator` and `/excavator:excavator-chat`. The flag loads the plugin for that session; repeat it when starting another session.

Alternatively, install through the marketplace:

```text
/plugin marketplace add 57blocks/excavator
/plugin install excavator@excavator
```

A marketplace install has its own plugin copy. Its Node dependencies and builds must be prepared in that installed directory before its MCP server can start; building a separate local checkout does not prepare the marketplace copy. The current marketplace metadata does not bootstrap those dependencies. See [MCP setup](docs/mcp.md).

### Codex

After preparing the local copy, run:

```bash
~/.excavator-plugin/install.sh
```

This symlinks each skill into `~/.agents/skills/` and makes the local plugin available at `~/.excavator-plugin`. If you unpacked or cloned elsewhere, run that copy's `install.sh`; it links back to that directory. Keep the directory in place and restart Codex.

Invoke `$excavator` or `$excavator-chat`. If the prefix is not recognized, ask in plain language: *"Use the excavator skill to analyze this project."*

The installer does not download the repository, install dependencies, build packages, register MCP, or install Claude Code hooks into Codex. Configure optional MCP separately using [MCP setup](docs/mcp.md). Running the script alone through `curl | bash` is not supported.

Uninstall: `~/.excavator-plugin/install.sh --uninstall` removes the skill and plugin-root symlinks. For a Git checkout, update and rebuild with:

```bash
git -C ~/.excavator-plugin pull
cd ~/.excavator-plugin
pnpm install --frozen-lockfile
pnpm -r build
```

---

## 📦 Share the Graph with Your Team

Share an explicit set of products for a known source revision. A teammate can use matching facts without repeating the initial analysis; after the source or selection rules change, refresh the products.

Start with `knowledge-graph.jsonl` and `source-manifest.json`. Add `semantic-cache.json`, `semantic-graph.json`, or `source-index.jsonl` only when needed and after reviewing their contents. Products include source paths and excerpts; report pages and the viewer may embed source text. Do not commit the entire `.excavator/` directory or its scratch, temporary, or trash directories by default. This repository ignores `.excavator/`; if your target project does too, deliberately allow or force-add only the reviewed files.

**Keep it fresh:** rerun `/excavator:excavator` after source changes. With `--auto-update` enabled, Claude Code's plugin hooks can propose an update after Git commands run through its Bash tool, or when a session starts with stale data. They wait for your decision before analysis; they are not a Git `post-commit` hook and do not guarantee a refreshed graph in every commit. The Codex installer does not register these hooks.

**Large graphs:** if your team uses Git LFS, include the graph's actual `.jsonl` extension:

```bash
git lfs install
git lfs track ".excavator/*.jsonl"
git add .gitattributes
```

Then add only the reviewed artifacts under your project's ignore policy.

## 🔧 Under the Hood

### Deterministic facts + host-owned semantics

- **Facts:** scripts scan the selected source snapshot, use Tree-sitter and deterministic extractors to build file/symbol nodes and supported relationships, and record coverage and gaps. Analysis does not build the target project or install its dependencies.
- **Semantics:** the host AI reads facts and source to generate node-local summaries/tags in `semantic-cache.json`. Full mode can also generate layers and cross-node relations in `semantic-graph.json`. These semantic products do not replace the structural fact graph.
- **Retrieval:** the host supplies explicit terms and chooses bounded graph traversal, combines identifier/BM25/source/cache candidates, and checks source evidence before answering. Unresolved relationships remain gaps rather than invented edges.

### When agents run

Lazy fact building uses deterministic scripts without analyzer subagents. Full semantic generation dispatches file-analyzer and summary-verifier agents for missing or stale node semantics, and an architecture-analyzer for whole-project layers. Other skills dispatch agents for their own tasks, such as domain analysis, wiki enrichment, PRD chapters, and verification. `--review` requests the LLM graph reviewer on the applicable Full review path.

### Refresh and reuse

A Lazy run, and a freshness sync that needs rebuilding, recomputes the deterministic fact projection. Freshness sync can update only changed source-index chunks, and semantic generation reuses fresh node-local cache entries. Full mode also has targeted incremental routes. These mechanisms do not mean every `/excavator:excavator` invocation analyzes only changed files.

---

## 🤝 Contributing

Read [AGENTS.md](AGENTS.md) and [REVIEW.md](REVIEW.md) before making a change. They define the OpenSpec workflow, checks by changed content, risk tiers, and review/merge requirements.

1. Create a `codex/` feature branch in a checkout you can access.
2. Record the change under `openspec/changes/` and implement it in logical commits.
3. Run the checks required by `AGENTS.md`. The core test command alone does not run the root suite; core changes additionally require core tests and typechecking.
4. Open a PR using the repository template. Changes enter protected `main` through PRs, with `CI gate`, `Privacy scan`, and the applicable review requirements satisfied.
