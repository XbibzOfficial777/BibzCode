# BibzCode Development Guide

This guide covers the public CLI repository. Read `CONTRIBUTING.md` before changing
code.

## Prerequisites

- Git
- Python 3.10 or newer
- A virtual environment
- Optional system packages required by browser, OCR, or document integrations

Production credentials are never required for unit tests. Use synthetic fixtures and
mocked network responses.

## Set up a development environment

```bash
git clone https://github.com/XbibzOfficial777/BibzCode.git
cd BibzCode
git fetch origin nightly
git switch -c fix/example origin/nightly
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
python -m pip install 'pyflakes>=3,<4' 'bandit>=1.8,<2' 'build>=1.2,<2'
```

Use `.[test,full]` only when developing optional browser, MCP, plotting, or document
features. Keep credentials in local environment variables or ignored files—never in
source, test fixtures, command history shared in an issue, or screenshots.

## Repository map

```text
bibzcode/                 canonical CLI package
deepseek/                 temporary import/module compatibility wrapper
tests/                    unit and security regression tests
scripts/build_release.py  deterministic release builder
scripts/check_community.py repository policy validator
releases/                 immutable CLI archive and checksum
.github/                  CI, issue forms, review templates, CODEOWNERS
```

Private deployment and administration sources are outside this public repository and
must never be created or committed here.

## Fast checks

```bash
python -m compileall -q bibzcode deepseek tests
python -m pytest -q
python scripts/check_community.py
```

## Full CLI checks

Run these before requesting review for code, dependency, installer, or release
changes:

```bash
python -m compileall -q bibzcode deepseek tests
python -m pytest -q
python -m pyflakes bibzcode deepseek tests scripts/check_community.py
bandit -q -r bibzcode --severity-level medium
python -m build
```

CI runs tests on every supported Python version in its matrix. Code that passes only
on the contributor's newest Python version is not ready to merge.

## Deterministic release verification

Only regenerate an archive when the issue/PR is explicitly a release change:

```bash
python scripts/build_release.py
git diff --exit-code -- install.sh releases/
```

The second command must be clean when no approved release change exists. If an
archive changes, explain why and include both old and new SHA-256 values in the pull
request. Never hand-edit an archive or checksum.

## Coding expectations

- Use canonical `bibzcode` imports in all new code.
- Keep `deepseek` and `dscli` references isolated to explicit compatibility paths.
- Add type hints where they improve trust-boundary or API clarity.
- Catch only errors that can be handled meaningfully; preserve actionable context.
- Use finite timeouts and bounded retries for external operations.
- Validate tool arguments before side effects.
- Keep sensitive local files private and use atomic replacement where practical.
- Never let remote connectors gain broader host access than local interactive users.

## Tests

Place regression tests near the related subsystem. Tests must be deterministic and
must not require live Firebase, provider APIs, browser accounts, or network access.
Use temporary directories and synthetic credentials. Assert security failures as well
as successful paths.

When changing compatibility behavior, test both the canonical path and migration from
the legacy path. When changing a trust boundary, include a negative test that proves
the bypass is rejected.

## IDE development

The desktop IDE requires Node.js 22.22.2+ and uses the same Python source from the
repository root as a packaged runtime resource.

```bash
cd ide
npm ci
npm audit
npm run typecheck
npm run lint
npm test
npm run build
xvfb-run -a npm run test:e2e  # Linux
```

Do not weaken `contextIsolation`, renderer sandboxing, CSP, IPC schemas, path
containment, symlink checks, or CLI approval policy. Build `.deb`, `.rpm`, Windows, and
macOS artifacts through the native release workflow described in `ide/README.md`.

## Pull request preparation

```bash
git status --short
git diff --check
git diff origin/nightly...HEAD
```

Confirm that the diff contains no `.env`, key, service-account, database, local state,
cache, build output, or private deployment files. Then complete the pull request
template and target `nightly`.
