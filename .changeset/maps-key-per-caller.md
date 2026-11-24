---
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

`Maps`: a key per caller, locked to it, under the role's name

- **Each caller holds a key of its own.** Two sites that call Maps get two browser keys, two apps two Android keys, each server process its own. The code is unchanged — every caller still reads `MAPS_API_KEY`, `MAPS_BROWSER_KEY`, `MAPS_ANDROID_KEY`, `MAPS_IOS_KEY` — and on a deployed stage the value is its own: the stage keeps each as `<name>__<CALLER>` (`MAPS_BROWSER_KEY__WEB`, `mapsKeyOf` in `@geekmidas/manifest`) and hands each process only its own, under the role's name. A leaked key works for no other app; each is rotated alone and shows its own use in Cloud Console (`Maps/Web browser production`). The local stage, and a deployed one with no provider, keep one key per role set by hand, read by every caller.
- **Every key is locked to its holder.** A browser key to its site's host; an iOS key to its app's bundle id; an Android key to its app's package and signing certificates — each EAS keystore's, read from EAS with `EXPO_TOKEN`, and `deploy.maps.<stage>.android.sha1` for Play's app-signing certificate. A key with no certificate, or a stage that ships through Google Play naming none of Play's, stops the deploy with `MapsAndroidKeyUnsigned`. A server key is locked to the compose stage's `GKM_SERVER_IPV4`/`GKM_SERVER_IPV6`; on a stage with no fixed address it is restricted to its APIs, and the deploy says so.
- **Keys nothing holds are retired.** A caller that drops its edge, and the per-kind keys the previous version made, keep their key until the stage has run without it; the next deploy deletes it from Google, the state and the stage's secrets (`--retire-old-keys` at once).
- `mapsCallers` and `mapsKeysFor` are removed from `@geekmidas/manifest`; `mapsKeyOf`, `mapsRoleOf` and `isMapsCallerKey` take their place. A provider's `writeSecrets` removes a key given `null`, and `ProvisionState` gains `records()` and `forget()`.
