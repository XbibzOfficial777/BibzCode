# BibzCode IDE — Eclipse Theia Edition

This directory contains the standalone BibzCode IDE built on Eclipse Theia 1.74.1. It is intentionally separate from the legacy `ide/` client and does **not** include the BibzCode web dashboard.

The IDE includes Theia workbench features, VS Code extension compatibility, Open VSX integration, workspace search, debugging, tasks, SCM, outline view, terminal support, and the BibzCode command center.

## Development

Use Node.js 20 LTS. From this directory:

```bash
npm ci
npm run build:browser
npm run build:electron
npm run start:browser
```

## Desktop packaging

The package scripts generate platform-native artifacts through electron-builder. Debian packages are architecture-specific; the CI workflow builds `amd64`, `arm64`, and `armv7l` in separate jobs so native modules are rebuilt for the target architecture.

```bash
npm run package:linux:amd64
npm run package:linux:arm64
npm run package:linux:armv7l
npm run package:windows
npm run package:mac
```

The web dashboard is deliberately excluded from this directory and from the Theia IDE workflow.
