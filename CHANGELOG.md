# Changelog

## 1.2.0 — 2026-11-18

- Sync between computers through the Chrome account (`chrome.storage.sync`). The encrypted
  vault is split into ≤7 KB chunks. Accounts are merged per item with delete markers, so adds,
  renames, deletes and HOTP counters from several computers converge without duplicates.
- New-computer flow: "Brankas ditemukan di akun Chrome" (vault found in Chrome account) to adopt
  the synced vault, plus join/merge when a computer already has its own vault.
- The extension ID is now fixed by the `key` in `manifest.json` (`pgmdlhcgleokbdgeeolklkaompfbplcn`).
  When upgrading from 1.0/1.1, export a backup first, then restore it in 1.2.

## 1.1.0

- The main QR reader is now ZXing (zxing-wasm, bundled locally), with jsQR as a fallback.
  jsQR could not read some dense Google Authenticator export QR codes (for example, version-23
  codes holding 10 accounts), even from clean images.
- Tightly cropped QR images without a white border can now be read.

## 1.0.0

- First release: TOTP/HOTP codes, import from Google Authenticator export, camera/image/link/manual
  import, encrypted vault and backup, tab QR scan.
