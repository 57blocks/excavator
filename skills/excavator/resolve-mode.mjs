// resolve-mode.mjs
//
// Slice A / Task 3 of the lazy-mode plan (openspec: changes/lazy-first-run,
// capability `lazy-analysis`). Pure resolution of `analysisMode` per the
// "analysisMode config and --mode flag" requirement:
//
//   - default: lazy
//   - `--mode=lazy|full` overrides ONE run only; never written to config.json
//   - `--full` is equivalent to `--mode=full` PLUS a forced rebuild; also
//     never persisted (this preserves the pre-existing `--full` flag's
//     meaning: an unconditional full analysis, matching the decision table's
//     existing "`--full` flag in $ARGUMENTS -> Full analysis (all phases)"
//     row)
//   - a stored `config.json` `analysisMode` wins when no flag is given
//   - flipping the default to lazy MUST NOT cause an existing full graph to
//     be wiped or downgraded: this function never returns a "wipe" signal
//     for a plain lazy default — `forceRebuild` is only ever true for
//     `--full`.
//
// No I/O: `resolveMode` is a pure function of its two inputs. The caller
// (SKILL.md's Phase 0 orchestration) reads `$ARGUMENTS` and `config.json`,
// tokenizes/parses them, and passes the results in; it also owns actually
// writing `config.json` when `persist` is present in the return value.
// `lazy-analyze.mjs` (the Lazy driver) does not call this module — mode
// resolution and dispatch happen once, in SKILL.md's Phase 0, before the
// driver is ever invoked.
//
// Contract: openspec/changes/lazy-first-run/specs/lazy-analysis/spec.md

const VALID_MODES = new Set(['lazy', 'full']);

/**
 * Parse the analysis-mode-related flags out of an argv token array. Accepts
 * both `--mode=<value>` (the form used in the spec's scenarios) and the
 * two-token `--mode <value>` form (matching this repo's other bundled
 * scripts, e.g. `structure-all.mjs --chunk-size <n>`), for robustness against
 * either tokenization of `$ARGUMENTS`.
 *
 * @param {string[]} argv
 * @returns {{ full: boolean, mode: string|null }}
 */
function parseModeFlags(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  let full = false;
  let mode = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (typeof tok !== 'string') continue;
    if (tok === '--full') {
      full = true;
      continue;
    }
    if (tok.startsWith('--mode=')) {
      mode = tok.slice('--mode='.length);
      continue;
    }
    if (tok === '--mode') {
      const value = tokens[i + 1];
      if (typeof value === 'string' && !value.startsWith('--')) {
        mode = value;
        i++;
      }
      continue;
    }
  }
  return { full, mode };
}

/**
 * Resolve the analysis mode for one `/excavator` invocation.
 *
 * Precedence (highest first): `--full` > `--mode=<value>` > stored
 * `config.analysisMode` > default (`lazy`).
 *
 * @param {{ argv?: string[], config?: { analysisMode?: string } }} [args]
 * @returns {{
 *   mode: 'lazy'|'full',
 *   forceRebuild: boolean,
 *   persist?: { analysisMode: string },
 * }}
 */
export function resolveMode({ argv = [], config = {} } = {}) {
  const flags = parseModeFlags(argv);

  // `--full` wins outright: forced full rebuild, single-run, never
  // persisted. This is the pre-existing `--full` flag's meaning, unchanged
  // by this slice.
  if (flags.full) {
    return { mode: 'full', forceRebuild: true };
  }

  // `--mode=lazy|full` overrides this run only; config.json is untouched.
  if (flags.mode !== null) {
    if (!VALID_MODES.has(flags.mode)) {
      throw new Error(`resolve-mode: --mode must be "lazy" or "full", got "${flags.mode}"`);
    }
    return { mode: flags.mode, forceRebuild: false };
  }

  // No flag: a stored preference wins.
  const stored = config && typeof config === 'object' ? config.analysisMode : undefined;
  if (VALID_MODES.has(stored)) {
    return { mode: stored, forceRebuild: false };
  }

  // No flag, no stored preference: the default is lazy. `forceRebuild` stays
  // false — the "existing full graph not wiped" scenario holds because this
  // branch never signals a rebuild/wipe of any kind, whether or not a full
  // graph already sits on disk from a prior run. `persist` bootstraps the
  // now-explicit default into config.json (mirrors the existing
  // `outputLanguage` first-run persistence in SKILL.md Phase 0, "Persist the
  // resolved $OUTPUT_LANGUAGE ... so it never re-prompts for this project")
  // so subsequent runs read an explicit value instead of re-deriving it.
  return { mode: 'lazy', forceRebuild: false, persist: { analysisMode: 'lazy' } };
}

export default { resolveMode };
