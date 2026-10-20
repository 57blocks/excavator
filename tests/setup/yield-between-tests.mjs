// Vitest runs the tests of a file back to back on microtasks and never returns
// to the event loop between them. A file of synchronous tests (execFileSync /
// spawnSync on git, the skill scripts, the analysis pipeline) therefore holds
// its worker's event loop for the whole file. The worker's RPC calls to the
// main process (onTaskUpdate) time out after 60s; once the loop is blocked
// that long, the timeout timer fires before the queued reply is read, and the
// run ends with an unhandled "[vitest-worker]: Timeout calling onTaskUpdate"
// error and exit 1 even though every test passed.
//
// Yielding one macrotask after each test lets the worker read its replies, so
// the longest block is one test plus its hooks, which testTimeout (20s) caps
// well below the RPC timeout.
import { afterEach } from 'vitest';

// Captured at load so a test that leaves fake timers installed cannot stall this hook.
const { setImmediate } = globalThis;

afterEach(() => new Promise((resolve) => setImmediate(resolve)));
