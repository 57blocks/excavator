# Runner image: deployment

The runner image bundles a pinned Excavator checkout (built) and a pinned Claude Code into one non-root container. It has no build toolchain, no cloud or git credentials, and no target-repository source or `.excavator/` products baked in. One container processes one mounted repository and performs one run.

This document lists what a deployment needs and how to configure it. The design decisions are in the OpenSpec change `runner-image` (under `openspec/changes/`, or `openspec/changes/archive/` once archived).

## 1. Requirements

| Item | Requirement |
|---|---|
| AWS region | A Bedrock region with an EU cross-region inference profile, e.g. `eu-central-1`. |
| Bedrock model access | Account-level access to the Anthropic model must be completed: Bedrock model access / AWS Marketplace subscription, plus the one-time Anthropic use-case form. An IAM invoke permission alone is not enough. |
| Inference profile | An EU inference profile, e.g. `eu.anthropic.claude-opus-5-5` (written `<PROFILE>` below). Service Quotas for it confirmed. |
| Host | EC2, x86_64 (the image is `linux/amd64`), Linux with Docker. |
| Memory | At least 16 GB; 32 GB for repositories of about 3M lines. |
| Disk | About 1.5 GB per image version, plus the repository, plus about 1.5 GB of products per 3M-line repository, plus the image tarball while it is being delivered. |
| Instance metadata | IMDSv2 with a hop limit of at least 2 (the container reaches the instance role through IMDS). |
| Host software | Docker Engine, AWS CLI v2, `unzip`, `sha256sum`, `git`. Installed before internet egress is closed. |
| Access | AWS Systems Manager Session Manager. No SSH and no public IP needed. |
| Network | No general internet egress; the VPC endpoints in [§3](#3-network). |
| Instance role | The permissions in [§4](#4-iam). |
| Handover storage | An S3 bucket (SSE-KMS, versioning, Block Public Access, TLS-only) for code archives and the image tarball. ECR is an alternative for the image ([§11](#11-ci-and-release-ecr)). |

## 2. Host setup

Install the host software while egress is still available, then close egress:

```sh
sudo apt-get update
sudo apt-get install -y --no-install-recommends docker.io unzip
sudo systemctl enable --now docker
aws --version            # AWS CLI v2; install it if the AMI does not ship it
curl -sS -m 6 https://www.google.com -o /dev/null   # after egress is closed this must fail
```

Directory layout used in the examples:

| Path | Content |
|---|---|
| `/srv/excavator/artifacts` | downloaded image tarballs, code archives, checksums |
| `/srv/excavator/<name>` | one prepared repository per project (mounted as `/work/repo`) |
| `/srv/excavator/out/<name>` | run output per project (mounted as `/work/out`) |

Both mounted directories must be writable by uid 10001 (the container always runs as uid 10001; do not pass `--user`).

## 3. Network

| VPC endpoint | Type | Required | Used by |
|---|---|---|---|
| `bedrock-runtime` | Interface | Yes | container: model calls |
| `s3` | Gateway | Yes, when code or the image is delivered through S3 | host |
| `ssm`, `ssmmessages`, `ec2messages` | Interface | Yes, for Session Manager | host |
| `ecr.api`, `ecr.dkr` | Interface | Only when the image is pulled from ECR | host |
| `bedrock` | Interface | Not required | Claude Code falls back to its built-in model list when it cannot list inference profiles |

- Security groups: allow TCP 443 from the host to the interface endpoints and to the S3 gateway prefix list.
- Close general egress by removing the `0.0.0.0/0` route (recommended: calls to anything else fail immediately). Blocking only in the security group also works.

## 4. IAM

Instance role policy. Replace the placeholders; tighten `Resource` to the profiles actually used.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeEuProfile",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:eu-central-1:<ACCOUNT_ID>:inference-profile/<PROFILE>"
    },
    {
      "Sid": "BedrockInvokeProfileFoundationModels",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:eu-*::foundation-model/<MODEL_ID>",
      "Condition": {
        "StringEquals": { "bedrock:InferenceProfileArn": "arn:aws:bedrock:eu-central-1:<ACCOUNT_ID>:inference-profile/<PROFILE>" }
      }
    },
    {
      "Sid": "HandoverBucketKmsViaS3",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "<BUCKET_KMS_KEY_ARN>",
      "Condition": { "StringEquals": { "kms:ViaService": "s3.eu-central-1.amazonaws.com" } }
    }
  ]
}
```

- `<MODEL_ID>` is the foundation model behind the profile, e.g. `anthropic.claude-opus-5-5`.
- S3 access to the handover prefix (`s3:GetObject`, `s3:PutObject`, `s3:ListBucket`) comes from the bucket policy or an equivalent role statement.
- No other AWS permissions should be reachable from the container.
- If data must not leave the EU, add this deny statement against `global.*` profiles:

```json
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
```

If Bedrock model-invocation logging is enabled, the logged payloads contain the analyzed source code; give that log destination the same access control and retention as the source code.

## 5. Image

### Build (any machine with Docker Buildx)

```sh
COMMIT=$(git rev-parse HEAD); TAG=${COMMIT:0:8}-amd64
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile \
  --build-arg EXCAVATOR_COMMIT=$COMMIT -t excavator-runner:$TAG .
docker run --rm --network none --entrypoint excavator-selftest excavator-runner:$TAG   # 12 PASS lines
docker save excavator-runner:$TAG | gzip > excavator-runner-$TAG.tar.gz
sha256sum excavator-runner-$TAG.tar.gz > excavator-runner-$TAG.tar.gz.sha256          # macOS: shasum -a 256
aws s3 cp excavator-runner-$TAG.tar.gz        s3://<BUCKET>/<PREFIX>/
aws s3 cp excavator-runner-$TAG.tar.gz.sha256 s3://<BUCKET>/<PREFIX>/
```

### Install on the host

```sh
cd /srv/excavator/artifacts
aws s3 cp s3://<BUCKET>/<PREFIX>/excavator-runner-<TAG>.tar.gz .
aws s3 cp s3://<BUCKET>/<PREFIX>/excavator-runner-<TAG>.tar.gz.sha256 .
sha256sum -c excavator-runner-<TAG>.tar.gz.sha256
docker load -i excavator-runner-<TAG>.tar.gz
docker run --rm --network none --entrypoint excavator-selftest excavator-runner:<TAG>   # 12 PASS lines
```

The self-test makes no model call and needs no credentials. It checks the Claude Code version, the image commit, plugin validity and loading, Python, the git safe-directory setting, the Node heap limit, a Lazy run, settings isolation and the MCP server.

## 6. Preparing `/work/repo`

`/work/repo` must be either a clone the operator made and maintains (`git clone`, then only `git fetch` / `git checkout`), or a repository prepared from a code archive as below. It must never be someone's working copy or a directory with a `.git` copied in from elsewhere. Keep it between runs so `.excavator/` enables incremental `full` runs.

From a code archive:

```sh
cd /srv/excavator/artifacts && sha256sum -c repo.zip.sha256     # if a checksum was provided
mkdir -p /srv/excavator/<name> && unzip -q repo.zip -d /srv/excavator/<name>
cd /srv/excavator/<name>/<project-root>
find . -name .git -prune -exec rm -rf {} +                      # before running any git command here
git init -q && git add -A && git -c user.name=excavator -c user.email=excavator@localhost commit -qm "handover <name>"
git ls-files --others --ignored --exclude-standard              # files left out by .gitignore
chmod -R a+rwX .
```

- Delete every `.git` from the archive before running any git command in it.
- `git add -A` follows the project's `.gitignore`. Review the listed ignored files. Add a file with `git add -f <path>` only if it is source that must be analyzed.
- The commit gives the repository a HEAD, which `full` mode requires.

## 7. Running

Lazy mode (deterministic, no model call, no credentials; can run with `--network none`):

```sh
docker run --rm --network none \
  -v /srv/excavator/<name>:/work/repo \
  -v /srv/excavator/out/<name>:/work/out \
  -e EXCAVATOR_MODE=lazy \
  excavator-runner:<TAG>
```

Full mode (Claude Code against Bedrock):

```sh
docker run --rm \
  -v /srv/excavator/<name>:/work/repo \
  -v /srv/excavator/out/<name>:/work/out \
  -e EXCAVATOR_MODE=full \
  -e EXCAVATOR_MAX_BUDGET_USD=<USD> \
  -e AWS_REGION=eu-central-1 \
  -e ANTHROPIC_MODEL=<PROFILE> \
  -e ANTHROPIC_DEFAULT_OPUS_MODEL=<PROFILE> \
  -e ANTHROPIC_DEFAULT_SONNET_MODEL=<PROFILE> \
  -e ANTHROPIC_DEFAULT_HAIKU_MODEL=<PROFILE> \
  excavator-runner:<TAG>
```

- Credentials come from the instance role through IMDS. Do not pass access keys.
- Set the three `ANTHROPIC_DEFAULT_*_MODEL` variables to a profile the role may invoke.

Other Excavator skills (for example `/excavator-prd`) run with Claude Code as the entrypoint, against a repository that already has Lazy products:

```sh
docker run -d --name prd-<name> \
  -v /srv/excavator/<name>:/work/repo \
  -v /srv/excavator/out/<name>:/work/out \
  -e AWS_REGION=eu-central-1 \
  -e ANTHROPIC_MODEL=<PROFILE> \
  -e ANTHROPIC_DEFAULT_OPUS_MODEL=<PROFILE> \
  -e ANTHROPIC_DEFAULT_SONNET_MODEL=<PROFILE> \
  -e ANTHROPIC_DEFAULT_HAIKU_MODEL=<PROFILE> \
  --entrypoint claude excavator-runner:<TAG> \
  -p "/excavator:excavator-prd /work/repo --scope <subdir> --language <lang>
Write the PRD to /work/out/PRD.md without asking for confirmation." \
  --plugin-dir /opt/excavator --setting-sources user --settings '{"disableAllHooks": true}' \
  --model <PROFILE> --permission-mode bypassPermissions --permission-prompts none \
  --max-budget-usd <USD> --no-session-persistence --output-format stream-json --verbose
docker logs -f prd-<name> > /srv/excavator/out/<name>/run.jsonl    # or: docker wait prd-<name>
```

Run long jobs detached (`docker run -d`) so they do not depend on an interactive Session Manager session.

Measure how much of the scope a skill run actually read (lower and upper bound, in lines):

```sh
docker run --rm -v /srv/excavator/<name>:/work/repo -v /srv/excavator/out/<name>:/work/out \
  --entrypoint node excavator-runner:<TAG> /opt/excavator/deploy/read-coverage.mjs \
  --run /work/out/run.jsonl --repo /work/repo --scope <subdir>/
```

## 8. Environment variables

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

A missing or invalid required parameter ends the run with exit code `2` before anything is written.

Claude Code's model-alias variables — `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` and `ANTHROPIC_DEFAULT_HAIKU_MODEL` — are passed through to Claude Code unchanged. `run-excavator.mjs` does not read them. Set them to a profile the instance role may invoke.

Testing-only seams (never set against the real image): `EXCAVATOR_REPO_ROOT_OVERRIDE`, `EXCAVATOR_OUT_DIR_OVERRIDE`, `EXCAVATOR_PLUGIN_DIR_OVERRIDE`, `EXCAVATOR_CLAUDE_BIN_OVERRIDE`, `EXCAVATOR_TIMEOUT_GRACE_SECONDS_OVERRIDE`.

### (b) Values baked into the image

Set in `deploy/Dockerfile`; not operator-configurable.

| Variable | Baked value | Meaning |
|---|---|---|
| `EXCAVATOR_IMAGE_COMMIT` | the `EXCAVATOR_COMMIT` build arg (required) | the Excavator commit; also the label `org.opencontainers.image.revision` |
| `EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION` | the `CLAUDE_CODE_VERSION` build arg (default `2.1.281`) | the pinned Claude Code version; also the label `com.excavator.claude-code-version` |
| `CLAUDE_CODE_USE_BEDROCK` | `1` | Claude Code uses Bedrock |
| `DISABLE_UPDATES` | `1` | Claude Code never self-updates |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | |
| `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` | `1` | |
| `MCP_TOOL_TIMEOUT` | `600000` (ms) | |
| `BASH_DEFAULT_TIMEOUT_MS` | `600000` | |
| `BASH_MAX_TIMEOUT_MS` | `1800000` | |
| `NODE_OPTIONS` | `--max-old-space-size-percentage=75` | Node heap = 75% of container memory (follows `docker run --memory`); override with `-e NODE_OPTIONS=...` |

## 9. Sizing

Measured on an 8 vCPU / 32 GB x86_64 host with the image above:

| Workload | Wall clock | Memory / disk | Model cost |
|---|---|---|---|
| Lazy, ~3M-line Java repository (16.5k files) | about 2–2.5 min | peak about 2.7 GB; products about 1.2 GB | none |
| Lazy, Java repository with 8.1k files (about 0.57M lines of main Java) | about 1 min | products about 0.6 GB | none |
| MCP read tool call on the ~3M-line repository | 6–10 s per call | — | none |
| `/excavator-prd` with verification, 81-file scope (~15k lines), Opus 5.5 on Bedrock | about 45 min | — | about 25 USD |

- For `full` runs on large repositories, raise `EXCAVATOR_TIMEOUT_MINUTES` above 180.
- Set `EXCAVATOR_MAX_BUDGET_USD` per run.
- Cost figures are Claude Code's client-side estimates at list prices. AWS billing is authoritative.

## 10. Exit codes and output files

| Exit code | Meaning |
|---|---|
| `0` | Success, or a `full` run skipped because existing products already match HEAD. |
| `2` | Configuration error: a required parameter was missing or invalid. Nothing is written; the reason goes to stderr only. |
| `3` | Run failure: Claude Code failed to start, errored, timed out, stopped at the budget cap or another non-success terminal state, recorded permission denials, or reported failed subagents. `lazy`: the Lazy driver exited non-zero. The underlying API error is in `run.jsonl`. |
| `4` | Load or product/structural-integrity failure: the plugin, its MCP server, its agents, or the subagent-dispatch tool did not fully load; the produced commit or model stamp did not match; or the independent re-validation found structural integrity issues or could not run. |
| `5` | Fabrication over threshold: the independent re-validation found more `contradicted` nodes/edges than `EXCAVATOR_MAX_CONTRADICTED` allows, or summary verification was skipped entirely. |

When several stages fail, the exit code is the first failing stage in the order configuration → load → run → products/integrity → fabrication.

Products already in `/work/repo/.excavator/` are never deleted or modified on a failure path.

Files in `/work/out` (none on exit `2`; `run.jsonl`, `validation.json` and `validated-graph.json` absent on a skipped `0` exit):

| File | Content |
|---|---|
| `summary.json` | image commit and Claude Code version, repository HEAD, mode, model, one status + reasons per check (a failed model call carries the provider's error message and HTTP status), token counts by kind, estimated cost, contradicted/unverified counts, and `readCoverage` (`full` only: how many lines of the repository the run read, lower and upper bound) |
| `run.jsonl` | raw `stream-json` events of the Claude Code session (`full` only) |
| `validation.json` | independent structural-integrity report (`issues[]`; non-empty means exit `4`) |
| `validated-graph.json` | the knowledge graph with a per-node/per-edge `verification` status |

## 11. Security preconditions

`full` mode runs Claude Code with `--permission-mode bypassPermissions`; the isolation boundary is the container and the host:

- The instance role is limited to [§4](#4-iam).
- No git credentials in the container or the image; host credentials used to clone are read-only.
- No general internet egress from the host or the container.
- Each `/work/repo` is dedicated to this image and written only by the operator's clone/fetch or archive preparation. If its state is in doubt, delete it and prepare it again.

## 12. CI and release (ECR)

`.github/workflows/runner-image.yml` runs on tags `runner-v*`, on manual `workflow_dispatch`, and on pull requests touching deploy files. It runs the test gate, then builds and self-tests the `linux/amd64` image. On a tag or dispatch, it then pushes the tested image to ECR through OIDC, once these GitHub repository variables are set:

| Variable | Meaning |
|---|---|
| `AWS_ACCOUNT_ID` | account owning the ECR repository |
| `ECR_REGION` | region of the ECR repository |
| `ECR_REPOSITORY` | ECR repository name |
| `AWS_ROLE_ARN` | IAM role the GitHub OIDC provider assumes to push |

- The role needs ECR push permission on that repository.
- Enable ECR tag immutability on the repository.
- Image tag format: `<package.json version>-<first 8 chars of the commit>`, e.g. `2.9.6-3dc3467a`.

Without ECR, deliver the image as a tarball through S3 ([§5](#5-image)).

## 13. Release gate (R1)

Before an image tag is used on a customer repository, run on the host with that image and record the result below:

1. `full` run against an agreed internal smoke repository, model `<PROFILE>`, budget 5 USD. Must exit `0`. Record token counts by kind, whether cache-read tokens are above 0, estimated cost and wall clock.
2. `full` run against a small decoy repository whose `CLAUDE.md` instructs writing a marker file, budget 1 USD. The marker file must not appear.

| Image tag | Date | R1 result | Tokens (in / cache-write / cache-read / out) | Cache read > 0? | Est. cost (USD) | Wall clock | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 14. Upgrade

Build a new image from the new commit (or bump `CLAUDE_CODE_VERSION` in `deploy/Dockerfile`), deliver it ([§5](#5-image) or [§12](#12-ci-and-release-ecr)), run the self-test, and pass R1 again before using it on customer repositories. Running containers are never upgraded in place.
