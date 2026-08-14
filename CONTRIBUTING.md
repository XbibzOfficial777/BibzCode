# Contributing to BibzCode

Thank you for helping improve BibzCode. Contributions are welcome from first-time and
experienced contributors, provided they preserve the project's security boundaries,
compatibility policy, and release integrity.

> **Ringkasan Bahasa Indonesia:** buat issue atau diskusi teknis lebih dahulu untuk
> perubahan besar, buat branch dari `nightly`, tambahkan test, jangan pernah
> mengirim credential/data pribadi, dan buka pull request ke `nightly`. Dashboard
> deployment tidak termasuk scope repository publik ini. Semua kontribusi akan
> melalui CI dan review maintainer sebelum dapat digabungkan.

## 1. Choose the right channel

- **Bug:** use the bug report form and include a minimal reproduction.
- **Feature or behavior change:** use the feature request form before investing in a
  large implementation.
- **Question/support:** use the question form after reading `README.md` and
  `SUPPORT.md`.
- **Security vulnerability:** follow `SECURITY.md`. Never disclose it in a public
  issue, pull request, discussion, log, screenshot, or sample configuration.

Search existing issues and pull requests before opening a new one.

## 2. Public repository scope

Accepted contributions include:

- the `bibzcode` Python package;
- tests, CLI documentation, and examples;
- installer and deterministic release tooling;
- the narrow `deepseek`/`dscli` migration shims;
- GitHub Actions and repository community files.

The deployed React dashboard and its Cloudflare Worker are maintained separately and
must **not** be added under `dashboard-react/` or otherwise committed to this public
repository. Do not submit generated dashboard assets, deployment state, database
exports, service-account files, or production configuration.

## 3. Development workflow

1. Fork the repository.
2. Fetch the current `nightly` branch and create a focused branch from it.
3. Use a descriptive branch name:
   - `feat/short-description`
   - `fix/short-description`
   - `docs/short-description`
   - `test/short-description`
   - `security/short-description`
4. Follow the setup and test instructions in `docs/DEVELOPMENT.md`.
5. Keep commits small and logically grouped.
6. Push to your fork and open a pull request against **`nightly`**, not `main`.

`main` is the stable/release branch. Maintainers promote reviewed changes from
`nightly` after required checks pass.

## 4. Non-negotiable contribution rules

### Security and privacy

- Never commit API keys, tokens, passwords, cookies, private keys, service accounts,
  database exports, `.env` files, user conversations, personal data, or real account
  identifiers.
- Use obvious placeholders such as `example-token` and synthetic test fixtures.
- Do not weaken approval gates, path controls, network/redirect validation, secret
  redaction, connector identity isolation, authentication, rate limiting, or bounded
  timeouts merely to make a test pass.
- Never introduce hidden downloads, obfuscated payloads, undeclared telemetry,
  credential collection, persistence mechanisms, or code that bypasses user consent.
- New dependencies require a clear justification and must be narrowly version-bounded.

### Compatibility and naming

- New code, documentation, paths, environment variables, archives, and user-visible
  output must use the canonical **BibzCode** identity.
- `deepseek`, `dscli`, and legacy environment/data paths may appear only inside an
  explicit migration or compatibility shim.
- Do not remove a compatibility shim without a documented deprecation plan, migration
  test, and maintainer approval.
- The canonical command is `bzcli`; `dscli` is temporary compatibility only.

### Code quality

- Support Python 3.10 and every Python version exercised by CI.
- Add or update tests for every behavior change and regression fix.
- Keep remote connector capabilities more restrictive than local interactive use.
- Prefer small, explicit functions and fail-closed behavior at trust boundaries.
- Preserve finite HTTP timeouts, bounded retries, deterministic builds, and atomic or
  permission-safe writes for sensitive local data.
- Avoid unrelated formatting changes and repository-wide rewrites in focused PRs.
- Do not edit generated release archives or checksums unless the PR is an approved
  release change. Release artifacts must be regenerated with
  `scripts/build_release.py` and verified byte-for-byte.

### AI-assisted contributions

You remain fully responsible for submitted code, including AI-assisted code. Review
and test every line, remove fabricated dependencies or APIs, and disclose substantial
AI assistance in the pull request when it affects reviewability. Unreviewed generated
code is not acceptable.

### Licensing

By submitting a contribution, you agree that it may be distributed under this
repository's MIT license and that you have the right to submit it. Do not copy code or
assets with incompatible or unclear licensing.

## 5. Commit messages

Use an imperative subject and, when practical, a Conventional Commit prefix:

```text
feat: add provider capability validation
fix: reject redirects to private network targets
docs: explain managed virtual environments
test: cover legacy configuration migration
security: tighten connector attachment limits
```

Explain *why* a non-trivial change is needed in the commit body. Do not place issue
keywords or security details in a commit message if they could disclose an unpatched
vulnerability.

## 6. Required local checks

At minimum, run:

```bash
python -m compileall -q bibzcode deepseek tests
python -m pytest -q
python scripts/check_community.py
```

For code or release changes, also run the full commands documented in
`docs/DEVELOPMENT.md`. Pull requests must pass all required GitHub checks on every
supported Python version.

## 7. Pull request requirements

A reviewable pull request must:

- describe the problem and the chosen approach;
- link the related issue when one exists;
- list security and compatibility impact;
- include test evidence;
- update documentation for user-visible behavior;
- keep the diff focused and free of credentials or generated clutter;
- complete every applicable item in the pull request template.

Draft pull requests are welcome for early feedback. A maintainer may request that a
large PR be split into smaller changes.

## 8. Review and merge policy

- At least one approving review is required for non-maintainer contributions.
- Code-owner review, resolved conversations, and required CI checks are enforced on
  protected branches.
- Maintainers may close contributions that violate security boundaries, licensing,
  project scope, or the Code of Conduct.
- Approval does not guarantee immediate release. Maintainers control release timing,
  version updates, archive regeneration, deployment, and promotion to `main`.
- Squash merge is preferred for a focused pull request unless preserving individual
  commits materially improves the history.

See `GOVERNANCE.md` for roles and project decision-making.