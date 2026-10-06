---
'@geekmidas/cli': patch
---

`gkm trust` asks for your password once on macOS, not twice

It ran `sudo security add-trusted-cert -d … -k /Library/Keychains/System.keychain`. `sudo` asked for the password in the terminal to write the System keychain, and then macOS asked again in a dialog, because changing trust settings needs its own authorization that `sudo` does not cover. The local authority is now trusted in your login keychain for your user, without `sudo`, so macOS asks once (your password or Touch ID). Browsers and Node's system store both honour a user's trust settings. Linux is unchanged: its trust store is system-wide and needs `sudo`.
