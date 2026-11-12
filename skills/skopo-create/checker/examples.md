# Excerpts from a recovered skopository

From the first pilot: a service that rebuilds smart contracts from source and publishes whether the
rebuild matches what is deployed, plus the deployment one company runs. Three code repositories,
about 38k lines of code; the skopo came out at 289 statements in 9.3k words. The excerpts show the
shape and tone; the domain is not yours, so do not borrow its words.

## A charter: words and principles (`spec/verification/charter.md`)

```
# Verification: charter

What a verification is, and the principles every detailed rule below refines. Words of the chain
are in [`../stellar.md`](../stellar.md).

## Words

- A **verifier** is one independent party that rebuilds contracts from source and publishes what
  it found under its own identity. ^T-pyf4fx
- A **verification** is a completed byte-for-byte comparison of a rebuilt Wasm with the Wasm
  deployed at the target. ^T-w707tb
- A **verdict** is the outcome of a verification: **verified** when the bytes are identical,
  **mismatched** when they are not. ^T-1ctwe5

## Principles

Each principle is realized through the detailed rules that refine it.

- A verdict **must** state only what a completed byte-for-byte comparison established. ^R-5bc5gf
- The submitter supplies the source and how it was built; the build environment, the comparison
  and the verdict **must** stay out of the submitter's reach. ^R-2wd522
- A verifier **must not** claim anything it holds no verdict for. ^R-1hd4vw
```

## A topic: rules that refine, and examples where a rule could be misread (`spec/verification/verdicts.md`)

```
- A verification **must** compare against the Wasm deployed at the target when it compares, fetched
  fresh, never a value remembered from the submission. ^R-ajnbap (refines R-5bc5gf)
- A verdict **must** belong to the Wasm hash, never to a network or a contract address. ^R-6pdaj9
- `mismatched` is a successful verification. It says the bytes differ, and nothing about the
  developer's honesty. ^R-tk41xq

> *Example.* A contract is upgraded while its job waits in the queue. The verifier compares with the Wasm the contract runs at comparison time. ^E-px5815 (R-ajnbap)

> *Example.* A Wasm is `verified` through a testnet contract. A mainnet contract running the same Wasm shows the same verdict. ^E-22msw4 (R-6pdaj9)
```

## One operator's promises (`spec/local/soroban-verify.md`)

From the operator's terms of service and privacy notice. Numbers live here, not in the general rules.

```
- Soroban Verify **must** delete a job that was never published 30 days after it was
  created. ^R-21hxfq (refines R-pah3r0)
- Soroban Verify **must** delete a raw build log 7 days after the build, or earlier when its
  submitter asks. ^R-wkdpx2 (refines R-rct0yn)

> *Example.* A build log from 1 October is gone by 8 October, or the same day if the submitter deletes it. ^E-80729m (R-wkdpx2)
```

## A product binding: what consumers see (`bindings/product/scvs.md`)

The product is a public API, so the API is defined here.

```
- The service offers two REST APIs with JSON bodies over HTTPS, on one host: the verification API
  under `/api/verification/v1` and the query API under `/api/query/v1`. ^F-2prda2
- Submitting returns a token once; only that token opens or deletes the job's build log, and the
  job's own link does not. ^F-5e5a0j (R-1n1tex)
- People submit through a web console; no command-line tool ships, because the API and the SDK
  cover scripted use. ^F-7y0f5e
- Running it takes AWS Batch for rebuilds and PostgreSQL for jobs; results go to S3, R2 or a local
  filesystem. Whoever runs it defines that infrastructure; the code creates none. ^F-mkdhj0
```

## A tech binding: what only developers see (`bindings/tech/scvs.md`)

Components named by role, never by directory; no file, module or symbol.

```
- The service is a set of independently deployable services over shared libraries, kept in one
  repository and written in TypeScript on Node.js with NestJS. ^D-xahaz1
- A **builder** runs one rebuild as a batch job. It is the only component that executes submitted
  source. ^D-49ntt5 (R-ggvpjj)
- The builder **must not** hold database access, storage credentials, cloud credentials or any
  secret. It receives the source to build and a write-only grant for one upload, and nothing
  else. ^D-av6c23 (R-2wd522, R-ggvpjj)
- A rebuild is keyed by its content alone (source hash, environment identity, arguments and
  options), never by network, contract or Wasm hash, so one rebuild serves many targets while each
  job gets its own verdict. ^D-8epcr8 (R-ee4tnc, R-kgpmb6, R-6pdaj9)
```

## Questions (the run's `questions.md`, never in the skopo)

The pilot's most useful output. Each is a place where sources disagree, and only a person can say
which is right.

```
| # | Category | Question | Sources that disagree | Statements it bears on |
|---|---|---|---|---|
| 1 | promise | Users are told reports are archived permanently; both environments archive to a test network that keeps nothing permanently. Which is intended? | terms of service §4 · deployment config (archive network) | R-bpkas9, D-zj6f4q |
| 2 | promise | Users are told raw build logs go after 7 days; the batch log group never expires. | privacy notice §2 · deployment log settings | R-wkdpx2, D-dqf09s |
| 3 | behaviour | The job says `mismatch`, the published verdict says `mismatched`. Intended? | job status values · published result schema | R-tk41xq |
```
