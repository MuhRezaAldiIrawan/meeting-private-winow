# Design: Private Presenter Notes (Meeting-Private Window)

Tanggal: 2026-11-12 · Sumber: `PRD Private Presenter Notes.md`

Dokumen ini adalah hasil brainstorming yang sudah disetujui user. Untuk implementation plan yang
terpecah menjadi task-taskecutable, lihat `docs/superpowers/plans/` (dihasilkan oleh skill
`writing-plans`).

---

## 1. Ringkasan

Aplikasi desktop kecil (Electron) yang menampilkan catatan presenter di monitor presenter tanpa
ikut tertangkap saat layar dibagikan di Zoom, Google Meet, atau Teams.

Prinsip utama yang mengikat seluruh desain:

- **Fail-visible.** Kalau proteksi gagal diterapkan, indikator menampilkan `error` — tidak pernah `on`.
- **Transparan.** Aplikasi dan jendelanya tetap terlihat di taskbar/Dock, daftar jendela, dan Task
  Manager. Tidak ada fitur anti-deteksi.
- **Privasi.** Semua data lokal, tanpa telemetry, tanpa panggilan jaringan dari renderer.

### Cakupan yang diimplementasikan (siklus ini)

| Requirement | Status siklus ini |
| --- | --- |
| FR-01 Editor catatan tersimpan lokal | ✅ |
| FR-02 Toggle proteksi lewat tombol + hotkey global | ✅ |
| FR-03 Indikator status selalu terlihat | ✅ |
| FR-04 Default OFF + pemberitahuan penggunaan pertama kali | ✅ |
| FR-05 Tetap tampil di taskbar/Dock & daftar jendela | ✅ (sifat default Electron, tanpa opsi menyembunyikan) |
| FR-11 Kolom pertanyaan + area jawaban | ✅ |
| FR-12 Request AI hanya atas aksi eksplisit | ✅ |
| FR-13 Label permanen third-party + AI bisa keliru | ✅ |
| FR-14 API key hanya di main process | ✅ |
| FR-15 Pesan error jelas per kode HTTP | ✅ |
| FR-06 Posisi/ukuran/opacity persisted | ⏭ siklus berikutnya |
| FR-07 Timer + agenda per segmen | ⏭ siklus berikutnya |
| FR-08 Panduan "Tes capture" | ⏭ siklus berikutnya |
| FR-09 Teleprompter auto-scroll | ⏭ siklus berikutnya |
| FR-10 Ekspor/impor `.md` | ⏭ siklus berikutnya |

Non-goals PRD (tidak dibangun, permintaan ditolak): menyembunyikan aplikasi dari taskbar/Dock/
Alt+Tab/daftar jendela; dipakai untuk ujian/assessment/wawancara; membaca layar/audio lawan bicara
secara otomatis; mengakai proctoring/monitoring; memaksa z-order di atas fullscreen pihak lain;
merekam layar/audio peserta.

---

## 2. Keputusan yang sudah diambil (dari brainstorming)

| Topik | Keputusan |
| --- | --- |
| Cakupan | P0 + AI Assist penuh. P1/P2 menyusul setelah matriks uji. |
| Stack | Electron + TypeScript, bundler `electron-vite`. |
| Arsitektur | Layered service (`src/main/{windows,protection,storage,ai,ipc,services}`). |
| AI Assist | Diimplementasikan penuh, request dari main process ke DataByte API. |
| API key | Dari env `DATABYTE_API_KEY` / `DATABYTE_MODEL`, plus UI Settings; disimpan di `settings.json` di userData. |
| Pengujian | Vitest unit + integrasi. Tidak ada E2E Playwright. |
| Editor | Markdown + preview (tab bergantian), `marked` + `DOMPurify`. |
| Hotkey global | `Ctrl+Shift+P` = toggle proteksi. |
| Bahasa | Label UI bahasa Inggris, dokumentasi README berbahasa Indonesia. **Pesan error AI tetap berbahasa Indonesia** (PRD FR-15 eksplisit meminta begitu) — ini pengecualian yang disengaja, bukan inkonsistensi. |

---

## 3. Arsitektur

### 3.1 Peta direktori

```
meeting-private-window/
├─ PRD Private Presenter Notes.md
├─ README.md
├─ docs/
│  ├─ superpowers/specs/2026-11-12-private-presenter-notes-design.md
│  ├─ superpowers/plans/
│  └─ testing-matrix.md            ← hasil matriks uji manual (PRD bagian "Rencana uji coba")
├─ electron.vite.config.ts
├─ vitest.config.ts
├─ package.json
├─ tsconfig.json
├─ tsconfig.node.json
├─ tsconfig.web.json
└─ src/
   ├─ shared/                       ← dipakai main, preload, dan renderer
   │  ├─ channels.ts                ← konstanta nama channel IPC
   │  ├─ types.ts                   ← payload & tipe status
   │  └─ logger.ts                  ← logger dengan penyensoran field sensitif
   ├─ main/
   │  ├─ index.ts                   ← lifecycle + wiring
   │  ├─ windows/notesWindow.ts     ← factory BrowserWindow
   │  ├─ protection/
   │  │  ├─ types.ts                ← ProtectionStatus, ContentProtectionAdapter
   │  │  ├─ ProtectionService.ts    ← state machine (murni, tanpa Electron)
   │  │  └─ electronAdapter.ts       ← adapter ke win.setContentProtection
   │  ├─ storage/
   │  │  ├─ NotesStore.ts
   │  │  └─ SettingsStore.ts
   │  ├─ ai/
   │  │  ├─ DataByteClient.ts
   │  │  ├─ errors.ts               ← AiErrorCode + pemetaan HTTP
   │  │  └─ prompt.ts               ← shaping request/response
   │  ├─ ipc/registerIpcHandlers.ts
   │  └─ services/
   │     ├─ hotkeys.ts
   │     └─ singleInstance.ts
   ├─ preload/index.ts
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ main.ts
         ├─ views/ EditorView.ts | StatusBar.ts | AiPanel.ts | NoticeDialog.ts | SettingsDialog.ts
         ├─ state/appStore.ts
         ├─ lib/markdown.ts
         └─ styles/app.css
```

### 3.2 Aturan batas lapisan

1. **Renderer tidak pernah** memanggil API Electron langsung, dan tidak melakukan request jaringan.
   Semua lewat `window.presenter` (diekspos preload).
2. **Main tidak pernah** menyentuh DOM renderer. Semua state dikirim lewat channel yang dideklarasikan
   di `shared/channels.ts`.
3. **Logika bisnis** (state machine proteksi, mapping error, sanitasi markdown, storage) berada di
   file yang **tidak meng-import Electron**, sehingga bisa diuji dengan unit test biasa.
4. **Semua nama channel IPC** konstanta di `shared/channels.ts` — main, preload, dan renderer meng-import
   dari satu sumber, sehingga typo channel ketahuan saat compile.

### 3.3 Tanggung jawab per komponen

| Komponen | Tanggung jawab | Bergantung pada |
| --- | --- | --- |
| `main/index.ts` | Lifecycle: `app.whenReady` → single instance → buat window → daftarkan IPC → register hotkey | Semua service |
| `windows/notesWindow.ts` | `BrowserWindow` dengan `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload minimal | — |
| `protection/ProtectionService.ts` | State machine status proteksi. **Tidak** meng-import Electron | `ContentProtectionAdapter` |
| `protection/electronAdapter.ts` | Menerjemahkan `apply()` ke `win.setContentProtection(v)` dalam `try/catch` | Electron |
| `storage/NotesStore.ts` | Baca/tulis `notes.md` di `app.getPath('userData')`, atomic write (tulis `.tmp` → `rename`) | `node:fs/promises` |
| `storage/SettingsStore.ts` | Baca/tulis `settings.json`: `hasAcknowledgedNotice`, `apiKey`, `model` | `node:fs/promises` |
| `ai/DataByteClient.ts` | `POST` ke DataByte, timeout 30s, mapping error | global `fetch` |
| `ai/errors.ts` | `AiErrorCode` + fungsi pemetaan status HTTP → pesan | — |
| `ipc/registerIpcHandlers.ts` | Satu tempat registrasi seluruh channel IPC + validasi argumen | Service |
| `services/hotkeys.ts` | `globalShortcut.register`, panggil service langsung | — |
| `services/singleInstance.ts` | `app.requestSingleInstanceLock()` | — |
| `preload/index.ts` | `contextBridge.exposeInMainWorld('presenter', api)` | `shared/channels` |
| `renderer/state/appStore.ts` | Store sederhana `subscribe/notify`, sumber kebenaran UI | — |
| `renderer/lib/markdown.ts` | Render markdown aman | `marked`, `dompurify` |

### 3.4 Kontrak preload

```ts
window.presenter = {
  getProtectionStatus(): Promise<ProtectionSnapshot>
  toggleProtection(): Promise<ProtectionSnapshot>
  getNotes(): Promise<string>
  saveNotes(content: string): Promise<void>
  askAi(question: string): Promise<AiResult>
  getSettings(): Promise<PublicSettings>   // { hasApiKey: boolean, model: string }
  setApiKey(value: string | null): Promise<PublicSettings>
  setModel(value: string): Promise<PublicSettings>
  acknowledgeNotice(): Promise<void>
  onProtectionChanged(cb: (snapshot: ProtectionSnapshot) => void): () => void
}
```

`getSettings()` **tidak pernah** mengembalikan nilai API key — hanya `hasApiKey` boolean dan `model`.

---

## 4. State machine proteksi

Status yang mungkin: `off`, `on`, `error`. Tidak ada status keempat.

```
                toggle / hotkey
   off ──────────────────────► apply(true) ──┬─► on        (adapter berhasil)
   on ──────────────────────► apply(false) ─┴─► off
   error ───────────────────► apply(true) ──┬─► on        (retry sukses)
                                           └─► error     (retry gagal → tetap error)

   apply() melempar / adapter menolak  →  status = 'error', reason = pesan
```

Aturan yang ditegakkan:

- `on` hanya dapat dicapai melalui jalur yang `await` adapter berhasil. Kalau adapter melempar,
  transisi adalah `off → error` atau `error → error`, **tidak pernah** `off → on`.
- Tidak ada polling untuk "memastikan" proteksi masih aktif; percuma pada Windows karena flag
  `WDA_EXCLUDEFROMCAPTURE` bersifat per-snapshot dan tidak bisa dibaca balik.
- Kegagalan merusak apa pun: window tetap terbuka, catatan tetap ada, toggle tetap bisa dicoba lagi.

### Platform

Windows dan macOS ditangani oleh API Electron yang sama (`setContentProtection`), sehingga adapter-nya
identik. Yang membedakan adalah perilaku OS, dan itu yang diuji manual lewat matriks uji.

- Windows: Electron memakai `SetWindowDisplayAffinity` dengan `WDA_EXCLUDEFROMCAPTURE`. Butuh
  Windows 10 versi 2004 ke atas; pada versi lebih lama area bisa tampil hitam.
- macOS: Electron memakai `NSWindow.sharingType = .none`. Hasil bisa berbeda per versi macOS dan
  per metode capture (termasuk ScreenCaptureKit).

Dokumentasi tidak mengklaim "tidak terlihat" secara mutlak: kamera yang mengarah ke layar, perekam
hardware, dan software monitoring tingkat sistem tetap bisa melihat jendela.

---

## 5. Alur data

### 5.1 Toggle proteksi

1. Pemicu: tombol UI di renderer, **atau** hotkey global `Ctrl+Shift+P`.
2. Renderer → `ipcRenderer.invoke('protection:toggle')`. Hotkey → `services/hotkeys.ts` memanggil
   `ProtectionService.toggle()` langsung di main (tidak melewati renderer).
3. Main: `ProtectionService.toggle()` → panggil adapter → tentukan status baru.
4. Main: broadcast `protection:changed` ke semua renderer.
5. `StatusBar` render ulang indikator.

Hotkey tidak bergantung pada fokus window, sehingga status konsisten.

### 5.2 Catatan

1. Saat mount, renderer → `invoke('notes:get')` → main baca `notes.md` dari userData.
2. Perubahan input → debounce 500ms → `invoke('notes:save', content)`.
3. Main: `NotesStore.save()` → atomic write (tulis `notes.md.tmp`, lalu `rename`).
4. Indikator di footer: "Saving…" → "Saved".

### 5.3 AI Assist

1. User mengetik pertanyaan → tekan "Ask" atau Enter di kolom → `invoke('ai:ask', question)`.
2. Main `DataByteClient.ask()`:
   - Ambil key: `process.env.DATABYTE_API_KEY`, fallback ke `SettingsStore.apiKey`. Key kosong →
     error `no_api_key` (tanpa request keluar). Env var menang bila keduanya terisi, sesuai
     prioritas "env var + UI settings" yang disepakati.
   - Model: `process.env.DATABYTE_MODEL` ?? `SettingsStore.model` ?? `MiniMax-M3`. Nilai default
     mengikuti PRD: nama model plan tanpa awalan `provider/`.
   - `POST https://ai.databyte.co.id/v1/chat/completions`
     - Header: `Authorization: Bearer <key>`, `Content-Type: application/json`
     - Body: `{ model, messages, temperature: 0.3, max_tokens: 600, stream: false }`
     - `messages` berisi satu system message (peran: presenter, diminta menjawab singkat dan jujur,
       menyatakan kalau tidak tahu) dan satu user message berisi pertanyaan pengguna. Isi catatan
       presenter **tidak** dikirim sebagai konteks — hanya pertanyaan yang diketik pengguna.
     - `AbortController` dengan timeout 30 detik.
3. Response dipetakan ke `{ ok: true, answer }` atau `{ ok: false, errorCode, message }`.
4. Renderer menampilkan jawaban atau pesan error.

Tidak ada request keluar tanpa aksi eksplisit pengguna (FR-12). `connect-src 'none'` di CSP
renderer menjamin ini secara teknis.

### 5.4 Pemetaan error AI (FR-15)

Semua pesan berbahasa Indonesia, dipetakan di main, dinormalisasi ke `AiErrorCode`.

| HTTP | `errorCode` | Pesan |
| --- | --- | --- |
| 401 | `unauthorized` | "API key ditolak. Periksa DATABYTE_API_KEY Anda." |
| 402 | `payment_required` | "Jatah request habis. Top up Request Based Plan Anda." |
| 403 | `forbidden` | "Akses ditolak. Periksa izin API key Anda." |
| 404 | `not_found` | "Endpoint atau model tidak ditemukan. Periksa DATABYTE_MODEL." |
| 429 | `rate_limited` | "Rate limit tercapai. Tunggu sebentar lalu coba lagi." |
| — | `no_api_key` | "API key belum diatur. Tambahkan di Settings atau variabel DATABYTE_API_KEY." |
| — | `timeout` | "Permintaan melebihi batas 30 detik." |
| — | `network` | "Gagal menghubungi server DataByte." |
| — | `invalid_response` | "Respons server tidak dapat dibaca." |
| — | `unknown` | "Terjadi kesalahan tak terduga." |

### 5.5 Keamanan API key (FR-14)

- Key hanya dibaca di main process.
- `getSettings()` hanya mengembalikan `{ hasApiKey, model }`.
- Logger main menyensor field bernama `apiKey`, `authorization`, `token`, `bearer` sebelum menulis.
- Key tidak pernah masuk ke file catatan, tidak masuk log, tidak terlihat dari DevTools renderer.

---

## 6. Antarmuka pengguna

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│ Notes        ● Protected                    ● ON  ○ OFF  ⚠ │
├───────────────────────────────┬──────────────────────────┤
│  [ Notes ] [ Preview ]        │  AI ASSIST                │
│                               │  ┌────────────────────┐  │
│  # Agenda                    │  │ Ask a question...  │  │
│  - Intro (2 min)              │  └────────────────────┘  │
│  - Demo                      │  [ Ask ]                 │
│                               │  ┌────────────────────┐  │
│                               │  │ Answer area        │  │
│                               │  └────────────────────┘  │
│                               │  ⚠ Questions are sent to │
│                               │    DataByte. AI answers  │
│                               │    may be wrong.         │
├───────────────────────────────┴──────────────────────────┤
│ Saved · 1,240 chars                        Ctrl+Shift+P  │
└──────────────────────────────────────────────────────────┘
```

Notes dan Preview berupa **tab bergantian** (bukan side-by-side) supaya panel AI tetap muat di
jendela sempit.

### 6.2 Indikator status (FR-03)

Tiga state, selalu terlihat, tidak ada kondisi ambigu.

| Status | Warna | Label | Ikon |
| --- | --- | --- | --- |
| `off` | Abu-abu | "Not protected" | Lingkaran kosong |
| `on` | Hijau | "Protected" | Lingkaran terisi |
| `error` | Merah/oranye | "Protection failed" | Segitiga peringatan + `title` tooltip berisi reason detail |

State `error` tidak pernah memakai warna hijau dan teksnya berbeda dari `on`.

### 6.3 First-run notice (FR-04)

Modal sekali saja. Tampil saat aplikasi pertama kali dibuka, ditutup dengan tombol
"I understand — continue", yang menyimpan flag `hasAcknowledgedNotice` di `settings.json`.

Isi modal (bahasa Inggris, sesuai keputusan UI language):

> **Before you use Private Presenter Notes**
>
> This app hides your notes from screen sharing by asking the operating system to exclude the
> window from capture. It does not hide itself — the app and its window stay visible in your
> taskbar, window list, and Task Manager.
>
> Make sure your use complies with your meeting or organization's rules. Using it during exams,
> assessments, or interviews that prohibit external help is not appropriate.
>
> A camera pointed at your screen, hardware recorders, and system-level monitoring software can
> still see this window.

Proteksi **default OFF** di setiap instalasi baru, dan **tidak** ikut ter-reset oleh
`hasAcknowledgedNotice`. Keduanya independen.

### 6.4 Settings (API key)

Dialog Settings berisi:

- Input password-type untuk API key + tombol show/hide. Nilai yang tersimpan ditampilkan masked
  (`sk-db-••••••••1234`).
- Input model, default `MiniMax-M3`.
- Tombol Save. Nilai disimpan di `settings.json` di userData.

### 6.5 Editor

- Tab **Notes**: `<textarea>` markdown native.
- Tab **Preview**: hasil render markdown ter-sanitasi.
- Auto-save debounce 500ms; footer menampilkan "Saving…" → "Saved" dan jumlah karakter.

### 6.6 Markdown aman

`marked` untuk parse, `DOMPurify` untuk sanitasi.

- HTML mentah **dihapus** dari DOM (bukan di-escape menjadi teks) agar tidak ada skrip yang
  masuk ke renderer.
- `target="_blank"` pada link dipaksa dengan `rel="noopener noreferrer"`.
- Tag `<script>`, atribut event handler (`onerror`, `onclick`, dst.), dan `javascript:` URL dibuang.

### 6.7 CSP

`meta` tag di `index.html`:

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
connect-src 'none';
```

`connect-src 'none'` membuat renderer tidak bisa melakukan request jaringan sama sekali — satu-satunya
jalur keluar adalah lewat main process, dan itu hanya untuk AI atas aksi eksplisit pengguna.

---

## 7. Penanganan error

| Sumber kegagalan | Perilaku |
| --- | --- |
| `setContentProtection` melempar | Status → `error`, reason disimpan, toast di renderer, tooltip berisi detail |
| OS tidak mendukung (Windows < 2004) | Adapter menangkap, status `error` |
| `notes.md` gagal ditulis | Toast "Couldn't save notes"; isi textarea tetap utuh di memory, tidak hilang |
| `notes.md` hilang saat baca | Dianggap string kosong; file dibuat saat save pertama |
| `settings.json` korup | Fallback ke default, log warning sekali, tidak crash |
| Tidak ada API key | Error `no_api_key` dengan cara mengaturnya |
| HTTP error AI | Dipetakan ke tabel di §5.4 |
| Timeout 30 detik AI | `AbortController` → error `timeout` |
| `window.presenter` undefined di renderer | Render pesan fatal di layar, bukan crash diam-diam |

Tidak ada `console.log` untuk nilai sensitif. `src/shared/logger.ts` menyensor key sensitif sebelum menulis.

---

## 8. Strategi pengujian

Vitest. Unit test untuk logika murni, integration test untuk IPC main dengan Electron di-mock.
Tidak ada E2E Playwright.

### 8.1 Unit — logika murni

| Target | Cakupan |
| --- | --- |
| `ProtectionService` | Matriks transisi state: `off→on`, `off→error` saat adapter melempar, `on→off`, `error→error`, `error→on` saat retry sukses. **Test eksplisit: adapter melempar → status tidak pernah `on`.** |
| `ai/errors.ts` | Setiap kode HTTP → pesan yang tepat; `no_api_key`; `timeout`; `network`; `invalid_response`. |
| `renderer/lib/markdown.ts` | `<script>` dibuang; `onerror` dibuang; `javascript:` URL dibuang; link dapat `rel="noopener noreferrer"`. |
| `storage/NotesStore.ts` | Atomic write: file `.tmp` tidak tertinggal; konten identik setelah read-back; file hilang → string kosong. |
| `storage/SettingsStore.ts` | Default saat file tidak ada; default saat file korup; round-trip API key; `hasAcknowledgedNotice` persist. |

### 8.2 Integrasi — main process

| Target | Cakupan |
| --- | --- |
| `ipc/registerIpcHandlers.ts` | Semua channel terdaftar; `notes:save` menolak argumen non-string; `protection:toggle` mengembalikan snapshot benar. |
| `ai/DataByteClient.ts` | `fetch` di-mock: 401→`unauthorized`, 402→`payment_required`, 403→`forbidden`, 404→`not_found`, 429→`rate_limited`, timeout→`timeout`; header `Authorization` benar; key tidak bocor ke renderer. |

### 8.3 Manual — matriks uji

Tidak bisa di-automate; butuh OS dan aplikasi meeting sungguhan. Dicatat di `docs/testing-matrix.md`
dengan kolom: nomor skenario, OS + versi, aplikasi + versi, hasil (lolos/gagal/keterangan).

Skenario 1–10 PRD: Zoom/Meet/Teams di Windows, Meet/Teams/Zoom di macOS, share jendela (bukan
layar penuh), screenshot OS saat ON, toggle OFF, simulasi fail-visible, multi-monitor, z-order
fullscreen (`demo.html`).

### 8.4 Aturan TDD

Setiap komponen ditulis test-nya lebih dulu (RED), lalu implementasi minimum untuk GREEN, lalu
refactor. Tidak ada kode produksi yang ditulis sebelum test-nya ada.

Test diletakkan berpasangan dengan file source: `src/main/protection/ProtectionService.test.ts`
di sebelah `ProtectionService.ts`.

Environment Vitest: `node` sebagai default; `jsdom` untuk test renderer, dipilih per-file dengan
docblock `@vitest-environment jsdom`.

---

## 9. Konfigurasi proyek

- **package.json** — `main` menunjuk ke output `electron-vite` (`out/main/index.js`), skrip
  `dev`, `build`, `preview`, `test`, `test:watch`, `typecheck`, `lint`.
- **electron-vite** — tiga target build: `main` (Node, bundled), `preload` (CJS, minimal), `renderer`
  (browser, HTML + TS).
- **TypeScript** — `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
  `tsconfig.node.json` untuk main+preload, `tsconfig.web.json` untuk renderer.
- **electron-builder** — target `nsis` (Windows) dan `dmg` (macOS), `asar: true`.
- **Dependensi runtime** — `marked`, `dompurify`. Dependensi dev: `electron`, `electron-vite`,
  `electron-builder`, `typescript`, `vitest`, `jsdom`, `@types/node`, `@types/dompurify`.

---

## 10. Risiko & batasan yang harus didokumentasikan di README

| Risiko | Mitigasi di desain |
| --- | --- |
| Perilaku capture berbeda per versi OS/app meeting | Indikator status jujur + tabel matriks uji manual; tidak ada klaim mutlak |
| Pembaruan OS mengubah perilaku API | Uji ulang tiap rilis OS besar; status `error` terlihat |
| Penyalahgunaan untuk assessment/wawancara | Non-goals, first-run notice, tanpa fitur anti-deteksi |
| Catatan sensitif bocor | Data lokal, tanpa telemetry, renderer tanpa akses jaringan |
| Key API bocor | Key hanya di main, disensor di log, tidak pernah dikirim ke renderer |

---

## 11. Out of scope siklus ini

FR-06 (posisi/ukuran/opacity persisted), FR-07 (timer + agenda per segmen), FR-08 (panduan tes
capture), FR-09 (teleprompter auto-scroll), FR-10 (ekspor/impor `.md`). Semuanya punya acceptance
criteria di PRD dan akan masuk siklus implementasi berikutnya.

Satu pengecualian kecil: FR-01 menyebut "teks atau Markdown sederhana" dan editor di sini sudah
Markdown + preview, sehingga fondasi untuk FR-10 sudah ada tetapi panel ekspor/impor belum.
