# BibzCode IDE compatibility workbench

BibzCode IDE provides multi-root workspaces, the Open VSX extension catalog, manual
VSIX installation, built-in language grammars, language servers/debuggers supplied by
compatible extensions, source control, terminals, tasks, notebooks, and an integrated
BibzCode agent sidebar.

The BibzCode activity bar contains:

- an agent view with streamed output and approval input;
- provider selection, OS-backed secret storage, model selection, live model lookup,
  and connection testing;
- local session search, pin, resume, context inspection, compaction, rename,
  export, and delete actions;
- native before/after change review with Apply once, Always allow, and Reject controls;
- managed core/full runtime setup from hash-locked requirements with process-tree cancellation.

Prepared source currently verifies 74 built-in language IDs and 51 grammar extensions.
Additional languages are installed from Open VSX or a compatible VSIX file. Extensions
that require proprietary vendor services or unsupported proposed APIs are not
implicitly supported.

## Verify and prepare

```bash
cd ide/codeoss
npm ci
npm run verify
npm run prepare:upstream
npm run audit:prepared
```

The upstream source and compatibility patch set are pinned by full commits and
SHA-256. Prepared builds remove vendor-specific bundled agents, disable telemetry and
cloud-only defaults, apply runtime lock security updates, bundle the owner logo, and
include the canonical BibzCode runtime.

## Native builds

The native workflow produces Linux x64/ARM64 packages, Windows x64 portable/setup
packages, and a macOS universal package. Every output receives checksums and provenance.
Owner certificates are still required for trusted Windows/macOS signing.

## Security

- Provider keys use extension SecretStorage and never enter workspace files.
- Agent processes start without a shell and require workspace trust.
- Session IDs and bridge actions are strictly allowlisted.
- The agent webview has a local-only content security policy and bounded output/input.
- Fixable runtime advisories are upgraded deterministically; remaining findings require
  explicit code-level mitigations documented in `SECURITY_AUDIT.md`.
