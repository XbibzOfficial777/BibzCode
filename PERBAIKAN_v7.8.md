# Laporan Perbaikan — DeepSeek CLI v7.8

**Tanggal:** 28 Juli 2026
**Basis:** `deepseek-cli7.8beta.zip`
**Hasil uji:** **88/88 test lulus** · 18/18 modul import · pyflakes **227 → 62**

---

## 1. Permintaan Spesifik Anda

### 1.1 `/help` yang error — akar masalah ditemukan

Bukan salah `show_help()` (fungsinya normal). Penyebabnya **`UnboundLocalError`**:

```python
# repl.py — SEBELUM
if command == '/':
    from .ui import show_help      # ← import lokal di sini…
    show_help()
    return ''
...
elif command in ('/help', '/h', '/?'):
    show_help()                    # ← …bikin baris ini CRASH
```

Import lokal di baris 382 membuat `show_help` menjadi **variabel lokal untuk seluruh fungsi**, sehingga `/help` di baris 394 mengakses variabel yang belum di-assign.

Bukti sebelum perbaikan:
```
UnboundLocalError: cannot access local variable 'show_help'
where it is not associated with a value
```

**Perbaikan:** hapus import lokal (sudah ada di module scope) + komentar penjelas agar tidak terulang. Saya juga menambahkan **pemindai AST** yang memeriksa *seluruh* codebase untuk pola bug yang sama — hasilnya nol.

Sekarang `/help`, `/h`, `/?`, dan `/` semuanya bekerja.

### 1.2 Ctrl+P: semua perintah kini lengkap

Panel lama hanya punya 12 item dan melewatkan banyak perintah. Sekarang **31 perintah slash** semuanya bisa diakses, ditata dalam kategori agar tetap muat di layar HP:

```
-- Settings Panel --
  >> Account         alice                      ← baru
     Provider        OpenRouter
     Model           deepseek/deepseek-r1-0528:free
     API Key         (not set)
     Agent Profile   General Assistant
     Thinking        ON
     Connectors      OFF
     Models …        List / fetch / search models
     Session …       Sessions, export, clear, compact
     Project …       Tools, skills, init, live search
     MCP Servers …   Connect external MCP servers
     System Prompt   Edit system prompt
     Info …          Config info, context usage, version
     Help            Show all commands
```

Diverifikasi lewat **PTY sungguhan** (bukan mock) + 17 jalur submenu diuji satu per satu — semuanya lolos. Ada test yang gagal bila ada perintah baru ditambahkan tanpa dimasukkan ke panel.

### 1.3 Username sinkron real-time CLI ↔ web dashboard

Sebelumnya username hanya dibaca saat registrasi, dengan kode duplikat di dua tempat dan pesan dashboard berbunyi *"CLI will pick this up on next launch"*.

Sekarang ada fungsi tunggal `resolve_username()` di `config.py` dengan urutan otoritas:

1. **Firebase RTDB** `dscliUsers/<uid>/username` ← **dashboard adalah sumber kebenaran**
2. cache lokal di `auth.json`
3. `user@hostname`

Sinkronisasi terjadi di **empat titik**:

| Kapan | Mekanisme |
|---|---|
| Saat login | `_try_restore_session()` menarik profil RTDB |
| Saat CLI start | `resolve_username(force=True)` di banner |
| **Selama sesi berjalan** | **thread background polling tiap 30 detik** |
| Manual | perintah **`/sync`** yang baru |

Kalau Anda ganti nama di dashboard, sesi CLI yang **sedang jalan** akan menampilkan:
```
Account renamed on dashboard → nama-baru
```
tanpa perlu restart. Hasilnya juga ikut ke telemetri. Ada cache 30 detik supaya RTDB tidak dibanjiri.

### 1.4 Kredensial hanya bisa diubah di web dashboard

- CLI **tidak punya** jalur tulis untuk username/email/password — dipastikan oleh test yang menolak keberadaan `update_username`/`set_username` di kode CLI.
- Menu `/account` bersifat **read-only** dan menampilkan tautan dashboard:
  ```
  Credentials are managed on the web dashboard:
  https://deepseek-dash.bibzflow.workers.dev
  The CLI mirrors your username and cannot change it.
  ```
- Perintah `/logout` dan `/sync` ditambahkan (keluar & tarik-ulang identitas, bukan mengubahnya).
- Test memastikan `_settings_account_info()` tidak memanggil `rtdb_put_user`/`rtdb_patch_user`.

---

## 2. Perbaikan Kritis Lain

### 🔴 K-1 — CLI tidak lagi mati saat offline
`enforce_gist()` dipanggil **setiap giliran chat** dan punya 8 `sys.exit(1)`; wifi putus = aplikasi keluar di tengah percakapan.

Sekarang **fail-open**: kegagalan jaringan hanya memunculkan peringatan sekali, lalu masuk mode offline. Hasil di-cache dengan **TTL 5 menit** (bukan tiap giliran). Yang **masih** menghentikan aplikasi hanyalah keputusan administratif eksplisit dari server: `banned` atau `limit_exceeded` — dan itu tetap diuji.

### 🔴 K-2 — Endpoint `/api/update` diamankan
Dulu tanpa autentikasi dan identitas hanya dari `ip` kiriman klien; siapa pun bisa mengirim `input_tokens: 999999999` atas nama IP orang lain untuk mengunci akun korban.

Sekarang wajib salah satu: **Firebase ID token** yang sah, **atau** request benar-benar berasal dari IP yang diklaim (`CF-Connecting-IP`). Ditambah pembatasan delta token (maks 5 juta, tidak boleh negatif) dan pemotongan string agar Gist tidak bisa dibanjiri.

### 🔴 K-3 — Konektor Telegram/Discord: tutup secara default
`allowed_users=None` dulu berarti **izinkan semua**, padahal jalur itu bermuara ke `run_shell` → RCE bagi siapa pun yang menemukan bot.

Sekarang **deny-by-default**, dan bot **menolak start** tanpa whitelist:
```
Refusing to start: no user whitelist configured.
This bot can execute commands, so an allow-list is mandatory.
```

### 🔴 K-4 — Gerbang konfirmasi dipindah ke registry
Sub-agent (`multi_agent.py`) memanggil handler langsung sehingga **melewati seluruh konfirmasi**; `confirm_action()` juga crash tanpa TTY.

Sekarang `ToolRegistry.DANGEROUS_TOOLS` (21 tool) adalah sumber kebenaran tunggal, dicek di `execute()` sehingga **semua** pemanggil (agent, sub-agent, konektor) ikut terlindungi. `confirm_action()` sekarang **fail-closed**: tanpa TTY → `reject`.

### 🔴 K-5 — `delete_file` kini digerbangi
`shutil.rmtree` rekursif tanpa konfirmasi. Ditambahkan ke daftar berbahaya bersama `install_package`, `se_execute_js`, `se_upload`, `browser_download`, `pdf_edit`.

### 🔴 K-6 — `_interrupt_last_time` diinisialisasi
Dibaca sebelum pernah di-assign → `AttributeError` yang tertelan `except`, membuat fallback deteksi ESC tidak pernah jalan.

### 🟠 T-3 — Bug off-by-one parser tool call
```python
json_str = cleaned[m.end(2)-1:i+1]   # ikut menangkap ')' → selalu gagal
json_str = cleaned[m.end(2)-1:i]     # benar
```
Format `tool_name({...})` — yang paling sering ditulis LLM — kini berfungsi.

### 🟠 T-2 — `list_skills`/`read_skill` tidak lagi hilang
Keduanya ter-`register` **di dalam** `_register_selenium_tools()` yang `return` lebih awal tanpa Selenium. Dipindah ke `_register_skill_tools()` sendiri. Tool: **86 → 88**.

### 🟠 T-5 — Pydantic tidak lagi merusak default handler
Field opsional dianotasi `int` tapi default `None` — kontradiktif. `run_shell` menerima `timeout=None` → **subprocess tanpa batas waktu**. Sekarang `Optional[int]` + nilai `None` yang tidak diminta dibuang sebelum sampai handler.

### 🟠 T-6 — Validasi benar-benar dipakai
`Agent` dulu mengambil `['handler']` langsung, melewati 78 model validasi. Sekarang lewat `execute(..., confirm=False)` (konfirmasi sudah dilakukan di UI yang lebih kaya).

---

## 3. Kejujuran Metadata

| Item | Sebelum | Sesudah |
|---|---|---|
| Versi | campur `7.7` / "7.8 beta" | konsisten **7.8** (diuji) |
| Jumlah tool | klaim "120+", nyata 86 | **88**, dilaporkan dinamis |
| Provider di `/version` | 7 (hardcode) | **8**, dibaca dari config |
| Anti-stuck | doc: `MAX_SAME_TOOL=50` (tak ada) | deskripsi sesuai kode |
| `tests/` | tidak ada | **88 test nyata** |
| Alasan berhenti | selalu "max_rounds" | `anti_stuck` vs `max_rounds` |
| f-string sia-sia | ~150 | **0** (104 dibersihkan) |

---

## 4. Pengujian

**88 test** dalam 2 berkas:

- `tests/test_fixes.py` (49) — regresi per temuan audit
- `tests/test_integration.py` (39) — perilaku end-to-end

Cakupan: agent loop, eksekusi tool, memory round-trip, 4 provider, parser streaming, safe_execute, multi-agent, sinkronisasi username, dan otorisasi konektor.

```
88 passed in 4.8s
```

### Mutation testing
Untuk membuktikan test bukan sekadar hijau, saya **sengaja mengembalikan** tiap perbaikan dan memastikan ada test yang gagal:

```
CAUGHT  off-by-one parser         -> 1 failed
CAUGHT  telegram deny-by-default  -> 1 failed
CAUGHT  version consistency       -> 1 failed
```

### Verifikasi PTY nyata
Panel Ctrl+P diuji di pseudo-terminal sungguhan (navigasi panah, Enter, Esc), bukan mock.

---

## 5. Satu Catatan Jujur

Saat membersihkan variabel mati secara otomatis, penghapusan `has_title = True` **merusak** blok `if` di `doc_tools.py` (badan jadi kosong → `IndentationError`). Ketahuan oleh cek kompilasi, langsung diperbaiki, lalu saya audit ulang **semua** penghapusan otomatis lain untuk memastikan tidak ada kerusakan serupa. Ini persis alasan setiap langkah diverifikasi, bukan diasumsikan.

---

## 6. Yang Masih Perlu Anda Lakukan

1. **Firebase Security Rules** — saya tidak bisa memverifikasi dari kode. Pastikan `dscliUsers/<uid>` hanya dapat dibaca/ditulis oleh pemiliknya:
   ```json
   { "rules": { "dscliUsers": { "$uid": {
       ".read":  "auth != null && auth.uid == $uid",
       ".write": "auth != null && auth.uid == $uid"
   }}}}
   ```
   Kode CLI sudah mengirim `?auth=<id_token>`, jadi aturan ketat ini akan tetap berfungsi.

2. **Deploy Worker** — `cd dashboard-react && npx wrangler deploy` untuk mengaktifkan pengamanan `/api/update`.

3. `.gitignore` mengecualikan `dashboard-react/`, tapi `repo_push/` tetap membawa `worker.js` + `wrangler.toml`. Saya sudah menghapus `repo_push/` dan `.config/.wrangler/logs/` dari paket hasil perbaikan.

---

## 7. Berkas

- `deepseek-cli-7.8-fixed.zip` — paket lengkap siap pakai
- `deepseek/` — 18 modul Python yang diperbaiki
- `dashboard-react/worker.js` — backend yang diamankan
- `tests/` — 88 test
