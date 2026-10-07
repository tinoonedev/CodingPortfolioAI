# CodingPortfolioAI — Fieldwork

Fieldwork is a visible, human-guided AI software studio. It organizes client projects around a Jira-backed delivery workflow and shows the work, artifacts, blockers, and handoffs from a specialist agent team.

## Run locally

```sh
npm install
npm run dev
```

## AI-assisted development setup

- [AGENTS.md](AGENTS.md) defines repository instructions, branch rules, and definition of done.
- [.agents/agents](.agents/agents/) contains role briefs for analysis, planning, design, QA, security, integration, frontend, backend, test automation, and delivery.
- [.agents/skills](.agents/skills/) contains reusable Gherkin, secure-integration, feature-delivery, QA-planning, CI smoke/sanity, and MCP-integration skills.
- Requirements and acceptance criteria use the Gherkin template in `.agents/templates/feature-requirements.feature`.
- `npm run check` validates the `feature/<project>_<change>` branch name, runs the domain unit suite, and creates a production build.
- Install a local browser once with `npx playwright install chromium`, then run `npm run test:smoke` and `npm run test:sanity` for real browser coverage of the current features.
- GitHub Actions runs branch validation, unit tests, npm audit, a production build, and separate Playwright smoke/sanity suites on every feature pull request. Dependabot checks npm and GitHub Action updates weekly.
- Do not add mocked connectors or fake success paths. The current Waypoint room is seeded legacy demo data, clearly labeled as demo; it is not a production integration. New work must use real services or remain blocked/not configured until the connection is available.

For repository conventions and agent handoffs, start with [`.agents/README.md`](.agents/README.md) and [SECURITY.md](SECURITY.md). Before implementing a live connector, follow the [integration readiness contract](docs/integration-readiness.md) for ownership, minimum permissions, audit evidence, and failure handling.

The Waypoint project room is a seeded, interactive demo. You can create client intake drafts from the project list; drafts and the selected project are stored in this browser with `localStorage`. Intake drafts do not create Jira issues or start agent runs. The Atlassian connector available to this Codex session can access `https://tinoonegithub.atlassian.net/` and its `SCRUM` / `TinoDevTeam` project, but the browser app itself has no Jira OAuth or synchronization yet. Figma, GitHub, model-provider, and deployment connections are also not wired into the app. Demo actions are labeled and do not claim to perform external work.

## Current prototype

- React and Vite single-page app.
- Project room with a five-stage delivery pipeline: discover, plan and design, build, verify, deliver.
- Agent roster with role, task, and state.
- Jira-linked artifacts and a seeded activity trail.
- Clarification interaction for answering the analyst’s open question.
- Client intake creation, editing, local persistence, and project switching.
- Workflow pause/resume control and clear demo-mode messaging.
- Responsive layout for desktop and mobile.

See [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) for the product direction and planned vertical slice.

Fictional, documentation-only client examples are maintained separately: [mobile app](docs/demo-projects/mobile-app.md), [web app](docs/demo-projects/web-app.md), and [API](docs/demo-projects/api.md). They do not create Jira issues or represent connected production runs.
