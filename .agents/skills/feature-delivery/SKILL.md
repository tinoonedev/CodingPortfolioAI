---
name: feature-delivery
description: Deliver a small user-authorized repository change through a reviewable feature branch and pull request.
---

# Feature delivery

1. Read `AGENTS.md` and the role brief for the assigned work.
2. Record the Jira issue and task revision when one exists, plus the owner, acceptance criteria, dependencies, and expected artifacts. Create a dedicated development-log subtask under the parent issue at kickoff and place it in the active sprint. If implementation already started, create it as soon as practical and label the initial note retrospective.
3. Inspect the existing implementation and working tree. Keep the change on `feature/<project>_<change>`; never overwrite user work.
4. Make the smallest complete change. Follow current React/Vite patterns and keep domain logic independently testable.
5. Add or update focused tests for changed behavior. Write/verify Gherkin and map it to smoke/sanity coverage. Document whether each integration is live and its required scopes.
6. Keep the Jira development-log subtask current at meaningful milestones: implementation progress, decisions and rationale, scope changes, blockers, handoffs, and verification or PR results. Record what changed, impact, and next owner/action. Avoid one comment per tool call.
7. Run `npm run check`, `npm run test:smoke`, `npm run test:sanity`, and `npm audit --audit-level=high`; inspect `git diff --check` and `git status`. Add a subtask comment for each test run with the exact command, environment, counts, skips/blocks, and artifact links. Preserve failures and document root cause, durable fix, and retest evidence.
8. Prepare one small PR with context, implementation summary, Jira parent and development-log subtask keys, verification, screenshots for UI changes when practical, and remaining risks.
9. On delivery, add a parent Jira comment linking the log subtask and summarizing the merged PR, checks, and remaining risks. Complete the subtask when its assigned development work is complete.
10. Hand off results and blockers. Continue with follow-up work when it is within the user's authorized scope; a new Jira confirmation comment is not required.
