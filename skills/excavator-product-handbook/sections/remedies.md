## Phase 8c: The remedies

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `remedies` chapter is the only chapter of the handbook that gives advice. It is written by one `excavator-handbook-writer` subagent that reads only the chapters already in `$OUT/chapters/`, never the project's code, and it covers the defects chapter and, when a run wrote it (Phase 8b), the design problems chapter. The script checks it with the same `check` as every chapter and records with a passed chapter a digest of the two chapters it read, so that a chapter written before the design problems existed, or before either chapter changed, is written again.

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
Your chapter is `remedies`, the only chapter of the handbook that gives advice. Read `$OUT/chapters/defects.md`; `$OUT/chapters/review.md` when that file exists (`ls "$OUT/chapters"` shows it), which lists the design problems; and the code health facts in `$OUT/entries/history.json` when that file exists (the files that change most and the files changed together). Read no other chapter unless a defect or a design problem sends you to it.

For each category that has defects, a level-2 heading with: the common cause the defects of that category share, in one or two sentences, each with the citations copied from the defects it rests on; and the measure that would remove that cause, as a list. When `review.md` exists, do the same for each dimension that has items there (its level-2 headings other than the counts table): a level-2 heading with the dimension's name as `review.md` writes it, the common cause its items share, in one or two sentences, each with the citations copied from the items it rests on, and the measures that would remove that cause, as a list; a measure for a design problem changes the design, not the code that implements it. Then a level-2 heading for the recommendations: 1 to 10 numbered items, most urgent first, each saying what to do, which defects or design problems it addresses and the copied citations of those. Name a defect by its level and feature, and a design problem by its title and its features. A statement about the product as it is today must rest on copied citations; a recommendation rests on the defects and design problems it names. Use the code health facts only to order the recommendations and to say where a measure applies; never quote a figure from them, since they cannot be cited.
````
