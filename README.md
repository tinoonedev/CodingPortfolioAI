# CodingPortfolioAI — Fieldwork

Fieldwork is a visible, human-guided AI software studio. It organizes client projects around a Jira-backed delivery workflow and shows the work, artifacts, blockers, and handoffs from a specialist agent team.

## Run locally

```sh
npm install
npm run dev
```

## AI-assisted development setup

- [AGENTS.md](AGENTS.md) defines repository instructions, branch rules, and definition of done.
- [.agents/agents](.agents/agents/) contains role briefs for analysis, planning, design, QA, frontend, backend, and delivery.
- [.agents/skills](.agents/skills/) contains reusable feature-delivery, QA-planning, and MCP-integration skills.
- `npm run check` validates the `feature/<project>_<change>` branch name, runs the domain unit suite, and creates a production build.
- Install a local browser once with `npx playwright install chromium`, then run `npm run test:e2e` for the Chromium smoke suite.
- GitHub Actions runs branch validation, unit tests, a production build, and the Playwright browser suite for feature-branch pushes and pull requests; Dependabot checks npm updates weekly.

For repository conventions and agent handoffs, start with [`.agents/README.md`](.agents/README.md).

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
