---
name: feature-delivery
description: Deliver a small user-authorized repository change through a reviewable feature branch and pull request.
---

# Feature delivery

1. Read `AGENTS.md` and the role brief for the assigned work.
2. Record the Jira issue and task revision when one exists, plus the owner, acceptance criteria, dependencies, and expected artifacts.
3. Inspect the existing implementation and working tree. Keep the change on `feature/<project>_<change>`; never overwrite user work.
4. Make the smallest complete change. Follow current React/Vite patterns and keep domain logic independently testable.
5. Add or update focused tests for changed behavior. Write/verify Gherkin and map it to smoke/sanity coverage. Document whether each integration is live and its required scopes.
6. Run `npm run check`, `npm run test:smoke`, `npm run test:sanity`, and `npm audit --audit-level=high`; inspect `git diff --check` and `git status` and summarize results accurately.
7. Prepare one small PR with context, implementation summary, verification, screenshots for UI changes when practical, and remaining risks.
