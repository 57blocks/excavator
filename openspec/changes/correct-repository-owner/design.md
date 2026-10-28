## Context

The origin remote already names 57blocks/excavator. Seven stale references remain across three files. The README also describes a multi-agent default, Git post-commit updates and changed-files-only refreshes that do not match the current Lazy driver and Claude hooks.

## Decisions

Correct the seven existing repository references and the README's descriptions against current skills and scripts. Skills or prompts cannot repair persisted installation instructions, plugin metadata or a generated footer, so editing the existing files is necessary. Add no new runtime logic or regression checker for this reversible documentation correction.

Describe installed skills separately from the dependencies/build and optional MCP registration. Show Claude plugin command namespaces, preserve Codex's existing local installer contract, distinguish facts from model semantics and explain the Git HEAD snapshot boundary. Document auto-update as opt-in Claude hook suggestions requiring consent. Replace blanket graph-sharing instructions with explicit artifact selection. Describe only the analysis/retrieval behavior that the current implementation supports.

For this change only, the user explicitly authorized Codex to implement and independently review instead of Sonnet/Opus. The repository's model requirements remain unchanged.

The user additionally requested a root-cause fix for the `.DS_Store` failure. The contract test currently treats every entry under `skills/` as a directory. Select actual directories with `Dirent.isDirectory()` in both skill scans instead of deleting metadata, hard-coding a filename exclusion or ignoring read failures. A genuine skill directory must still be checked, including its missing/unreadable `SKILL.md`. This deterministic test boundary cannot be repaired by runtime prompts.

## Acceptance oracle

- No previous-owner repository reference remains in tracked content.
- The original seven repository references use the canonical owner; README claims agree with the current implementation and do not introduce a new installation or analysis contract.
- Node dependencies install with the frozen lockfile; workspace builds, root tests and reference checks succeed.
- Strict OpenSpec validation succeeds. New planning files are included in tracked-file checks before those checks run.
- A fresh-context Codex reviewer checks the medium-tier PR under REVIEW.md after Privacy scan succeeds, under the user's task-specific model authorization.
- A fixture containing a metadata file and an ordinary file does not crash skill discovery; a genuine non-view skill containing a browser opener is still detected. The real metadata file stays present during final verification.

## Risks

The user confirmed that the canonical repository is now public. Installation instructions describe public clone/download access, while retaining the current local-copy and build prerequisites. Repository visibility and distribution workflows are outside this change.

## Implementation evidence

- `install.sh` only creates/removes local symlinks; `docs/mcp.md` describes the separate dependency/build preparation and per-project Codex MCP configuration.
- `skills/excavator/SKILL.md` Phase 0 selects Lazy by default; Phase F2 writes node semantics into `semantic-cache.json`, and Phase F3 writes architecture into `semantic-graph.json`.
- `skills/excavator/lazy-analyze.mjs` and `sync-fact-graph.mjs` rebuild the deterministic fact projection. `source-snapshot/git-utils.mjs` recognizes repository roots; Git snapshots bind committed HEAD.
- `skills/excavator-chat/SKILL.md` merges exact, BM25, source-search and fresh semantic-cache candidates, with bounded traversal and source verification.
- `hooks/hooks.json`, `post-tool-use-auto-update.mjs` and `auto-update-prompt.md` implement Claude plugin hook suggestions and require consent before analysis.
- `skills/excavator-view/SKILL.md`, `excavator-prd-report/SKILL.md` and `skopo-report/SKILL.md` produce standalone pages. `build-source-index.mjs` stores source comments/strings, so sharing requires deliberate artifact selection.
- All 19 command names map to existing `skills/*/SKILL.md` directories. `AGENTS.md` defines checks by changed content; `REVIEW.md` defines review and merge requirements.
- The initial root test run failed at the service-only browser-opener check with `ENOTDIR` for `skills/.DS_Store`, demonstrating the unfiltered-directory bug before its fix. A temporary metadata move also raced a separate rsync-based test; the file was restored, and no workaround remains in the final verification environment.
- The independent review identified that a Git subdirectory is a directory snapshot unless it is itself a repository root or multi-repo parent. The README now scopes the HEAD baseline to repository-root targets and distinguishes the subdirectory target example from scoped semantics over repository-root facts.
