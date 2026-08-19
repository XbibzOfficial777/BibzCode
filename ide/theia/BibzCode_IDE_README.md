# BibzCode IDE

BibzCode IDE adalah aplikasi browser berbasis Eclipse Theia yang diperluas untuk kebutuhan BibzCode. Fondasinya mempertahankan editor Monaco, workspace, terminal, search, Source Control, debug, task runner, outline view, testing view, VS Code extension host, dan Open VSX registry. Fitur product-level BibzCode ditambahkan melalui Theia extension terpisah sehingga tidak mengubah kompatibilitas extension VS Code.

## Build di sandbox

Gunakan Node.js 20 LTS. Node.js 22 pada kombinasi Theia 1.74.1 dan `native-keymap` menghasilkan kegagalan kompilasi C++; Node 20.20.2 adalah runtime yang tervalidasi untuk bundle ini.

```bash
cd /home/ubuntu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 20
npm install
npm run download:plugins --workspace browser-app
npm run build:browser
```

Build yang tervalidasi menghasilkan browser dan node bundle dengan **0 errors**. Browser development build sengaja memakai pipeline esbuild terisolasi. Linked sourcemap dapat diaktifkan untuk investigasi source-level dengan `THEIA_DEV_SOURCEMAP=1`, tetapi pada Theia 1.74.1 mode tersebut memiliki lifecycle bug yang dapat menghentikan shared esbuild service.

Target Electron juga sudah tervalidasi di sandbox:

```bash
npm run build:electron
```

Build Electron menghasilkan browser, node, dan electron bundle dengan **0 errors** setelah native modules direbuild. Runtime utama yang diuji secara interaktif adalah browser karena sandbox tidak menyediakan packaging desktop sebagai deliverable OS-specific; artifact Electron sudah tersedia untuk tahap packaging lanjutan.

## Menjalankan IDE

```bash
cd /home/ubuntu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 20
npm run start:browser
```

IDE tersedia di `http://127.0.0.1:3000`. Untuk membuka workspace, gunakan URL workspace Theia atau menu **File → Open Workspace** setelah server hidup.

## Fitur product-level BibzCode

Menu **BibzCode** menyediakan `BibzCode: Open Command Center` dan `BibzCode: Platform & Extension Compatibility`. Shortcut `Ctrl/Cmd+Alt+C` membuka command center. Perintah tersebut adalah Theia extension internal dan tidak mengubah atau menggantikan VS Code API.

## Kompatibilitas ekstensi VS Code

`@theia/plugin-ext` dan `@theia/plugin-ext-vscode` menyediakan extension host. `@theia/vsx-registry` menyediakan Extensions view dan instalasi runtime dari Open VSX. Plugin yang disinkronkan saat build didefinisikan pada `browser-app/package.json` melalui `theiaPlugins` dan disimpan di `../plugins`.

```bash
npm run download:plugins --workspace browser-app
```

Uji nyata yang sudah berhasil adalah Prettier VS Code extension 12.4.0 dari Open VSX. Log runtime menunjukkan satu plugin berhasil disinkronkan, dimuat, dan dijalankan oleh `PluginManagerExtImpl`.

Kompatibilitas harus dipahami sebagai **kompatibilitas berdasarkan coverage VS Code API versi Theia**, bukan jaminan bahwa setiap extension di Visual Studio Code akan 100% berfungsi. Extension yang bergantung pada API proprietary Microsoft, binary native tertentu, Electron-only behavior, atau API VS Code yang belum tercakup dapat memerlukan fallback atau tidak dapat berjalan penuh. VSIX manual juga didukung melalui plugin location setelah di-unpack.

## Struktur utama

| Path | Peran |
|---|---|
| `browser-app/` | Aplikasi IDE browser Theia |
| `electron-app/` | Target desktop Electron yang disiapkan oleh scaffold |
| `bibzcode-ide/` | Custom Theia extension untuk command center dan product commands |
| `plugins/` | VS Code extensions yang disinkronkan/pre-installed |
| `browser-app/esbuild.mjs` | Pipeline browser/node bundle yang stabil di sandbox |

## Status validasi

| Komponen | Status |
|---|---|
| TypeScript custom extension | PASS |
| Browser bundle | PASS, 0 errors |
| Node backend bundle | PASS, 0 errors |
| Runtime HTTP server | PASS, port 3000 |
| Frontend state | PASS, mencapai `ready` |
| Custom BibzCode menu | PASS |
| VS Code extension host | PASS |
| Open VSX download script | PASS |
| Prettier extension activation | PASS |
| npm production dependency audit | WARNING, 45 findings pada Theia dependency tree |
| Electron bundle | PASS, browser/node/electron 0 errors |
| npm full dependency audit | WARNING, 75 findings pada full tree |

## Catatan keamanan

Jangan menganggap extension pihak ketiga aman hanya karena dapat dipasang. Extension berjalan dengan kemampuan yang diberikan extension host, sehingga setiap extension perlu dipin versi, checksum atau provenance-nya diverifikasi, dan diuji dalam workspace trust policy. Untuk deployment production, lakukan upgrade Theia/dependency terencana dan audit ulang sebelum membuka registry ke pengguna umum.

## Desktop packaging

Electron Builder 26.15.3 dikonfigurasi pada `electron-builder.yml`. Target Linux adalah `.deb`, `.rpm`, dan `.AppImage`; target Windows adalah NSIS `.exe` dan portable `.exe`; target macOS adalah `.dmg` dan `.zip`. Perintahnya adalah `npm run package:linux`, `npm run package:windows`, dan `npm run package:mac`.

Artifact Linux x64 `.deb`, `.rpm`, dan `.AppImage` berhasil dibuat di sandbox. Windows portable `.exe` juga berhasil dibuat. NSIS memerlukan Wine ketika dibuild dari Linux dan karenanya dijalankan pada Windows CI. macOS ZIP dan `.app` directory dapat dibuat dari Linux, tetapi DMG memerlukan utilitas macOS `sips`; packaging macOS final dijalankan pada runner macOS melalui `.github/workflows/build-desktop.yml`.

Windows DLL resources diletakkan di `electron-app/native/windows/x64` atau `electron-app/native/windows/arm64` dan dipetakan ke `resources/native/windows` di luar ASAR. DLL bukan installer; DLL harus dikompilasi untuk Windows dan arsitektur yang tepat.
