<h1 align="center">Excavator</h1>

<p align="center">
  <strong>Turn any codebase, knowledge base, or docs into a verified knowledge graph you can ask questions about.</strong>
  <br />
  <em>Works with Claude Code and Codex.</em>
</p>

<p align="center">
  <em>AI should help people, not replace them.</em>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="READMEs/README.zh-CN.md">简体中文</a> | <a href="READMEs/README.zh-TW.md">繁體中文</a> | <a href="READMEs/README.ja-JP.md">日本語</a> | <a href="READMEs/README.ko-KR.md">한국어</a> | <a href="READMEs/README.es-ES.md">Español</a> | <a href="READMEs/README.tr-TR.md">Türkçe</a> | <a href="READMEs/README.ru-RU.md">Русский</a>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Jingqi-57blocks/excavator/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
</p>

<p align="center">
  <img src="assets/hero.png" alt="Excavator — Turn any codebase into a queryable knowledge graph" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**You just joined a new team. The codebase is 200,000 lines of code. Where do you even start?**

Excavator is a [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference) that analyzes your project with a multi-agent pipeline, builds a knowledge graph of every file, function, class, and dependency, then answers questions against that graph in the terminal.

> **The goal isn't a graph that wows you with how complex your codebase is — it's a graph that quietly teaches you how every piece fits together.**

---

## ✨ Features

### Query the structural graph

Ask about files, functions, classes, dependencies, and request flows. Answers use plain-English summaries, architecture layers, relationships, and source evidence from the generated graph.

### Understand business logic

Extract how code maps to real business processes — domains, flows, and steps — and query those relationships from the terminal.

### Analyze knowledge bases

Point `/excavator-knowledge` at a [Karpathy-pattern LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The deterministic parser extracts wikilinks and categories from `index.md`, then LLM agents discover implicit relationships, extract entities, and surface claims.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>💬 Terminal Q&amp;A</h3>
      <p>Ask architecture and business-flow questions without starting a browser or local web server.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Fuzzy & Semantic Search</h3>
      <p>Find anything by name or by meaning. Search "which parts handle auth?" and get relevant results across the graph.</p>
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
      <p>Automatic grouping by architectural layer — API, Service, Data, UI, and Utility.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Language Concepts</h3>
      <p>12 programming patterns (generics, closures, decorators, etc.) explained in context wherever they appear.</p>
    </td>
  </tr>
</table>

---

## 🚀 Quick Start

### 1. Install the plugin

```bash
/plugin marketplace add Jingqi-57blocks/excavator
/plugin install excavator@excavator
```

> **Using a local model?** For privacy or enterprise setups, point your platform at a local model provider such as [Ollama](https://docs.ollama.com/integrations) — follow their integration guide to change the model provider.

### 2. Analyze your codebase

```bash
/excavator
```

A multi-agent pipeline scans your project, extracts every file, function, class, and dependency, then builds a knowledge graph saved to `.excavator/knowledge-graph.json`.

Then ask questions directly:

```bash
/excavator-chat How does the request flow work?
```

Excavator is service-only: it generates nodes, edges, architecture layers, and evidence for terminal Q&A. It does not ship or launch an HTML interface.

> **Heads up on token usage:** The initial `/excavator` analyzes your whole codebase and can consume a significant number of tokens on large projects. We recommend running it on a token plan / subscription, or using a local model (see above) for initialization. Subsequent runs are incremental by default — only changed files are re-analyzed — so they use far fewer tokens.

**Localized output:** Use `--language` to generate content in your preferred language:

```bash
# Generate Chinese graph summaries
/excavator --language zh

# Supported languages: en (default), zh, zh-TW, ja, ko, ru
```

On the **first run** in a project — when you don't pass `--language` and no language is stored yet — `/excavator` detects the language you're conversing in. If it isn't English, it asks you to confirm (or override) before generating; English conversations are unaffected. Your choice is saved to `.excavator/config.json` and reused on every later run.

The `--language` parameter affects node summaries, descriptions, and other generated graph text.

### 3. Ask and analyze

```bash
# Ask anything about the codebase
/excavator-chat How does the payment flow work?

# Analyze impact of your current changes
/excavator-diff

# Deep-dive into a specific file or function
/excavator-explain src/auth/login.ts

# Generate an onboarding guide for new team members
/excavator-onboard

# Extract business domain knowledge (domains, flows, steps)
/excavator-domain

# Analyze a Karpathy-pattern LLM wiki knowledge base
/excavator-knowledge ~/path/to/wiki

# Re-run anytime — incremental by default (only re-analyzes changed files)
/excavator

# Auto-update on every commit via a post-commit hook
/excavator --auto-update

# Scope to a subdirectory (for huge monorepos)
/excavator src/frontend
```

---

## 🌐 Installation

Excavator supports two hosts: Claude Code (native plugin) and Codex.

### Claude Code (Native)

```bash
/plugin marketplace add Jingqi-57blocks/excavator
/plugin install excavator@excavator
```

Claude Code invokes every skill with the plugin-name prefix, e.g. `/excavator:excavator` and `/excavator:excavator-chat`.

### Codex

```bash
git clone https://github.com/Jingqi-57blocks/excavator.git ~/.excavator-plugin
~/.excavator-plugin/install.sh
```

This symlinks each skill into `~/.agents/skills/` and links `~/.excavator-plugin` to the repository (if you cloned elsewhere, run `install.sh` from that clone instead — it links wherever it's run from). Restart Codex afterwards.

> **Note on invoking skills:** Codex uses `$` instead of `/` — type `$excavator`, not `/excavator`. If neither prefix is recognized, just ask in plain language: *"Use the excavator skill to analyze this project."*

Uninstall: `~/.excavator-plugin/install.sh --uninstall` (or run `install.sh --uninstall` from wherever you cloned the repo). Update: `git -C ~/.excavator-plugin pull` (the symlinks follow the checkout, no re-run needed).

---

## 📦 Share the Graph with Your Team

The graph is just JSON — **commit it once, and teammates skip the pipeline**. Good for onboarding, PR reviews, and docs-as-code.

> **Example:** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) — Go / Java / Python / Node reference with a committed graph.

**What to commit:** everything in `.excavator/` except `intermediate/` (local scratch).

```gitignore
.excavator/intermediate/
```

**Keep it fresh:** enable `/excavator --auto-update` — a post-commit hook incrementally patches the graph so each commit lands with a matching graph. Or re-run `/excavator` manually before releases.

**Large graphs (10 MB+):** track with **git-lfs**.

```bash
git lfs install
git lfs track ".excavator/*.json"
git add .gitattributes .excavator/
```

## 🔧 Under the Hood

### Tree-sitter + LLM hybrid

Static analysis and LLMs do what each does best:

- **Tree-sitter (deterministic)** — parses source into a concrete syntax tree and extracts structural facts: imports, exports, function/class definitions, call sites, inheritance. Pre-resolved into an `importMap` during the scan phase and passed to file-analyzers so they don't re-derive imports from source. Same input → same output, every run. Also powers fingerprint-based change detection for incremental updates.
- **LLM (semantic)** — reads the parsed structure alongside the original source to produce what parsers can't: plain-English summaries, tags, architectural layer assignments, business-domain mapping, and language concept callouts.

This split is why the graph is reproducible on the structural side (the same code always yields the same edges) while still capturing intent on the semantic side (what a file is *for*, not just what it imports).

### Multi-Agent Pipeline

The `/excavator` command orchestrates specialized analysis and verification agents:

| Agent                   | Role                                                                                                               | Used By                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `project-scanner`       | Discovers files, detects languages and frameworks                                                                  | `/excavator`           |
| `file-analyzer`         | Extracts functions, classes, imports; produces graph nodes and edges                                               | `/excavator`           |
| `architecture-analyzer` | Identifies architectural layers                                                                                    | `/excavator`           |
| `graph-reviewer`        | Validates graph completeness and referential integrity. Runs inline by default; use `--review` for full LLM review | `/excavator`           |
| `domain-analyzer`       | Extracts business domains, flows, and process steps                                                                | `/excavator-domain`    |
| `article-analyzer`      | Extracts entities, claims, and implicit relationships from wiki articles                                           | `/excavator-knowledge` |

File analyzers run in parallel, up to 5 concurrent workers and 20–30 files per batch.

The pipeline also supports incremental updates: only files changed since the last run are re-analyzed.


---

## 🎥 Community

A community-made walkthrough by **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Community walkthrough by Better Stack — watch on YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Watch on YouTube &rarr;</a></em>
</p>

Made a video, blog post, or tutorial? Open an issue or PR — happy to feature it here.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run the tests (`pnpm --filter @excavator/core test`)
4. Commit your changes and open a pull request

Please open an issue first for major changes so we can discuss the approach.

---

<p align="center">
  <strong>Stop reading code blind. Start understanding everything.</strong>
</p>

## Star History

<a href="https://www.star-history.com/?repos=Jingqi-57blocks%2Fexcavator&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Jingqi-57blocks/excavator&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Jingqi-57blocks/excavator&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Jingqi-57blocks/excavator&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Thanks to everyone who's used and contributed — knowing this saves people time is what made it worth building.</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
