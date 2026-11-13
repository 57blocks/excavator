## Phase 8c: The remedies

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `remedies` chapter is the only chapter of the handbook that gives advice. It is written by one `excavator-handbook-writer` subagent that reads only the chapters already in `$OUT/chapters/`, never the project's code. The script checks it with the same `check` as every chapter.

1. Make sure `$OUT/chapters/defects.md` exists. When it does not, skip this phase, tell the user in `$LANGUAGE` that the remedies need the defects chapter, and go on to the next phase.
2. Find whether `remedies` is still to write:
   ```bash
   jq -r --arg n "remedies" '(.chapters[$n] // {status: "none", attempts: 0}) | [$n, .status, .attempts] | @tsv' "$OUT/state.json"
   ```
   Treat it as Phase 5 step 1 treats a feature: `passed` or `failed` with attempts 2 is done; a file with no record is checked first; `failed` with attempts 1 is written once more with its recorded reasons; no file and no record is written.
3. Dispatch one `excavator-handbook-writer` subagent in the foreground. Its prompt is the block **Every cross chapter** (in `stages/cross-prompt.md`) followed by the block below.
4. When it returns, check it with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" remedies --project "$PROJECT_ROOT"` and follow the result exactly as Phase 5 step 3 says. Then tell the user `Chapter remedies: <status>`, in `$LANGUAGE`.

**remedies** (`$OUT/chapters/remedies.md`):

````text
Your chapter is `remedies`, the only chapter of the handbook that gives advice. Read `$OUT/chapters/defects.md`, and the code health facts in `$OUT/entries/history.json` when that file exists (the files that change most and the files changed together); read no other chapter unless a defect sends you to it.

For each category that has defects, a level-2 heading with: the common cause the defects of that category share, in one or two sentences, each with the citations copied from the defects it rests on; and the measure that would remove that cause, as a list. Then a level-2 heading for the recommendations: 1 to 10 numbered items, most urgent first, each saying what to do, which defects it addresses (by level and feature) and the copied citations of those defects. A statement about the product as it is today must rest on copied citations; a recommendation rests on the defects it names. Use the code health facts only to order the recommendations and to say where a measure applies; never quote a figure from them, since they cannot be cited.
````
