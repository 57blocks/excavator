## MODIFIED Requirements

### Requirement: Service-only distribution

Excavator SHALL ship code-analysis and terminal-question-answering capabilities without an HTML application runtime, a browser launcher that starts a server, a local HTTP viewer, or a presentation-mode feature flag. The only presentation artifact SHALL be the static, self-contained `view.html` that the deterministic view bake writes into `.excavator/` (see the `artifact-view` capability); opening it SHALL require nothing but a browser, SHALL bind no port, and SHALL leave no process running.

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
- **THEN** no dashboard skill and no HTTP viewer is present
- **AND** the terminal analysis and chat skills remain available
- **AND** the view skill is present and starts no server

#### Scenario: Open the static view

- **WHEN** a user runs `/excavator-view`
- **THEN** a single static file is written under `.excavator/` and handed to the operating system's file opener
- **AND** no port is bound and no process outlives the skill
