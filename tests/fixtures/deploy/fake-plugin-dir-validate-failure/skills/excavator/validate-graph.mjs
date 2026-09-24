#!/usr/bin/env node
/**
 * A stand-in for skills/excavator/validate-graph.mjs, used only by
 * tests/deploy/e2e.test.mjs's "stale report + validate-graph failure" case.
 * Deliberately fails without writing any output file, simulating a real
 * validate-graph.mjs crash (e.g. an unreadable graph) so the test can prove
 * run-excavator.mjs's orchestration treats a non-zero exit as an integrity
 * failure instead of trusting whatever is already on disk.
 */
process.stderr.write('fake validate-graph.mjs: simulated crash for the stale-report/non-zero-exit test\n');
process.exit(1);
