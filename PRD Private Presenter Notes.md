# PRD: Private Presenter Notes (Meeting-Private Window)

Nov 12, 2026 · @Lllen

## Ringkasan

Private Presenter Notes adalah aplikasi desktop kecil yang menampilkan catatan, agenda, dan timer di monitor presenter tanpa ikut tertangkap saat layar dibagikan di Zoom, Google Meet, atau Teams. Dokumen ini menjadi acuan uji coba teknis, bukan spesifikasi produk final.

**Masalah:** presenter yang berbagi layar sering butuh catatan atau timer. Menaruhnya di jendela biasa berisiko ikut terlihat peserta, dan layar kedua tidak selalu tersedia.

**Tujuan:**

- Catatan tampil di monitor presenter dan tidak muncul di hasil screen share.
- Presenter selalu tahu apakah perlindungan sedang aktif, tanpa menebak.
- Perilaku terverifikasi lewat uji di Zoom, Meet, dan Teams pada Windows dan macOS.
- Transparan: tidak ada fitur yang menyamarkan keberadaan aplikasi dari pengguna maupun dari sistem.

**Asumsi yang perlu dikonfirmasi:** dibangun dengan Electron, target Windows 10 versi 2004 ke atas dan macOS yang masih didukung Electron, penggunaan pribadi, data tersimpan lokal.

## Use case dan persona

Use case utamanya adalah catatan privat bagi orang yang sedang berbicara di depan peserta lain, sama seperti kertas catatan atau layar kedua.

| Persona | Situasi | Kebutuhan |
| --- | --- | --- |
| Presenter webinar | Demo produk sambil share layar | Poin bicara dan timer yang tidak terlihat audiens |
| Dosen atau trainer | Mengajar online dengan slide | Catatan materi, jadwal sesi, daftar pertanyaan peserta |
| Sales engineer | Demo ke klien | Skrip demo dan angka kunci |
| Moderator meeting | Memimpin rapat dengan agenda | Agenda, pembagian waktu, giliran bicara berikutnya |
| Pengguna umum | Share layar sambil memegang info pribadi | Jendela privat yang tidak ikut tertangkap |

Di semua kasus ini, peserta lain wajar mengetahui bahwa presenter memegang catatan. Produk ini tidak dirancang untuk menyembunyikan bantuan dari pihak ketiga.

## Non-goals

Bagian ini membatasi lingkup produk. Semua poin di bawah sengaja tidak dibangun, dan permintaan fitur yang mengarah ke sana ditolak.

- Menyembunyikan aplikasi dari taskbar, Dock, Alt+Tab, atau daftar jendela untuk menghindari deteksi.
- Dipakai pada ujian, assessment, atau wawancara yang melarang bantuan eksternal.
- Fitur yang membaca layar atau audio lawan bicara lalu menghasilkan jawaban otomatis secara diam-diam.
- Mengakali software proctoring, monitoring perusahaan, atau sistem integritas tes.
- Memaksa jendela tetap tampil di atas aplikasi fullscreen milik pihak lain.
- Merekam layar atau audio peserta tanpa sepengetahuan mereka.

## Functional requirements

Sepuluh kebutuhan fungsional, dengan P0 sebagai syarat minimum untuk uji coba.

| ID | Requirement | Prioritas | Kriteria diterima |
| --- | --- | --- | --- |
| FR-01 | Jendela catatan yang bisa diedit (teks atau Markdown sederhana), disimpan lokal | P0 | Teks tetap ada setelah aplikasi ditutup dan dibuka lagi |
| FR-02 | Toggle "sembunyikan dari capture" lewat tombol dan hotkey global | P0 | Status berubah tanpa restart aplikasi |
| FR-03 | Indikator status ON/OFF selalu terlihat di jendela | P0 | Teks dan warna berbeda, tidak ada keadaan ambigu |
| FR-04 | Default OFF; ON hanya setelah pengguna mengaktifkan, dengan pemberitahuan penggunaan saat pertama kali | P0 | Instalasi baru dimulai dalam keadaan OFF |
| FR-05 | Aplikasi tetap tampil di taskbar atau Dock dan daftar jendela | P0 | Tidak ada opsi untuk menyembunyikannya |
| FR-06 | Jendela bisa digeser, diubah ukurannya, dan diatur opacity-nya | P1 | Posisi dan ukuran diingat |
| FR-07 | Timer hitung mundur dan agenda per segmen | P1 | Peringatan visual saat segmen hampir habis |
| FR-08 | Panduan "Tes capture": langkah berbagi layar ke diri sendiri dan memeriksa hasilnya | P1 | Pengguna bisa memverifikasi sendiri sebelum meeting |
| FR-09 | Mode teleprompter dengan auto-scroll yang kecepatannya bisa diatur | P2 | Scroll berhenti saat dijeda |
| FR-10 | Ekspor dan impor catatan sebagai file .md | P2 | Isi identik setelah impor |

## Non-functional requirements

Prinsip utamanya: kalau proteksi gagal, pengguna harus tahu, bukan dibuat percaya bahwa jendela sudah tersembunyi.

- **Fail-visible:** jika API proteksi gagal diterapkan, indikator menampilkan status gagal atau OFF, tidak pernah ON.
- **Platform:** Windows 10 versi 2004 ke atas dan macOS yang masih didukung Electron. Perilaku diuji per versi, tidak diasumsikan sama.
- **Kinerja (target awal, perlu divalidasi):** CPU idle di bawah 1% dan memori di bawah 200 MB.
- **Privasi:** semua data lokal, tanpa telemetry secara default, tanpa panggilan jaringan.
- **Keamanan:** `contextIsolation` aktif, `nodeIntegration` mati, preload minimal, dan Content Security Policy yang ketat.
- **Transparansi:** proses dan jendela tampil normal di Task Manager atau Activity Monitor dan di daftar jendela sistem.

## Arsitektur dan implementasi

Perlindungan terjadi di compositor sistem operasi: jendela catatan ditandai khusus, sehingga gambar layar yang diminta aplikasi meeting disusun tanpa jendela itu, sementara monitor presenter tetap menampilkannya.

&#91;embedded content: arsitektur · 7 komponen, 1 filter di compositor\]

Aplikasi meeting tidak tahu jendela catatan ada, karena penyaringan terjadi sebelum gambar sampai ke Zoom, Meet, atau Teams.

**API per platform**

| Platform | API | Perilaku | Catatan uji |
| --- | --- | --- | --- |
| Windows | `SetWindowDisplayAffinity` dengan `WDA_EXCLUDEFROMCAPTURE`, dipanggil lewat `setContentProtection(true)` di Electron | Jendela tampil di monitor, dikecualikan dari capture | Butuh Windows 10 versi 2004 ke atas; pada versi lebih lama opsi serupa bisa tampil sebagai area hitam |
| macOS | `NSWindow.sharingType = .none`, dipanggil lewat `setContentProtection(true)` | Jendela tidak ikut tertangkap oleh API capture | Verifikasi per versi macOS dan per metode capture (termasuk ScreenCaptureKit), hasil bisa berbeda |
| Berbagi tab browser | Tidak berlaku | Jendela native di luar tab memang tidak ikut | Dicatat sebagai pembanding |

**Alur implementasi**

1. Buat `BrowserWindow` catatan dengan `contextIsolation: true`, `nodeIntegration: false`, dan preload minimal.
2. Saat startup, proteksi dalam keadaan OFF (FR-04).
3. Hotkey global dan tombol UI mengirim IPC `toggle-protection` ke main process.
4. Main process memanggil `setContentProtection(value)` di dalam `try/catch`. Jika error, status yang dikirim ke renderer adalah gagal, bukan ON.
5. Renderer menampilkan indikator ON, OFF, atau gagal (FR-03).
6. Penyimpanan catatan dilakukan main process ke file lokal lewat IPC, tidak langsung dari renderer.

Prototipe `capture-protection-lab` sudah mencakup langkah 1, 3, dan 4 dalam bentuk dasar.

## Transparansi, privasi, dan etika

Perlindungan dari capture diposisikan sebagai fitur privasi bagi presenter, bukan alat untuk menyamarkan perilaku dari pihak lain.

- **Pemberitahuan pertama kali:** aplikasi meminta pengguna memastikan pemakaiannya sesuai aturan meeting atau organisasi, dan menyatakan bahwa penggunaan pada ujian, assessment, atau wawancara yang melarang bantuan eksternal tidak dibenarkan.
- **Tanpa fitur anti-deteksi:** tidak ada penyamaran nama proses, penyembunyian dari daftar jendela, atau upaya menghindari software pemantau.
- **Keterbatasan dijelaskan jujur:** kamera yang mengarah ke layar, perekam hardware, dan software monitoring tingkat sistem tetap bisa melihat jendela. Dokumentasi tidak menjanjikan "tidak terlihat" secara mutlak.
- **Hormati kebijakan:** beberapa organisasi melarang aplikasi tersembunyi di perangkat kerja. Pengguna perlu memeriksa kebijakan mereka sendiri.
- **Data lokal:** catatan tidak dikirim ke server mana pun.

## Rencana uji coba

Uji hanya dengan akun dan perangkat milik sendiri: satu perangkat sebagai presenter, satu lagi (atau akun kedua) sebagai penonton. Catat OS, versi OS, versi aplikasi meeting, dan hasil per baris.

| # | Skenario | Cara uji | Hasil yang diharapkan |
| --- | --- | --- | --- |
| 1 | Share seluruh layar di Zoom desktop (Windows) | Toggle ON, amati layar di sisi penonton | Jendela catatan tidak tampil, desktop normal |
| 2 | Share seluruh layar di Google Meet (Chrome) | Sama seperti 1 | Jendela catatan tidak tampil |
| 3 | Share seluruh layar di Microsoft Teams | Sama seperti 1 | Jendela catatan tidak tampil |
| 4 | Share satu jendela aplikasi lain, bukan layar penuh | Toggle ON dan OFF | Hasil sama di kedua kondisi, catatan dicatat sebagai tidak relevan |
| 5 | Zoom, Meet, dan Teams di macOS | Sama seperti 1, catat versi macOS | Bandingkan hasil antarversi, catat perbedaan |
| 6 | Screenshot dan perekam layar bawaan OS | Tangkap layar saat ON | Catat apakah jendela tertangkap, tampil hitam, atau hilang |
| 7 | Toggle OFF | Matikan lalu amati penonton | Jendela kembali tertangkap, indikator OFF |
| 8 | Fail-visible | Simulasikan kegagalan API proteksi | Indikator tidak pernah menampilkan ON |
| 9 | Multi-monitor | Share monitor kedua dan monitor utama | Perilaku konsisten, dicatat jika berbeda |
| 10 | Halaman demo fullscreen buatan sendiri | Buka `demo.html`, masuk fullscreen | Catat perilaku z-order tanpa memaksa tampil di atas |

## Metrik, risiko, dan milestone

**Kriteria sukses uji coba:**

- Skenario 1 sampai 3 lulus di minimal tiga aplikasi meeting pada satu OS.
- Nol kasus indikator ON palsu pada uji fail-visible.
- Perbedaan perilaku per versi OS terdokumentasi.

**Risiko:**

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Perilaku capture berbeda per versi OS dan aplikasi meeting, misalnya jendela tampil hitam atau tetap tertangkap pada metode capture tertentu | Pengguna mengira tersembunyi padahal terlihat | Matriks uji per versi, dokumentasi keterbatasan, tanpa klaim mutlak |
| Pembaruan OS mengubah perilaku API | Fitur berhenti bekerja tanpa disadari | Uji ulang tiap rilis OS besar, indikator status jujur |
| Penyalahgunaan untuk assessment atau wawancara | Pelanggaran aturan dan risiko reputasi | Non-goals, pemberitahuan penggunaan, tanpa fitur anti-deteksi |
| Catatan sensitif bocor | Pelanggaran privasi | Data lokal, tanpa telemetry |

**Milestone:**

1. Prototipe Electron untuk eksplorasi (proyek `capture-protection-lab`).
2. Editor catatan dan penyimpanan lokal.
3. Indikator status dan pemberitahuan penggunaan pertama kali.
4. Timer dan agenda.
5. Putaran uji matriks di Windows.
6. Putaran uji matriks di macOS.
7. Perbaikan dan dokumentasi keterbatasan.

## Fitur AI Assist (manual)

AI Assist membantu presenter mencari jawaban cepat atas pertanyaan yang ia ketik sendiri. Panggilan ke DataByte API (Request Based Plan, format OpenAI Chat Completions) dibuat dari main process, bukan dari jendela UI.

| Item | Keputusan |
| --- | --- |
| Pemicu | Hanya saat pengguna mengetik pertanyaan lalu menekan Tanya atau Enter |
| Endpoint | `POST https://ai.databyte.co.id/v1/chat/completions` |
| Autentikasi | `Authorization: Bearer sk-db-...`, dibaca dari variabel lingkungan `DATABYTE_API_KEY` di main process |
| Model | `MiniMax-M3` (model plan, tanpa awalan `provider/`), bisa diganti lewat `DATABYTE_MODEL` |
| Parameter | `temperature` 0.3, `max_tokens` 600, `stream` false, batas waktu 30 detik |
| Penagihan | Memotong jatah Request Based Plan, bukan saldo AI Gateway |
| Error | HTTP 401, 402, 403, 404, dan 429 dipetakan ke pesan berbahasa Indonesia |

**Kebutuhan tambahan**

| ID | Requirement | Prioritas |
| --- | --- | --- |
| FR-11 | Kolom pertanyaan dan area jawaban di jendela catatan | P1 |
| FR-12 | Request dibuat hanya atas aksi eksplisit pengguna | P0 |
| FR-13 | Label permanen: pertanyaan dikirim ke pihak ketiga dan jawaban AI bisa keliru | P0 |
| FR-14 | API key hanya ada di main process, tidak masuk ke renderer, log, atau file catatan | P0 |
| FR-15 | Pesan error yang jelas untuk setiap kode HTTP | P1 |

**Batasan fitur AI**

- Tidak membaca layar, audio, atau clipboard secara otomatis untuk menyusun jawaban.
- Tidak menjawab pertanyaan peserta secara otomatis tanpa tindakan presenter.
- Tidak untuk ujian atau wawancara yang melarang bantuan eksternal, dan hal ini disebut di pemberitahuan pertama kali.
- Riwayat pertanyaan, jika ada, hanya disimpan lokal dan bisa dihapus pengguna.

**Uji coba tambahan**

1. Tanpa API key: muncul pesan yang menjelaskan cara mengaturnya.
2. API key salah: muncul pesan untuk HTTP 401.
3. Jatah request habis: muncul pesan untuk HTTP 429 (disimulasikan).
4. Saat tombol Tanya tidak ditekan, tidak ada request keluar (periksa lewat log jaringan).
5. API key tidak terlihat dari DevTools jendela catatan.
