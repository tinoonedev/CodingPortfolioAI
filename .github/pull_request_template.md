## What changed

<!-- Describe the user-visible change and why it is needed. -->

## Jira task

- Jira issue:
- Development-log subtask:
- Task revision:
- [ ] The development-log subtask is linked to the parent and has current progress, decision, and verification evidence
- [ ] Required feature tests and acceptance checks passed and were recorded before the parent Jira issue moved to Ready for Release
- [ ] Parent Jira issue is Ready for Release
- [ ] This PR targets `development`

## Verification

- [ ] `npm run check` or CI checks pass
- [ ] `npm run test:smoke` passes
- [ ] `npm run test:sanity` passes
- [ ] `npm audit --audit-level=high` passes
- [ ] GitHub secret scanning reports no findings
- [ ] UI behavior reviewed at desktop and mobile sizes (when applicable)
- [ ] Real integrations are exercised; no mock, stub, route interception, or fake success is used as evidence

After merge, record the merge commit and final CI evidence in Jira, then move the parent issue to Done. If PR checks or review require changes, move the issue back to In Progress and record the fix and retest before restoring Ready for Release.

## Risks and follow-up

<!-- Note known limitations or linked follow-up work. -->
