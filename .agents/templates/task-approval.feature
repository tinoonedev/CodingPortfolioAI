Feature: Human-confirmed AI task execution
  As a project owner
  I want each AI task to require a fresh Jira confirmation
  So that no agent proceeds beyond the exact work I authorized

  Rule: Approval must match the issue, current task revision, and authorized human

    Scenario: Authorized human confirms the current task
      Given a Jira task revision "prod-readiness-v2" is proposed on issue "SCRUM-8"
      And the Jira commenter is an authorized human account
      And the comment is created after that revision was proposed
      When the comment body is "AI-TASK-APPROVED: SCRUM-8@prod-readiness-v2"
      Then only that task revision may enter the ready state
      And the approval comment ID and author account ID are recorded in the audit trail

    Scenario: Approval is missing, stale, or mismatched
      Given a Jira task is waiting for confirmation
      When no fresh authorized comment matches its issue and revision
      Then the task remains blocked
      And no agent, tool call, or external write starts
