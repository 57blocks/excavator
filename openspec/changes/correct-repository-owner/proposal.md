## Why

The README, plugin metadata and generated onboarding footer still point to the previous repository owner. The canonical repository is https://github.com/57blocks/excavator, as confirmed by the user and the existing origin remote. The user also requested that the README's descriptions be checked against the current implementation.

## What Changes

- Correct the four README references: license, both marketplace commands and clone URL.
- Correct plugin homepage and repository metadata.
- Correct the generated onboarding footer link.
- Correct inaccurate descriptions of installation, Lazy and Full analysis, retrieval, command invocation, auto-update hooks, static reports, sharing and contributor checks.
- Document the current Figma and Skopo commands alongside the other shipped skills.
- Fix the service-only contract test's skill-directory discovery so ordinary files, including macOS metadata, cannot be mistaken for skills; retain checks for genuine skill directories.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This corrects repository identity without changing analysis or installation behavior; `skip_specs: true` applies.

## Impact

The implementation touches README.md, plugin metadata, the footer URL in src/onboard-builder.ts and the service-only contract test. No dependency, API, installation workflow or version change. Documentation describes existing behavior; it does not implement public distribution, one-command downloads or additional host integrations. The user requested the test discovery fix after a local metadata file exposed the failure.
