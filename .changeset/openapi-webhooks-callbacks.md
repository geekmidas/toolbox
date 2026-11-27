---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

The OpenAPI document describes what a service sends: webhooks and callbacks

**Webhooks.** `api.webhooks(topic, { signature, events?, description? })`
documents a topic's events as the requests a service delivers to the URLs its
users register. Each appears under the document's `webhooks` (OpenAPI 3.1) as
a `POST` with a `{ type, payload }` body — the payload's schema from the topic
— and the signature header a receiver checks. The list lives on the surface,
so every endpoint built from it reaches the document, whenever the topic was
registered. Two delivered topics carrying the same event type are refused
(`WebhookEventDeclaredTwice`), as is an `events` entry the topic does not carry
(`WebhookEventNotOnTopic`).

**Callbacks.** `.callback(name, { url, method?, body?, response? })` on an
endpoint, repeatable, documents a request it makes back to a URL its caller
gave it under the operation's `callbacks`. `url` is a runtime expression such
as `{$request.body#/callbackUrl}`. A name declared twice is refused
(`CallbackDeclaredTwice`).

**The generated client** exports a `webhooks` interface, event type → the
body a receiver is sent, so a receiver can type its handler.
