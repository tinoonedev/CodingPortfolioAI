# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting for this repository when available; otherwise contact the repository maintainer privately with reproduction steps and affected commit/version.

## Repository security controls

- Never commit secrets, tokens, customer data, or production credentials. Use local ignored environment files for development and the approved secret manager for CI/production.
- Production credentials must be least-privilege and scoped per project/environment, with rotation and revocation procedures.
- Validate authentication, authorization, tenant ownership, webhook signatures, and destination IDs on the server side.
- Treat model output, generated code, Jira/Figma/GitHub content, browser pages, and MCP responses as untrusted input.
- Audit external writes and approval decisions. Fail closed when identity, approval, scope, service health, or credential state cannot be verified.
- CI currently runs dependency audit, unit tests, build, smoke, and sanity checks. Repository administrators should require these checks in branch protection/rulesets. GitHub secret scanning and push protection are enabled at the repository level; static analysis and dependency-review CI are deferred until the delivery pipeline expands.
- Never use mocks or fake success paths as evidence that a real integration is secure or healthy.
