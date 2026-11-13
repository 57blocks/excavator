## Phase 3: The map

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The map is the handbook's spine: the areas of the product, the features in each area, how a reader gets to each feature, and where every candidate went. When `$OUT/map.json` exists, run `check-map` first; when it exits 0, skip the writing and go to the `--features` step.

### Writing the map

If you split this reading across subagents, dispatch them as `excavator-handbook-writer` subagents in the foreground and wait for them. Read the source that shows the product as a reader meets it: navigation and menu configuration, route tables, page and tab titles, sign-in and public pages, the messages and emails the product sends, scheduled-job and queue registrations, command-line entry files. Read code only. Then write `$OUT/map.json`:

```json
{
  "format": "excavator-product-handbook-map/1",
  "language": "<$RUN_LANGUAGE>",
  "areas": [{"id": "A1", "name": "<area as the reader sees it>", "evidence": [{"file": "<path from the project root>", "passage": "<text copied from that file>"}]}],
  "features": [{"id": "F1", "name": "<what the reader does>", "area": "A1", "reach": "menu", "label": "<menu text>", "evidence": [{"file": "...", "passage": "..."}], "candidates": ["c1", "c2"], "seedFiles": ["<path from the project root>"]}],
  "unassigned": [{"candidate": "c7", "reason": "<why no feature holds it, in plain words>"}],
  "roles": [{"label": "<role name as the product shows it>", "evidence": [{"file": "...", "passage": "..."}]}],
  "names": [{"label": "<external product or system name>", "evidence": [{"file": "...", "passage": "..."}]}]
}
```

- **Areas, as the reader sees them.** An area is a group of features under one heading a reader knows: a menu group, a section of the navigation, a page family. Take the names from the navigation configuration and the page titles, in order. An area name quoted from the source carries `evidence`; an area name you give yourself (for the work that runs by itself, for example) has none, is written in `$LANGUAGE` and passes the same reader-text rules. Give the areas ids `A1`, `A2`, ... in navigation order.
- **Features, one per thing a reader does.** A feature is a task or a place in the product ("place an order", "approve a request", "the audit list"), not a route, a file or a layer. A page, the requests it sends and the backend code that serves them are one feature spanning both sides: for each page find the request it sends and the route that serves it, and put both candidates in the feature. A feature can have several entries that are not connected in the code: put them in one feature when they handle the same kind of business object for the same reader task, without requiring a code connection (the list page and the detail page of the same thing, the admin side and the user side of the same task, a flow that starts on a page and ends in a scheduled job or an event listener, the page that a link in an email opens); keep them apart when they only touch the same object for different tasks. A reader-facing feature takes its name from the product's own label where there is one. Give features ids `F1`, `F2`, ... in reading order. Two features may share a name when they sit in different areas; the ids stay distinct.
- **Reach: how a reader gets to the feature.** Exactly one of:
  - `menu` - the reader opens it from a navigation menu. `label` is the menu text, `evidence` is the menu configuration line that holds it.
  - `link` - the reader can get there, but no menu entry shows it: a public link (sign-in, sign-up, password reset, a shared page), a link inside an email or message the product sends, a jump from another page, a menu entry that is commented out or hidden while its route is still registered. `label` is the text the reader sees there (or the commented-out menu text), `evidence` is the route registration, the place the link is built or the commented-out menu line. The `link` features are shown in their own list in the handbook; putting a feature there is a statement of how it is reached, not a judgment.
  - `automated` - scheduled or background work the reader does not start: jobs, queue consumers, event listeners.
  - `interface` - endpoints that other systems or external clients call (webhooks, public APIs), not the ones the product's own pages call.
  - `operator` - commands an operator runs: program starts, command-line tools, maintenance scripts.
  A `menu` or `link` feature needs `label` and `evidence`, and the label must occur in the quoted passage.
- **Labels, quoted from the source.** A label is the text exactly as the product shows it, in the source's language, never translated. Quote the line that holds it. When a menu text lives in a translation file under a key, quote the translation file's line that holds the text, so the label occurs in the passage.
- **Roles.** `roles` lists the user categories or permission levels the project defines, each with the line that defines it. The chapters name roles with these labels. Prefer the role name the product shows to its users: the entries of a role list or the options of a role select in the interface, a table of display names. Quote that line, so the label is the name a reader knows. Use the key the code uses (an enum value, often with an underscore) only when the product shows no name for that role: a code key passes the banned-word gate because it is a quoted label, and the reader would then see a code word where the product has a name.
- **Names.** `names` lists the external products, systems and integrations the source names (a messaging service, a code host, a payment provider), each as written in the source with the line that shows it. They are often written in camel or mixed case; a name listed here, with its passage, may appear in reader text.
- **Conservation.** Every candidate id in `candidates.json` appears in exactly one feature's `candidates` or in `unassigned` with a reason: test code, a dead registration, an outbound HTTP call a pattern mistook for a route, a health check no reader uses. The check prints each candidate that is missing and each that is assigned twice.
- **Seed files.** A feature's `seedFiles` are the files its writer reads first; from them the writer follows calls and imports as far as the feature goes, so list here what the feature is built from: the entrypoint files, the files they call or import directly, the files that define the forms, validation, constants, enums, statuses and settings the feature reads, the menu file its labels come from, and for a page the code that sends its requests and the backend handlers that serve them. Every path exists inside the project and is not under `.git`, `node_modules`, `vendor`, `dist`, `build` or `.excavator`.

### Reader text

Everything a reader sees (area names, feature names, labels, reasons, and later the chapters) follows these rules, and the scripts enforce them:

- No code-shaped words. Refused: identifiers with an underscore (`order_status`), camel-case and mixed-case words (`orderStatus`, `PayPal`), paths that start with `/` (`/api/orders`), file names with a source extension (`.go`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.py`, `.sql`, `.json`, `.yaml`, `.yml`), a name followed by `(` and the names of the project's member repositories. Say it in plain words. The one exception is a label or name that was quoted from the source and passed its check.
- Numbers are Arabic numerals, always ("2 levels", not "two levels"). A number in reader text must occur in the item's own quoted passages, so do not number features or areas in their names unless the source does.
- Labels stay in the source's language. The narrative, the area names you give and the reasons are written in `$LANGUAGE`.
- Describe the product as it is. No advice, no judgment of the product.

**Language of the narrative.** Everything you write yourself in the map (an area name without `evidence`, a feature name without a `label`, every reason in `unassigned`) is written in `$LANGUAGE`; a name quoted from the source stays as the source writes it. The scripts do not rely on this line alone: for a language with its own script (Chinese, Japanese, Korean, Russian and the like) they refuse any such text that holds no letter outside ASCII, and say which field. The fixed text of Phase 2 tells them which languages those are; a language written in Latin letters (French, Spanish) is not checked, and there the rule rests on you. A text made only of numbers and labels quoted from the source is not refused.

### Check and fix

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-map "$OUT" --project "$PROJECT_ROOT"
```

`check-map` exits 1 and prints, one per line, every candidate assigned twice or not at all, every shape problem, every label that is not in its passage, every passage that is not in its file exactly once (a short passage found twice needs a longer one), every path that is outside the project or under a skipped directory, every missing seed file, every code-shaped word in reader text and, for a language with its own script, every name or reason of yours written only in ASCII letters. When `$RUN_LANGUAGE` is not English and `$OUT/ui.json` is missing or fails `check-ui`, it prints one line saying so and a `Next:` line: go back to Phase 2, then run it again. Fix `map.json` for each line and run it again; dispatch no writer until it exits 0. Fix the cause: quote the right passage, rename the feature, change its reach; never drop a candidate into `unassigned` with a reason that is not true. On exit 0 it prints `map ok: ...`. Then print the areas and the features to the user, one line each: id, name and reach.

### `--features`

Without `--features`, every feature gets a chapter. With `--features`, run this once `check-map` passes, with the list as one single-quoted argument exactly as the user gave it:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" select "$OUT" --features '<the --features value>' --project "$PROJECT_ROOT"
```

- Exit 0: it prints the selected feature ids, one per line, in map order. Only those get a writer in Phase 5; `$SELECTED` is that list. Every other feature keeps the chapter an earlier run wrote, or is listed in the handbook as not written.
- Exit 1: an item matched no feature or several (two features share a name). It prints each failing item, then every feature as `id  name`, then a `Next:` line. Stop the run here: tell the user the lines it printed, as printed, dispatch no writer and run no further command.
- Exit 2: show its message and stop.

---
