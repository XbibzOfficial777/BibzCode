# BibzCode Theia IDE CI/CD

The workflow at `.github/workflows/build-theia-ide.yml` is limited to the Theia IDE under `ide/theia`. It does not build, package, deploy, or publish the BibzCode web dashboard.

## Automatic execution

Every push and pull request that changes `ide/theia/**` or this workflow runs validation and packaging jobs. Branch and pull-request runs compile and validate artifacts but do not publish a release. A successful push to `main` publishes a CI prerelease, while a tag matching `ide-v*` publishes a named IDE release. Maintainers can also invoke the workflow manually and explicitly enable release publication.

## Build matrix

| Target | Runner | Published artifact families |
|---|---|---|
| Linux amd64 | `ubuntu-24.04` | `.deb`, `.rpm`, `AppImage` |
| Linux arm64 | `ubuntu-24.04-arm` | `.deb`, `.rpm`, `AppImage` |
| Linux armv7l | `ubuntu-22.04` with explicit ARM rebuild | `.deb`, `.rpm`, `AppImage` |
| Windows x64 | `windows-2025` | NSIS installer and portable `.exe` |
| macOS x64 | `macos-13` | `.dmg`, `.zip` |
| macOS arm64 | `macos-14` | `.dmg`, `.zip` |

Each Linux job checks Debian metadata, RPM metadata, AppImage ELF output, native module architecture, and SHA-256 checksums. The release job requires every matrix job to succeed before copying assets into a canonical release directory and publishing them to GitHub Releases.

## Error handling

The workflow retries transient package/build commands up to three times and clears only npm's verifiable cache before retrying. It does not silently ignore compiler, test, packaging, architecture, or metadata failures. The native rebuild wrapper repairs only the deterministic `node-pty` prebuild layout when a valid compiled `pty.node` exists; it never fabricates a binary or changes application source automatically.

A failed job uploads diagnostic logs when available. A release is never published from a failed or partially validated matrix.

## Release controls

The GitHub Actions token needs `contents: write` only in the release job. Release assets are created from workflow artifacts rather than from repository-tracked binaries. This keeps the repository source-only and prevents the web dashboard or local build output from entering releases.

The workflow uses GitHub Actions artifacts to pass build outputs between jobs and `softprops/action-gh-release@v3` to upload the final validated assets. See the [GitHub Actions workflow syntax documentation](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions), [artifact documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data), and [release action documentation](https://github.com/softprops/action-gh-release).
