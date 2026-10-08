# Agent resources

This directory contains repository-local agent role briefs and reusable skill guides. `AGENTS.md` is the top-level operating contract; these files add focused instructions. They are references for Codex and other compatible agents, not a runtime multi-agent orchestrator. Fieldwork does not yet dispatch these roles automatically.

## Roles

- `agents/business-analyst.md` — discovery, ambiguity, acceptance criteria.
- `agents/project-manager.md` — Jira work breakdown, dependencies, handoffs.
- `agents/product-designer.md` — user flows, wireframes, Figma handoff.
- `agents/qa-analyst.md` — test strategy, risk, coverage and evidence.
- `agents/security-engineer.md` — threat modeling, application and agent security.
- `agents/integration-engineer.md` — real provider adapters and scoped credentials.
- `agents/test-automation-engineer.md` — CI test suites and real integration evidence.
- `agents/frontend-developer.md` — React UI delivery.
- `agents/backend-developer.md` — API, persistence and integration delivery.
- `agents/delivery-engineer.md` — review, CI, preview and release evidence.

## Skills

Skills use the Agent Skills convention: one folder per skill with a `SKILL.md` file and YAML frontmatter. Read the skill that matches the task before acting.

- `skills/feature-delivery/SKILL.md`
- `skills/qa-test-planning/SKILL.md`
- `skills/gherkin-business-requirements/SKILL.md`
- `skills/secure-integrations/SKILL.md`
- `skills/ci-smoke-sanity/SKILL.md`
- `skills/mcp-integrations/SKILL.md`
- `skills/jira-ticket-formatting/SKILL.md`

## Templates

- `templates/feature-requirements.feature` — Gherkin acceptance criteria for one feature.
- `templates/development-log-subtask.md` — Jira development-log subtask fields and milestone comment format.
- `templates/jira-feature-description.html` — Jira-supported rich-text feature description with readable, color-coded Gherkin keywords.

## Handoff contract

Each task handoff should identify the Jira issue and task revision when available, owner, inputs, Gherkin scenarios, expected artifacts, acceptance checks, and dependencies. Record meaningful work and evidence in the Jira development-log subtask. The per-task Jira comment gate is temporarily suspended under SCRUM-15; Jira comments and statuses are tracking evidence, not task authorization. Route questions and failed checks to the responsible role. External writes and production releases require explicit authorization for the selected target. Production behavior must use real integrations; no demo stub or fake success may stand in for one.
