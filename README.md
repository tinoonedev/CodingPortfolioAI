# CodingPortfolioAI — Fieldwork

Fieldwork is a visible, human-guided AI software studio. It organizes client projects around a Jira-backed delivery workflow and shows the work, artifacts, blockers, and handoffs from a specialist agent team.

## Run locally

```sh
npm install
npm run dev
```

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
