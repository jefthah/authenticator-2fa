# Authenticator 2FA — ekstensi Chrome

Kode 2FA (TOTP/HOTP) langsung dari toolbar Chrome. Semua akun bisa dipindahkan
sekaligus dari **Google Authenticator** lewat QR "Transfer akun".
Berjalan offline. Data hanya keluar dari komputer jika **Sinkron antar laptop**
dinyalakan, dan itu pun dalam bentuk terenkripsi.

ID ekstensi selalu `pgmdlhcgleokbdgeeolklkaompfbplcn` (dikunci lewat `key` di
manifest) di laptop mana pun. Syarat ini dibutuhkan agar sinkron bekerja.

## Update dari versi 1.0 / 1.1 (PENTING)

Versi 1.2 punya ID ekstensi baru, sehingga Chrome menganggapnya ekstensi lain dan
**akun di versi lama tidak terbaca otomatis**. Urutannya:

1. Di versi lama: ikon ekstensi → ⚙ Pengaturan → **Cadangan** → **Unduh file cadangan**.
2. Ganti isi folder `authenticator-extension` dengan versi baru.
3. Di `chrome://extensions`: **Remove** kartu Authenticator 2FA yang lama, lalu
   **Load unpacked** folder yang baru.
4. Buat password brankas → **+** → tab **Cadangan** → **Pulihkan** file tadi → **Simpan**.

## Pasang (mode developer)

1. Buka `chrome://extensions`.
2. Nyalakan **Developer mode** (kanan atas).
3. Klik **Load unpacked** → pilih folder `authenticator-extension` ini.
4. Klik ikon puzzle 🧩 di toolbar → pin **Authenticator 2FA**.

## Pindahkan akun dari Google Authenticator

1. Klik ikon ekstensi → buat password brankas (minimal 8 karakter).
2. Klik **Import dari Google Authenticator** (atau tombol **+**). Tab import terbuka.
3. Di HP: Google Authenticator → menu ☰ → **Transfer akun** → **Ekspor akun** →
   pilih semua akun → **Berikutnya**. Muncul satu atau beberapa QR.
4. Pilih cara membaca QR:
   - **Kamera**: arahkan layar HP ke webcam laptop. Kalau QR-nya lebih dari
     satu, geser ke QR berikutnya; status batch (QR 1 ✓, QR 2 ✓, …) terlihat di bawah.
   - **Gambar QR**: foto layar HP pakai HP lain, lalu unggah/seret/tempel (Ctrl+V)
     fotonya. Screenshot biasanya diblokir oleh Google Authenticator.
   - **Link / teks**: tempel link `otpauth-migration://…` atau `otpauth://…`.
5. Periksa daftar → **Simpan**. Akun di HP tidak terhapus.

## Fitur

- Klik akun = kode tersalin. Kode merah saat sisa waktu ≤ 5 detik.
- Tombol **pindai** (ikon kotak) membaca QR yang sedang tampil di tab aktif, berguna
  saat mengaktifkan 2FA di situs baru.
- Tambah manual (secret key), ubah nama, hapus, cari.
- TOTP & HOTP, SHA1/SHA256/SHA512, 6–8 digit, periode bebas.
- Cadangan terenkripsi (ekspor/pulihkan file `.json`).
- Sinkron antar laptop lewat akun Chrome (lihat di bawah).
- Tampilan bahasa Indonesia dan Inggris: ⚙ Pengaturan → **Bahasa / Language**. Pemasangan
  baru otomatis mengikuti bahasa Chrome. Pengguna versi lama tetap berbahasa Indonesia.

Kode sumber dan rilis terbaru: https://github.com/jefthah/authenticator-2fa

## Sinkron antar laptop

Syarat: Chrome di semua laptop login dengan akun Google yang sama, dan
**Sinkronisasi** aktif termasuk **Ekstensi** (`chrome://settings/syncSetup`).

1. Laptop pertama: ikon ekstensi → ⚙ Pengaturan → nyalakan **Sinkron antar laptop**.
2. Laptop lain: pasang ekstensi (Load unpacked) → klik ikonnya. Muncul
   **"Brankas ditemukan di akun Chrome"** → masukkan password brankas laptop pertama.
   Jika layar itu belum muncul, tunggu 1–2 menit agar Chrome selesai sinkron, lalu buka lagi.
3. Selesai. Tambah, ubah nama, hapus akun, dan counter HOTP ikut menyebar ke laptop
   lain saat popup dibuka. Jika akun ditambah di dua laptop bersamaan, keduanya disimpan.

Laptop yang sudah punya brankas sendiri dengan password lain: saat sinkron dinyalakan,
muncul **Gabungkan**. Masukkan password brankas sinkron; akun dari kedua tempat
digabung, lalu laptop itu ikut memakai password tersebut. Begitu juga setelah password
diganti di salah satu laptop: laptop lain menampilkan "Sinkron tertunda" dan meminta
password baru.

Cara kerja: brankas yang sama (AES-GCM, password Anda) disalin ke
`chrome.storage.sync`, dipecah menjadi potongan ≤7 KB. Google hanya menyimpan
data terenkripsi. Batas Chrome sekitar 100 KB, cukup untuk ±250 akun.

## Keamanan

- Secret disimpan di `chrome.storage.local`, dienkripsi AES-GCM 256-bit dengan kunci
  dari password (PBKDF2-SHA256, 600.000 iterasi).
- Setelah dibuka, kunci hanya ada di `chrome.storage.session` (memori) dan hilang saat
  browser ditutup. Bisa diatur kunci otomatis 5 menit / 15 menit / 1 jam.
- Password tidak bisa dipulihkan. Kalau lupa, reset brankas lalu import ulang dari HP
  atau dari file cadangan.
- Izin yang dipakai hanya `storage` dan `activeTab` (untuk tombol pindai tab).
  CSP menambahkan `wasm-unsafe-eval` khusus untuk menjalankan pembaca QR WebAssembly lokal;
  tidak ada skrip dari luar.
- Jika sinkron aktif, salinan terenkripsi ikut tersimpan di akun Google. Kekuatannya
  bergantung pada password brankas, jadi pakai password yang panjang dan unik.
- Simpan 2FA di browser yang sama dengan password memang lebih praktis, tapi
  mengurangi lapisan "faktor kedua". Tetap simpan akun di HP sebagai cadangan.

## Struktur

```
manifest.json
popup.html            daftar kode (popup toolbar)
import.html           halaman import / tambah / cadangan
src/core.js           Base32, HOTP/TOTP (RFC 4226/6238), parser otpauth & migrasi Google
src/vault.js          enkripsi, penyimpanan, sinkron (chrome.storage.sync)
src/qr.js             pembaca QR (gambar, video, screenshot tab)
src/popup.js, src/import.js, src/ui.js, src/style.css
src/i18n.js           terjemahan; teks ada di src/locales/id.js dan en.js
_locales/             nama & deskripsi ekstensi per bahasa (untuk manifest)
lib/zxing-reader.js   pembaca QR utama: zxing-wasm 2.2.4 (MIT) + zxing-cpp (Apache-2.0)
lib/zxing_reader.wasm   ↳ modul WebAssembly-nya (dimuat lokal, bukan dari CDN)
lib/jsQR.js           pembaca QR cadangan: jsQR 1.4.0 (Apache-2.0)
```

## Catatan versi

- 1.3.0 — Tampilan bahasa Inggris (pilihan **Bahasa / Language** di Pengaturan). Perbaikan:
  tulisan "false" tidak lagi muncul di bagian Sinkron saat sinkron mati.
- 1.2.0 — Sinkron antar laptop lewat akun Chrome (terenkripsi, gabung per akun).
  ID ekstensi dikunci lewat `key`, sehingga data versi lama perlu dipindah lewat
  file cadangan (lihat "Update dari versi 1.0 / 1.1").
- 1.1.0 — Pembaca QR utama diganti ke ZXing. jsQR ternyata gagal membaca sebagian
  QR ekspor Google yang padat (mis. QR versi 23 dengan 10 akun), bahkan dari gambar
  yang bersih. Gambar yang dipotong mepet tanpa tepi putih juga kini bisa dibaca.
- 1.0.0 — Rilis pertama.
