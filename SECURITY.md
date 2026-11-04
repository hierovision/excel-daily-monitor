# Security Policy

## Reporting a vulnerability

Report privately through GitHub's private security advisory for this
repository. Do not open a public issue. Include the affected workflow or file,
a reproduction, and an impact assessment.

## Dated exceptions

### Solo-owner approval exception (2026-11-03)

`main` requires a pull request, with force-push and deletion denied. Required
approvals are 0 because the owner is the only engineer on this repository and
GitHub does not count the author's own approval.

Required status checks are not enforced: the repository has no pull-request
CI workflow (`daily-summary` runs on a schedule, `deploy-pages` on push).
Adding PR CI is the prerequisite for a required check. Compensating controls:
secret scanning + push protection, Dependabot alerts + security updates, and
CodeQL default setup. Review date: 2027-01-25, or when a second engineer is
added.
