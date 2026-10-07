---
name: qa-test-planning
description: Turn Jira acceptance criteria into risk-based unit, integration, and browser test scenarios with explicit test tags.
---

# QA test planning

1. Confirm the Jira task comment gate before starting; read the acceptance criteria and design artifact.
2. Challenge criteria that are ambiguous, not observable, contradictory, or missing error/empty/loading/accessibility behavior. Ask the business analyst or product owner instead of guessing.
3. List scenarios by unit, integration, and end-to-end level. Tag each `smoke`, `sanity`, or `regression`, and note risk, data setup, expected result, and evidence.
4. Prefer unit tests for domain rules, integration tests for persistence/connectors, and a small set of browser tests for critical user journeys.
5. Keep tests deterministic: isolate external apps, avoid sleeps, use explicit fixtures, and clean up created data.
6. Report command, environment, pass/fail, and artifact links. A failure returns to the owning agent; every fix and retest needs fresh Jira confirmation.
