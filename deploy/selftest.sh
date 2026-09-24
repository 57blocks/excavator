#!/usr/bin/env bash
# Runner image self-test (design.md D5). Runs inside the image as the
# default non-root user. Makes no model call and needs no credentials.
#
# Prints one "PASS <check>" / "FAIL <check>: <reason>" line per check and
# exits non-zero if any check failed. Every check reads its expected value
# from the environment (EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION,
# EXCAVATOR_IMAGE_COMMIT), so `docker run -e EXCAVATOR_IMAGE_...=<wrong>`
# exercises the negative path without any special-cased test code here.

set -euo pipefail

FAILED=0

pass() {
  echo "PASS $1"
}

fail() {
  echo "FAIL $1: $2"
  FAILED=1
}

# Runs check function "$2", capturing combined stdout/stderr as the failure
# reason. IMPORTANT: because this capture happens in the condition of an
# `if`, bash's `set -e` does NOT apply inside "$fn" — a failing command
# there does not stop the function early, so a multi-step check function
# MUST check every step's own exit status explicitly (chain with `&&`, or
# `|| { ...; return 1; }` per step). Do not rely on `set -e` to fail a
# check out from under a later command that happens to succeed.
run_check() {
  local name="$1" fn="$2" out
  if out="$("$fn" 2>&1)"; then
    pass "$name"
  else
    fail "$name" "${out:-check failed with no output}"
  fi
}

# 1. Claude Code reports the version the image was built with.
check_claude_code_version() {
  : "${EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION:?EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION is not set}"
  local actual
  actual="$(claude --version 2>&1)" || {
    echo "claude --version failed: $actual"
    return 1
  }
  case "$actual" in
    *"$EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION"*) return 0 ;;
    *)
      echo "claude --version reported '$actual', expected it to contain '$EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION'"
      return 1
      ;;
  esac
}

# 2. The baked-in checkout commit equals the image's recorded commit.
# .git is excluded from the image (see .dockerignore), so this compares
# against /opt/excavator/.image-commit, written at build time from the
# EXCAVATOR_COMMIT build arg (see deploy/Dockerfile).
check_image_commit() {
  : "${EXCAVATOR_IMAGE_COMMIT:?EXCAVATOR_IMAGE_COMMIT is not set}"
  local recorded
  recorded="$(cat /opt/excavator/.image-commit 2>&1)" || {
    echo "failed to read /opt/excavator/.image-commit: $recorded"
    return 1
  }
  if [[ "$recorded" != "$EXCAVATOR_IMAGE_COMMIT" ]]; then
    echo "recorded commit '$recorded' does not match EXCAVATOR_IMAGE_COMMIT='$EXCAVATOR_IMAGE_COMMIT'"
    return 1
  fi
}

# 3. The plugin manifest checked out into the image validates.
check_plugin_validate() {
  claude plugin validate /opt/excavator
}

# 4. Both `python` and `python3` resolve (python-is-python3), and `python`
# specifically resolves to a Python 3 interpreter (not just "some binary
# named python that runs" — e.g. a shadowed Python 2, or a broken shim).
check_python() {
  local python_version python3_version version_check_err
  python_version="$(python --version 2>&1)" || {
    echo "'python --version' failed: $python_version"
    return 1
  }
  python3_version="$(python3 --version 2>&1)" || {
    echo "'python3 --version' failed: $python3_version"
    return 1
  }
  version_check_err="$(python -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' 2>&1)" || {
    echo "'python' (reports '$python_version') does not resolve to a Python 3 interpreter: $version_check_err"
    return 1
  }
}

# 5. $HOME/.excavator-plugin resolves to the checkout and looks like it.
check_plugin_symlink() {
  local resolved
  resolved="$(readlink -f "$HOME/.excavator-plugin")"
  if [[ "$resolved" != "/opt/excavator" ]]; then
    echo "\$HOME/.excavator-plugin resolves to '$resolved', expected /opt/excavator"
    return 1
  fi
  if [[ ! -f "$HOME/.excavator-plugin/package.json" ]]; then
    echo "$HOME/.excavator-plugin/package.json does not exist"
    return 1
  fi
}

# 6. System git config allowlists every directory ownership (D2's
# rationale: /work/repo is always a fresh clone made by the operator).
check_safe_directory() {
  local values
  values="$(git config --system --get-all safe.directory)"
  case "$values" in
    *'*'*) return 0 ;;
    *)
      echo "git config --system --get-all safe.directory = '$values', expected it to contain '*'"
      return 1
      ;;
  esac
}

# 7. Lazy analysis runs end-to-end on a freshly created repo (no model,
# no credentials) and produces a knowledge graph. Every step is checked
# explicitly (see the run_check note above) so a failing git or node step
# fails this check with its own output, instead of silently falling
# through to a later step that might coincidentally still succeed.
check_lazy_analyze() {
  local tmp_repo step_out

  tmp_repo="$(mktemp -d /tmp/excavator-selftest-XXXXXX)" || {
    echo "mktemp failed to create a temp repo directory"
    return 1
  }

  step_out="$(git -C "$tmp_repo" init -q 2>&1)" || {
    echo "git init failed: $step_out"
    rm -rf "$tmp_repo"
    return 1
  }
  step_out="$(git -C "$tmp_repo" config user.email "selftest@excavator.local" 2>&1)" || {
    echo "git config user.email failed: $step_out"
    rm -rf "$tmp_repo"
    return 1
  }
  step_out="$(git -C "$tmp_repo" config user.name "Excavator Selftest" 2>&1)" || {
    echo "git config user.name failed: $step_out"
    rm -rf "$tmp_repo"
    return 1
  }

  cat > "$tmp_repo/index.js" <<'EOF'
function add(a, b) {
  return a + b;
}
module.exports = { add };
EOF
  if [[ ! -f "$tmp_repo/index.js" ]]; then
    echo "failed to write $tmp_repo/index.js"
    rm -rf "$tmp_repo"
    return 1
  fi

  cat > "$tmp_repo/util.js" <<'EOF'
function greet(name) {
  return `Hello, ${name}!`;
}
module.exports = { greet };
EOF
  if [[ ! -f "$tmp_repo/util.js" ]]; then
    echo "failed to write $tmp_repo/util.js"
    rm -rf "$tmp_repo"
    return 1
  fi

  step_out="$(git -C "$tmp_repo" add -A 2>&1)" || {
    echo "git add failed: $step_out"
    rm -rf "$tmp_repo"
    return 1
  }
  step_out="$(git -C "$tmp_repo" commit -q -m "selftest: initial commit" 2>&1)" || {
    echo "git commit failed: $step_out"
    rm -rf "$tmp_repo"
    return 1
  }

  step_out="$(node /opt/excavator/skills/excavator/lazy-analyze.mjs "$tmp_repo" 2>&1)" || {
    echo "lazy-analyze.mjs failed: $step_out"
    rm -rf "$tmp_repo"
    return 1
  }

  if [[ ! -f "$tmp_repo/.excavator/knowledge-graph.json" ]]; then
    echo "$tmp_repo/.excavator/knowledge-graph.json was not produced"
    rm -rf "$tmp_repo"
    return 1
  fi

  rm -rf "$tmp_repo"
}

# ---------------------------------------------------------------------------
# 8-11. Zero-credential full-mode checks (design D5, O4/O5).
#
# These start the real `claude` binary in full mode with a local stub that
# answers every Bedrock request with 403, fake static AWS credentials, and
# IMDS disabled — so on ANY host, including an EC2 instance with a real
# instance role, no real model request can leave the container. `env -i`
# additionally strips every ambient env var (including any real AWS_* the
# host might have set) so only the fake ones listed below are visible to the
# child process.
# ---------------------------------------------------------------------------

STUB_SERVER_PID=""
STUB_SERVER_PORT=""
STUB_SERVER_COUNT_FILE=""

start_stub_server() {
  local work_dir port_file waited
  work_dir="$(mktemp -d /tmp/excavator-selftest-stub-XXXXXX)"
  STUB_SERVER_COUNT_FILE="$work_dir/count"
  port_file="$work_dir/port"
  echo 0 > "$STUB_SERVER_COUNT_FILE"

  node -e '
    const http = require("http");
    const fs = require("fs");
    const [countFile, portFile] = process.argv.slice(1);
    const server = http.createServer((req, res) => {
      const n = parseInt(fs.readFileSync(countFile, "utf-8").trim() || "0", 10) + 1;
      fs.writeFileSync(countFile, String(n));
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "forbidden", message: "stubbed by excavator-selftest: no real model access" } }));
      });
    });
    server.listen(0, "127.0.0.1", () => { fs.writeFileSync(portFile, String(server.address().port)); });
  ' "$STUB_SERVER_COUNT_FILE" "$port_file" &
  STUB_SERVER_PID=$!

  waited=0
  while [[ ! -s "$port_file" ]]; do
    sleep 0.1
    waited=$((waited + 1))
    if [[ "$waited" -gt 50 ]]; then
      echo "stub 403 server did not start within 5s"
      return 1
    fi
  done
  STUB_SERVER_PORT="$(cat "$port_file")"
}

stop_stub_server() {
  if [[ -n "$STUB_SERVER_PID" ]]; then
    kill "$STUB_SERVER_PID" 2>/dev/null || true
    wait "$STUB_SERVER_PID" 2>/dev/null || true
    STUB_SERVER_PID=""
  fi
}

stub_request_count() {
  if [[ -f "$STUB_SERVER_COUNT_FILE" ]]; then
    cat "$STUB_SERVER_COUNT_FILE"
  else
    echo 0
  fi
}

# The zero-credential env block (AWS_REGION, ANTHROPIC_MODEL, the stub URL,
# fake static credentials, AWS_EC2_METADATA_DISABLED) is repeated inline in
# each check below rather than built by a shared helper: `env -i KEY=VAL ...`
# assignments are not safely composable through command substitution/word
# splitting, and the block is short enough that inlining stays obviously
# correct.

make_tmp_repo() {
  local dir
  dir="$(mktemp -d /tmp/excavator-selftest-repo-XXXXXX)"
  git -C "$dir" init -q
  git -C "$dir" config user.email "selftest@excavator.local"
  git -C "$dir" config user.name "Excavator Selftest"
  echo 'module.exports = { ok: true };' > "$dir/index.js"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "selftest: initial commit"
  echo "$dir"
}

# A decoy repo carrying a marker-writing SessionStart hook, a decoy MCP
# server, and a same-named decoy "excavator" skill (spec: "诱饵仓库"
# scenario). Prints "<repoPath><TAB><markerFilePath>".
setup_decoy_repo() {
  local repo marker_dir marker_file
  repo="$(mktemp -d /tmp/excavator-selftest-decoy-XXXXXX)"
  marker_dir="$(mktemp -d /tmp/excavator-selftest-marker-XXXXXX)"
  marker_file="$marker_dir/session-start-marker"

  mkdir -p "$repo/.claude/skills/excavator"
  cat > "$repo/.claude/settings.json" <<EOF
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "touch $marker_file" } ] }
    ]
  }
}
EOF
  cat > "$repo/.mcp.json" <<'EOF'
{
  "mcpServers": {
    "excavator-selftest-decoy-mcp": {
      "command": "sh",
      "args": ["-c", "echo excavator-selftest-decoy-mcp should never start"]
    }
  }
}
EOF
  cat > "$repo/.claude/skills/excavator/SKILL.md" <<'EOF'
---
name: excavator
description: excavator-selftest-decoy-skill-marker -- must never be loaded by the runner image.
---
This decoy skill proves the runner image never loads a project-local skill,
even one with the same name as the real Excavator skill.
EOF
  echo 'module.exports = { ok: true };' > "$repo/index.js"

  git -C "$repo" init -q
  git -C "$repo" config user.email "selftest@excavator.local"
  git -C "$repo" config user.name "Excavator Selftest"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "selftest: decoy repo"

  printf '%s\t%s\n' "$repo" "$marker_file"
}

# 8. Load probe (O4): full mode against the stub must pass the load check
# and still end the run in failure (the stub always 403s).
check_load_probe() {
  local repo out status load_status count
  start_stub_server || return 1
  repo="$(make_tmp_repo)"
  out="$(mktemp -d /tmp/excavator-selftest-out-XXXXXX)"

  set +e
  env -i PATH="$PATH" HOME="$HOME" \
    EXCAVATOR_MODE=full \
    EXCAVATOR_REPO_ROOT_OVERRIDE="$repo" \
    EXCAVATOR_OUT_DIR_OVERRIDE="$out" \
    AWS_REGION=eu-central-1 \
    ANTHROPIC_MODEL=eu.anthropic.claude-sonnet-5 \
    CLAUDE_CODE_USE_BEDROCK=1 \
    EXCAVATOR_MAX_BUDGET_USD=1 \
    EXCAVATOR_TIMEOUT_MINUTES=2 \
    ANTHROPIC_BEDROCK_BASE_URL="http://127.0.0.1:$STUB_SERVER_PORT" \
    AWS_ACCESS_KEY_ID=FAKEACCESSKEYID00000 \
    AWS_SECRET_ACCESS_KEY=FAKESECRETACCESSKEY00000000000000000000 \
    AWS_SESSION_TOKEN=FAKESESSIONTOKEN00000000000000000000000000000000 \
    AWS_EC2_METADATA_DISABLED=true \
    excavator-run
  status=$?
  set -e
  stop_stub_server

  if [[ "$status" -ne 3 ]]; then
    echo "expected exit code 3 (run failure against the stubbed endpoint), got $status"
    rm -rf "$repo" "$out"
    return 1
  fi

  load_status="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8")).checks.load.status); } catch (e) { console.log("unavailable: " + e.message); }' "$out/summary.json")"
  count="$(stub_request_count)"
  rm -rf "$repo" "$out"

  if [[ "$load_status" != "passed" ]]; then
    echo "summary.json checks.load.status = '$load_status', expected 'passed'"
    return 1
  fi
  if [[ "$count" -lt 1 ]]; then
    echo "stub endpoint received $count request(s), expected at least 1"
    return 1
  fi
  echo "stub endpoint received $count request(s); load check passed; run correctly ended in failure (exit 3)"
}

# 9. Isolation (O5): the decoy repo's hook/MCP-server/skill must not fire,
# and the plugin actually loaded must still be the real one at /opt/excavator.
check_isolation() {
  local repo marker_file out status leaked load_status
  start_stub_server || return 1
  IFS=$'\t' read -r repo marker_file <<< "$(setup_decoy_repo)"
  out="$(mktemp -d /tmp/excavator-selftest-out-XXXXXX)"

  set +e
  env -i PATH="$PATH" HOME="$HOME" \
    EXCAVATOR_MODE=full \
    EXCAVATOR_REPO_ROOT_OVERRIDE="$repo" \
    EXCAVATOR_OUT_DIR_OVERRIDE="$out" \
    AWS_REGION=eu-central-1 \
    ANTHROPIC_MODEL=eu.anthropic.claude-sonnet-5 \
    CLAUDE_CODE_USE_BEDROCK=1 \
    EXCAVATOR_MAX_BUDGET_USD=1 \
    EXCAVATOR_TIMEOUT_MINUTES=2 \
    ANTHROPIC_BEDROCK_BASE_URL="http://127.0.0.1:$STUB_SERVER_PORT" \
    AWS_ACCESS_KEY_ID=FAKEACCESSKEYID00000 \
    AWS_SECRET_ACCESS_KEY=FAKESECRETACCESSKEY00000000000000000000 \
    AWS_SESSION_TOKEN=FAKESESSIONTOKEN00000000000000000000000000000000 \
    AWS_EC2_METADATA_DISABLED=true \
    excavator-run
  status=$?
  set -e
  stop_stub_server

  leaked=0
  if [[ -e "$marker_file" ]]; then
    echo "isolation leak: the decoy SessionStart hook's marker file was created"
    leaked=1
  fi
  if [[ -f "$out/run.jsonl" ]] && grep -q "excavator-selftest-decoy-mcp" "$out/run.jsonl"; then
    echo "isolation leak: the decoy MCP server name appeared in run.jsonl"
    leaked=1
  fi
  if [[ -f "$out/run.jsonl" ]] && grep -q "excavator-selftest-decoy-skill-marker" "$out/run.jsonl"; then
    echo "isolation leak: the decoy skill's marker text appeared in run.jsonl"
    leaked=1
  fi

  load_status="unavailable"
  if [[ -f "$out/summary.json" ]]; then
    load_status="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8")).checks.load.status); } catch (e) { console.log("unavailable: " + e.message); }' "$out/summary.json")"
  fi
  if [[ "$load_status" != "passed" ]]; then
    echo "summary.json checks.load.status = '$load_status', expected 'passed' (the real excavator plugin should still load fully)"
    leaked=1
  fi

  rm -rf "$repo" "$out" "$(dirname "$marker_file")"

  if [[ "$leaked" -eq 0 ]]; then
    echo "no marker file, no decoy MCP server, no decoy skill text; real excavator plugin loaded normally (run exited $status as expected)"
    return 0
  fi
  return 1
}

# 10. Control for the isolation check (proves it is not blind): the SAME
# decoy repo, launched naively (cwd inside it, no --setting-sources user, no
# disableAllHooks) must show at least one leak signal. If it does not, the
# isolation check above cannot be trusted, so this is reported as a failure.
check_isolation_control() {
  local repo marker_file control_log leaked
  start_stub_server || return 1
  IFS=$'\t' read -r repo marker_file <<< "$(setup_decoy_repo)"
  control_log="$(mktemp /tmp/excavator-selftest-control-XXXXXX.jsonl)"

  set +e
  (
    cd "$repo" && env -i PATH="$PATH" HOME="$HOME" \
      AWS_REGION=eu-central-1 \
      ANTHROPIC_MODEL=eu.anthropic.claude-sonnet-5 \
      CLAUDE_CODE_USE_BEDROCK=1 \
      ANTHROPIC_BEDROCK_BASE_URL="http://127.0.0.1:$STUB_SERVER_PORT" \
      AWS_ACCESS_KEY_ID=FAKEACCESSKEYID00000 \
      AWS_SECRET_ACCESS_KEY=FAKESECRETACCESSKEY00000000000000000000 \
      AWS_SESSION_TOKEN=FAKESESSIONTOKEN00000000000000000000000000000000 \
      AWS_EC2_METADATA_DISABLED=true \
      timeout 90 claude -p "/excavator:excavator $repo --full" \
        --plugin-dir /opt/excavator \
        --model eu.anthropic.claude-sonnet-5 \
        --permission-mode bypassPermissions --permission-prompts none \
        --max-budget-usd 1 --no-session-persistence \
        --output-format stream-json --verbose < /dev/null > "$control_log" 2>/dev/null
  )
  set -e
  stop_stub_server

  leaked=0
  if [[ -e "$marker_file" ]]; then leaked=1; fi
  if grep -q "excavator-selftest-decoy-mcp" "$control_log" 2>/dev/null; then leaked=1; fi
  if grep -q "excavator-selftest-decoy-skill-marker" "$control_log" 2>/dev/null; then leaked=1; fi

  rm -rf "$repo" "$(dirname "$marker_file")" "$control_log"

  if [[ "$leaked" -eq 0 ]]; then
    echo "the naive control run showed NO leak at all -- the isolation check above would be blind to a real leak"
    return 1
  fi
  echo "the naive control run leaked as expected (marker file and/or decoy server/skill observed), proving the isolation check can detect a real leak"
}

# 11. lazy + MCP (O6's local half): a lazy run followed by mcp-smoke.mjs
# calling all seven tools over stdio, on a disposable synthetic repo. The
# wcp-auth comparison this task's spec also asks for is a separate, manual,
# real-corpus check outside this self-test (never run against real
# workspace data from inside the image's own checks).
check_mcp_smoke() {
  local repo lazy_out smoke_out status pass_count
  repo="$(make_tmp_repo)"

  lazy_out="$(node /opt/excavator/skills/excavator/lazy-analyze.mjs "$repo" 2>&1)" || {
    echo "lazy-analyze.mjs failed before mcp-smoke: $lazy_out"
    rm -rf "$repo"
    return 1
  }

  smoke_out="$(node /opt/excavator/deploy/mcp-smoke.mjs --project-root "$repo" 2>&1)"
  status=$?
  rm -rf "$repo"

  if [[ "$status" -ne 0 ]]; then
    echo "mcp-smoke.mjs failed (exit $status): $smoke_out"
    return 1
  fi
  pass_count="$(echo "$smoke_out" | grep -c '^PASS ' || true)"
  if [[ "$pass_count" -ne 7 ]]; then
    echo "mcp-smoke.mjs reported $pass_count PASS line(s), expected 7: $smoke_out"
    return 1
  fi
  echo "mcp-smoke: 7/7 tools passed"
}

run_check "claude-code-version" check_claude_code_version
run_check "image-commit" check_image_commit
run_check "plugin-validate" check_plugin_validate
run_check "python" check_python
run_check "plugin-symlink" check_plugin_symlink
run_check "safe-directory" check_safe_directory
run_check "lazy-analyze" check_lazy_analyze
run_check "load-probe" check_load_probe
run_check "isolation" check_isolation
run_check "isolation-control" check_isolation_control
run_check "mcp-smoke" check_mcp_smoke

exit "$FAILED"
