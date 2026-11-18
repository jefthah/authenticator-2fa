# Authenticator 2FA — Chrome extension

Two-factor codes (TOTP/HOTP) right in the Chrome toolbar. Move **all** your accounts
out of **Google Authenticator** in one go by scanning its "Transfer accounts" QR codes.
Everything is encrypted with your password and works offline. Optional sync between your
computers goes through your own Chrome account, end-to-end encrypted.

> The interface is available in **English** and **Bahasa Indonesia**. By default it follows
> Chrome's language; change it under ⚙ Settings → **Bahasa / Language**.
> 🇮🇩 Panduan lengkap berbahasa Indonesia: [authenticator-extension/README.md](authenticator-extension/README.md).

## Features

- Import from Google Authenticator's export QR (`otpauth-migration://`), including
  multi-QR exports. Read the QR with your webcam, from a photo or pasted image, or paste the link.
- Also accepts regular `otpauth://` QR codes and links, or a secret key typed by hand.
- **Scan tab** button: reads a 2FA setup QR code shown on the current web page.
- TOTP and HOTP, SHA-1/SHA-256/SHA-512, 6–8 digits, any period.
- Click an account to copy its code; search, rename, delete.
- Encrypted backup file (export / restore).
- Optional **sync between computers** through `chrome.storage.sync`. Only the encrypted
  vault leaves the device, and accounts are merged per item, so adding accounts on two
  laptops at once loses nothing.
- No servers, no analytics, no remote code. Permissions: `storage` and `activeTab` only.

## Install

The extension is not on the Chrome Web Store (yet), so it is installed in developer mode:

1. Download `Authenticator-2FA-vX.Y.Z.zip` from the
   [latest release](https://github.com/jefthah/authenticator-2fa/releases/latest) and extract it
   (or `git clone` this repository).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `authenticator-extension` folder.
4. Pin **Authenticator 2FA** from the puzzle-piece menu in the toolbar.

Keep the folder where it is: Chrome loads the extension from that folder every time it starts.

The extension ID is always `pgmdlhcgleokbdgeeolklkaompfbplcn`, because it is fixed by the
`key` in `manifest.json`. Sync needs the same ID on every computer.

## Move accounts from Google Authenticator

1. Click the extension icon and create a vault password (at least 8 characters).
2. Click **Import from Google Authenticator** (or **+**). An import tab opens.
3. On your phone: Google Authenticator → ☰ → **Transfer accounts** → **Export accounts** →
   select all → **Next**. One or more QR codes appear.
4. Show them to the webcam (**Camera** tab), one after another. The batch indicator shows which QR
   codes have been read. Alternatively, take a photo of the phone screen and drop or paste it in
   the **QR image** tab. Google Authenticator usually blocks screenshots.
5. Review the list → **Save**. Nothing is removed from your phone.

## Sync between computers

Requirements: Chrome on every computer is signed in to the same Google account, with
**Extensions** sync turned on (`chrome://settings/syncSetup`).

1. First computer: extension icon → ⚙ → turn on **Sync between computers**.
2. Other computers: install the extension and open it. It shows **"Vault found in your Chrome
   account"**. Enter the same vault password.

The vault (AES-GCM ciphertext) is split into ≤7 KB chunks to fit Chrome's sync quota
(about 100 KB total, enough for roughly 250 accounts). Google only ever sees ciphertext.

## Security

- Secrets are stored in `chrome.storage.local`, encrypted with AES-GCM-256. The key is derived
  from your password with PBKDF2-SHA256 (600,000 iterations).
- After unlocking, the derived key lives only in `chrome.storage.session` (memory) and is gone
  when the browser closes. Optional auto-lock after 5 min / 15 min / 1 hour.
- The password cannot be recovered. If you forget it, reset the vault and import again.
- The CSP allows `wasm-unsafe-eval` only to run the bundled WebAssembly QR reader. No
  scripts are loaded from the network.
- Keeping 2FA codes in the same browser as your passwords is convenient, but it weakens the
  "second factor". Keep your phone authenticator as a backup.
- This project has **not** been independently audited. Please report vulnerabilities as
  described in [SECURITY.md](SECURITY.md).

## Development

No build step and no dependencies: the extension is plain ES modules.

```
authenticator-extension/   the extension (load this folder in Chrome)
  manifest.json
  popup.html, import.html
  src/core.js              Base32, HOTP/TOTP (RFC 4226/6238), otpauth & migration parsers, vault merge
  src/vault.js             encryption, storage, sync (chrome.storage.sync)
  src/qr.js                QR decoding (images, video frames, tab screenshots)
  src/popup.js, src/import.js, src/ui.js, src/style.css
  src/i18n.js              translation helper; strings live in src/locales/{en,id}.js
  _locales/                localized extension name and description (manifest)
  lib/                     bundled QR decoders (ZXing WebAssembly, jsQR) + licenses
tests/                     node:test suites (core, sync merge, translations)
.github/workflows/         CI and release
```

**Adding a language:** copy `src/locales/en.js` to `src/locales/<code>.js`, translate the values,
register it in `DICTS` and `LANGUAGES` in `src/i18n.js`, and add `_locales/<code>/messages.json`.
The tests check that every language has the same keys and placeholders.

Run the tests (Node.js 20+):

```bash
node --test tests/*.test.mjs
```

After editing, click the reload icon on the extension card in `chrome://extensions`.

**Releasing:** bump `version` in `manifest.json`, add a section to [CHANGELOG.md](CHANGELOG.md),
then push a tag `vX.Y.Z`. The release workflow runs the tests, zips `authenticator-extension/`
and publishes a GitHub release with the zip and its SHA-256 checksum.

## License

[MIT](LICENSE). Bundled third-party code keeps its own license. See
[authenticator-extension/lib/THIRD-PARTY-NOTICES.md](authenticator-extension/lib/THIRD-PARTY-NOTICES.md):
zxing-wasm (MIT), zxing-cpp (Apache-2.0) and jsQR (Apache-2.0).

Not affiliated with Google. "Google Authenticator" is a trademark of Google LLC.
