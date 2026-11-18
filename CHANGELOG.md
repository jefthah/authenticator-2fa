# Changelog

## 1.4.0 — 2026-11-18

- Reorder accounts by dragging them in the popup (mouse), or with Alt+↑/↓ on a focused account.
  A grip appears on hover; the popup auto-scrolls near its edges. Reordering is off while searching.
- The order is stored in the encrypted vault as `{ ids, at }` and syncs between computers:
  the most recent reorder wins, and accounts added later appear at the end. Computers still on
  1.3 or older ignore the order and may drop it when they sync, so update every computer.
- Fix: the "Copied" badge is now translated (it was always Indonesian).

## 1.3.0 — 2026-11-18

- English interface. Choose the language under Settings → **Bahasa / Language**. New installs
  follow Chrome's language. Existing installs keep Bahasa Indonesia until changed.
- Localized extension name and description (`_locales/en`, `_locales/id`).
- Fix: the Sync section no longer shows the text "false" while sync is off.
- Translation tests: both languages must have the same keys and placeholders.

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
