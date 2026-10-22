---
name: act-on-whatsapp
description: Act on a user's own WhatsApp number through wuapi (REST at https://api.wuapi.dev). Use when an assistant must operate that number for the user rather than write an application: store an organization API key as WUAPI_API_KEY and never print it, tell an organization key from a project key and send the Wuapi-Project header, pick the sending account from GET /v1/accounts, retry account_not_ready while reconnecting, stop on 402 free_limit_reached, honor 429 Retry-After, resolve a group or contact and ask when several match, confirm the exact text and recipients, send with POST /v1/messages and an Idempotency-Key, and poll GET /v1/messages/{id} until sent or delivered. Also the short endpoint map for media, reactions, chats, groups, channels, stories, uploads, webhooks, incoming webhooks and projects, plus the MCP server, CLI and TypeScript and Rust SDKs.
---

# Act on the user's WhatsApp number

Use this when the user wants you to do something on their own linked number: send a message, find a chat, react, archive. Load `wuapi-rules` for identities, the full error catalog and pacing. The other skills are the long form of each area; this one is the path an assistant follows, and it links to them instead of repeating them.

Base URL `https://api.wuapi.dev`. Every call sends `Authorization: Bearer $WUAPI_API_KEY`. The contract is `https://wuapi.dev/openapi.json`.

wuapi links the user's own number as a device, the same way WhatsApp Web does. It is not the WhatsApp Business Platform and it is not affiliated with WhatsApp. Send only to people who expect it. See [Responsible use](#responsible-use).

## Setup

1. The user creates an **organization API key** in the dashboard at `https://wuapi.dev/app/api-keys` (API keys). It looks like `wu_live_...` and is shown in full when it is created.
2. They store it as the secret `WUAPI_API_KEY` (the environment of the process that calls the API, or a secret manager). You read that variable. You never print it, log it, commit it, or ask them to paste it into the chat. If a key appears in the chat, tell them to revoke it in the dashboard and store a new one; do not repeat the value.
3. No key, and a terminal is available? Do not take a key from the user. `npx @wuapidev/cli login` keeps it in the CLI's own storage. The `wuapi-cli` skill.

Check the key without revealing it. `GET /v1/me` returns an `auth_context`: `organization` (`id`, `name`), `apiKey` (`projectId`, `keyPrefix`, `last4`) and `project` (null for the whole organization). `apiKey.key` is absent here. Quote `keyPrefix` and `last4` if you need to say which key is in use.

| Credential | `Wuapi-Project` header | What you can reach |
|---|---|---|
| organization key | absent | every project, and resources in no project |
| organization key | a project id or `ext:<externalId>` | that project only; `404 project_not_found` when it is not in the organization |
| project key | absent, or its own project | its project only |
| project key | another project | `403 forbidden` |

A project key is enough when the number lives in that project. Send `Wuapi-Project` only to narrow an organization key. Outside the scope is `404 not_found`. Creating projects and project keys: [Projects and API keys](#projects-and-api-keys) and the `projects-and-invitations` skill.

```bash
curl https://api.wuapi.dev/v1/me \
  -H "Authorization: Bearer $WUAPI_API_KEY"
```

```ts
import { Wuapi } from "@wuapidev/sdk" // npm install @wuapidev/sdk

const wuapi = new Wuapi() // reads process.env.WUAPI_API_KEY
const me = await wuapi.me()
console.log(me.organization.name, me.apiKey.projectId ?? "organization key", me.apiKey.last4)
```

## The sending account

`GET /v1/accounts` is `{object: "list", items, nextCursor}` (pass `?limit`, 1 to 100, default 50, and `?cursor` until `nextCursor` is null). Each account has `id`, `name`, `phone` (E.164, null until linked) and `status`.

`status` is `initializing`, `qr_ready`, `authenticating`, `ready`, `disconnected` or `failed`. Sending needs `ready`. `GET /v1/accounts/{accountId}` is the same account, including `reconnecting` and `disconnectReason`.

- One account with `status: "ready"`: use it, and tell the user the `name` and `phone`.
- Several ready: ask which one. Show `name` and `phone`. Do not pick for them.
- None ready: say so. Linking (QR or pairing code, proxy location) is the `link-account` skill, or `npx @wuapidev/cli link` from the `wuapi-cli` skill. Stop until one is `ready`.

```bash
curl "https://api.wuapi.dev/v1/accounts?limit=100" \
  -H "Authorization: Bearer $WUAPI_API_KEY"

curl "https://api.wuapi.dev/v1/accounts/$ACCOUNT_ID" \
  -H "Authorization: Bearer $WUAPI_API_KEY"
```

### `account_not_ready` and reconnecting

A live call on an account that is not `ready` answers `409` with `{code: "account_not_ready", details.status}`. While the account is reconnecting on its own, that `409` also carries `Retry-After` (seconds) and `details.reconnecting: true`. The account's own `reconnecting: true` means the same thing: it was `ready`, it is briefly `disconnected`, `initializing` or `authenticating`, and a send made in that window waits for it (about 3 minutes).

1. `details.reconnecting` is true: wait `Retry-After` seconds, then retry the **same** request with the **same** `Idempotency-Key`. A failed response is not stored, so the same key does not send twice.
2. Still not `ready`, and `reconnecting` is false: `POST /v1/accounts/{accountId}/reconnect` returns `202` and the account. Poll `GET /v1/accounts/{accountId}` until `status` is `ready`, then retry the send with the same key.
3. The poll reaches `qr_ready` (`qrCodeUrl` or `pairingCode` is set) or `failed`: the phone has to link again. Hand off to `link-account`. Do not send meanwhile.
4. Do not reconnect in a loop when the refusal is billing. See below.

### Free plan and `402 free_limit_reached`

An organization without a paid subscription is on the Free plan: 1 number, 2,000 messages (sent and received, counted together) and 0.5 GB of proxy traffic per calendar month (UTC). At either limit the account pauses (`disconnectReason: free_limit_reached`, the device stays linked) and sends, new accounts and reconnects answer:

`402` `{code: "free_limit_reached", details: {limit, month, resetsAt, upgradeUrl}}`

`details.limit` is `messages` or `proxy`. Show `details.upgradeUrl` and `details.resetsAt` to the user. Do not retry and do not call reconnect until the month ends or they upgrade; the account reconnects on its own. A second number is `402 upgrade_required` (`details.upgradeUrl`). Other `402` codes (`payment_required`, `proxy_fair_use_reached`, and the rest) are in `wuapi-rules`: surface the URL in `details` and stop.

### `429` and `Retry-After`

`429` `{code: "rate_limited"}` is 600 requests per minute per key, or WhatsApp limiting the account. Every `429` has `Retry-After` in seconds. Wait that long, then retry. On a `POST`, reuse the `Idempotency-Key`. Responses also carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the window resets). A `503 engine_unavailable` is retried shortly, with the same key.

## Resolve who it goes to

Lists are pages: follow `nextCursor` until it is null before you decide there is no match. Ask the user when more than one group or contact fits. Never guess, and never send to the whole page.

**A group.** `GET /v1/accounts/{accountId}/groups` is live, so the account must be `ready`. Each item has `name`, `id` (`120363041234567890@g.us`) and `community` (`true` when it is a community, not an ordinary group). There is no search parameter: walk the pages and compare `name`. Two groups with the same name: ask, and show `id`. URL-encode `@` as `%40` in the path when the client does not.

**A person saved on the phone.** `GET /v1/accounts/{accountId}/contacts?q=maria` searches `savedName`, `profileName`, the business name, the username and the number (best match first; the last word matches as a prefix). This list works while the account is not `ready`. Each contact has `savedName`, `profileName`, `phone` (E.164, or null when WhatsApp hides the number) and `id` (the same E.164, or `lid:<digits>`). Send to `id`. Several hits: ask, and show `savedName`, `profileName`, and `phone` or `id`.

Someone the account only chatted with is not in the address book. `GET /v1/accounts/{accountId}/chats?q=` finds them (`id`, `name`, `type`). The `chats-contacts-profile` skill.

**A number the user typed.** `POST /v1/accounts/{accountId}/contacts/check` with `{phones: ["+584241112233"]}` (1 to 50, E.164 or digits). The response is `{object: "list", items}`. Each item is `{phone, onWhatsApp, contactId, businessName}`. `contactId` is null when `onWhatsApp` is false: tell the user and do not send. When it is true, `to` is `contactId`.

`to` also accepts digits, `lid:<digits>`, or `@username` for a contact the account already chats with (otherwise `400 username_not_supported`). Prefer the id you just resolved.

## Confirm, then send

Always show the user the exact text and every recipient (`name`, and the `phone` or id you will pass as `to`) and wait for an explicit yes. Do this even when their request already contained both. A later "yes" to that confirmation is enough; do not ask twice. No send on a shrug, a partial match, or a list you have not shown.

`POST /v1/messages` with `Idempotency-Key` (at most 255 characters; a new key per message, the same key for every retry of that message). It returns `202` and the message (`object: "message"`) with `status: "queued"`. `202` means queued, not delivered. The same key within 24 hours replays that response and sets `Idempotent-Replayed: true`.

```bash
curl -X POST https://api.wuapi.dev/v1/messages \
  -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1042-shipped" \
  -d '{ "accountId": "'"$ACCOUNT_ID"'", "to": "+584241112233", "text": "Your order has shipped." }'
```

```ts
const message = await wuapi.messages.send(
  { accountId, to: "+584241112233", text: "Your order has shipped." },
  { idempotencyKey: "order-1042-shipped" },
)
```

Then poll `GET /v1/messages/{messageId}` until `status` is `sent`, `delivered`, `read` or `failed`. A few seconds between reads. `sent` means WhatsApp accepted it; `delivered` and `read` are the receipts after that, so keep polling when the user asked whether it arrived. Stop on `failed` and report `error.code` (`not_on_whatsapp`, `rate_limited`, `account_offline`, `send_failed`, or another code from `wuapi-rules`). With pacing on, `queued` can last up to the account's `queueTimeoutMinutes`: say that it is still queued and give the id, instead of polling for the whole wait, unless the user asked you to wait. Do not poll the inbox for new events; that is Webhooks or Streams (`receive-webhooks`, `receive-streams`).

```bash
curl "https://api.wuapi.dev/v1/messages/$MESSAGE_ID" \
  -H "Authorization: Bearer $WUAPI_API_KEY"
```

On `409 account_not_ready`, `429` or `503`, follow the retries above with the same `Idempotency-Key`. On `402 free_limit_reached`, stop and tell the user.

## Other capabilities

One call each. Bodies, limits and errors are in the skill named on the row. Paths sit under `https://api.wuapi.dev`.

### Messages, media, uploads

All of these sends are `POST /v1/messages` (202, queued, same `Idempotency-Key` rule). `type` defaults to `text`. Skill: `send-message`.

| Capability | Body besides `accountId` and `to` |
|---|---|
| Image, video, audio | `type` `image`, `video` or `audio`, `media` `{url}` (https) or `{uploadId}`, optional `text` caption. `viewOnce` on image, video and audio |
| Voice note | `type: "voice"`, `media` `{url, mimeType: "audio/ogg; codecs=opus"}` or `{uploadId}` |
| Document | `type: "document"`, `media` `{url, filename}` or `{uploadId, filename}`, optional `text` |
| Contact card | `type: "contact"`, `contact` `{name, phone}`, or `type: "contacts"` with 2 to 20 `contacts` |
| Poll | `type: "poll"`, `poll` `{name, options, selectableCount?}` (2 to 12 options) |
| Calendar event | `type: "calendar_event"`, `calendarEvent` `{name, startsAt, endsAt?, location?, callType?}` |

A file that is not already on an https URL: `POST /v1/uploads` (`{mimeType, size}` → `{id, uploadUrl}`, or `{mimeType, base64}` up to 5 MB), `POST` the bytes to `uploadUrl` with no API key, then `POST /v1/uploads/{uploadId}/complete` with `{storageId}`. Send with `media.uploadId`. The steps are in `send-message`.

| Action | Call |
|---|---|
| React | `POST /v1/messages/{messageId}/react` `{emoji}` (`""` removes it) |
| Edit text | `PATCH /v1/messages/{messageId}` `{text}` (outbound text, about 15 minutes) |
| Delete | `DELETE /v1/messages/{messageId}` (`forEveryone` defaults to true; outbound only) |
| Forward | `POST /v1/messages/{messageId}/forward` `{to}` (1 to 5 chats), with `Idempotency-Key` |
| Read one chat | `GET /v1/messages?accountId=&chatId=` |

### Chats

Under `/v1/accounts/{accountId}/chats`. Skill: `chats-contacts-profile`.

| Action | Call |
|---|---|
| List, search | `GET /v1/accounts/{accountId}/chats` (`?q=`, `?unread=`, `?archived=`) |
| Read receipts | `POST .../chats/{chatId}/read` |
| Mark read or unread | `POST .../chats/{chatId}/mark-read`, `POST .../mark-unread` |
| Archive, pin, mute | `POST .../archive`, `/unarchive`, `/pin`, `/unpin`, `/mute` `{durationSeconds?}`, `/unmute` |
| Labels (WhatsApp Business; a consumer number is `400 not_supported`) | `PUT /v1/accounts/{accountId}/labels/{labelId}` `{name, color?}`, then `POST .../chats/{chatId}/labels` `{labelId}` and `DELETE .../chats/{chatId}/labels/{labelId}` |

`chatId` is a contact id, a group id or a channel id. Encode it in the path.

### Groups, communities, channels, stories

Skills: `groups-and-channels`, `send-message` (stories and channel posts).

| Action | Call |
|---|---|
| Groups | `GET` and `POST /v1/accounts/{accountId}/groups`, `GET` and `PATCH .../groups/{groupId}` |
| Members | `POST .../groups/{groupId}/participants/add`, `/remove`, `/promote`, `/demote` with `{contactIds}` |
| Invite, join, leave | `GET .../groups/{groupId}/invite-link`, `POST .../groups/join` `{code}`, `POST .../groups/{groupId}/leave` |
| Community | `POST .../groups` `{name, community: true}`, then `GET` and `POST .../groups/{groupId}/subgroups`, `DELETE .../subgroups/{subgroupId}` |
| Channels | `GET` and `POST /v1/accounts/{accountId}/channels` (id `...@newsletter`). Follow, mute, read: `POST .../channels/{channelId}/follow`, `/mute`, `GET .../messages`. Post: `POST /v1/messages` with that id as `to` |
| Stories | `POST /v1/accounts/{accountId}/stories` (202, queued). List contacts' stories: `GET .../stories`. The account's own: `GET .../stories/own` |

### Webhooks

**Your endpoint** receives events. Skill: `receive-webhooks`. No public URL: Streams, skill `receive-streams` (`GET https://stream.wuapi.dev/v1/events/stream`).

| Action | Call |
|---|---|
| Create | `POST /v1/webhook-endpoints` `{url, events}` → `201`, `secret` is `whsec_...` and is returned only here and on rotate. Store it as `WUAPI_WEBHOOK_SECRET`. Never print it |
| List, get, update, delete | `GET /v1/webhook-endpoints`, `GET`, `PATCH`, `DELETE /v1/webhook-endpoints/{webhookEndpointId}` |
| Rotate the secret | `POST /v1/webhook-endpoints/{webhookEndpointId}/rotate-secret` |

Every delivery has `Wuapi-Signature: t=<unix seconds>,v1=<hex>`. `v1` is HMAC-SHA256 of `<t>.<raw body>` keyed with that secret. Verify the raw body in constant time and reject a timestamp older than a few minutes before you parse JSON. `verifyWebhook(rawBody, header, secret)` from `@wuapidev/sdk` does this (tolerance 300 seconds). Deduplicate on the event `id`. Retries are 30s, 2m, 10m, 1h, 6h.

**An incoming webhook** is the other direction: a secret URL that sends from one account to one fixed `to`, for a script that must not hold an API key.

| Action | Call |
|---|---|
| Create | `POST /v1/incoming-webhooks` `{accountId, name, to}` → `201` with `url` |
| Pause, rotate, delete | `PATCH /v1/incoming-webhooks/{incomingWebhookId}` `{enabled?: false, rotateUrl?: true, name?}`, `DELETE` the same path |

`POST` that `url` with no API key: JSON `{"text": "..."}` (`content` is accepted, plus an optional https `imageUrl`) or a plain text body. `202` once queued; the same `Idempotency-Key` replays with `200` and `Idempotent-Replayed: true`. 60 messages a minute per hook (`429` over it), 50 hooks per organization (`400 limit_reached`). Anyone who has the URL can send to that destination: treat `url` like a secret, and do not paste it into the chat.

### Projects and API keys

A platform (one project per customer) is the `projects-and-invitations` skill. Organization keys are created in the dashboard, not by the API. Project keys:

| Action | Call |
|---|---|
| Projects | `GET` and `POST /v1/projects`, `GET`, `PATCH`, `DELETE /v1/projects/{projectId}` (`projectId` or `ext:<externalId>`). Organization keys only |
| Project keys | `POST /v1/projects/{projectId}/api-keys` `{name}` → `201`. `key` is returned only then. `GET .../api-keys` never returns it. `DELETE .../api-keys/{apiKeyId}` revokes |

The `key` from that `201` is a secret. Hand it to the user's secret store. Do not print it or leave it in the chat. Scope later calls with `Wuapi-Project`.

## MCP, CLI and SDKs

Same API. Prefer the one the user already has.

| Client | How |
|---|---|
| MCP server | [wuapidev/wuapi-mcp](https://github.com/wuapidev/wuapi-mcp). Local: `npx -y @wuapidev/mcp` with `WUAPI_API_KEY`. Hosted: `https://wuapi.dev/api/mcp` with `Authorization: Bearer $WUAPI_API_KEY`. Docs: `https://wuapi.dev/docs/mcp`. Tools are one REST call each. Still confirm before a send. A tool that deletes or leaves takes `confirm: true` |
| CLI | `npx @wuapidev/cli` (npm `@wuapidev/cli`, binary `wuapi`, [wuapidev/wuapi-cli](https://github.com/wuapidev/wuapi-cli)). `npx @wuapidev/cli send`, `accounts list`, and every other method. Skill: `wuapi-cli` |
| TypeScript | `npm install @wuapidev/sdk`. `new Wuapi()` reads `WUAPI_API_KEY`. [wuapidev/wuapi-typescript](https://github.com/wuapidev/wuapi-typescript) |
| Rust | `cargo add wuapi`. `Wuapi::from_env()` reads `WUAPI_API_KEY`. [wuapidev/wuapi-rust](https://github.com/wuapidev/wuapi-rust), [crates.io/crates/wuapi](https://crates.io/crates/wuapi) |

## Responsible use

- The number is the user's. Recipients are people who agreed to hear from it. Do not message a purchased list, a scraped list, or someone who did not ask.
- Confirm the text and the recipients before every send. One confirmed message is not permission for a blast.
- Do not run cold or bulk outreach. When the user is sending more than a reply, point them at pacing in `wuapi-rules` and at `https://wuapi.dev/guides/avoid-restrictions`. WhatsApp restricts numbers for what they send and how people respond.
- Read contacts, chats and groups only to do the thing the user asked. Do not export the address book anywhere else.
- Keys, webhook secrets and incoming-webhook URLs stay in a secret store. Never in the chat, a commit, or a log.
- wuapi is an independent service. It is not affiliated with, endorsed or sponsored by WhatsApp or Meta, and it does not offer message templates, buttons or list messages.
