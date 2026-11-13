## Phase 8b: The design problems

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `review` chapter looks across the features for what the chapters show to be badly designed, not wrongly coded. It is optional: it runs only when `$SECTIONS` holds `review` (`--review` or `--sections review`). This part of the phase only checks that it may run; the writing steps are not part of this version of the skill yet, so after the check you tell the user so and go on.

1. Check that the features have their chapters:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" --before review --project "$PROJECT_ROOT"
   ```
   - Exit 0: tell the user, in `$LANGUAGE`, that the design problems are not written by this version, and go on to the next phase.
   - Exit 1 in a run that selected `features`: go back to Phase 5 for the features it lists, then run this command again. When it still exits 1, tell the user the lines it printed and go on to the next phase.
   - Exit 1 in a run that did not select `features`: skip this phase. Tell the user, in `$LANGUAGE`, what the lines say is missing (no map, or how many features have no chapter) and that `--sections features` writes the chapters. The remedies are written all the same, without design problems to read.
   - Exit 2: show its message and stop.
