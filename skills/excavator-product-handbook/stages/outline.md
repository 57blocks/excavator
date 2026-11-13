## Phase 9: The outline

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The outline decides how the handbook is laid out: which parts there are, which chapters each holds, in what order and under what names. You write it yourself, in one file, from the list of chapters; it dispatches no subagent and reads no code. It never changes a chapter: it only places them. Without an outline, or with one that does not hold every chapter exactly once, the handbook uses the default order under the fixed names and says so in its coverage section.

1. List what can be placed:
   ```bash
   ls "$OUT/chapters"
   for f in "$OUT"/chapters/*.md; do printf '%s\t%s\n' "$(basename "$f" .md)" "$(grep -m1 '^# ' "$f" | sed 's/^# //')"; done
   test -f "$OUT/data.json" && echo data
   test -f "$OUT/dictionaries.json" && echo dictionaries
   test -f "$OUT/entries/history.json" && echo history
   ```
   The chapters are `system`, one `F<n>` per feature and the cross chapters `domains`, `roles`, `notifications`, `topics`, `defects` and `remedies`; `data`, `dictionaries` and `history` are written by the scripts. Each is a block of the outline.
2. Write `$OUT/outline.json`:
   ```json
   {
     "format": "excavator-product-handbook-outline/2",
     "language": "<$RUN_LANGUAGE>",
     "parts": [
       {"title": "<the part, in the reader's words>", "chapters": ["system", "domains", "F1", "F2"]}
     ],
     "unplaced": [{"block": "<a block>", "reason": "<why it is not in the handbook>"}]
   }
   ```
   - Group the chapters into parts the way the readers of this project think of it, using the words of the project's own menus and screens that the map and the chapters use; never a name taken from these instructions.
   - Put what a reader asks first at the front: the system, the domains and the people, then the features part by part (a feature's place follows its domain in `chapters/domains.md` when there is one, else its area in `map.json`), then notifications and topics, then data, dictionaries and history, then defects and remedies last.
   - Write every part title and reason in `$LANGUAGE`, under the reader-text rules of Phase 3.
   - Every block from step 1 is in the outline exactly once: in one part's `chapters` or in `unplaced` with a reason a reader could check. Do not use `unplaced` to make the handbook shorter.
3. Phase 10 checks the outline when it assembles: `assemble` prints a line starting `Outline:` for each block that is missing, placed twice or unknown, and for each empty part. Fix `outline.json` for those lines and run `assemble` again, at most twice; then leave it, and the handbook uses the default order and says why.

Then tell the user the parts, one line each: the title and the number of chapters it holds.

---
