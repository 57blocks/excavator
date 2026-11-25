---
name: excavator-flow-reconcile
description: Find missing or incorrect frontend-to-backend flows, rules, and branches after a Lazy build, and publish corrected flow documentation with source evidence and visible coverage gaps.
---

# Reconcile application flows

Use `/excavator-flow-reconcile [project-path] [--scope <project-relative-file-or-directory> | --refresh] [--exclude <patterns>]` to publish a corrected inventory of how the application works. Omit the scope for a whole-project run with automatic batches and resumable checkpoints. Use `--refresh` to revisit a whole-project inventory after it has been merged. Treat application files and generated analysis as evidence. A reconciliation writes flow data under `.excavator/`. Changing application behavior requires a separate request.

1. Resolve the project root from the positional argument or current directory. Use the checkout containing this skill as `PLUGIN_ROOT` when it has the existing core build. Otherwise follow the plugin resolution and build instructions in `skills/excavator/SKILL.md`. Check the data directory before any fallback build. Set `RECONCILE` to `$PLUGIN_ROOT/skills/excavator-flow-reconcile/reconcile.mjs`.

   ```bash
   node "$RECONCILE" -- check-root "$PROJECT_ROOT"
   ```

   Stop if the root check fails. Use the existing Lazy fact build for this revision. If the graph or manifest is missing, or either is based on older source or an older build, run the Lazy driver and require it to save successfully:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator/lazy-analyze.mjs" "$PROJECT_ROOT"
   ```

   Reuse the exact effective Lazy exclusions for all reconciliation commands and any Lazy rebuild. When present, pass the comma-separated pattern list as `--exclude "$EXCLUDE_PATTERNS"` before the `--` separator for the reconciliation commands, or after the project root for the Lazy driver. For a standalone run with an existing build and an unknown custom selection, resolve the selection mismatch before rebuilding.

   With a specific file or directory scope, run `node "$RECONCILE" -- prepare "$PROJECT_ROOT" "$SCOPE"` to get the frozen `basis`, readable starting files, unavailable paths and prior inventory. With no scope or scope `.`, follow [Whole-project batches](#whole-project-batches) for preparation and publication. Apply the same discovery and evidence rules to each batch. Follow relevant source dependencies outside the starting files when they establish a flow.

   Open the source from the same snapshot. Use the Excavator MCP `read_evidence` when bound to this project and revision with the same selection, or run:

   ```bash
   node "$RECONCILE" -- read "$PROJECT_ROOT" '<project-relative-path>' 1 120
   ```

   Read at most 200 lines per call. Start with the prepared file list, which respects Lazy's source selection. Report coverage over that selected snapshot.

2. Discover operations from the source inventory independently of graph hits and previous results. Work in bounded batches for large scopes. Inspect UI templates, includes, custom tag bindings, form and dialog construction, click/submit handlers, and server routes or workflow registrations. Check files that have no structural extraction. Follow both directions at boundaries where helpful, such as from a page to its handler and from a handler back to its callers. Keep distinct operations even when multiple forms or actions share a route, command, dialog, or state.

3. Verify and repair each in-scope flow. Trace the UI event and arguments through templates, JavaScript, requests, or framework bindings to the backend. Read the controlling conditions and the effects of successful, rejected, alternative, and deferred branches. Record UI display or validation separately from enforcement, permissions, state changes, and side effects. Cite the condition together with the executed outcome when both are needed. Preserve exact identifiers and quote source-owned text verbatim. Use graph nodes and prior flow results as leads. For prior entries, add missing flows and replace inaccurate claims in the new inventory. Retain a prior flow when still supported. Account for a removed or unconfirmed prior flow explicitly, and record why the evidence remains incomplete when applicable.

4. Save the corrected inventory. Make a temporary UTF-8 JSON candidate with this shape. Store the prose fields in English and preserve source-owned literals in their original language.

   - `basis` — copy the prepare response's `basis` exactly.
   - `reviewedPaths` — in-scope paths whose flow relevance or entry points were actually checked. Leave paths you did not check out of the list. A path with an unresolved part can be reviewed and have a gap.
   - `flows` — objects with stable `id`, `title`, a source `entry`, and a non-empty `claims` list. Reuse the prior ID when the operation is still the same. Each claim has `kind`, `text` and one or more `evidence` entries. Kinds are `field`, `step`, `ui-validation`, `backend-rule`, `branch`, `state-change`, and `side-effect`. The entry and every evidence object have `path`, a 1-based `line`, and a short exact substring of that single source line as `quote`.
   - `gaps` — objects with `path` in the source manifest and a `reason` naming the unresolved binding, configuration, branch, or external boundary. For an external dependency cite the in-project call site as the path. State the scope of the search when a prior claim cannot be settled. Distinguish a specific missing runtime input from the general fact that the check is source-based.
   - `removed` — objects with `id` and `reason` for every prior flow absent from the new inventory. If its omission is unresolved, include a corresponding gap. Use empty arrays for categories with no entries.

   ```bash
   node "$RECONCILE" -- publish "$PROJECT_ROOT" < "$CANDIDATE"
   ```

   Use `publish` for a specific scope and `save-batch` for whole-project batches. Both validate source quotes, prior flow dispositions and the source/product baseline. If rejected, correct the specific issue or prepare again if the baseline changed. Report the resulting path, scope, concrete additions and corrections, and the unchecked paths or unresolved gaps. Citation checks establish that the quotes exist. Coverage claims are limited to the inspected sources and the behavior they establish.

## Whole-project batches

1. Run `node "$RECONCILE" -- status "$PROJECT_ROOT"`. If the user requested `--refresh`, use `refresh` in place of `status`. It starts a new run from a merged inventory or resumes the active run, with the published inventory available until a new merge. The plan is derived from the Lazy selection, including files with no graph hits. Each batch holds at most 128 paths. If the state is `merged`, report the existing result for this snapshot. Otherwise process the batches whose `pending` count is positive. Use independent research agents for different batches when the host supports them. Give each agent the batch's starting files and ownership of that batch only. A single host can also work through batches in sequence.
2. Run `node "$RECONCILE" -- prepare-batch "$PROJECT_ROOT" "$BATCH"`. Use its `files` as starting files and `previousFlows` as prior inventory. If it has a `checkpoint`, load its existing findings and finish the still-pending paths. Discover entries across every assigned source type. Group files with a common role only after checking source signals or registration for that group. A filename match alone is insufficient. Record untraced candidate actions and unresolved branches in `gaps`. When a path cannot be screened after trying to establish its relevance, record its path and specific reason in `deferred`. Use neither field to hide paths skipped because a session stopped.
3. Add `run`, `batch`, and `checkpointDigest` from the prepare response to the candidate. Also include `deferred` as an array of `{path,reason}` objects. Reuse valid prior flow IDs in the batch and use `entry:${encodeURIComponent(entry.path)}#operation-name` for new IDs. Preserve distinct IDs for separate operations on the same page. Include all findings accumulated for the batch, with a disposition for each prior flow whose path you have reviewed or deferred. Save as you go, even partway through a batch:

   ```bash
   node "$RECONCILE" -- save-batch "$PROJECT_ROOT" "$BATCH" < "$CANDIDATE"
   ```

   Re-run `prepare-batch` after each save to obtain the next checkpoint digest. Keep earlier findings. If evidence changes a finding, update the claim in place, or include a reason for withdrawing the saved flow (`{kind:"flow",id,reason}`) or resolving the saved gap (`{kind:"gap",path,previousReason,reason}`) in `revisions`. Carry forward existing revisions. For a previously published flow, use its `removed` disposition if applicable. The save becomes a finished batch once every readable path is reviewed or explicitly deferred. Lazy's unavailable paths are carried forward automatically. If the run stops, a fresh host repeats `status` and resumes the pending batches. A changed Lazy snapshot or a replacement whole-project inventory starts a new plan. Completed batches for the same run are reused as saved.
4. When the pending count reaches zero, compare the earlier `previousFlows` from `status` with newly found entries in the checkpoints. If an evidenced operation moved between batches, keep its prior ID in the aggregate by providing a UTF-8 JSON object with `run` and `moves` (an array of `{fromId,toId}`, from retired or removed prior ID to new checkpoint ID). Use `node "$RECONCILE" --relocations -- merge "$PROJECT_ROOT" < "$MOVES"` when there are moves. Otherwise run `node "$RECONCILE" -- merge "$PROJECT_ROOT"`. The merge verifies the saved results, rechecks source evidence, and atomically publishes one whole-project inventory. Report completed batches, reviewed paths over all selected paths, deferred and unavailable paths, and unresolved semantic gaps. If a run stops with pending paths, report the checkpoint progress and name the command to resume. The previous whole-project inventory remains published until the merge succeeds.
