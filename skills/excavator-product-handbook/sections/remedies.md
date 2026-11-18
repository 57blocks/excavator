## Phase 8c: The remedies

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `remedies` chapter is the only chapter of the handbook that gives advice. It is written by one `excavator-handbook-writer` subagent that reads only the chapters already in `$OUT/chapters/`, never the project's code, from the numbered tables `handbook.mjs remedies-inputs` prints for the defects chapter and, when a run wrote it (Phase 8b), the design problems chapter. Its measures name those items by number (`D3`, `R12`); the script checks every number and every citation, and the assembled handbook and the page list the high-impact design problems and the P0 defects that no measure names. The script checks it with the same `check` as every chapter and records with a passed chapter a digest of the two chapters it read, so that a chapter written before the design problems existed, or before either chapter changed, is written again.

1. Make sure `$OUT/chapters/defects.md` exists. When it does not, skip this phase, tell the user in `$LANGUAGE` that the remedies need the defects chapter, and go on to the next phase.
2. Find whether `remedies` is still to write:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" remedies-state "$OUT"
   ```
   It prints `STATUS` (the recorded status or `none`), `ATTEMPTS`, `FILE` (`yes` when `chapters/remedies.md` exists) and `STALE`. `STALE=yes` means the chapter passed before the defects chapter or the design problems chapter changed, or before the design problems chapter existed: delete the file (`rm -f "$OUT/chapters/remedies.md"`) and write it as if there were no file. Otherwise treat it as Phase 5 step 1 treats a feature: `passed` or `failed` with attempts 2 is done; a file with no record is checked first; `failed` with attempts 1 is written once more with its recorded reasons (`jq -r '.chapters.remedies.reasons[]' "$OUT/state.json"`); no file and no record is written.
3. Dispatch one `excavator-handbook-writer` subagent in the foreground. Its prompt is the block **Every cross chapter** (in `stages/cross-prompt.md`) followed by the block below.
4. When it returns, check it with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" remedies --project "$PROJECT_ROOT"` and follow the result exactly as Phase 5 step 3 says. Then tell the user `Chapter remedies: <status>`, in `$LANGUAGE`.

**remedies** (`$OUT/chapters/remedies.md`):

````text
Your chapter is `remedies`, the only chapter of the handbook that gives advice. You write measures, not paragraphs. First print the numbered items you may name, and the fixed text of the chapter:

`node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" remedies-inputs "$OUT"`

`jq -r '.strings | to_entries[] | select(.key | startswith("chapter.remedies.") or .key == "chapter.none") | "\(.key)=\(.value)"' "$OUT/ui.json"`

The first command prints one line per defect (`DEFECT D<n> <level> <category> <feature ids> <short title>`) and per design problem (`DESIGN R<n> <impact> <dimension> <feature ids> <title>`), each followed by a `cites:` line with the citations of that item; a line `DESIGN none: ...` or `DEFECT none: ...` means that source is not written, and then you name no id of that kind. The second prints the fixed text; below, `<key>` stands for the value printed after that key. Read `$OUT/chapters/defects.md` and `$OUT/chapters/review.md` only where an item sends you to them for a detail, and `$OUT/entries/history.json` when that file exists (the files that change most and the files changed together). Read no other chapter. Ids come only from the printed lines; never write an id that is not printed.

Write this structure; it is the shape the reader expects. The check does not enforce the shape. It enforces only that every id exists and that every citation sits in the same paragraph or list item as the id group naming the items it was copied from (at most one id group per paragraph or list item). It also prints the items no measure names.

1. One level-1 heading, your chapter's title.
2. Four level-2 headings, once each, in this order, written exactly as the printed text: `<chapter.remedies.crossProcess>`, `<chapter.remedies.defectFixes>`, `<chapter.remedies.simplify>`, `<chapter.remedies.fix>`. No other heading of any level. Outside the headings write only list items and blank lines, no paragraph and no table. A section with nothing to say holds exactly the line `<chapter.none>`.
3. A measure is a list item that starts with a bold measure type, then one sentence saying what to do, then one id group in square brackets naming the items it rests on, like `[D3, R12]` (ids separated by a comma and a space; exactly one group per item), then the citations. The measure type is exactly one of the printed `<chapter.remedies.type.merge-entrance>` (several entrances or places that do one job become one), `<chapter.remedies.type.unify-rule>` (one rule is written once and used where today it differs), `<chapter.remedies.type.remove-step>` (a step the design does not need is dropped), `<chapter.remedies.type.automate>` (work done by hand is done by the system), `<chapter.remedies.type.retire-old>` (one of two implementations of the same function is removed) or `<chapter.remedies.type.fix>` (a defect is corrected). A measure for a design problem changes the design, not the code that implements it.
4. `<chapter.remedies.crossProcess>`: a bullet list of measures that rest on design problems of more than one feature.
5. `<chapter.remedies.defectFixes>`: one bullet for each defect category that has defects in the DEFECT lines, no more than one, starting with the bold category word exactly as printed in the DEFECT lines, then the common cause the defects of that category share in one sentence, then an id group holding D ids of that category only: every defect of that category the cause explains, every P0 defect of the category among them where the cause fits it (an id group may be long; it need not cite every item it names, but every citation must come from an item it names), then the citations. No measure type here.
6. `<chapter.remedies.simplify>`: a numbered list of 1 to 10 measures, most urgent first (a `high` design problem before a `medium` or `low` one), each naming at least one R id (a design problem).
7. `<chapter.remedies.fix>`: a numbered list of 1 to 10 measures, most urgent first (a P0 defect before a P1 or P2 one), each naming at least one D id (a defect).

Every statement about the product as it is today carries citations copied from the `cites:` lines of the items its id group names, in parentheses and separated by "; "; a citation of an item the group does not name is refused. Use the code health facts only to order the measures and to say where a measure applies; never quote a figure from them, since they cannot be cited. Rest every measure on the items it names: where the items do not settle a point, say less.

When the check passes and prints `Not named:` lines, give each listed item a measure where one of the rules above fits it (a high design problem in `<chapter.remedies.crossProcess>` or `<chapter.remedies.simplify>`, a P0 defect in its category's bullet or in `<chapter.remedies.fix>`), then run the check again, within the same limit of runs. An item no measure fits stays unnamed, and the handbook lists it.
````
