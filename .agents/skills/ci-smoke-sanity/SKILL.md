---
name: ci-smoke-sanity
description: Design and maintain smoke and sanity suites that run on every feature pull request and verify real product behavior.
---

# CI smoke and sanity suites

1. Start from approved Gherkin scenarios and acceptance criteria.
2. Add `@smoke` scenarios for critical app startup and the smallest high-value user path. For each external integration, add health coverage against the real service and a dedicated test account before calling it production-ready.
3. Add `@sanity` scenarios for the changed feature, permission boundaries, persistence, and nearby regression risks.
4. Run both suites on every feature PR. CI must also run unit tests, production build, dependency review/audit, and static analysis.
5. Do not mock connectors or intercept service requests in smoke/sanity coverage. Use dedicated real test accounts and fail clearly if required credentials are missing.
6. Make test setup and cleanup idempotent. Use unique test data, explicit waits, and artifact capture; do not use arbitrary sleeps.
7. Report failures with the Gherkin scenario, test artifact, integration/environment, and redacted logs. Never retry away a persistent failure.
