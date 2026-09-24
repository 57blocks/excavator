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

run_check "claude-code-version" check_claude_code_version
run_check "image-commit" check_image_commit
run_check "plugin-validate" check_plugin_validate
run_check "python" check_python
run_check "plugin-symlink" check_plugin_symlink
run_check "safe-directory" check_safe_directory
run_check "lazy-analyze" check_lazy_analyze

exit "$FAILED"
