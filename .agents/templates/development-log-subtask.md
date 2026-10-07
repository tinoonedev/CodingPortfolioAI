# Jira development-log subtask template

Create one development-log subtask under each feature or delivery ticket and assign it to the active sprint. Keep the parent issue's reviewed Gherkin as the acceptance source; use this subtask for implementation traceability and evidence.

## Description

```markdown
## Goal
<One sentence describing the delivery work tracked here.>

## Owner and task revision
- Owner role:
- Jira parent:
- Task revision:

## Acceptance and dependencies
- Parent Gherkin scenarios:
- Dependencies:
- Expected artifacts:

## Delivery evidence
- Review before commit/push:
- Required checks and integration environment:
- PR target: development
```

## Milestone comment

Use one concise comment at each meaningful milestone rather than one comment per tool call:

```markdown
**Milestone:** <progress | decision | blocker | verification | PR | merge>

- **Change or decision:** <what changed>
- **Reason:** <why this choice was made>
- **Acceptance impact:** <criteria, dependency, or risk affected>
- **Review:** <reviewer, scope, findings, fixes, unresolved risk>
- **Evidence:** <exact command/result, artifact URL, PR URL, or merge SHA>
- **Next owner/action:** <specific next step>
```

Do not put credentials, tokens, secrets, or client data in the subtask. Jira task comments and status changes are tracking evidence; the per-task Jira confirmation gate is temporarily suspended under SCRUM-15.
