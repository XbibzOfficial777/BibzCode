# BibzCode IDE 7.8.0-r6

<p align="center">
  <img src="build/icon.png" alt="BibzCode IDE logo" width="180">
</p>

<p align="center">
  <strong>Production BibzCode desktop development environment.</strong>
</p>

## Supported production packages

| Operating system | Architectures | Packages |
| --- | --- | --- |
| Debian, Ubuntu, and compatible Linux | x64, ARM64 | `.deb` |
| Fedora, RHEL, Rocky, Alma, openSUSE-compatible | x64, ARM64 | `.rpm` |
| Windows 10/11 | x64 | NSIS installer `.exe`, portable `.exe` |
| macOS 12+ | Universal (Intel x64 + Apple Silicon ARM64) | `.dmg`, `.zip` |

Native packages are produced by `.github/workflows/ide-release.yml`. GitHub signing
secrets activate Windows Authenticode signing and macOS hardened-runtime
signing/notarization without placing credentials in source.

## Feature parity

The IDE is a standalone Electron application. Its Assistant panel uses the configured provider directly from the native main process and streams responses through the typed preload bridge. The IDE does not package `bibzcode`, `deepseek`, Python, a virtual environment, or a web dashboard.

Native capabilities include:

- 34 provider presets, including OpenAI-compatible gateways, Anthropic, Google Gemini, local Ollama/LM Studio/vLLM, Agnes AI, and custom endpoints;
- secure API-key storage through Electron safeStorage;
- live model discovery, thinking modes and budgets, and deterministic ultra context compression;
- real-time streaming Agent Prompt and Assistant responses with cancellation;
- Monaco Editor language workers, themes, minimap, tabs, search, diff, terminal, Git, and workspace operations;
- VS Code-compatible extension foundation under the native Electron security boundary;
- CSP, context isolation, sandbox, path restrictions, denied remote navigation, and validated IPC.

The original BibzCode CLI remains a separate repository capability. It is not launched by the IDE and is not required for startup, AI responses, editor use, or packaging.

## IDE capabilities

- Offline code editing and language support—no editor code is fetched from a CDN.
- Lazy workspace explorer with create, rename, atomic save, and system-trash deletion.
- Workspace search with binary, size, symlink, and generated-directory boundaries.
- Integrated command terminal restricted to the selected workspace.
- Git status, diff, stage, unstage, and commit with repository hooks preserved.
- Native multi-provider Agent and Assistant streaming with cancelable responses.
- Command palette, native menus, editor tabs, dirty-state protection, and settings.
- Local-only logs, opt-in update checks, no telemetry, and no remote UI scripts.

## Desktop security boundary

The renderer uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
and `webSecurity: true`. It receives a narrow, frozen preload API rather than Node.js
or generic IPC access. Main-process handlers validate payloads and enforce:

- canonical workspace containment and symlink-escape rejection;
- 10 MiB editor read/write limits and binary-file rejection;
- atomic file writes that preserve existing executable permissions;
- system trash instead of renderer-triggered permanent deletion;
- command/input length limits;
- HTTPS allowlisting for external links;
- denied permission requests, embedded remote views, popups, and navigation;
- a restrictive renderer Content Security Policy;
- a secure `bibzcode://app/` protocol instead of privileged `file://` renderer pages;
- hardened packaged-runtime controls and integrity validation.

## Development

Node.js **22.22.2+** is required for development. Python is not required by the IDE.

```bash
cd ide
npm ci
npm run typecheck
npm run lint
npm test
npm run build
xvfb-run -a npm run test:e2e  # Linux production-window smoke
```

Start the development application:

```bash
npm run dev
```

## Local Linux packages

```bash
npm run dist:linux
```

Artifacts and `SHA256SUMS` are written to `ide/release/`. ARM64, Windows, and macOS
packages should be built on their native GitHub runners via the release workflow.
Cross-compiling a macOS package on Linux is intentionally not treated as a valid
production build.

## Code signing and notarization

Configure these through **GitHub repository secrets**, never source files or chat:

| Platform | Secret names |
| --- | --- |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| macOS certificate | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` |
| Apple notarization | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Optional checksum signature | `LINUX_GPG_PRIVATE_KEY`, `LINUX_GPG_PASSPHRASE` |

Without certificate secrets, CI still creates checksum-verified unsigned test
artifacts. Those artifacts may trigger SmartScreen or Gatekeeper warnings and must not
be described as signed production releases.

## Logo

`build/logo-original.png` preserves the exact owner-provided 3264×3264 source. The
`.png`, multi-resolution `.ico`, `.icns`, and Linux icon sizes are derived locally from
that source without generative modification.

## License

MIT. The bundled CLI remains governed by the repository `LICENSE`.
