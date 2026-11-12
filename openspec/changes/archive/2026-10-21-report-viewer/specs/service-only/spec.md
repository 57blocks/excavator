## MODIFIED Requirements

### Requirement: Service-only distribution

Excavator SHALL ship code-analysis and terminal-question-answering capabilities without an HTML application served by a process, browser launcher in any analysis skill, local HTTP viewer, or presentation-mode feature flag.

The one exception is `/excavator-view`: it MAY write a single self-contained static HTML file of existing products and hand that file to the operating system's default browser. It SHALL NOT start an HTTP server, run any analysis, or be invoked by another skill. The static page's front-end code SHALL have no npm dependencies and no build step.

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
- **AND** `/excavator-view` is present as the only skill that opens a browser

#### Scenario: Open the static view

- **WHEN** a user runs `/excavator-view`
- **THEN** it writes one HTML file and asks the operating system to open it
- **AND** no HTTP server or other long-running process is started
- **AND** no analysis skill's instructions refer to `/excavator-view`
