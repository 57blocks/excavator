# Runner image: deploy contract

This is the operator (DevOps) entry point for running Excavator as a container on AWS Bedrock. It documents what the image is, what `docker run -e ...` accepts, what it produces, and the security and release preconditions. The decisions behind this contract are in the OpenSpec change `runner-image` (its `design.md`, under `openspec/changes/` or, once archived, `openspec/changes/archive/`); this document only states the contract itself.

## What the image is

The runner image bundles a pinned Excavator checkout (built: dependencies and `packages/core/dist` are already present) and a pinned Claude Code install into a single non-root container. It has no build toolchain, no cloud credentials, no git credentials, and no target-repo source or `.excavator/` products baked in.

**One container processes one mounted repository and performs one run.** There is no batching, no scheduling, and no repository cloning inside the container — the operator (a VM, ECS task, or CodeBuild job) supplies an already-cloned repository and reads the results back from a mounted output directory. Two fixed mount points:

- `/work/repo` — the target repository. **Must be a clone the operator made and maintains** (created with `git clone`, updated only with `git fetch`/`git checkout` by the operator), never a copy of someone's working tree and never a directory whose `.git` was copied in from elsewhere (the image trusts this directory's `.git/config`; see [Security preconditions](#security-preconditions)). It may persist between runs so that `.excavator/` from the previous run enables incremental `full` runs and the unchanged-HEAD skip. Writable — products are written into its `.excavator/`.
- `/work/out` — run output. Writable — `run.jsonl`, `summary.json`, `validation.json`, `validated-graph.json` land here (see [Exit codes and output files](#exit-codes-and-output-files)).

The container **always runs as uid 10001** (baked in; the entrypoint needs to write to its own `$HOME`). Do not pass `--user` to override it. Both mount points must be writable by uid 10001 on the host (or in the volume backing them).

On EC2, the **IMDSv2 hop limit must be at least 2** — Claude Code inside the container needs to reach the instance metadata service through the container network to pick up the instance role's Bedrock credentials, which is one network hop further than IMDSv2's default hop limit of 1 allows.

## `docker run` examples

Lazy mode calls Excavator's deterministic analysis directly, never starts Claude Code, and needs no AWS credentials or region/model configuration:

```sh
docker run --rm \
  -v /path/to/clean-clone:/work/repo \
  -v /path/to/out:/work/out \
  -e EXCAVATOR_MODE=lazy \
  <registry>/<repository>:<tag>
```

Full mode starts Claude Code against Bedrock in the EU:

```sh
docker run --rm \
  -v /path/to/clean-clone:/work/repo \
  -v /path/to/out:/work/out \
  -e EXCAVATOR_MODE=full \
  -e AWS_REGION=eu-central-1 \
  -e ANTHROPIC_MODEL=eu.anthropic.claude-sonnet-5 \
  -e EXCAVATOR_MAX_BUDGET_USD=5 \
  <registry>/<repository>:<tag>
```

On EC2/ECS with an instance/task role, no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are needed — Claude Code picks up Bedrock credentials from the role via IMDS (see the hop-limit note above).

The image's self-test (no model call, no credentials needed) runs by overriding the entrypoint:

```sh
docker run --rm --entrypoint excavator-selftest <registry>/<repository>:<tag>
```

## Environment variables

### (a) Runtime parameters the operator passes

<!-- runtime-params-table:start -->
This is the exact set exported by `deploy/run-excavator.mjs`'s `RUNTIME_PARAMS` constant — `tests/deploy/docs-contract.test.mjs` asserts the two are identical in both directions.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `EXCAVATOR_MODE` | Yes | — | `lazy` or `full`. Any other value is a configuration error. |
| `EXCAVATOR_MAX_BUDGET_USD` | Only in `full` mode | — | Positive number (USD). Passed to Claude Code as `--max-budget-usd`; the run stops and is judged a run failure if it is exceeded. Not read in `lazy` mode. |
| `EXCAVATOR_FORCE` | No | `false` | Boolean-like (`1`/`0`/`true`/`false`/`yes`/`no`). When true, forces a full rebuild (`--full`) in `full` mode even if existing full-mode products already match HEAD. |
| `EXCAVATOR_MAX_CONTRADICTED` | No | `0` | Non-negative integer. Maximum number of `contradicted` nodes+edges (combined) the post-run independent re-validation may find before the run is judged fabrication. `full` mode only. |
| `EXCAVATOR_TIMEOUT_MINUTES` | No | `180` | Positive number. Wall-clock timeout for the `full` Claude Code run; on expiry the process is sent `SIGINT`, then `SIGTERM` after a grace period, and the run is judged a run failure. Not used by `lazy`. |
| `AWS_REGION` | Only in `full` mode | — | Claude Code's own variable; the Bedrock region, e.g. `eu-central-1`. |
| `ANTHROPIC_MODEL` | Only in `full` mode | — | Claude Code's own variable; the model/inference-profile ID, e.g. `eu.anthropic.claude-sonnet-5`. Recorded into the knowledge graph as the run's model. |
<!-- runtime-params-table:end -->

Any required parameter that is missing or invalid ends the run with the configuration-error exit code before anything is written or any process is started (see the exit-code table below).

**Claude Code's own model-alias pins** — such as `ANTHROPIC_DEFAULT_SONNET_MODEL` or `ANTHROPIC_DEFAULT_HAIKU_MODEL` — may be passed through to `docker run -e ...` like any other environment variable and Claude Code will honor them, but `run-excavator.mjs` itself never reads them; they are not part of the table above.

**Testing-only seams** (never set these against the real image; they exist so `tests/deploy/` and `deploy/selftest.sh` can point the runner at fixtures instead of the fixed mount points and the real `claude` binary): `EXCAVATOR_REPO_ROOT_OVERRIDE`, `EXCAVATOR_OUT_DIR_OVERRIDE`, `EXCAVATOR_PLUGIN_DIR_OVERRIDE`, `EXCAVATOR_CLAUDE_BIN_OVERRIDE`, `EXCAVATOR_TIMEOUT_GRACE_SECONDS_OVERRIDE`.

### (b) Values baked into the image (informational)

Set at build time in `deploy/Dockerfile`; not operator-configurable. Listed so the values in a `docker inspect` or a self-test failure are legible, not as a `docker run -e ...` reference.

| Variable | Baked value | Source |
|---|---|---|
| `EXCAVATOR_IMAGE_COMMIT` | the `EXCAVATOR_COMMIT` build arg (required, no default) | records the Excavator commit the image was built from; also the OCI label `org.opencontainers.image.revision` |
| `EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION` | the `CLAUDE_CODE_VERSION` build arg (default `2.1.281`) | records the pinned Claude Code version; also the label `com.excavator.claude-code-version` |
| `CLAUDE_CODE_USE_BEDROCK` | `1` | routes Claude Code at Bedrock instead of the Anthropic API |
| `DISABLE_UPDATES` | `1` | Claude Code never self-updates |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | |
| `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` | `1` | |
| `MCP_TOOL_TIMEOUT` | `600000` (ms) | |
| `BASH_DEFAULT_TIMEOUT_MS` | `600000` | |
| `BASH_MAX_TIMEOUT_MS` | `1800000` | |

## Exit codes and output files

| Exit code | Meaning |
|---|---|
| `0` | Success, or a `full` run skipped because existing products already match HEAD. |
| `2` | Configuration error: a required parameter was missing or invalid. Nothing is written; the reason goes to stderr only. |
| `3` | Run failure: Claude Code failed to start, errored, timed out, stopped at the budget cap or another non-success terminal state, recorded permission denials, or reported failed subagents (or its result lacked the fields needed to tell). `lazy`: the Lazy driver exited non-zero. |
| `4` | Load or product/structural-integrity failure: the plugin, its MCP server, its agents, or the subagent-dispatch tool did not fully load; the produced commit or model stamp did not match; or the independent re-validation found structural integrity issues or could not run. |

When several stages fail, the exit code is the first failing stage in the order configuration → load → run → products/integrity → fabrication; `summary.json` still records every check that could be evaluated.
| `5` | Fabrication over threshold: the independent re-validation found more `contradicted` nodes/edges than `EXCAVATOR_MAX_CONTRADICTED` allows, or summary verification was skipped entirely (a skip is never counted as zero fabrication). |

**Products already in `/work/repo/.excavator/` are never deleted or modified by the runner on any failure path** — a failing run always leaves the last good product (or none) in place.

Files written to `/work/out` (all absent on a `2` exit; `run.jsonl`/`validation.json`/`validated-graph.json` absent on a skipped `0` exit, since no Claude Code run happened):

- `summary.json` — the deterministic verdict: image commit and Claude Code version, target repo HEAD, mode, model, one status + reasons per check, token counts by kind (input/cache-write/cache-read/output), estimated cost, contradicted/unverified counts, and a cache-read warning. Written for every run except a configuration error.
- `run.jsonl` — the raw `stream-json` events from the Claude Code `-p` session. `full` mode only.
- `validation.json` — `validate-graph.mjs`'s independent structural-integrity report for the post-run graph (an `issues[]` array; non-empty means a `4` exit).
- `validated-graph.json` — the knowledge graph re-annotated by that same independent pass with a per-node/per-edge `verification` status (`verified` / `unverified` / `contradicted` / `dirty`).

**Cost figures are estimates, not a bill.** `summary.json`'s `estimatedCostUsd` (and the underlying `result` event's own `total_cost_usd`) is Claude Code's client-side estimate at official list prices. It does not reflect Bedrock's EU-region pricing, which runs roughly 10% above the price this estimate assumes. Treat AWS's own billing as authoritative for actual spend.

## Security preconditions

`full` mode runs Claude Code with `--permission-mode bypassPermissions` (see design D3): Excavator executes shell commands the analyzed repository's content can influence, without per-command confirmation. This is a deliberate tradeoff — the alternative (an allowlist, or an auto-classifying permission mode) is either too brittle for Excavator's varied shell usage or itself calls a model with unpredictable results. The isolation boundary is therefore pushed to the container and the host, not the permission prompt:

- The instance/task role attached to the host **must be limited to Bedrock invocation** (see [IAM minimum permissions](#iam-minimum-permissions) below) — no other AWS credentials should be reachable from inside the container.
- No git credentials live in the container or the image; the host's git credentials (used only to produce the clone at `/work/repo`) should be read-only.
- Network egress from the container should be restricted to what Bedrock and its VPC endpoints need (see below); no general internet access.
- Each `/work/repo` must be dedicated to this image: a clone the operator created and updates only with `git fetch`/`git checkout`, not a developer's checkout and not shared with other tools. Nothing else should write to it between runs; if a run's output is ever in doubt, delete the directory and clone again (the next `full` run then rebuilds from scratch).

## IAM minimum permissions

Minimal, EU-only Bedrock invoke access. Replace `<ACCOUNT_ID>` and tighten `Resource` to the specific inference profile(s) in use; this is an example, not a policy to paste in unmodified.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeEuOnly",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:eu-central-1:<ACCOUNT_ID>:inference-profile/eu.*",
        "arn:aws:bedrock:eu-*::foundation-model/*"
      ]
    },
    {
      "Sid": "BedrockDiscoverInferenceProfiles",
      "Effect": "Allow",
      "Action": [
        "bedrock:ListInferenceProfiles",
        "bedrock:GetInferenceProfile"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyGlobalCrossRegionInference",
      "Effect": "Deny",
      "Action": "bedrock:*",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "aws:RequestedRegion": "unspecified" },
        "ArnLike": { "bedrock:InferenceProfileArn": "arn:aws:bedrock:*:*:inference-profile/global.*" }
      }
    }
  ]
}
```

The deny statement is only needed when data must not leave the EU. A `global.*` inference profile can route a request to any commercial AWS region; when Bedrock authorizes such a request, it evaluates the region-agnostic foundation-model resource with `aws:RequestedRegion` set to the literal string `unspecified` (it is not absent, so a `Null` condition would never match). The statement above follows AWS's documented pattern for disabling global cross-Region inference; the `eu.*` profiles used here keep routing inside EU regions and are unaffected. Omit it if global routing is acceptable. If your organization restricts regions with SCPs, the same condition key applies there (see AWS's "Global cross-Region inference" documentation).

Additional preconditions:
- A **one-time Anthropic model use-case form** must be completed per AWS account before Bedrock will serve Anthropic models in it.
- **Service Quotas** for the EU cross-region inference profile must be requested/confirmed before the first real run; the default quota may be too low for a `full` run's burst of tool-call turns.

### VPC endpoints

If the host runs without general internet egress, these VPC endpoints are required:

- `bedrock-runtime` — model invocation (the container).
- `bedrock` — Claude Code lists inference profiles at startup (the container).
- `ecr.api`, `ecr.dkr`, and the S3 gateway endpoint — pulling this image from ECR (the host; ECR serves image layers from S3).
- `ssm`, `ssmmessages`, `ec2messages` — Systems Manager Session Manager access to the host, if you use it instead of SSH (the host, not the container).

The host additionally needs whatever route it uses to clone target repositories (for example, to your git hosting); the container itself needs no git access.

### Bedrock invocation logging

If Bedrock model-invocation logging is enabled on the account, the logged payloads contain the analyzed repository's source code (it is sent to the model as context). Treat that log destination (S3/CloudWatch) as sensitive, with access control and retention matching the source code's own classification — not merely "AWS logs."

## CI and release

Tags matching `runner-v*` (and manual `workflow_dispatch` runs) trigger `.github/workflows/runner-image.yml`'s full flow: the repository's test gate, then a build and self-test of both `linux/amd64` and `linux/arm64`, then — only on that release trigger, and only once DevOps has configured the four repository variables below — a push to ECR via OIDC (no long-lived AWS credentials stored in GitHub). A PR touching deploy-relevant files runs the same flow but never pushes.

DevOps must provide, as GitHub **repository variables**:

| Variable | Meaning |
|---|---|
| `AWS_ACCOUNT_ID` | account owning the ECR repository (passed to the ECR login step) |
| `ECR_REGION` | region of the ECR repository |
| `ECR_REPOSITORY` | ECR repository name |
| `AWS_ROLE_ARN` | IAM role the GitHub Actions OIDC provider assumes to push |

The assumed role needs ECR push permissions on that repository; scoping that role (and setting up the GitHub OIDC trust relationship) is DevOps's IaC, not part of this repository. **ECR tag immutability is a DevOps-side setting on the repository** — this workflow relies on it to guarantee a pushed tag can never be silently overwritten, but does not itself enforce it.

**Image tag format:** `<Excavator package version>-<first 8 chars of the commit>`, e.g. `2.9.6-3dc3467a`. The version comes from the repository's own `package.json`.

## Release gate (R1)

An image tag reaching CI (built and pushed) is **not yet cleared for customer repositories**. Before first use, DevOps must run two real-model checks on a VM using the pushed ECR image, and record the results below:

1. **Full run against the designated smoke repository** (not a customer repository — an internal repository DevOps and the Excavator team have agreed to use for this check), model `eu.anthropic.claude-sonnet-5`, budget `$5` USD. Must exit `0`. Record: token counts by kind (input/cache-write/cache-read/output), whether cache-read tokens are greater than 0, estimated cost, and wall-clock time.
2. **Full run against a small decoy repository** whose `CLAUDE.md` instructs writing a marker file, budget `$1` USD. The marker file must **not** appear (this is the one isolation check that needs a real model call — see design D5/O5 for the zero-credential checks that cover everything else).

**An image tag must not be used against any customer repository until its R1 row is recorded below.**

### Release record

| Image tag | Date | R1 result | Tokens (in / cache-write / cache-read / out) | Cache read > 0? | Est. cost (USD) | Wall clock | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Upgrade procedure

To move to a newer Claude Code or a newer Excavator commit: bump the `CLAUDE_CODE_VERSION` build arg default in `deploy/Dockerfile` (or simply build from the new commit — `EXCAVATOR_COMMIT` is supplied by CI, not hardcoded), cut a new `runner-vX.Y.Z` tag, let CI build/self-test/push it, then run R1 again against the new tag before it is used on any customer repository. There is no in-place upgrade of a running container; every upgrade is a new image tag through the same release gate.
