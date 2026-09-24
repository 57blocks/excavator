---
name: fake-agent
description: Single dummy agent for the e2e "validate-graph fails" fixture. Its only job is to give readExpectedAgentIds/fake-claude.mjs a non-empty, matching agent set so the load check passes and the test isolates the validate-graph failure path.
---
Not a real agent; used only by tests/deploy/e2e.test.mjs.
