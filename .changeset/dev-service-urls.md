---
'@geekmidas/cli': patch
'@geekmidas/manifest': minor
---

:sparkles: `gkm dev` says where every service is, and an app can open Mailpit's inbox

- **`gkm dev` lists every published port on every start**, labelled — `postgres`, `smtp`, `mailpit inbox`, `minio console`, … — with the pages as `http://` links. It used to print only on the start that changed a container, and only each container's primary port, so Mailpit's inbox was never shown at all. `gkm setup` lists the same when it converges.
- **An `Email`'s inbox is a public role.** A `MobileApp` or `StaticSite` that `.dependsOn([mailer])` is built with `EXPO_PUBLIC_MAILER_INBOX_URL` (`VITE_`/`NEXT_PUBLIC_`) on a local stage — Mailpit's web inbox, so an "Open email app" button can open a sign-in link from the app. Deployed mail has no inbox and nothing sets it; the SMTP URL, which carries credentials, is never public. Closes #125.
