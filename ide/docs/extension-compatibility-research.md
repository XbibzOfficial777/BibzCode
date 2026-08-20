# VS Code extension compatibility notes

Sources:
- https://code.visualstudio.com/api/references/extension-manifest
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/docs/configure/extensions/extension-marketplace
- https://open-vsx.org/

The VS Code extension manifest is a root-level package.json. Required compatibility fields include lowercase `name`, SemVer `version`, `publisher`, and `engines.vscode`; the latter must specify a concrete compatible VS Code version range and cannot be `*`. The extension identifier is `${publisher}.${name}`. Contributions, activation events, extension dependencies, extension packs, categories, icon, main/browser entrypoints, and capabilities are also manifest-driven.

VSIX is the portable installation format. VS Code can install a `.vsix` from the Extensions view or command line, and a VSIX can be distributed from a release. Installed extensions live in a per-user extensions directory; the native BibzCode adapter should use a BibzCode-specific directory but preserve the standard publisher/name/version directory layout so extension packages remain recognizable and portable.

VS Code's Extensions view supports browsing, details, publisher/id display, Install, Manage, Uninstall, Enable, Disable, updates, version selection, and VSIX installation. Third-party extension installation should have a publisher trust/compatibility gate because extensions have editor-level permissions.

Open VSX is an open, vendor-neutral registry for VS Code-compatible extensions. It is a useful registry source for search and metadata, while Marketplace compatibility should be implemented through the same publisher/name/version/engines fields and VSIX package format. The product should support configurable registry sources rather than claiming that every Marketplace extension is guaranteed to run: extensions using proprietary VS Code services, native binaries, proposed APIs, or unavailable hosts may require a compatibility warning.

Implementation decisions:
1. Use a native main-process ExtensionService for registry fetch, metadata normalization, download, VSIX ZIP validation, installation, persistence, and enable/disable state.
2. Use Open VSX as the default public registry for safe, vendor-neutral discovery and provide a configurable VS Code Marketplace metadata/download adapter where allowed by endpoint behavior and licensing.
3. Validate `publisher`, `name`, `version`, `engines.vscode`, and extension ID before install. Reject path traversal and malformed VSIX archives.
4. Keep the renderer on typed contextBridge methods only. Do not fetch or write extension archives directly from React.
5. Mark native/proposed/unsupported extensions with a warning before install and require explicit confirmation for third-party extension code.
