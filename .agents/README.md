# Agent resources

This directory contains repository-local agent role briefs and reusable skill guides. `AGENTS.md` is the top-level operating contract; these files add focused instructions. They are references for Codex and other compatible agents, not a runtime multi-agent orchestrator. Fieldwork does not yet dispatch these roles automatically.

## Roles

- `agents/business-analyst.md` — discovery, ambiguity, acceptance criteria.
- `agents/project-manager.md` — Jira work breakdown, dependencies, handoffs.
- `agents/product-designer.md` — user flows, wireframes, Figma handoff.
- `agents/qa-analyst.md` — test strategy, risk, coverage and evidence.
- `agents/frontend-developer.md` — React UI delivery.
- `agents/backend-developer.md` — API, persistence and integration delivery.
- `agents/delivery-engineer.md` — review, CI, preview and release evidence.

## Skills

Skills use the Agent Skills convention: one folder per skill with a `SKILL.md` file and YAML frontmatter. Read the skill that matches the task before acting.

- `skills/feature-delivery/SKILL.md`
- `skills/qa-test-planning/SKILL.md`
- `skills/mcp-integrations/SKILL.md`

## Handoff contract

Each task handoff should identify the Jira issue and task revision when available, owner, inputs, expected artifacts, acceptance checks, and dependencies. Route questions and failed checks to the responsible role. External writes and production releases require explicit authorization for the selected target.
