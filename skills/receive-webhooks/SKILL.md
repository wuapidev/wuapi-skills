---
name: receive-webhooks
description: Receive wuapi events on an HTTPS endpoint. Use when writing a webhook handler for wuapi, creating or updating webhook endpoints, verifying the Wuapi-Signature header, handling inbound WhatsApp messages, delivery and read receipts, account status changes, poll votes, calls, group and chat changes, or the chat history synced after linking; also when building an AI agent that answers incoming WhatsApp messages.
---

# Receive webhooks

wuapi POSTs every event as JSON to your webhook endpoints, signed with the endpoint's secret.

## Workflow

1. Create a webhook endpoint once and store its `secret` (`whsec_...`); it is returned only on create and on rotate.
2. In the handler, read the **raw body** as text, verify the signature, then parse.
3. Answer any `2xx` fast (the timeout is 10 seconds); do slow work in a queue.
4. Deduplicate on the event `id`: deliveries can repeat.

```ts
import { Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi() // reads WUAPI_API_KEY
const endpoint = await wuapi.webhookEndpoints.create({
  url: "https://example.com/webhooks/wuapi",
  events: ["message.received", "message.failed", "account.disconnected"],
})
console.log(endpoint.id, endpoint.secret) // store the secret as WUAPI_WEBHOOK_SECRET
```

```bash
curl -X POST https://api.wuapi.dev/v1/webhook-endpoints \
  -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/webhooks/wuapi", "events": ["message.received"] }'
```

## Verify and handle

```ts
import { verifyWebhook, WebhookVerificationError } from "@wuapidev/sdk"

// Next.js route handler, or any runtime with the Fetch API Request.
export async function POST(request: Request) {
  const rawBody = await request.text() // raw, before JSON.parse
  try {
    const event = await verifyWebhook(rawBody, request.headers.get("wuapi-signature"), process.env.WUAPI_WEBHOOK_SECRET!)
    switch (event.type) {
      case "message.received": {
        const m = event.data.object
        if (m.type === "reaction") break // emoji in m.text, target in m.replyToMessageId
        console.log(m.accountId, m.chatId, m.from, m.profileName, m.text)
        break
      }
      case "message.failed":
        console.log(event.data.object.id, event.data.object.error?.code)
        break
      case "account.disconnected":
        console.log(event.data.object.id, event.data.object.disconnectReason)
        break
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response("invalid signature", { status: 400 })
    throw err
  }
}
```

`verifyWebhook(rawBody, header, secret, toleranceSec = 300)` resolves to the typed event (a union discriminated on `type`, with `data.object` typed per event), or throws `WebhookVerificationError` when the header is missing or malformed, no `v1` matches, or the timestamp is outside the tolerance.

Without the SDK: the header is `Wuapi-Signature: t=<unix seconds>,v1=<hex>`, where `v1` = HMAC-SHA256 of `<t>.<raw body>` keyed with the secret. Compare in constant time and reject old timestamps.

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

export function verifyWuapiSignature(rawBody: string, header: string, secret: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]))
  const t = Number(parts.t)
  if (!t || !parts.v1) return false
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex")
  const got = Buffer.from(parts.v1, "hex")
  return expected.length === got.length && timingSafeEqual(expected, got)
}
```

## Envelope and delivery

Every event has the same envelope. `data.object` is the resource in exactly the shape the REST API returns (here a `message`), or the event's own object named in the catalog below.

```json
{
  "id": "evt_3f9a1c2b7d4e5f60a1b2c3d4",
  "object": "event",
  "type": "message.received",
  "createdAt": "2026-09-24T14:02:11.000Z",
  "organizationId": "...",
  "projectId": null,
  "data": {
    "object": { "object": "message", "id": "...", "accountId": "...", "chatId": "+584241112233", "chatType": "direct", "from": "+584241112233", "type": "text", "text": "Is my order on the way?" }
  }
}
```

- `message.edited` also carries `data.previousAttributes: {text}`, and `invitation.status_changed` carries `data.previousAttributes: {status}`.
- Headers: `Wuapi-Signature`, `Wuapi-Event-Id`, `Wuapi-Event-Type`.
- POST with a 10 second timeout; redirects are not followed; any `2xx` is success.
- Anything else is retried after 30s, 2m, 10m, 1h and 6h: six attempts in total. The dashboard (Logs, Webhooks) keeps every delivery for 30 days, with each attempt's status, latency and the start of a non-2xx response body, and can resend one (a new delivery with the same `Wuapi-Event-Id`, so deduplicate on it) or send a `webhook.test` event to an endpoint.
- `projectId` is the event's project, or `null`. An organization endpoint receives every project's events; a project endpoint only its own (see `projects-and-invitations`).
- Limits: 5 webhook endpoints per organization plus 5 per project.

## Managing webhook endpoints

| SDK | REST |
|---|---|
| `webhookEndpoints.create({ url, events, projectId? })` | `POST /v1/webhook-endpoints` (201, with `secret`) |
| `webhookEndpoints.list({ projectId? })` | `GET /v1/webhook-endpoints` (paginated, never the secret) |
| `webhookEndpoints.get(id)` | `GET /v1/webhook-endpoints/{webhookEndpointId}` |
| `webhookEndpoints.update(id, { url?, events?, active? })` | `PATCH /v1/webhook-endpoints/{webhookEndpointId}` |
| `webhookEndpoints.delete(id)` | `DELETE /v1/webhook-endpoints/{webhookEndpointId}` |
| `webhookEndpoints.rotateSecret(id)` | `POST /v1/webhook-endpoints/{webhookEndpointId}/rotate-secret` (returns the endpoint with the new `secret`; the old one stops working at once) |

`WEBHOOK_EVENT_TYPES`, exported by the SDK, is the list of every event type.

## Event catalog

| event | `data.object` | when |
|---|---|---|
| `account.qr_code_issued` | `account` with `qrCodeUrl` | the account entered `qr_ready`; not re-sent on each QR code rotation |
| `account.pairing_code_issued` | `account` with `pairingCode` | a new pairing code was issued |
| `account.connected` | `account` | reached `ready` |
| `account.disconnected` | `account` | the connection dropped; `disconnectReason` says why |
| `account.failed` | `account` | stopped for good; reconnect to start again |
| `message.received` | `message` | a contact sent a message; reactions too, with `type` `reaction` |
| `message.sent` | `message` | WhatsApp accepted an outbound message; also for messages sent from the phone, with `source` `phone` |
| `message.delivered` | `message` | the recipient's device received it |
| `message.read` | `message` | read, or a voice note played |
| `message.failed` | `message` | `error.code` `not_on_whatsapp`, `rate_limited` or `send_failed` |
| `message.edited` | `message` | edited by either side; `editedAt` set; `previousAttributes.text` |
| `message.deleted` | `message` | deleted for everyone; content cleared, `deletedAt` set |
| `message.media_downloaded` | `message` | a received file was stored by a background retry; `media.downloaded` is now `true` |
| `story.received` | `story` | a contact posted a story (accounts with stories on); `media.downloaded` is `false` until you fetch the file |
| `story.deleted` | `story` | its author deleted it before it expired; `deletedAt` set, content cleared |
| `story.viewed` | `story_viewer`: `{accountId, storyId, contactId, viewedAt, reaction, reactedAt}` | a contact saw a story the account posted; once per contact and story |
| `story.reacted` | `story_viewer` | a contact reacted to a story the account posted, or changed or removed the reaction |
| `poll.voted` | `poll_vote`: `{accountId, chatId, messageId, voterId, options, votedAt, poll}` | someone voted; `poll` is the poll message with its tally, or `null` |
| `group.joined` | `group` | the account was added to or created a group |
| `group.updated` | `group_change`: `{accountId, groupId, actorId, added, removed, promoted, demoted, name, description, locked, announce, changes, changedAt}` | participants, admins, name, description or settings changed; `changes` lists what |
| `group.join_requested` | `group_join_request`: `{accountId, groupId, contactId, requestedAt}` | someone asked to join a group that needs approval |
| `group.join_request_revoked` | `group_join_request` | the request was withdrawn |
| `chat.updated` | `chat_change`: `{accountId, chatId, change, value, messageId, mutedUntil}` | archive, pin, mute, read, delete, clear or star, from any device |
| `chat.presence_updated` | `chat_presence`: `{accountId, chatId, contactId, state}` | a contact is `typing`, `recording` or `paused` |
| `contact.presence_updated` | `contact_presence`: `{accountId, contactId, online, lastSeenAt}` | a subscribed contact went online or offline |
| `contact.picture_updated` | `picture_change`: `{accountId, chatId, pictureId, removed, changedBy, changedAt}` | a contact or group changed its picture |
| `contact.updated` | `contact` with `about` | a contact changed their about text |
| `blocklist.updated` | `blocklist_change`: `{accountId, changes: [{contactId, action}], refetch}` | the blocklist changed; with `refetch: true`, read it again |
| `sticker.favorites_updated` | `sticker_favorites_change`: `{accountId, reason, stickerId, sticker, added, removed}` | the account's favorite stickers changed: `added` (with the `sticker`), `removed` (with its `stickerId`) or `synced` (the whole list was read again; counts only, read `GET .../stickers/favorites`) |
| `label.updated` | `label_change`: `{accountId, kind, labelId, name, color, deleted, chatId, messageId, labeled}` | WhatsApp Business labels: edited, or put on a chat or message |
| `call.received` | `call`: `{id, accountId, from, video, groupId, endReason, startedAt, endedAt}` | an incoming call |
| `call.ended` | `call` | a call ended or was rejected; `endReason` says how |
| `channel.message_received` | `channel_message`: `{id, accountId, channelId, type, text, viewCount, reactions, sentAt}` | a post in a followed channel; not stored |
| `channel.message_updated` | `channel_message` | new view and reaction counts on a channel post |
| `channel.updated` | `channel_change`: `{accountId, channelId, change, name, role}` | the channel was `followed`, `unfollowed`, `muted` or `unmuted` |
| `history.synced` | `history_sync`: `{accountId, chunk, syncType, progress, part, conversationCount, messageCount, duplicateCount}` | one push of the history sent after linking was stored (only with `historySync: "recent"`) |
| `project.created` | `project` | a project was created |
| `project.updated` | `project` | renamed, relabeled, limit changed, suspended or resumed |
| `project.deleted` | `project` | the background delete of a project finished |
| `invitation.status_changed` | `invitation`, plus `previousAttributes.status` | an invitation moved to `in_progress`, `completed`, `failed`, `cancelled` or back to `pending` |
| `webhook.test` | `webhook_endpoint` | you pressed Send test event on this endpoint in the dashboard; sent once, whatever the endpoint subscribes to |

Full examples for every event: `https://wuapi.dev/llms-full.txt` (section Events) or `https://wuapi.dev/docs#events`.

## Payloads that matter most

- **Inbound message** (`message.received`): `direction` `inbound`, `source` `contact`, `chatId` (the contact id, or the group id when `chatType` is `group`), `from` (the sender's contact id; in groups, the member), `profileName` (the sender's WhatsApp name), `type`, `text`, `media` (`{url, mimeType, filename, size, width, height, durationSeconds, gifPlayback, downloaded}`; `size` is bytes; `width`, `height` and `durationSeconds` are `null` for received files today; `gifPlayback: true` marks a `video` that WhatsApp plays as a GIF; with `downloaded: true` `url` is the stored file; with `downloaded: false` the file is still on WhatsApp and `url` is `GET /v1/messages/{id}/media`, which needs the API key and downloads it on first use — or call it with `?redirect=false` for a keyless file URL; `url` can be `null`), `location`, `contact`/`contacts`, `poll`, `calendarEvent`, `mentions`, `replyToMessageId` (the quoted wuapi message, when known), `forwarded`, `forwardedManyTimes` (WhatsApp's "Forwarded many times": five or more forwards), `viewOnce`. Types include `voice` for voice notes and `unknown` for what cannot be parsed.
- **Replying**: send with the same `accountId` and `to` set to the inbound `chatId`, optionally `replyToMessageId` set to the inbound message id.
- **Calls**: `call.received` carries `startedAt`; `call.ended` carries `endedAt` and `endReason`. Reject with the call `id` and `from` (see `chats-contacts-profile`).
- **Polls**: a vote on a poll the account never saw arrives with an empty `options` list and `poll: null`.
- Contacts are always E.164 (`+584241112233`) or `lid:<digits>`; group and channel ids stay `...@g.us` and `...@newsletter`.

```ts
import { Wuapi, verifyWebhook } from "@wuapidev/sdk"

const wuapi = new Wuapi()

// A minimal auto-reply: answer every text in one-to-one chats, quoting it.
export async function POST(request: Request) {
  const event = await verifyWebhook(await request.text(), request.headers.get("wuapi-signature"), process.env.WUAPI_WEBHOOK_SECRET!)
  if (event.type === "message.received") {
    const m = event.data.object
    if (m.chatType === "direct" && m.type === "text") {
      await wuapi.chats.sendReadReceipts(m.accountId, m.chatId) // blue ticks
      await wuapi.messages.send(
        { accountId: m.accountId, to: m.chatId, text: "Thanks, we got it.", replyToMessageId: m.id },
        { idempotencyKey: `reply-${m.id}` },
      )
    }
  }
  return new Response(null, { status: 204 })
}
```

Using `reply-${m.id}` as the idempotency key makes a redelivered event reply only once.

## History sync

Right after a number links, WhatsApp sends the linked device part of the chat history, as it does for WhatsApp Web. History import is off by default: create the account with `historySync: "recent"` to store it.

- WhatsApp sends it once, right after linking. Changing `historySync` later applies to the next link; a number already linked gets no history, not even after a reconnect.
- With `historySync: "none"` (the default) nothing is stored and `history.synced` never fires.
- Stored as messages with `source` `history`: `GET /v1/messages?accountId=...&chatId=...` returns old conversations with new ones.
- It arrives in pushes of at most 500 messages; each push fires one `history.synced` with counts, never one event per message.
- Historical messages carry no media: `type` says what it was and `media` is `null`. Messages already stored are counted in `duplicateCount`.
- History does not count toward `sentMessageCount` or `receivedMessageCount` in usage. How much arrives is decided by WhatsApp and the phone; there is no endpoint to ask for more.
- Chat changes replayed by the initial sync are not sent as `chat.updated`; only live changes are.
