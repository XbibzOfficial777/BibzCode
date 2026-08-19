# BibzCode IDE Desktop Packaging

## Target platform

BibzCode IDE memakai Electron Builder 26.15.3 di atas Electron 42.3.0. Target packaging yang dikonfigurasi adalah Debian/Ubuntu melalui `.deb`, Fedora/RHEL/openSUSE melalui `.rpm`, AppImage untuk Linux portable, NSIS dan portable `.exe` untuk Windows, serta `.dmg` dan `.zip` untuk macOS.

| Platform | Target | Status sandbox Linux | Status CI native |
|---|---|---|---|
| Linux x64 | `.deb` | **PASS**, 107 MB | **PASS** |
| Linux x64 | `.rpm` | **PASS**, 88 MB | **PASS** |
| Linux x64 | `.AppImage` | **PASS**, 137 MB | **PASS** |
| Windows x64 | portable `.exe` | **PASS**, 446 MB | **PASS** |
| Windows x64 | NSIS installer `.exe` | Requires Wine on Linux; CI uses Windows runner | **Configured** |
| macOS x64/arm64 | `.dmg` and `.zip` | Not runtime-validatable on Linux | **Configured on macOS runner** |
| Windows native | `.dll` resources | Resource mapping **PASS**; no project-specific DLL supplied | **Per-architecture build required** |

## Linux artifacts

The Linux artifacts were verified without installing them into the host system. `dpkg-deb --info` confirmed a valid Debian package with package name `bibzcode-ide`, version `7.8.0`, architecture `amd64`, maintainer metadata, and runtime dependencies. `rpm -qip` confirmed a valid x86_64 RPM. The AppImage reports a valid AppImage runtime version.

```text
SHA-256
06463cef7adc495ab16fee686e4f4945265061133eef667f1916d7fcc9d6ad4b3  BibzCode-IDE-7.8.0-linux-amd64.deb
20406a015d4e2ce06557bfe0bb000c4ff6b21e073321bab1ea98d0dc160fd6e3  BibzCode-IDE-7.8.0-linux-x86_64.rpm
6fdd8e62363f379390d6c1475ad06dd4673599ccf33ffcd16042f0a080b93cc3  BibzCode-IDE-7.8.0-linux-x86_64.AppImage
35db7e40d3ff3fac1303c573b57d96452c37e9c1263c38c3a250bc759930cf5b  BibzCode-IDE-7.8.0-portable-x64.exe
```

## Windows `.exe`

The portable Windows artifact was built successfully from the Linux sandbox as a PE32 GUI self-extracting executable. It is a no-install portable distribution and does not require an NSIS install workflow. The NSIS target is configured as the primary Windows installer, but Linux cross-build requires Wine; the GitHub Actions workflow builds it on a native Windows runner to avoid invalid cross-runtime assumptions.

The portable binary is large because it contains the Electron runtime and Theia workbench. A future production optimization should use differential updates, a web installer, or a smaller plugin baseline rather than removing runtime files blindly.

## Windows DLL support

A DLL is not an installer format. The configuration reserves `electron-app/native/windows/x64` and `electron-app/native/windows/arm64` for architecture-specific DLLs and maps them into `resources/native/windows` outside the ASAR archive. A loader must check `process.platform === "win32"` and the architecture before loading a DLL. DLLs must be compiled for Windows and must never be copied from a Linux or macOS build.

The current bundle contains no project-specific DLL because no DLL was supplied in the project requirements. The packaging contract and resource mapping are ready for one to be added with provenance and checksum verification.

## macOS support

The configuration produces `.dmg` and `.zip` targets for both x64 and arm64. macOS runtime validation, code signing, notarization, and native module rebuild must occur on a macOS runner. The included GitHub Actions workflow uses `macos-14`, rebuilds native modules on that host, packages DMG/ZIP, and uploads the artifacts.

Unsigned local macOS testing can be performed with `CSC_IDENTITY_AUTO_DISCOVERY=false`. Production distribution requires Apple Developer ID signing and notarization; those credentials are intentionally not placed in the sandbox.

## Build commands

```bash
# Linux
npm run package:linux

# Windows native runner, or Linux with Wine for NSIS
npm run package:windows

# macOS native runner
npm run package:mac
```

The cross-platform workflow is stored at `.github/workflows/build-desktop.yml`. It uses Node 20, runs `npm ci`, downloads the pinned Prettier VS Code plugin, rebuilds Theia/Electron native modules on the current OS, and uploads the OS-specific artifacts.

## References

[1]: https://www.electron.build/docs/targets/ "electron-builder Target Selection Guide"
[2]: https://www.electron.build/docs/configuration/ "electron-builder Configuration"
[3]: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules "Electron Native Node Modules"

## Debian multi-architecture policy

Debian does not provide a single universal executable `.deb` for this IDE. The package includes Electron and native `.node` modules, so each package must carry one exact architecture in its control metadata. The supported target matrix for the current Electron 42 line is:

| Debian architecture | electron-builder target | Validation status |
|---|---|---|
| `amd64` | `--x64` | **PASS in sandbox**; `Architecture: amd64` |
| `arm64` | `--arm64` | **Configured in native ARM64 CI**; not falsely published from the x86_64 sandbox |
| `armhf`/`armv7l` | `--armv7l` | **Configured as an explicit target**; requires a validated ARMv7 native/cross toolchain |

The sandbox is x86_64. Its current valid binary artifact is `BibzCode-IDE-7.8.0-linux-amd64.deb`. An ARM64 package built with x86_64 native `.node` files would be invalid even if `dpkg-deb` accepted the archive, so the ARM64 artifact must be produced on an ARM64 runner or with a fully validated cross toolchain. The CI workflow now separates the jobs and uploads `*amd64.deb`, `*arm64.deb`, and `*armv7l.deb` independently.
