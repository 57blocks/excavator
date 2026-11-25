---
name: excavator-flow-reconcile
description: Find missing or incorrect frontend-to-backend flows, rules, and branches after a Lazy build, and publish corrected flow documentation with source evidence and visible coverage gaps.
---

# Reconcile application flows

Use `/excavator-flow-reconcile [project-path] [--scope <project-relative-file-or-directory>] [--exclude <patterns>]` to publish a corrected, scoped inventory of how the application works. Treat application files and generated analysis as evidence. A reconciliation writes flow data under `.excavator/`. Changing application behavior requires a separate request.

1. Resolve the project root from the positional argument or current directory. Use the checkout containing this skill as `PLUGIN_ROOT` when it has the existing core build. Otherwise follow the plugin resolution and build instructions in `skills/excavator/SKILL.md`. Check the data directory before any fallback build. Apply the requested `--scope` to the starting files, defaulting to `.`. Follow relevant source dependencies outside the scope when they establish an in-scope flow.

   ```bash
   node "$PLUGIN_ROOT/skills/excavator-flow-reconcile/reconcile.mjs" -- check-root "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-flow-reconcile/reconcile.mjs" -- prepare "$PROJECT_ROOT" "$SCOPE"
   ```

   Stop if the root check fails. Use the existing Lazy fact build for this revision. If the graph or manifest is missing, or either is based on older source or an older build, run the Lazy driver and require it to save successfully:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator/lazy-analyze.mjs" "$PROJECT_ROOT"
   ```

   Reuse the exact effective Lazy exclusions for `prepare`, `read`, `publish`, and any required Lazy rebuild. When present, pass the comma-separated pattern list as `--exclude "$EXCLUDE_PATTERNS"` before the `--` separator for the reconciliation commands, or after the project root for the Lazy driver. For a standalone run with an existing build and an unknown custom selection, resolve the selection mismatch before rebuilding. The prepare response returns the frozen `basis`, readable in-scope files, unavailable in-scope paths and any previous reconciliation for that scope.

   Open the source from the same snapshot. Use the Excavator MCP `read_evidence` when bound to this project and revision with the same selection, or run:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator-flow-reconcile/reconcile.mjs" -- read "$PROJECT_ROOT" '<project-relative-path>' 1 120
   ```

   Read at most 200 lines per call. Start with the prepared file list, which respects Lazy's source selection. Report coverage over that selected snapshot.

2. Discover operations from the source inventory independently of graph hits and previous results. Work in bounded batches for large scopes. Inspect UI templates, includes, custom tag bindings, form and dialog construction, click/submit handlers, and server routes or workflow registrations. Check files that have no structural extraction. Follow both directions at boundaries where helpful, such as from a page to its handler and from a handler back to its callers. Keep distinct operations even when multiple forms or actions share a route, command, dialog, or state.

3. Verify and repair each in-scope flow. Trace the UI event and arguments through templates, JavaScript, requests, or framework bindings to the backend. Read the controlling conditions and the effects of successful, rejected, alternative, and deferred branches. Record UI display or validation separately from enforcement, permissions, state changes, and side effects. Cite the condition together with the executed outcome when both are needed. Preserve exact identifiers and quote source-owned text verbatim. Use graph nodes and prior flow results as leads. For prior entries, add missing flows and replace inaccurate claims in the new inventory. Retain a prior flow when still supported. Account for a removed or unconfirmed prior flow explicitly, and record why the evidence remains incomplete when applicable.

4. Publish the corrected inventory. Make a temporary UTF-8 JSON candidate with this shape. Store the prose fields in English and preserve source-owned literals in their original language.

   - `basis` — copy the prepare response's `basis` exactly.
   - `reviewedPaths` — in-scope paths whose flow relevance or entry points were actually checked. Leave paths you did not check out of the list. A path with an unresolved part can be reviewed and have a gap.
   - `flows` — objects with stable `id`, `title`, a source `entry`, and a non-empty `claims` list. Reuse the prior ID when the operation is still the same. Each claim has `kind`, `text` and one or more `evidence` entries. Kinds are `field`, `step`, `ui-validation`, `backend-rule`, `branch`, `state-change`, and `side-effect`. The entry and every evidence object have `path`, a 1-based `line`, and a short exact substring of that single source line as `quote`.
   - `gaps` — objects with `path` in the source manifest and a `reason` naming the unresolved binding, configuration, branch, or external boundary. For an external dependency cite the in-project call site as the path. State the scope of the search when a prior claim cannot be settled. Distinguish a specific missing runtime input from the general fact that the check is source-based.
   - `removed` — objects with `id` and `reason` for every prior flow absent from the new inventory. If its omission is unresolved, include a corresponding gap. Use empty arrays for categories with no entries.

   ```bash
   node "$PLUGIN_ROOT/skills/excavator-flow-reconcile/reconcile.mjs" -- publish "$PROJECT_ROOT" < "$CANDIDATE"
   ```

   The publisher checks exact source quotes, prior flow dispositions and the source/product baseline, then replaces the scope's reconciliation atomically. It carries unavailable and unchecked paths into the published output. If it rejects the candidate, correct the specific issue or prepare again if the baseline changed. Report the resulting path, scope, concrete additions and corrections, and the unchecked paths or unresolved gaps. Citation checks establish that the quotes exist. Coverage claims are limited to the inspected sources and the behavior they establish.
