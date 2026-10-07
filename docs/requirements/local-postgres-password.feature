Feature: Authenticate invited Fieldwork workspace accounts with passwords
  As an authorized Fieldwork workspace owner
  I want invited workspace members to sign in with email and password
  So that workspace access and client project persistence do not depend on an external identity provider

  Rule: An invitation grants account enrollment for one email and one workspace

    Scenario: An invited member creates an account
      Given an unexpired unused invitation for an email address and workspace exists in PostgreSQL
      And the submitted email matches the invitation email after case normalization
      And the submitted password contains between 12 and 128 characters
      When the invitee submits the invitation, email, display name, and password
      Then the API creates one account and membership with the role in the invitation
      And PostgreSQL stores a salted scrypt password hash and a hash of the invitation token
      And the invitation is marked redeemed in the same transaction
      And the invitee receives an HTTP-only session cookie whose token is stored only as a hash

    Scenario: A used, expired, mismatched, or unknown invitation is rejected
      Given no valid unused invitation matches the submitted token, email, and workspace
      When the invitee submits account registration
      Then the API returns an invalid invitation response
      And no user, membership, or session is created

    Scenario: An account signs in after a previous session ends
      Given an existing workspace member has a valid email and password hash in PostgreSQL
      When the member submits the matching email and password
      Then the API creates a new opaque 12-hour session
      And the member can load only projects in the member workspace

    Scenario: Invalid credentials do not identify the failing field
      Given an account exists in the workspace
      When a caller submits an unknown email or an incorrect password
      Then the API returns the same generic credential error
      And no session is created

    Scenario: A workspace member requests a project from another workspace
      Given a client project belongs to a different workspace
      When an authenticated member requests that project identifier
      Then the API returns a not-found response
      And no project fields or artifacts are returned

  Rule: Only an owner can issue workspace invitations

    Scenario: A workspace owner issues a single-use invitation
      Given an authenticated workspace owner submits a valid email address and role
      When the owner creates an invitation
      Then the API returns a cryptographically random 256-bit token once
      And PostgreSQL stores only its SHA-256 hash with a 24-hour expiration
      And the audit log records the workspace, actor, invited email, and role

    Scenario: A workspace member attempts to invite an account
      Given an authenticated workspace member without the owner role
      When the member submits an invitation request
      Then the API returns a forbidden response
      And no invitation is created
