## Phase 4b: Data

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The data section lists the tables of the project, the migrations that build them and where each table name appears, and the value sets (status and type values: Go named types with their constants, TypeScript enums, JavaScript state objects) with the comments and display names the code gives them. A script writes all of it; you write nothing and dispatch no subagent. It needs no map.

1. Run the script and write its result into `$OUT`:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" data "$PROJECT_ROOT" "$OUT"
   ```
   It writes `$OUT/data.json` and then `$OUT/dictionaries.json` on every run, whatever an earlier run left there.
2. On exit 0, tell the user the two lines it printed (the one that starts `Data:` and the one that starts `Dictionaries:`), as they are. On any other exit, tell the user the lines it printed as they are, and stop: do not edit `data.json`, `dictionaries.json` or any other file yourself.

This section has no units: Phases 5 and 6 have nothing to verify or trace for it.

---

