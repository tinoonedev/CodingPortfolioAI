# Copy this file per feature. Replace all placeholders before requesting implementation.
# Every scenario must be specific enough that two independent readers expect the same result.

Feature: <capability stated as a user-visible outcome>
  As a <specific user or system role>
  I want <observable capability>
  So that <measurable business outcome>

  Rule: <one policy or condition governing this capability>

    Scenario: <one behavior with an observable outcome>
      Given <explicit actor, state, permissions, and relevant data>
      And <additional precondition when required>
      When <one user action or external event>
      Then <observable result with exact state or threshold>
      And <required audit, notification, or external side effect>

    Scenario: <failure or denied behavior>
      Given <explicit conditions that make the action invalid>
      When <the action is attempted>
      Then <the exact safe failure behavior>
      And <no unauthorized or partial side effect occurs>

# Before implementation, remove every placeholder and answer:
# - Who is allowed to perform the action?
# - Which Jira issue/task revision does it affect?
# - What proves success, and what happens on timeout, denial, or partial failure?
# - Which real integration is used, and which credential scopes are required?
