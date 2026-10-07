---
name: feature-delivery
description: Deliver a small repository change from confirmed Jira task through reviewable feature branch and pull request.
---

# Feature delivery

1. Read `AGENTS.md`, the Jira confirmation skill, and the role brief for the assigned work.
2. Confirm the Jira human gate before starting. Record issue, task revision, owner, acceptance criteria, dependencies, and expected artifacts.
3. Inspect the existing implementation and working tree. Keep the change on `feature/<project>_<change>`; never overwrite user work.
4. Make the smallest complete change. Follow current React/Vite patterns and keep domain logic independently testable.
5. Add or update focused tests for changed behavior. Document demo/live boundaries and integration limitations.
6. Run `npm run check`, inspect `git diff --check` and `git status`, and summarize verification accurately.
7. Prepare one small PR with context, implementation summary, verification, screenshots for UI changes when practical, and remaining risks.
8. Stop after the task and wait for a fresh Jira confirmation before any follow-up task or retry.
