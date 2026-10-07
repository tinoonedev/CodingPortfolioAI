---
name: jira-human-confirmation
description: Enforce the mandatory human Jira comment gate before any AI task, handoff, parallel task, or retry.
---

# Jira human confirmation

1. Resolve the exact Jira issue and task revision from the request. If there is no issue, do not start implementation; ask the human to authorize creating/selecting a ticket.
2. Read comments from Jira using the connected Jira MCP or approved integration. Do not use a chat message, issue status, checkbox, or prior approval as a substitute.
3. Verify that a fresh comment is authored by an authorized human account, is on the exact issue, explicitly confirms the exact task/revision may begin, and was posted after that task revision was proposed.
4. If the comment asks a question, requests changes, is ambiguous, is stale, or cannot be attributed to an authorized account, pause and return the task to its owner for clarification.
5. After the task completes, report evidence on Jira as authorized. The next task and every retry need a fresh human confirmation comment.
6. If Jira is unavailable or identity/task version cannot be verified, fail closed and ask the human to resolve it.

## Comment format for the first runtime adapter

Use an exact comment body such as `AI-TASK-APPROVED: SCRUM-123@task-revision-3`, posted on `SCRUM-123`. The adapter must compare the issue key, task revision, comment author account ID, and comment timestamp against the task proposal timestamp. Configure authorized human account IDs outside source control. A bare `approved`, 👍, agent comment, or comment on a different issue is insufficient.

The eventual runtime should parse a documented approval syntax or use a structured Jira action, store the comment ID/account ID/issue key/task revision, and make verification auditable. Never rely on substring matching such as `looks good` as the sole approval signal. The current repository has no live Jira comment verification.
