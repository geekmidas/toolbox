# Receiving Email

An app can receive mail at addresses on its own domain and handle each
message in a worker. An `Inbox` declares the addresses; a handler bound to it
is handed each message, parsed. The same code runs under `gkm dev`, in feature
tests, and deployed.

```typescript
// constructs/inbox.ts
import { Inbox } from '@geekmidas/constructs/inbox';

export const requests = new Inbox('Requests', {
  addresses: ['requests'], // local parts: structural
  subdomains: true,        // requests@<tenant>.<stage domain>
});

// subscribers/requests.ts
import { requests } from '../constructs/inbox.js';
import { worker } from '../constructs/worker.js';

export const onRequest = worker
  .inbox(requests)
  .handle(async ({ messages, db }) => {
    for (const message of messages) {
      const tenant = message.recipient.subdomain; // from the envelope
      const thread = message.recipient.tag;       // requests+<tag>@
    }
  });
```

Install `@geekmidas/emailkit` beside `@geekmidas/constructs`: it holds the MIME
parser the handler reads messages with.

## The model

- **A construct of its own, not part of `Email`.** Sending owns an SMTP URL
  and a sending identity. Receiving owns addresses, a store of raw messages
  and a channel they are announced on. An app that only sends gets none of it.
- **The local part is structural; the domain is the stage's.** `addresses`
  and `subdomains` are fixed in code. The domain is the workspace's `domains`
  for a deployed stage, and `<project>.localhost` locally (`test.<project>.localhost`
  under `gkm test`).
- **Plus-addressing is part of the address.** `requests` also receives at
  `requests+<tag>@`, and the tag is handed to the handler. Threading by a tag
  you issued is reliable where `In-Reply-To:` is not.
- **The envelope routes.** Which inbox, which tenant and which tag come from
  the envelope recipient. `From:` and `To:` are written by the sender, and a
  BCC'd or forwarded message has no header naming your address at all.
- **One decoder, everywhere.** Deployed, SES stores the raw message and
  publishes its receipt notification on the inbox's own topic. Locally,
  Mailpit receives it and the same notification is published. The handler is
  handed what that notification says, wherever it came from.

With `subdomains: true` an inbox receives at exactly one label in front of the
stage's domain — `requests@acme.fixwell.example` — and never at the bare
domain, whose mail would belong to no tenant.

## What a handler is handed

Each message is handed once per envelope recipient the inbox receives at.

| Field | What it is |
| --- | --- |
| `recipient` | From the envelope: `{ address, local, tag?, subdomain? }` |
| `from`, `to`, `cc`, `replyTo`, `subject`, `date`, `messageId`, `inReplyTo`, `references`, `headers` | From the message's headers, as the sender wrote them. `headers` is every header by lowercase name |
| `text`, `html` | The body. Either can be missing |
| `attachments` | `{ filename?, contentType, size, content() }` |
| `raw` | `{ bucket, key }` — where the raw message is kept |
| `verdicts` | `{ spf, dkim, dmarc, spam, virus }`: `'pass'`, `'fail'`, `'gray'`, or `'unavailable'`. Always `'unavailable'` locally — never a faked `'pass'` |

## Inbound mail is untrusted input

Everything in a message except the envelope recipient was written by whoever
sent it.

- **Route on `recipient`**, never on `From:` or `To:`.
- **Treat `from` as a claim** until `verdicts.dmarc` is `'pass'` *and* the
  address is one that tenant knows. Either alone is not enough: DMARC proves
  the domain, not that the sender belongs to this tenant.
- **Sanitise `html`** before rendering it anywhere.
- **Never use an attachment's `filename`** as a key or a path. It is the
  sender's to choose, `../../etc/passwd` included.
- **Reply to addresses you know**, not to `Reply-To:`.
- **Ignore auto-replies** (`Auto-Submitted:` other than `no`), or two systems
  answer each other forever.

## Locally: `gkm dev`

Declaring an inbox runs Mailpit, as declaring an `Email` does, and points
Mailpit's webhook at the worker that runs the inbox's subscribers. Send mail to
Mailpit's SMTP port — from a mail client, `swaks`, or your app — and a message
addressed to a declared inbox reaches its handler. Anything else stays in
Mailpit, mail your app sends to anyone else included.

The handler reads the raw message back from Mailpit, so no bucket runs for an
inbox locally.

Two limits, both local only:

- Mailpit reports the envelope recipients the headers do not name (a BCC) as
  `Bcc`, and reports `To:` and `Cc:` as the sender wrote them. Mail sent by hand
  whose `To:` names an inbox it was never delivered to looks delivered there.
  Feature tests (below) are exact.
- Mailpit posts to one webhook, so locally every inbox subscriber must run in
  one worker ([#343](https://github.com/geekmidas/toolbox/issues/343)). The
  build says so if they do not.

## In tests: `mailbox.receive`

A feature test delivers mail to an inbox with `mailbox.receive`. The message is
built into a real MIME message, delivered to Mailpit with the envelope you
name, received exactly as `gkm dev` receives it, and handed to each subscriber
in the test's transaction. It resolves once they have run.

```typescript
it('threads a reply onto its ticket', async ({ mailbox }) => {
  await mailbox.receive({
    to: 'requests+t_8f3k2q@acme.fixwell.test', // the envelope: required
    from: 'ada@resident.example',              // required without `raw`
    subject: 'Re: Leaking tap',
    text: 'Still dripping.',
    attachments: [{ filename: 'tap.jpg', content: photo }],
    verdicts: { dmarc: 'pass' },               // 'unavailable' when left out
  });
  // …assert on what the handler did
});

// Or a whole message, as an .eml holds it:
await mailbox.receive({ to: 'requests@acme.fixwell.test', raw: eml });
```

- `headerTo` writes a `To:` header different from the envelope.
- `to` must be an address a declared inbox receives at, or it throws
  `NoInboxForAddress` — as the deployed receipt rule would never take it.
- Passing both `raw` and fields to build a message throws `ReceiveFieldsOrRaw`.

`mailbox(address)` still reads the mail your app *sent*, and its attachments
now come through the same parser.

## Deployed: `deploy.inbox`

A deployed stage names what receives its inboxes:

```typescript
// gkm.config.ts
deploy: {
  inbox: {
    production: { provider: 'ses', region: 'eu-west-1' },
  },
},
```

With `{ provider: 'ses' }`, the deploy creates each inbox in the stage's AWS
account — on a compose stage on your own server as much as anywhere:

- **Its own bucket**, where SES may write only under `messages/`, read by an
  IAM user of its own whose key is in the inbox's URL. Never a bucket the stack
  runs or `deploy.objects` backs.
- **Its own SNS topic**, which only SES may publish to. SNS pushes each message
  to the worker that runs the inbox's subscribers, at its route on the stage's
  domain, over HTTPS.
- **The stage's domain as an SES identity**, verified with DKIM, and **MX
  records** pointing the domain — or every subdomain of it, with
  `subdomains: true` — at `inbound-smtp.<region>.amazonaws.com`. Both go
  through the stage's `dns` config (Route53, GoDaddy or Hostinger); a domain
  with none is printed as the records to create by hand.
- **A receipt rule** in the region's **active** rule set, for the inbox's
  recipients. The deploy never makes a new set active over an existing one:
  only one is active per region, and switching would stop every other
  stage's and app's rules. A set is made active only where none is.

A removed inbox's rule is deleted on the next deploy. Nothing else is.

The region must be one SES receives mail in: `us-east-1`, `us-east-2`,
`us-west-1`, `us-west-2`, `af-south-1`, `ap-south-1`, `ap-southeast-1`,
`ap-southeast-2`, `ap-southeast-3`, `ap-northeast-1`, `ap-northeast-2`,
`ap-northeast-3`, `ca-central-1`, `eu-central-1`, `eu-west-1`, `eu-west-2`,
`eu-west-3`, `eu-south-1`, `eu-north-1`, `il-central-1`, `me-south-1`,
`sa-east-1`. Any other fails the deploy with `SesReceivingUnsupported`, and a
stage with no domain fails with `NoDomainForStage`.

## Worked example: Fixwell

Fixwell is a made-up maintenance-request app for property-management
agencies. Each agency is a tenant with an inbox at
`requests@<agency>.fixwell.example`; a reply on a ticket goes to
`requests+<token>@<agency>.fixwell.example`. Initech Living is suspended.

```typescript
export const onRequest = worker.inbox(requests).handle(async ({ messages }) => {
  for (const message of messages) {
    // The envelope says which agency. Never To:, never From:.
    const agency = agencies.find(message.recipient.subdomain);
    if (!agency || agency.suspended) continue;                    // 9, 10

    const auto = message.headers['auto-submitted']?.[0];
    if (auto && auto !== 'no') continue;                         // 11

    if (message.verdicts.virus === 'fail') {                     // 12
      await quarantine(agency, message.raw);                     // raw kept,
      continue;                                                  // nothing opened
    }

    // A token threads only within its own agency.
    const ticket = message.recipient.tag
      ? await tickets.byToken(agency, message.recipient.tag)     // 2, 8
      : undefined;
    if (ticket) {
      await tickets.reply(ticket, message);
      continue;
    }

    const known = agency.residents.includes(message.from?.address);
    await tickets.open(agency, message, {
      review: !known
        ? 'unknown sender'                                       // 3, 5
        : message.verdicts.dmarc !== 'pass'
          ? 'possible impersonation'                             // 4
          : undefined,                                           // 1, 7
    });
  }
});
```

Each row of this table is a test, in
[`featureTest.fixwell.spec.ts`](https://github.com/geekmidas/toolbox/blob/main/packages/constructs/src/testing/__tests__/featureTest.fixwell.spec.ts):

| # | Envelope recipient | `From:` (as written) | Verdicts | Outcome |
| --- | --- | --- | --- | --- |
| 1 | `requests@acme…` | an Acme resident | DMARC pass | New Acme ticket, attributed to the resident |
| 2 | `requests+t_8f3k2q@acme…` | the same resident | DMARC pass | Threaded onto their Acme ticket |
| 3 | `requests@acme…` | an unknown sender | DMARC pass | New Acme ticket, needs review |
| 4 | `requests@acme…` | an Acme resident | DMARC fail | Acme ticket, needs review: possible impersonation |
| 5 | `requests@acme…` | `finance@globex.fixwell.example` | DMARC fail | Stays in Acme, needs review. Never routed to Globex |
| 6 | `requests@acme…`, header `To: requests@globex…` | anyone | any | Acme. `To:` is ignored |
| 7 | `requests@acme…` by BCC | an Acme resident | pass | Acme ticket. The envelope still knows |
| 8 | `requests+t_8f3k2q@globex…` (an Acme token) | anyone | any | Token not found in Globex: a new Globex ticket |
| 9 | `requests@initech…` | anyone | any | Dropped: agency suspended |
| 10 | `requests@unknown…` | anyone | any | Dropped: no such agency |
| 11 | `requests@acme…` | an out-of-office reply | pass | Ignored: `Auto-Submitted: auto-replied` |
| 12 | `requests@acme…` | anyone | virus fail | Quarantined: raw kept, attachments not stored |
| 13 | `support@acme…` | anyone | any | Never received: not a declared address |
