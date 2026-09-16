## MODIFIED Requirements

### Requirement: 跳过按原因分桶

Every enumerated candidate SHALL land in exactly one visible selection or processing bucket. Pre-extraction outcomes SHALL distinguish `filtered-by-defaults`, `filtered-by-ignore`, and `sensitive`; selected files SHALL then end as `parsed`, `zero-symbol`, `no-extractor`, `parse-failed`, or one scanner skip reason in {`symlink`, `read-failed`, `unknown-language`, `binary`, `too-large`, `ignored`}. The import resolver SHALL record unresolved specifiers per file. A protected file MUST NOT disappear merely because its content cannot be reported.

#### Scenario: 每个输入落一桶
- **GIVEN** a fixture with a default-filtered file, a project-ignored file, a private key, a symlink, an unreadable file, a `.xyz` file, a `.dll` file, a file above the size limit, an `.html` file, a syntax-error file, and two parsable files
- **WHEN** selection, scan, and extraction run
- **THEN** every candidate appears in exactly one named bucket and none is absent or double-counted

#### Scenario: 敏感桶不泄露内容
- **GIVEN** a private-key fixture containing a unique canary string
- **WHEN** all persisted analysis artifacts and terminal output are searched for that canary
- **THEN** the canary is absent while the ledger reports one `sensitive` candidate using safe metadata only

#### Scenario: 守恒
- **WHEN** coverage is computed for any run
- **THEN** enumerated candidates equal selected candidates plus every pre-extraction exclusion bucket, and selected candidates equal extraction outcomes plus scanner skip outcomes
