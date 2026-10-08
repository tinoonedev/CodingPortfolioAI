# Workspace authentication and persistence

Fieldwork uses local email/password accounts and PostgreSQL-backed workspaces. It does not require Auth0 or another identity provider. Read the acceptance scenarios in [`local-postgres-password.feature`](./requirements/local-postgres-password.feature).

## Local setup

1. Copy `.env.example` to `.env`. Set a long random `POSTGRES_PASSWORD` and the matching `DATABASE_URL`. Keep `.env` out of Git.
2. Set `STUDIO_WORKSPACE_ID` to a UUID and `STUDIO_WORKSPACE_NAME` to the local studio name.
3. Start PostgreSQL with `docker compose up -d postgres`.
4. Apply migrations using `npm run db:migrate`, then start the app with `npm run dev`.
5. Create the first workspace owner invitation with `npm run auth:invite -- owner@example.com owner`. The command writes the one-time bearer token to an ignored `.local-invites/` file with owner-only directory and file permissions. Read it locally when provisioning, deliver it through a trusted channel, then securely delete the file. Never paste the token into chat, CI logs, tickets, or commits. Open `http://127.0.0.1:4173`, select account creation, and redeem the invitation by setting a password.
6. Workspace owners can issue member or owner invitations in the authenticated studio. Tokens are shown once, expire after 24 hours, and are tied to the invited email.

## Authentication contract

- Passwords must be 12–128 characters. The server hashes them with Node.js `scrypt` using a unique random salt and stores only the encoded hash in PostgreSQL.
- Account enrollment requires a random one-time invitation bound to the email and workspace. PostgreSQL stores the SHA-256 token hash, not the bearer token. Redemption, account creation, membership creation, invitation consumption, audit event, and session creation share a transaction.
- Login returns a generic error for unknown email and incorrect password. Login and registration attempts use atomic PostgreSQL-backed 15-minute limits keyed by both source IP and email, shared across application instances. Public deployments still need edge limits for invitation and project endpoints.
- Sessions use opaque 256-bit tokens. PostgreSQL stores only the SHA-256 token hash. The browser receives an HTTP-only, SameSite=Lax cookie; production cookies are Secure and use the `__Host-` prefix. Sessions expire after 12 hours and logout deletes the server-side session.
- Each project query includes the authenticated workspace ID. A project in another workspace returns 404 without project data.
- Mutating requests must include the configured same-origin `Origin`. Production requires HTTPS and PostgreSQL TLS; `TRUST_PROXY_HOPS` must match the deployment proxy topology.
- Workspace project creation requires explicit brief approval, stores the approving member and server timestamp, validates field types and lengths, and writes its audit event in the same transaction.

## Account verification and recovery

Invitation-only enrollment prevents public self-registration but does not independently verify control of the invited email address. The invitation token must be delivered through a trusted channel. The current app does not send email, verify addresses, reset forgotten passwords, or support self-service account recovery. An owner or operator must revoke/reissue invitations or manage recovery through a separately designed workflow. Do not expose a public production signup flow until email verification, password reset, abuse controls, and operational delivery are implemented.

## Operations and security boundaries

- Keep database connection strings and local credentials in ignored `.env` files for development and a managed secret store in hosted environments. Never expose them to browser code, logs, prompts, or generated code.
- `npm run auth:invite` needs a database role that can write workspace invitations and create workspaces. For production, use a restricted runtime role and a separate controlled operator credential for migrations and initial owner provisioning.
- The local Compose service binds to `127.0.0.1:5433` and uses a dedicated volume. Hosted deployments need managed PostgreSQL, TLS, backups, connection limits, network controls, and a migration-capable role.
- Existing Auth0/OIDC environment values are no longer read. Database migration 2 adds password hashes and invitation records; migration 3 adds shared rate-limit buckets. The old OIDC transaction table is left untouched for a later reviewed cleanup. Existing OIDC user rows are retained, but need a fresh password invitation before they can use local password login.
- The browser smoke and sanity suites must exercise a real app and real PostgreSQL integration. Missing credentials must fail with a setup state; tests must not substitute seeded authenticated success.

## Jira OAuth connection foundation

The Jira connection foundation uses a Fieldwork platform-owned Atlassian OAuth 2.0 (3LO) client for each deployed environment. Configure `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`, and the registered same-origin `JIRA_OAUTH_REDIRECT_URI` only in the server environment. Set `JIRA_TOKEN_ENCRYPTION_KEYRING` to a JSON object containing one active key ID and up to seven retained key IDs, each mapped to a canonical base64 encoding of a random 32-byte AES key. Generate keys with `openssl rand -base64 32`; do not commit the generated values.

The connection status API reports only configuration setting names and safe connection metadata. OAuth authorization/callback and live Jira API calls are not implemented by this foundation slice, so configured settings alone do not indicate a connected Jira project. Stored credentials use AES-256-GCM with associated data binding ciphertext to a Fieldwork workspace and project. During key rotation, add the new key while retaining old keys until all credentials have been re-encrypted; then remove retired keys. Disconnecting deletes local encrypted credentials. No Jira provider revocation claim is made by this storage layer.


The Jira OAuth authorization API is server-side. An authenticated workspace owner starts authorization for a project; Fieldwork stores a hashed, single-use state bound to the owner, workspace, project, and session, with a 10-minute expiry. The OAuth callback consumes state before exchanging the code and refuses replay or cross-session callbacks. Returned tokens are encrypted and retained only in a pending selection record for 10 minutes; the project remains disconnected until a later flow verifies the selected Jira site and project. Expired transaction and pending credential rows are purged periodically. The current callback API does not yet provide the site/project selection UI.
