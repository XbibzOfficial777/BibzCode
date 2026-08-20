# BibzCode IDE Native Backlog Audit

**Scope:** current native Electron branch `feat/native-electron-ai`, compared with the inherited BIBZCODE task requirements and production constraints.

## Production constraints

| Requirement | Current status | Evidence / gap |
|---|---|---|
| Electron-only desktop IDE | Implemented on current branch | `ide/electron`, React renderer, Monaco, preload contextBridge, sandboxed BrowserWindow |
| Theia stopped in production | Merged into `main` in PR #8 | `origin/main` no longer contains `ide/theia` or Theia workflow; must continue scanning future changes |
| No dashboard web | Implemented | Native custom protocol and Electron renderer only; no dashboard worker in the native path |
| Build only through GitHub Actions | Implemented as production policy | `ide-ci.yml` and `ide-release.yml`; sandbox source validation is allowed, packaging remains CI-only |
| Public Electron release | Implemented previously and main push-triggered release is configured | Release workflow publishes Linux, Windows, macOS assets; latest main-triggered run must be monitored to completion |

## Completed native capabilities

| Area | Status | Notes |
|---|---|---|
| Monaco editor | Complete | Workers for editor/json/css/html/typescript and custom themes are registered |
| Provider catalog | Complete baseline | 34 presets plus custom OpenAI-compatible endpoint, including Agnes AI |
| Secure API key | Complete | Electron `safeStorage` through main-process secret store |
| Provider routing | Complete baseline | OpenAI-compatible, Anthropic, and Google adapters; local endpoints supported by catalog |
| Real-time AI streaming | Complete baseline | Typed IPC delta events, cancellation, final cleanup, and JSON fallback |
| Thinking/compression controls | Complete baseline | Persisted settings and deterministic compression service |
| Native Agent Manager | Complete baseline | Tool registry, provider tool-calling loop, approvals, tool-result timeline, cancellation |
| Tool security | Complete baseline | Main-process execution, zod validation, workspace boundary, bounded terminal output |
| Python/CLI decoupling | Complete on native path | Runtime setup, CLI bridge, Python field, bundled CLI/Python resources removed from Electron path |
| Electron packaging | Complete baseline | Linux deb/rpm/AppImage, Windows NSIS/portable, macOS DMG/ZIP |

## Open or partially implemented requirements

| Priority | Requirement | Current status | Required next work |
|---|---|---|---|
| P0 | Explorer create file/folder buttons | Broken/partial | Replace browser `prompt()` with a native inline dialog; create relative path through validated IPC; refresh tree after success and show errors |
| P0 | Live settings and theme | In progress, uncommitted | App must receive every settings update; Monaco options/theme and workbench palette must update live; settings writes need serialized atomic queue |
| P0 | VS Code-compatible Extensions page | In progress, uncommitted | Connect ExtensionService to main/preload/contracts; add Extensions activity view, search, details, install/uninstall/enable/disable, VSIX chooser, persistence |
| P0 | Extension runtime host | Not implemented | Installing a VSIX is not the same as running it. Add a controlled extension host or explicitly mark install-only compatibility until host APIs are implemented |
| P1 | VS Code/Open VSX synchronization | Partial design | Use normalized publisher/name/version/engines metadata and VSIX flow; keep registry source selectable and show compatibility warnings for proposed/native APIs |
| P1 | System theme | Not implemented | Extend `IdeTheme` with `system`, use `nativeTheme.shouldUseDarkColors`, and update renderer on `nativeTheme` changes without restart |
| P1 | Extension auto-update | Not implemented | Add check/update state, opt-in policy, version comparison, and restart/host reload notice only when needed |
| P1 | Settings updates from main to all renderer surfaces | Partial | Add settings-changed event or shared App state propagation for multiple panels/windows; current single-window App can update locally |
| P1 | Agent artifacts/review | Partial | Tool timeline exists; add explicit changed-file diff list, revert, apply/reject artifact actions, and task summary |
| P2 | Browser-control agent | Not implemented | Separate capability; must use explicit user approval and a native browser/webview policy if added |
| P2 | Multi-agent parallel orchestration | Not implemented | Current Agent Manager is single-task loop with bounded tool calls |
| P2 | Extension trust policy | Partial | Add publisher trust prompt, manifest risk scan, native-binary/proposed-API warnings, and persisted trust decisions |
| P2 | Extension contribution activation | Not implemented | Install state exists in planned service, but commands/languages/themes/debuggers are not yet activated by an extension host |

## Current uncommitted work

The current working tree contains:

- `ide/electron/settings-store.ts`: serialized write queue for live settings.
- `ide/shared/contracts.ts`: initial extension types/channels and an extended activity view.
- `ide/src/App.tsx`: SettingsPanel callback into App state.
- `ide/src/components/SettingsPanel.tsx`: live settings persistence and debounced secure-key persistence.
- `ide/electron/extension-service.ts`: initial registry search, VSIX download/manifest validation/extraction, installed state, and enable/disable/uninstall service.
- `ide/docs/extension-compatibility-research.md`: official VS Code/Open VSX compatibility notes.

These files are not production-ready until the bridge, IPC handlers, UI, tests, archive safety, and CI checks are completed.

## Implementation order

1. Fix Explorer create actions because they are a direct user-visible broken workflow.
2. Finish live settings/theme, including `system` theme and native theme events.
3. Integrate and harden ExtensionService, then add the Extensions view and VSIX picker.
4. Add extension trust/compatibility warnings and tests. Clearly separate install compatibility from runtime activation compatibility.
5. Add Agent changed-file review/revert and remaining agentic capabilities only after core editor workflows pass.
6. Run GitHub Actions CI, package from CI, verify release assets, and update the backlog document.

## Verification standard

The feature is complete only when typecheck, lint, unit tests, Electron smoke tests, and production packaging succeed in GitHub Actions. A successful download of an extension or build artifact alone does not prove runtime compatibility.
