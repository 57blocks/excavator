## ADDED Requirements

### Requirement: Service-only distribution

Excavator SHALL ship code-analysis and terminal-question-answering capabilities without an HTML application, browser launcher, local HTTP viewer, or presentation-mode feature flag.

#### Scenario: Analyze a repository

- **WHEN** a user runs `/excavator`
- **THEN** the service produces the knowledge graph and architecture layers needed by `/excavator-chat`
- **AND** it dispatches no tour-builder
- **AND** it writes `tour: []`
- **AND** it does not start a browser or HTTP server

#### Scenario: Incremental architecture update

- **WHEN** an incremental update reruns architecture analysis
- **THEN** it does not request or read `tour.json`
- **AND** the published graph contains `tour: []`

#### Scenario: Install the plugin

- **WHEN** the installer enumerates shipped skills
- **THEN** no dashboard skill is present
- **AND** the terminal analysis and chat skills remain available

