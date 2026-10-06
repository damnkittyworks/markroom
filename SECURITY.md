# Security

Markroom is an early self-hosted project maintained by Damn Kitty Works. Security fixes target the current `main` branch; older snapshots do not have a separate support commitment. There is no guaranteed response time.

## Report a vulnerability

Use [GitHub's private vulnerability report form](https://github.com/damnkittyworks/markroom/security/advisories/new) when available. This requires private vulnerability reporting to be enabled on the public repository. If the form is unavailable, [open an issue requesting a private reporting channel](https://github.com/damnkittyworks/markroom/issues/new?title=Private%20security%20reporting%20contact) without including vulnerability details, then wait for a private channel.

Do not put exploit instructions, live room links, browser-held tokens, customer PDFs, or private comments in public issues. In the private report, include the affected commit, deployment/runtime details, impact, and reproduction steps using synthetic data. Test only installations you own or have permission to test.

## Deployment boundaries

Anyone with a room link can read its PDF, reviewer names, and comments. Browser-held capabilities control edits and closing; they are not accounts. Closing freezes a room but does not revoke read access or delete data. Room creation requires an operator-issued key. Application budgets, write-rate limits, and authenticated operator takedown are documented in [hosting controls](docs/hosting-controls.md). Operators remain responsible for edge traffic controls, retention, backups, and key distribution. See the [README](README.md#boundaries-and-privacy).

The current dependency findings and their limits are recorded in [the dependency review](docs/dependency-review.md). A passing CI run does not mean the dependency audit is clear or that a public deployment has adequate abuse controls.

## Maintainer setup

Before inviting public security reports, enable **Private vulnerability reporting** in the repository's **Settings → Advanced Security**, verify that the reporting form above is available, and ensure maintainers receive security notifications. [GitHub's configuration guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) describes the setting. This file alone does not enable the feature.
