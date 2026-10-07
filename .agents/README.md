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

- `skills/jira-human-confirmation/SKILL.md`
- `skills/feature-delivery/SKILL.md`
- `skills/qa-test-planning/SKILL.md`
- `skills/gherkin-business-requirements/SKILL.md`
- `skills/secure-integrations/SKILL.md`
- `skills/ci-smoke-sanity/SKILL.md`
- `skills/mcp-integrations/SKILL.md`

## Handoff contract

Each task handoff must identify the Jira issue, task revision, owner, inputs, expected artifacts, Gherkin scenarios, acceptance checks, and dependencies. The receiving role may begin only after an authorized human posts the required confirmation comment for that exact task revision. Missing evidence returns the task to `blocked`; do not infer approval. Production behavior must use real integrations; no demo stub or fake success may stand in for one.
