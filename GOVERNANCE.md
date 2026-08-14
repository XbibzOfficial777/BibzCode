# BibzCode Governance

## Project roles

### Users

Use BibzCode and provide reproducible feedback.

### Contributors

Submit issues, documentation, tests, or code under `CONTRIBUTING.md` and the Code of
Conduct. A merged contribution does not automatically grant repository permissions.

### Reviewers

Provide technically grounded reviews and may be asked by a maintainer to review a
specific subsystem. Reviewers cannot approve their own change as the required review.

### Maintainers

Maintain repository access, scope, security policy, protected branches, releases,
deployments, and final merge decisions. The repository owner is the initial
maintainer and code owner.

## Branch and release model

- `nightly` is the integration branch and normal pull-request target.
- `main` is the stable/release branch.
- Contributions are validated on `nightly` before maintainer-controlled promotion to
  `main`.
- Both branches are protected from force-push and deletion.
- Pull requests require passing checks, resolved review conversations, and the
  configured approval/code-owner review.
- Release versioning, deterministic archive generation, checksum updates, GitHub
  publication, and deployment are maintainer responsibilities.

Temporary compatibility shims are treated as supported migration code. Removing one
requires a documented deprecation decision, migration coverage, and maintainer
approval.

## Decision-making

Routine changes use pull-request review and rough consensus. Security boundaries,
backward-incompatible behavior, provider/remoting policy, new privileged tools, large
dependencies, and release architecture require explicit maintainer approval.

When consensus is not reached, the maintainer records the decision and rationale in
the issue or pull request. Decisions may be revisited when new evidence appears.

## Changes to governance

Governance and contribution-policy changes follow the same pull-request process as
code and require code-owner approval. Emergency security actions may be applied first
and documented immediately afterward.