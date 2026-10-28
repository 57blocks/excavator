## 1. Correct repository references

- [x] 1.1 Correct repository references and inaccurate README descriptions against current implementation; verify no previous-owner reference remains in tracked content, command examples name shipped skills, and every corrected behavior has source evidence.
- [x] 1.2 Filter service-only contract checks to actual skill directories; verify regular files do not crash discovery and a genuine skill with forbidden browser-opener content is still detected, with the real metadata file left in place.

## 2. Verify and deliver

- [x] 2.1 Run the frozen dependency install, workspace builds, root tests, reference checks and strict OpenSpec validation; record the results. Frozen install and all workspace builds succeeded; references resolved for 19 skills and 12 agents; OpenSpec validated 54 items. Final `pnpm test --maxWorkers=4`: 254 files passed, 6062 tests passed, 4 skipped, with the original metadata file present. An earlier parallel run's deployment timeout case passed in an isolated 8-test rerun before the complete bounded-worker run passed.
- [x] 2.2 Open one medium-tier PR with the required description and obtain a fresh-context Codex review under the user's task-specific model authorization; verify the final diff and review outcome. PR #94 was reviewed at 59aa0b13: 0 Important, 1 Nit, 0 Pre-existing. The Git-root wording correction is ready in the follow-up diff.

Merge gate: wait for both required checks on the final head, answer and resolve the review thread, and confirm the branch is synchronized with main before merging. These delivery checks are recorded on the PR rather than requiring another source commit after every CI result.
