# BibzCode 7.8.0-r6 — Bahasa Indonesia

[← English (default)](../../README.md) · [Semua bahasa](README.md)

<p align="center">
  <a href="https://github.com/XbibzOfficial777/BibzCode/actions/workflows/cli-security.yml"><img alt="Pemeriksaan keamanan CLI" src="https://img.shields.io/github/actions/workflow/status/XbibzOfficial777/BibzCode/cli-security.yml?branch=main&style=flat-square&label=CLI%20security"></a>
  <a href="https://github.com/XbibzOfficial777/BibzCode/actions/workflows/contribution-policy.yml"><img alt="Kebijakan kontribusi" src="https://img.shields.io/github/actions/workflow/status/XbibzOfficial777/BibzCode/contribution-policy.yml?branch=main&style=flat-square&label=Contribution%20policy"></a>
  <a href="../../pyproject.toml"><img alt="Python 3.10 atau lebih baru" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white"></a>
  <a href="../../RELEASE_NOTES_7.8.0.md"><img alt="Rilis 7.8.0-r6" src="https://img.shields.io/badge/Release-7.8.0--r6-6f42c1?style=flat-square"></a>
  <a href="../../LICENSE"><img alt="Lisensi MIT" src="https://img.shields.io/github/license/XbibzOfficial777/BibzCode?style=flat-square&label=License"></a>
</p>

> Ini adalah dokumentasi Bahasa Indonesia yang dipelihara secara khusus. Jika terdapat
> perbedaan makna atau versi, [`README.md`](../../README.md) berbahasa Inggris tetap
> menjadi dokumen kanonis dan paling mutakhir.

BibzCode adalah agen AI multi-provider untuk terminal dengan eksekusi alat yang
terkontrol, penyimpanan sesi, dukungan MCP, utilitas dokumen, otomatisasi browser,
serta konektor Telegram dan Discord opsional.

## Statistik proyek

| Metrik | Nilai | Metrik | Nilai |
| --- | ---: | --- | ---: |
| Provider LLM | 8 | Alat inti | 86 |
| Alat opsional | 29 | Maksimum alat | 115 |
| Regression test | 56 | Bahasa dokumentasi | 48 |
| Mode instalasi | 3 | Command kanonis | `bzcli` |

| Kompatibilitas | Dukungan |
| --- | --- |
| Rilis CLI | `7.8.0-r6` |
| Versi package Python | `7.8.0.post6` |
| Versi minimum Python | Python 3.10+ |
| Matrix CI aktif | Python 3.10 dan 3.13 |
| Platform | Linux, macOS, dan Termux |

## Persyaratan

- Python **3.10+**
- Linux, macOS, atau Termux
- Akun Firebase untuk akses CLI
- API key dari minimal satu provider LLM yang didukung

## Instalasi

Mirror Cloudflare dapat digunakan ketika GitHub tidak tersedia atau diblokir:

```bash
curl -fsSL https://bibzcode.bibzflow.workers.dev/install.sh | bash
```

### Pilihan lingkungan Python

Ketika terminal interaktif tersedia, installer menyediakan tiga pilihan:

1. **Managed venv** — membuat atau menggunakan kembali
   `~/.bibzcode-cli/venv`; ini pilihan default dan paling direkomendasikan.
2. **Active venv** — menggunakan `VIRTUAL_ENV` yang sedang aktif.
3. **User/default Python** — tanpa virtual environment dan menggunakan
   instalasi `pip --user`.

Pilihan yang sama tersedia untuk penggunaan non-interaktif:

```bash
bash install.sh --managed-venv   # direkomendasikan/default
bash install.sh --active-venv    # membutuhkan VIRTUAL_ENV aktif
bash install.sh --user-python    # tanpa venv; menggunakan pip --user
```

Instalasi melalui pipe atau otomatisasi tanpa controlling terminal akan memilih
managed venv secara aman. Gunakan `--non-interactive` atau
`BIBZCODE_INSTALL_MODE=managed|active|user` untuk menentukan mode secara eksplisit.

Untuk memasang dependency browser, dokumen, dan OCR opsional:

```bash
curl -fsSL https://bibzcode.bibzflow.workers.dev/install.sh | bash -s -- --full
```

Dari checkout lokal:

```bash
bash install.sh
```

Installer memverifikasi SHA-256 arsip r6 yang immutable. Mirror Cloudflare dan GitHub
menyediakan arsip byte-for-byte yang sama. Urutan sumber dapat diatur melalui
`BIBZCODE_SOURCE_ORDER=github,cf`.

## Uninstall

```bash
bash install.sh --uninstall        # mempertahankan config/auth/sesi/upload/venv
bash install.sh --purge            # meminta konfirmasi destruktif
bash install.sh --purge --yes      # purge non-interaktif
```

## Menjalankan BibzCode

```bash
bzcli
```

`bzcli` adalah command kanonis. Alias `dscli` dan package wrapper lama tetap tersedia
sementara hanya untuk kompatibilitas dan migrasi pengguna 7.x. Semua output, path,
package, arsip, environment variable baru, dan endpoint menggunakan identitas
BibzCode.

Command penting:

```text
/provider       mengganti provider
/model          mengganti model
/key            mengatur API key provider
/tools          melihat alat yang tersedia
/mcp            mengelola server MCP eksternal
/telegram       mengatur konektor Telegram
/discord        mengatur konektor Discord
/session        melihat daftar sesi
/export         mengekspor percakapan
/compact        memadatkan konteks percakapan
/context        melihat penggunaan konteks dan arsip
/exit           menyimpan lalu keluar
```

## Provider

- OpenRouter
- Google Gemini
- OpenAI
- Anthropic
- Groq
- Together AI
- Hugging Face
- Agnes AI

## Jumlah alat

- 86 alat bawaan dengan dependency inti
- 29 alat tambahan untuk Selenium, browser, dan skill opsional
- Maksimal 115 alat bawaan, ditambah alat yang ditemukan secara dinamis dari server MCP

Kapabilitas dikirim sesuai sumber permintaan. Sesi Telegram dan Discord jarak jauh
tidak diberi akses ke filesystem host, shell, environment variable, kredensial
browser, proses MCP eksternal, atau delegasi sub-agent.

## Model keamanan

- Argumen alat divalidasi sebelum eksekusi.
- Operasi mutasi, sensitif, browser, MCP eksternal, dan akses di luar workspace
  membutuhkan persetujuan lokal.
- Sub-agent tidak dapat melewati persetujuan lokal.
- Telegram dan Discord menolak berjalan tanpa whitelist user ID yang eksplisit.
- Setiap identitas konektor memiliki memori percakapan terisolasi.
- Tujuan jaringan privat/lokal diblokir secara default. Aktifkan
  `BIBZCODE_ALLOW_PRIVATE_NETWORK=1` hanya pada lingkungan pengembangan tepercaya.
- Secret pada environment, argumen alat, cookie, dan hasil alat umum disensor.
- Request HTTP memiliki timeout terbatas dan retry dengan deadline yang dibatasi.
- Parser PDF, Office, gambar, dan media yang tidak tepercaya berjalan dalam child
  process dengan batas resource dan dihentikan sebagai process group ketika timeout.
- Persetujuan persisten hanya berlaku untuk alat penulisan workspace. Shell, delete,
  install, browser, MCP, delegasi, path sensitif, dan akses luar workspace hanya dapat
  disetujui satu kali.
- Setiap redirect HTTP divalidasi ulang oleh kebijakan fetch/download.

## Konektor dan file

Konektor Telegram dan Discord mempertahankan konteks terstruktur untuk pesan aktif dan
pesan yang dibalas. Dukungan file mencakup teks, PDF, DOCX, PPTX, XLSX, CSV, gambar,
OCR, audio/video, APK, serta berbagai metadata pesan Telegram dan Discord.

File diunduh menggunakan batas ukuran yang dapat diatur, nama file yang disanitasi,
permission privat, dan tanpa token bot pada konteks model. Agen jarak jauh hanya
mendapat akses baca ke path file yang tepat, bukan akses filesystem host secara umum.

```bash
export BIBZCODE_CONNECTOR_MAX_FILE_MB=25
export BIBZCODE_CONNECTOR_MAX_IDENTITY_MB=250
export BIBZCODE_CONNECTOR_MAX_IDENTITY_FILES=100
export BIBZCODE_CONNECTOR_FILE_TTL_HOURS=168
```

Setiap kombinasi `(platform, chat, user)` memiliki memori percakapan terisolasi.
Whitelist konektor tetap wajib.

## Memori percakapan panjang

BibzCode secara otomatis memadatkan konteks aktif sebelum mencapai batas model
(default 72% atau 80 pesan aktif). Pesan lama diringkas menjadi memori jangka panjang,
sementara isi aslinya dipindahkan ke arsip sesi lossless. Arsip tetap tersedia setelah
resume dan disertakan dalam ekspor percakapan.

Pengaturan opsional di `config.yaml`:

```yaml
auto_compact: true
auto_compact_ratio: 0.72
auto_compact_message_count: 80
compact_keep_recent: 20
reasoning_prepass: false
max_tool_rounds: 12
tool_timeout: 120
```

Jika model peringkas gagal, ringkasan fallback deterministik digunakan agar request
dapat berlanjut tanpa menghilangkan transkrip yang diarsipkan. `/clear` adalah satu-
satunya command yang dengan sengaja menghapus percakapan aktif dan arsipnya.

## Data lokal

Data disimpan di `~/.bibzcode-cli/`:

- `config.yaml` — pengaturan provider dan API key lokal (`0600`)
- `auth.json` — token refresh/sesi Firebase (`0600`)
- `sessions/` — riwayat percakapan
- `logs/` — metrik lokal agen
- `venv/` — virtual environment yang dikelola installer

File sesi dapat berisi percakapan dan hasil alat. Jangan membagikan folder tersebut dan
jangan menuliskan secret di dalam prompt.

## MCP eksternal

Server MCP berjalan sebagai child process dan dapat memiliki kemampuan besar. Preset
menggunakan versi npm yang dipin dan hanya menerima credential yang dibutuhkan server
tersebut. Preset filesystem dibatasi ke workspace aktif, bukan seluruh home directory.
Periksa setiap server sebelum menghubungkannya.

## Pengembangan dan kontribusi

Kontribusi publik diterima melalui pull request ke branch `nightly`. Branch `main`
digunakan untuk versi stabil/rilis.

```bash
python -m pip install -e '.[test]'
python -m compileall -q bibzcode deepseek tests
python -m pytest -q
python scripts/check_community.py
```

Sebelum berkontribusi, baca:

- [Aturan kontribusi](../../CONTRIBUTING.md)
- [Panduan pengembangan](../DEVELOPMENT.md)
- [Kebijakan keamanan](../../SECURITY.md)
- [Tata kelola proyek](../../GOVERNANCE.md)
- [Kode etik](../../CODE_OF_CONDUCT.md)

Jangan pernah mengirim API key, password, token, cookie, private key, service account,
database export, `.env`, percakapan pengguna, atau data pribadi. Vulnerability harus
dilaporkan secara privat melalui tab **Security**, bukan issue publik.

## Lisensi

MIT — lihat [`LICENSE`](../../LICENSE).
