# Security Policy

## Supported versions

| Version or branch | Security support |
| --- | --- |
| Latest release on `main` | Supported |
| Current `nightly` | Best-effort pre-release fixes |
| Older releases and forks | Not supported |

Users should reproduce an issue against the newest release before reporting it when
that can be done safely.

## Reporting a vulnerability

**Do not open a public issue, pull request, discussion, or commit containing an
unpatched vulnerability.**

Use GitHub's private vulnerability reporting flow from the repository **Security**
tab ("Report a vulnerability"). If that option is unavailable, contact the maintainer
through the private contact methods listed on the
[`XbibzOfficial777` GitHub profile](https://github.com/XbibzOfficial777).

A useful report includes:

- affected version, commit, operating system, and Python version;
- affected component and prerequisite configuration;
- minimal reproduction steps or proof of concept;
- realistic impact and the trust boundary crossed;
- suggested mitigation, if known;
- whether any real credential or personal data was involved.

Use synthetic accounts and redacted logs. Never send live tokens, passwords, private
keys, service-account JSON, user conversations, or database exports. If sensitive
data was exposed during testing, revoke it before continuing and state only that
rotation occurred.

## Response process

The project aims to acknowledge a complete report within five business days. Timing
for validation, remediation, release, and public disclosure depends on severity and
complexity. Maintainers may request additional evidence or coordinate a disclosure
date. Please allow a reasonable remediation window before publishing details.

## Security-sensitive areas

Changes involving any of these areas require focused tests and maintainer review:

- Firebase authentication and Worker authorization;
- admin sessions, cookies, CORS, rate limits, and audit logs;
- shell/process execution and tool approval policy;
- filesystem boundaries and sensitive-path detection;
- URL redirects and private-network protections;
- secret redaction, logs, session storage, and connector identity isolation;
- installer integrity, release archives, checksums, dependencies, and CI workflows.

## Safe-harbor intent

Good-faith research that stays within accounts and systems you own, minimizes data
access, avoids disruption, and follows this policy will not be treated as malicious
by the project. This statement does not authorize testing third-party services,
accounts, infrastructure, or data and cannot bind third parties.