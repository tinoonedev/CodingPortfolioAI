---
name: qa-test-planning
description: Turn Jira acceptance criteria into risk-based unit, integration, and browser test scenarios with explicit test tags.
---

# QA test planning

1. Read the acceptance criteria and design artifact when available.
2. Require Gherkin requirements using `.agents/templates/feature-requirements.feature`. Challenge criteria that are ambiguous, not observable, contradictory, or missing error/empty/loading/accessibility behavior. Ask the business analyst or product owner instead of guessing.
3. List scenarios by unit, integration, and end-to-end level. Tag each `smoke`, `sanity`, or `regression`, and note risk, data setup, expected result, and evidence.
4. Use fixtures only for pure unit tests of domain rules. Integration, smoke, sanity, and end-to-end coverage must use the actual app and real test integrations rather than mock servers, intercepted routes, or canned connector responses.
5. Keep tests deterministic without faking integrations: use dedicated test tenants/accounts, unique data, explicit waits, idempotent setup, and cleanup. If required service credentials are absent, fail with a clear setup error and report the blocked gate.
6. Report command, environment, pass/fail, and artifact links. Route failures to the owning agent for investigation and retest.
