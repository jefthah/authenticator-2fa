# Security policy

This extension stores two-factor secrets, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue with exploit details. Instead, use GitHub's private
reporting: **Security** tab → **Report a vulnerability**. If that button is not available, open
an issue that only says you have a security report, without details, and a private channel will
be arranged.

Please include the affected version (`manifest.json` → `version`), the steps to reproduce it,
and its impact.

## Scope and design notes

- Vault encryption: AES-GCM-256 with a PBKDF2-SHA256 key (600,000 iterations, random 16-byte
  salt, fresh 12-byte IV per write). Code: `authenticator-extension/src/vault.js`.
- The unlocked key is kept in `chrome.storage.session` only.
- Sync stores the same ciphertext in `chrome.storage.sync`. Its strength therefore depends on
  the vault password.
- The extension makes no network requests and loads no remote code.
- Not independently audited.
