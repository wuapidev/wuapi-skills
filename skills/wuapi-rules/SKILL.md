---
name: wuapi-rules
description: Foundational rules for any code that calls wuapi, the WhatsApp API for developers (REST at api.wuapi.dev, npm package `@wuapidev/sdk`). Always load it before writing or reviewing wuapi code; it covers what wuapi is and is not, auth and the WUAPI_API_KEY variable, the naming and identity conventions, projects and the Wuapi-Project header, the error shape and codes, pagination, the Idempotency-Key header, rate limit headers, per-number pacing, webhook signing and where the full docs live.
---

# wuapi: the rules

wuapi is a **WhatsApp API for developers**, run as an independent service. A customer links their own WhatsApp number as a *linked device* (the same mechanism as WhatsApp Web) by QR code or pairing code, then sends and receives over a REST API, a TypeScript SDK and signed webhooks.

## What it is not

- **Not the WhatsApp Business Platform (Cloud API)** and not affiliated with, endorsed or sponsored by WhatsApp or Meta.
- **No message templates, buttons or list messages.** Those exist only on the official platform. Do not generate code for them.
- **No guarantee a number is never restricted.** WhatsApp restricts numbers for what they send and how recipients react. Never write "ban-proof" logic or copy; message people who expect it.
- Not supported: delete for me (delete for everyone works), answering or placing calls (calls can be seen and rejected), receiving contacts' stories, history on demand, calendar event call links, calendar event RSVPs, and votes on polls the account never saw (they arrive with empty `options`).

## Vocabulary

One word per concept, the same in paths, fields, events, docs and SDK:

| term | meaning |
|---|---|
| organization | who pays |
| project | one customer of a platform, or an environment |
| account | one linked WhatsApp number, with a name such as "Sales" |
| contact | a WhatsApp user |
| chat | a conversation: with a contact, a group, a channel, or the account's stories |
| group, community | a WhatsApp group; a community is a group with `community: true` that links other groups |
| channel | a WhatsApp channel (one-to-many broadcast) |
| story | a WhatsApp Status post; "status" only ever means the state of a resource |
| webhook endpoint, event | the URL that receives events, and the delivered body |
| QR code, pairing code | the two ways to link a number |
| proxy location | where an account's residential proxy exits: `{country, city}`, required when creating an account, from `GET /v1/proxy-locations` |

## Auth and base URL

- Base URL `https://api.wuapi.dev`. Every request: `Authorization: Bearer wu_live_...`.
- Read the key from the `WUAPI_API_KEY` environment variable. Never hard-code it, log it or commit it. Keys are shown in full only when created (the dashboard owner can reveal them again).
- No key yet? Do not ask the user to paste one in chat: run `npx @wuapidev/cli login`. They approve in the browser and the key stays in the CLI's own storage, never in the project or the chat. Run the project's code with `npx @wuapidev/cli run -- <command>`, which puts `WUAPI_API_KEY` in that process's environment only. Never read, print or write the key yourself. See the `wuapi-cli` skill.
- `GET /v1/me` returns the `auth_context`: `organization`, `apiKey` (`projectId` is set for a project key) and `project`, the scope of the request.

```ts
import { Wuapi } from "@wuapidev/sdk" // npm install @wuapidev/sdk

// apiKey falls back to process.env.WUAPI_API_KEY, so new Wuapi() also works.
const wuapi = new Wuapi({ apiKey: process.env.WUAPI_API_KEY })
const me = await wuapi.me()
console.log(me.organization.id, me.project?.id ?? "whole organization")
```

The SDK has zero runtime dependencies and runs on Node 18+, Bun, Deno and edge runtimes. Prefer it in TypeScript and JavaScript projects; elsewhere call REST directly (the OpenAPI 3.1 spec is at `https://wuapi.dev/openapi.json`).

## Shapes

- Every resource is returned as is, with `object` naming its type: `{"object": "message", "id": "...", ...}`. There is no wrapper key.
- Fields are camelCase, enum values snake_case. Timestamps are ISO 8601 UTC strings named `...At` (`createdAt`, `sentAt`, `expiresAt`). Durations and sizes carry the unit (`durationSeconds`, `proxyBytes`), money is integer `...Cents`, counts end in `Count`, URLs end in `Url`.
- References are `<resource>Id`: `accountId`, `projectId`, `contactId`, `replyToMessageId`.

## Identities

| thing | format |
|---|---|
| contact with a number | E.164 with `+`: `+584241112233` |
| contact whose number WhatsApp hides | `lid:<digits>` |
| group | `120363041234567890@g.us` |
| channel | `120363198765432101@newsletter` |
| the account's stories | `stories` |

Contact ids are what `to`, `from`, `contactId`, `mentions`, participants and callers hold. A message's `chatId` is the contact id, the group id, the channel id or `stories`, and `chatType` says which (`direct`, `group`, `channel`, `story`). Inputs also accept a contact number as bare digits.

A WhatsApp user can hide their number behind a username (`@lina.morales`): their chat is `lid:<digits>`, and messages, `contact` and `contact_check` carry `username` (lowercase, no `@`) when WhatsApp shared it. `to` of a send also takes `"@lina.morales"`, but only for a contact the account already chats with; any other username answers `400 username_not_supported` (WhatsApp does not let a linked device look usernames up). Reply to such a contact with its `lid:` id.

## Projects and the `Wuapi-Project` header

| Credential | `Wuapi-Project` header | Scope |
|---|---|---|
| organization key | absent | every project plus unassigned resources |
| organization key | a project id or `ext:<externalId>` | that project only; `404 project_not_found` if it is not in the organization |
| project key | absent, or its own project | its project only |
| project key | another project | `403 forbidden` |

A resource outside the scope answers `404 not_found`, never `403`. In the SDK, `wuapi.withProject("ext:customer_8812")` or `new Wuapi({ project })` sends the header on every request. Details: the `projects-and-invitations` skill.

## Account state gates everything live

Every route under `/v1/accounts/{accountId}/...` runs live against WhatsApp and needs the account `ready`, else `409 account_not_ready` (`details.status` holds the current status). Sending needs `ready` too. The exceptions: requesting a pairing code (refused with `409 already_linked` once ready) and the call settings on `PATCH /v1/accounts/{accountId}`.

## Errors

One shape everywhere: `{code, message, details?}`. Branch on `code`, never on `message`. The SDK throws `WuapiError` with `status`, `code`, `message`, `details`, `requestId` and `retryAfter`.

| status | code | when |
|---|---|---|
| 400 | `invalid_request` | validation failed; `details.field` names the field when there is one |
| 400 | `not_supported` | WhatsApp cannot do it for this account (labels on a consumer-app number) |
| 400 | `unsupported_proxy_location` | `proxyLocation` is not in `GET /v1/proxy-locations` |
| 400 | `not_on_whatsapp` | a live call targeted a number without WhatsApp |
| 401 | `unauthorized` | key missing, malformed, revoked, or of a deleted project |
| 402 | `subscription_required` | a new account or invitation while the subscription is past due; `details.billingUrl` |
| 402 | `upgrade_required` | the Free plan includes 1 account: a second account, invitation or slot-taking reconnect, or a send from a Free organization with more than 1 billable account; `details.maxAccounts`, `details.upgradeUrl` |
| 402 | `free_limit_reached` | the Free plan's monthly limit (2,000 messages sent and received, or 0.5 GB of proxy) is reached: sends, new accounts and reconnects until the month ends (UTC) or an upgrade; `details.limit`, `details.resetsAt`, `details.upgradeUrl` |
| 402 | `addon_required` | `hideWuapiBranding: true` without the White label add-on |
| 402 | `trial_proxy_limit_reached` | legacy free trials only: a send after the trial's 0.5 GB of proxy traffic; `details.limitMb`. Wait for the trial to end |
| 402 | `payment_required` | proxy traffic is paused while an invoice is unpaid: sends, stories, new accounts and reconnects; accounts show `disconnectReason: proxy_paused` and reconnect on their own once it is paid; `details.billingUrl` |
| 402 | `proxy_spend_cap_reached` | proxy traffic is paused because this month's proxy overage reached the organization's monthly cap; the same calls; raise the cap in Billing or wait for the month to end; `details.capCents` |
| 403 | `forbidden` | a project key asked for another project or an organization-only route |
| 403 | `project_suspended` | a send or write in a suspended project; reads still work |
| 403 | `project_limit_reached` | the project is at `maxAccounts`; `details.maxAccounts` |
| 403 | `trial_account_limit` | legacy free trials only: a second account (or invitation) while the trial runs; `details.maxAccounts` |
| 403 | `whatsapp_forbidden` | WhatsApp refused: not a member, not an admin, not allowed |
| 404 | `not_found`, `project_not_found` | missing or outside the scope |
| 404 | `group_not_found`, `channel_not_found`, `invite_not_found`, `picture_not_found`, `business_profile_not_found`, `link_not_found`, `sticker_pack_not_found`, `order_not_found`, `whatsapp_not_found` | WhatsApp does not know it, or hides it from the account |
| 409 | `account_not_ready`, `already_linked`, `already_completed`, `already_exists` | state conflicts |
| 409 | `idempotency_conflict` | the `Idempotency-Key` is still running, or was used with a different request |
| 429 | `rate_limited` | 600 requests per minute per key, or WhatsApp is limiting the account; honor `Retry-After` |
| 500 | `internal_error` | our side; retry with the same `Idempotency-Key` |
| 502 | `whatsapp_error` | WhatsApp failed the operation; retrying may work |
| 503 | `engine_unavailable` | the connection to WhatsApp is briefly unreachable; retry shortly |

A send that was accepted and fails later is not an HTTP error: the message moves to `failed` with `error.code` `not_on_whatsapp`, `rate_limited`, `account_offline` or `send_failed`, and `message.failed` fires.

```ts
import { Wuapi, WuapiError } from "@wuapidev/sdk"

const wuapi = new Wuapi()
try {
  await wuapi.messages.send({ accountId, to: "+584241112233", text: "hi" })
} catch (err) {
  if (err instanceof WuapiError && err.code === "account_not_ready") {
    await wuapi.accounts.reconnect(accountId)
  } else {
    throw err
  }
}
```

## Headers

| header | rule |
|---|---|
| `Idempotency-Key` (request) | accepted on every `POST`; the first 2xx response is stored for 24 hours and replayed for the same key in the same scope, with `Idempotent-Replayed: true`; a failed request is not stored, so retry it with the same key |
| `Wuapi-Project` (request) | the project scope, above |
| `x-request-id` (response) | on every response; quote it to support |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (response) | the key's window: 600 per minute; reset in seconds |
| `Retry-After` (response) | on every `429`, in seconds |

The SDK sends an `Idempotency-Key` on every `POST`, generated per call, and retries up to `maxRetries` (default 2): `429` after `Retry-After`, 5xx, network errors and timeouts. Pass your own key (an order id, a job id) when your own code may retry across processes:

```ts
await wuapi.messages.send({ accountId, to: "+584241112233", text: "Shipped." }, { idempotencyKey: "order-4417-shipped" })
```

## Pagination

Every list, including lists read live from WhatsApp (groups, channels, blocked contacts), is `{object: "list", items, nextCursor}`. Pass `?limit` (default 50, max 100) and `?cursor`; `nextCursor` is `null` on the last page. SDK list methods return a `Paginator`: iterate with `for await`, call `.page(cursor?)`, or `.toArray(max?)`. Batch actions (`contacts.check`, `groups.addParticipants`, ...) return every result as an array.

```ts
for await (const message of wuapi.messages.list({ accountId, direction: "inbound" })) {
  console.log(message.from, message.text)
}
const { items, nextCursor } = await wuapi.messages.list({ limit: 20 }).page()
```

## Pacing: sends are queued, not instant

Every send goes through the account's queue, one at a time. The anti-ban protections are **off by default**: no per-minute cap, no first-contact cap, no typing indicator, so messages leave one after another as fast as WhatsApp accepts them. The developer turns them on per account. Recommended for bulk, cold or marketing sends, and for new numbers:

- `messagesPerMinute: 12`: at most 12 messages per minute per account, with a random 1 to 3 second gap between them;
- `firstContactPerMinute: 5`: at most 5 per minute to people who have never written to that number;
- `typing: {enabled: true}`: "typing" for 0.8 to 6 seconds before each message, depending on its length (25 characters per second).

With a cap on, sends over the pace stay `queued` and go out as slots free up, for **up to 1 hour** (`queueTimeoutMinutes`); then they fail with `error.code` `rate_limited`. Queued messages are not guaranteed to leave in the order sent.

Configure it with `PATCH /v1/accounts/{accountId}` and a `pacing` object: `messagesPerMinute` 0 to 30, `firstContactPerMinute` 0 to `messagesPerMinute` (0 to 30 while that is 0), `typing.enabled`, `typing.minMs` 0 to 10000, `typing.maxMs` `minMs` to 20000, `typing.charsPerSecond` 5 to 100, `queueTimeoutMinutes` 1 to 1440. `0` turns a cap off. Fields merge over what is stored; `null` resets a field, `pacing: null` resets all (every protection off). The account returns its effective `pacing` with `custom: true|false`. Out-of-range values answer `400 invalid_request` with `details: {field, min, max}`. Transactional replies to people who wrote first, OTPs and self tests are fine with the protections off; turn them on before bulk, cold or marketing sends. Full guide: `https://wuapi.dev/docs#sending-safely`.

Edits, poll votes and the automatic call-rejection reply share the same pace; stories and channel posts count against the per-minute cap only. So: `POST /v1/messages` returns `202` with `status: "queued"`, and the outcome arrives later as `message.sent` or `message.failed` (or read it with `GET /v1/messages/{messageId}`). Never assume a `202` means delivered. Never build cold bulk messaging on wuapi.

For the habits that keep a number healthy (warming up a new number, opt-in, first messages without links, what to do after `temporary_ban` or `logged_out`), point the user to `https://wuapi.dev/guides/avoid-restrictions`.

## Webhook signing (summary)

Every delivery carries `Wuapi-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 of `<t>.<raw body>` keyed with the endpoint secret (`whsec_...`, shown on create and rotate). Verify over the raw body before parsing JSON, in constant time, and reject timestamps older than a few minutes. `verifyWebhook(rawBody, header, secret)` from the SDK does all of it (default tolerance 300 seconds) and returns the typed event: `{id, object: "event", type, createdAt, organizationId, projectId, data: {object}}`. Deliveries retry after 30s, 2m, 10m, 1h and 6h; deduplicate on the event `id`. Full guide: the `receive-webhooks` skill.

## Billing facts that change code paths

- An organization without a paid subscription is on the Free plan: 1 number, 2,000 messages and 0.5 GB of proxy traffic a month, no card. Within those limits everything works, webhooks included. A second account or invitation answers `402 upgrade_required`. Messages count sent and received together, per calendar month in UTC. At either limit the account pauses (`disconnectReason: free_limit_reached`, the device stays linked) and sends, new accounts and reconnects answer `402 free_limit_reached` until the month ends or the organization upgrades; then it reconnects on its own. A canceled subscription falls back to Free; with more than 1 billable account its sends answer `402 upgrade_required` until the extra ones are removed.
- Sending checks billing only for the Free plan (above) and a legacy free trial (past its 0.5 GB of proxy, `402 trial_proxy_limit_reached`). A paying organization is refused only while proxy traffic is paused: `402 payment_required` while an invoice is unpaid (including `past_due`), `402 proxy_spend_cap_reached` at the organization's monthly proxy spend cap ($50 unless changed in Billing). During a pause the accounts show `disconnectReason: proxy_paused` and reconnect on their own when it lifts; messages already queued wait up to 24 hours, then fail with the same code. Do not retry these in a loop: surface `details.billingUrl` (or `details.upgradeUrl`) to a person.
- An account is billable once it has reached `ready`, until it is logged out or deleted. Logging out keeps the record and stops billing; deleting removes it.

## Where the full docs live

- Everything as one Markdown file, for agents: `https://wuapi.dev/llms-full.txt` (every docs section, every endpoint with its error codes, every webhook event). Index: `https://wuapi.dev/llms.txt`.
- Human docs: `https://wuapi.dev/docs`. Contract: `https://wuapi.dev/openapi.json`.
- When a skill and those docs disagree, the docs and the OpenAPI spec win.

## Other skills in this package

| Skill | Use it for |
|---|---|
| `wuapi-cli` | Logging in without handling keys, linking a number and sending a test from the terminal, calling any API method from a shell, setting up the MCP server |
| `link-account` | Connecting a number: QR code, pairing code, waiting for `ready`, reconnecting, logging out |
| `send-message` | Every send type and option, replies, mentions, polls, calendar events, edits, reactions, stories and channel posts |
| `receive-webhooks` | Webhook endpoints, signature verification, the event catalog, retries, history sync |
| `groups-and-channels` | Groups, communities, join requests, invite links, channels |
| `chats-contacts-profile` | Chat actions, read receipts, labels, contacts, blocking, profile, privacy, calls |
| `projects-and-invitations` | Building a platform: projects, project keys, per-project webhook endpoints and usage, invitations, branding |
