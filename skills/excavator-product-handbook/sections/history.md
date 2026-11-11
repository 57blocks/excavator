## Phase 4e: History

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The history section is the code health chapter: the commits of each year, the first and last commit, the commits and authors of each application, the files that change most, the files changed together across applications, and the source and test files of each application. A script computes all of it from git and the project files; you write nothing and dispatch no subagent. It needs no map. It reads the project with read-only commands and writes nothing under it.

1. Run the script and write its result into `$OUT`:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" history "$OUT" --project "$PROJECT_ROOT"
   ```
   It writes `$OUT/entries/history.json` on every run, whatever an earlier run left there.
2. On exit 0, tell the user the one line it printed (it starts `History:`), as it is. On any other exit, tell the user the lines it printed as they are, and stop: do not edit `history.json` or any other file yourself.

This section has no units: it writes nothing a model checks.

---
