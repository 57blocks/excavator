## Phase 3: The map

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The map is the handbook's spine: the areas of the product, the features in each area, how a reader gets to each feature, and where every candidate went. When `$OUT/map.json` exists, run `check-map` first; when it exits 0, skip the writing and go to the `--features` step.

### Writing the map

If you split this reading across subagents, dispatch them as `excavator-handbook-writer` subagents in the foreground and wait for them, as for the lanes. Read the source that shows the product as a reader meets it: navigation and menu configuration, route tables, page and tab titles, sign-in and public pages, the messages and emails the product sends, scheduled-job and queue registrations, command-line entry files. Read code only. Then write `$OUT/map.json`:

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
- **Features, one per thing a reader does.** A feature is a task or a place in the product ("place an order", "approve a request", "the audit list"), not a route, a file or a layer. A page, the requests it sends and the backend code that serves them are one feature spanning both sides: for each page find the request it sends and the route that serves it, and put both candidates in the feature. A reader-facing feature takes its name from the product's own label where there is one. Give features ids `F1`, `F2`, ... in reading order. Two features may share a name when they sit in different areas; the ids stay distinct.
- **Reach: how a reader gets to the feature.** Exactly one of:
  - `menu` - the reader opens it from a navigation menu. `label` is the menu text, `evidence` is the menu configuration line that holds it.
  - `link` - the reader can get there, but no menu entry shows it: a public link (sign-in, sign-up, password reset, a shared page), a link inside an email or message the product sends, a jump from another page, a menu entry that is commented out or hidden while its route is still registered. `label` is the text the reader sees there (or the commented-out menu text), `evidence` is the route registration, the place the link is built or the commented-out menu line. The `link` features are shown in their own list in the handbook; putting a feature there is a statement of how it is reached, not a judgment.
  - `automated` - scheduled or background work the reader does not start: jobs, queue consumers, event listeners.
  - `interface` - endpoints that other systems or external clients call (webhooks, public APIs), not the ones the product's own pages call.
  - `operator` - commands an operator runs: program starts, command-line tools, maintenance scripts.
  A `menu` or `link` feature needs `label` and `evidence`, and the label must occur in the quoted passage.
- **Labels, quoted from the source.** A label is the text exactly as the product shows it, in the source's language, never translated. Quote the line that holds it. When a menu text lives in a translation file under a key, quote the translation file's line that holds the text, so the label occurs in the passage.
- **Roles.** `roles` lists the user categories or permission levels the project defines, each with the line that defines it. Entries can name only these roles. Prefer the role name the product shows to its users: the entries of a role list or the options of a role select in the interface, a table of display names. Quote that line, so the label is the name a reader knows. Use the key the code uses (an enum value, often with an underscore) only when the product shows no name for that role: a code key passes the banned-word gate because it is a quoted label, and the reader would then see a code word where the product has a name.
- **Names.** `names` lists the external products, systems and integrations the source names (a messaging service, a code host, a payment provider), each as written in the source with the line that shows it. They are often written in camel or mixed case; a name listed here, with its passage, may appear in reader text.
- **Conservation.** Every candidate id in `candidates.json` appears in exactly one feature's `candidates` or in `unassigned` with a reason: test code, a dead registration, an outbound HTTP call a pattern mistook for a route, a health check no reader uses. The check prints each candidate that is missing and each that is assigned twice.
- **Seed files.** A feature's `seedFiles` are the files its lane reads first; from them the lane follows calls and imports to at most 20 more files, so list here what the feature is built from: the entrypoint files, the files they call or import directly, the files that define the forms, validation, constants, enums, statuses and settings the feature reads, the menu file its `where` labels come from, and for a page the code that sends its requests and the backend handlers that serve them. Every path exists inside the project and is not under `.git`, `node_modules`, `vendor`, `dist`, `build` or `.excavator`.

### Reader text

Everything a reader sees (area names, feature names, labels, reasons, and later the narrative of the entries) follows these rules, and the scripts enforce them:

- No code-shaped words. Refused: identifiers with an underscore (`order_status`), camel-case and mixed-case words (`orderStatus`, `PayPal`), paths that start with `/` (`/api/orders`), file names with a source extension (`.go`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.py`, `.sql`, `.json`, `.yaml`, `.yml`), a name followed by `(` and the names of the project's member repositories. Say it in plain words. The one exception is a label or name that was quoted from the source and passed its check.
- Numbers are Arabic numerals, always ("2 levels", not "two levels"). A number in reader text must occur in the item's own quoted passages, so do not number features or areas in their names unless the source does.
- Labels stay in the source's language. The narrative, the area names you give and the reasons are written in `$LANGUAGE`.
- Describe the product as it is. No advice, no judgment of the product.

**Language of the narrative.** Everything you write yourself in the map (an area name without `evidence`, a feature name without a `label`, every reason in `unassigned`) is written in `$LANGUAGE`; a name quoted from the source stays as the source writes it. The scripts do not rely on this line alone: for a language with its own script (Chinese, Japanese, Korean, Russian and the like) they refuse any such text that holds no letter outside ASCII, and say which field. The fixed text of Phase 2 tells them which languages those are; a language written in Latin letters (French, Spanish) is not checked, and there the rule rests on you. A text made only of numbers and labels quoted from the source is not refused.

### Check and fix

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-map "$OUT" --project "$PROJECT_ROOT"
```

`check-map` exits 1 and prints, one per line, every candidate assigned twice or not at all, every shape problem, every label that is not in its passage, every passage that is not in its file exactly once (a short passage found twice needs a longer one), every path that is outside the project or under a skipped directory, every missing seed file, every code-shaped word in reader text and, for a language with its own script, every name or reason of yours written only in ASCII letters. When `$RUN_LANGUAGE` is not English and `$OUT/ui.json` is missing or fails `check-ui`, it prints one line saying so and a `Next:` line: go back to Phase 2, then run it again. Fix `map.json` for each line and run it again; dispatch no lane until it exits 0. Fix the cause: quote the right passage, rename the feature, change its reach; never drop a candidate into `unassigned` with a reason that is not true. On exit 0 it prints `map ok: ...` and creates `state.json` with every feature planned. Then print the areas and the features to the user, one line each: id, name and reach.

### `--features`

Without `--features`, every feature gets an entry. With `--features`, run this once `check-map` passes, with the list as one single-quoted argument exactly as the user gave it:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" select "$OUT" --features '<the --features value>' --project "$PROJECT_ROOT"
```

- Exit 0: it prints the selected feature ids, one per line, in map order. Only those get lanes in Phase 4; `$SELECTED` is that list. Every other feature stays planned and is listed in the handbook as not written.
- Exit 1: an item matched no feature or several (two features share a name). It prints each failing item, then every feature as `id  name`, then a `Next:` line. Stop the run here: tell the user the lines it printed, as printed, dispatch no lane and run no further command.
- Exit 2: show its message and stop.

---

## Phase 3c: Business domains

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Run this phase after the map has passed `check-map` and before Phase 3b (its letter is the order the phases were added in, not the order they run in). The map groups the features the way the navigation does, by menu group, so a reader who wants one business thing, such as leave or expenses, finds its features under several menus. This phase groups the same features by business domain, in one small file. The map does not change: the area of a feature stays what Phase 3 wrote, and every feature keeps its name, its reach and its candidates. The handbook's navigation, its domain pages, the entities and the matrices are by domain; a feature's area is still shown next to it.

You write this file yourself, from the map. Dispatch no subagent: the input is the list of features, which the map's subagents already read the source to write, and the work is one judgment over that list. A feature's name, label and area usually say what it is; open the first seed file of a feature only when its name does not say which business object it handles.

1. When `$OUT/domains.json` exists, run `check-domains` first; when it exits 0, skip the writing and go to Phase 3b. An `$OUT` from before business domains has no `domains.json`: this phase writes it, and the map, the entries and `state.json` are not touched. The file follows the map: a `domains.json` that no longer fits a map that was written again is reported by `check-domains`, which names each feature it misses: write the file again.
2. Print the areas and the features in navigation order, then write `$OUT/domains.json`:
   ```bash
   jq -r '.areas[] | [.id, .name] | @tsv' "$OUT/map.json"
   jq -r '.features[] | [.id, .area, .reach, .name, (.label // "")] | @tsv' "$OUT/map.json"
   ```
   ```json
   {
     "format": "excavator-product-handbook-domains/1",
     "language": "<$RUN_LANGUAGE>",
     "domains": [
       {"id": "D1", "name": "<the business domain, in the reader's words>", "features": ["F1", "F4", "F9"]},
       {"id": "D2", "name": "<a menu group's name, quoted>", "evidence": [{"file": "<path from the project root>", "passage": "<text copied from that file>"}], "features": ["F2", "F3"]}
     ]
   }
   ```
   - A domain is a kind of business object, or a stretch of business, that readers handle together: leave, expenses, projects, billing. It can hold features from several areas of the map.
   - A feature that submits something and the features that approve, review, list or export it are in the same domain, whatever menu they sit under.
   - A feature that runs by itself (reach `automated`, `interface` or `operator`) goes in the domain of the business object it processes. Only a feature that processes no business object goes in a domain for system operations, such as clean-up or maintenance work; give that domain a name in the reader's words too.
   - Every feature of the map is in exactly one domain. Do not add, remove, rename or split a feature.
   - Name each domain in the reader's words, written in `$LANGUAGE`, under the reader-text rules of Phase 3: no code-shaped word, and no number the source does not hold. A domain name that is a menu group's name as the product shows it may be quoted with `evidence`, a passage copied from the source that holds the name, as an area name is; the script then checks it like an area name.
   - Number the domains `D1`, `D2`, ... without a gap, in the order in which the navigation first shows one of their features; a domain whose features all run by themselves comes after the others, in the order of its first feature.
   - Write no description of a domain: the handbook shows what each of its features does.
3. Check it:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-domains "$OUT" --project "$PROJECT_ROOT"
   ```
   - Exit 0: it prints `domains ok: ...`; tell the user the domains, one line each: id, name and the number of features; go to Phase 3b.
   - Exit 1: it prints, one per line, every feature that is in no domain or in two, every id that is not a feature of the map, every empty domain, every id out of order or used twice, every code-shaped word, number or language problem in a domain name, and a language that is not the map's. Fix `domains.json` for each line it prints and run it again. You get two attempts in all: when the second run still exits 1, tell the user the lines it printed, as printed, and stop; run no further phase. Fix the cause, never the check: do not drop a feature to make the lines go away.
   - Exit 2: show its message and stop.

   Without a `domains.json` that passes, the commands of Phase 7 still run: the handbook then groups the features by the map's areas and says so in a fixed text.

---

