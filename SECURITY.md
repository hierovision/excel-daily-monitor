# Security Policy

## Reporting a vulnerability

Report privately through GitHub's private security advisory for this
repository. Do not open a public issue. Include the affected workflow or file,
a reproduction, and an impact assessment.

## Dated exceptions

### Solo-owner approval exception (2026-11-03)

`main` is protected by a repository ruleset that blocks force-pushes and
deletion. A pull request is deliberately not required: the scheduled
`daily-summary` workflow commits data to `main` with `GITHUB_TOKEN`, and that
commit is the deployment path (`deploy-pages` publishes it). Requiring a PR
blocks that push; a ruleset bypass for the GitHub Actions integration is not
available on this personal repository (API 422: "Actor GitHub Actions
integration must be part of the ruleset source or owner organization").
If PR enforcement is added, the workflow must first change to open and merge a
PR (or use a deploy-key/GitHub-App bypass).

Required status checks are not enforced: the repository has no pull-request
CI workflow (`daily-summary` runs on a schedule, `deploy-pages` on push).
Adding PR CI is the prerequisite for a required check. Compensating controls:
secret scanning + push protection, Dependabot alerts + security updates,
CodeQL default setup, and no force-push/deletion. Review date: 2027-01-25, or
when a second engineer is added.
