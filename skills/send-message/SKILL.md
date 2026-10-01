---
name: send-message
description: Send WhatsApp messages through wuapi and act on sent messages. Use when writing code that sends text, media, voice notes, documents, stickers, locations, contact cards, polls or calendar events; replies, mentions, forwards, view-once or disappearing messages; edits, deletes, stars or reacts to a message; votes in a poll; or posts a story or a channel post. Also covers the queued lifecycle, the Idempotency-Key header, pacing and send errors.
---

# Send messages

`POST /v1/messages` sends one message from one connected account, to a contact, a group, or a channel the account administers. The account must be `ready` (else `409 account_not_ready`). The call returns `202` with the message (`object: "message"`) `queued`; it moves to `sent` when WhatsApp accepts it, then `delivered` and `read` as receipts arrive (webhooks `message.sent`, `message.delivered`, `message.read`), or `failed` (`message.failed`).

```ts
import { Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi() // reads WUAPI_API_KEY

const message = await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  text: "Your order has shipped.",
})
console.log(message.id, message.status, message.chatId) // "queued", "+584241112233"
```

```bash
curl -X POST https://api.wuapi.dev/v1/messages \
  -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-4417-shipped" \
  -d '{ "accountId": "'"$ACCOUNT_ID"'", "to": "+584241112233", "type": "text", "text": "Your order has shipped." }'
```

## Fields

| field | notes |
|---|---|
| `accountId` | required; the account to send from |
| `to` | required; a contact (E.164 `+584241112233`, digits, `lid:<digits>`, or the `@username` of a contact the account already chats with, else `400 username_not_supported`), a group (`...@g.us`) or a channel (`...@newsletter`, admins only) |
| `type` | `text` (default), `image`, `video`, `audio`, `voice`, `document`, `sticker`, `location`, `contact`, `contacts`, `poll`, `calendar_event`; a channel takes `text`, `image`, `video`, `document` |
| `text` | required for `text`, up to 4,096 characters; the caption for media |
| `media` | required for media types: `{url, mimeType?, filename?, gifPlayback?}`, or `{uploadId, ...}` for a file you uploaded (see "Sending a file you have"); `url` must be HTTPS and is fetched by our servers; a missing `mimeType` is guessed from the URL, or is the upload's |
| `location` | `{latitude, longitude, name?, address?}` |
| `contact` | `{name, phone}` |
| `contacts` | 2 to 20 `{name, phone}` cards in one message |
| `poll` | `{name, options, selectableCount?}`: 2 to 12 unique options, each up to 100 characters; `selectableCount` `0` (default) allows any number |
| `calendarEvent` | `{name, description?, startsAt, endsAt?, location?, callType?, allowExtraGuests?}`; times are ISO 8601 |
| `replyToMessageId` | a wuapi message id in the same chat to quote; works with every type |
| `mentions` | contact ids, up to 256 |
| `mentionAll` | `true` mentions every participant; groups only |
| `forwarded` | `true` marks it as forwarded |
| `viewOnce` | image, video and audio: the recipient can open it once |
| `linkPreview` | text only: `{url, title, description?, thumbnailBase64?}`; nothing is fetched, you provide the preview |
| `disappearingSeconds` | `0`, `86400`, `604800` or `7776000`; match the chat's timer |
| `metadata` | your own string pairs, up to 50 keys, returned on the message and in webhooks |

Idempotency is a header, not a field: `Idempotency-Key` makes a retried send return the first response (`202`, with `Idempotent-Replayed: true`) for 24 hours instead of sending twice. The SDK generates one per call; pass your own as `{ idempotencyKey }` in the last argument.

There are no templates, buttons or list messages: they are features of the official WhatsApp Business Platform, not of wuapi.

## Sending a file you have

`media.url` needs the file at a public URL. A local file, a pasted image or a recorded voice note is uploaded first and sent by its id.

```ts
import { readFile } from "node:fs/promises"

// A Blob, File, Buffer, ArrayBuffer or stream. Small files go in one request,
// larger ones (up to 100 MB) straight to storage through an upload URL.
const upload = await wuapi.uploads.upload(await readFile("photo.jpg"), { mimeType: "image/jpeg" })

await wuapi.messages.send({ accountId, to: "+584241112233", type: "image", media: { uploadId: upload.id }, text: "From my camera roll" })

// A recorded voice note: Ogg/Opus, nothing is transcoded.
const note = await wuapi.uploads.upload(await readFile("note.ogg"), { mimeType: "audio/ogg; codecs=opus" })
await wuapi.messages.send({ accountId, to: "+584241112233", type: "voice", media: { uploadId: note.id } })
```

Without the SDK it is three calls, or one for a file up to 5 MB:

```bash
# Any size up to 100 MB: create, post the bytes to uploadUrl (no API key), complete.
curl -X POST https://api.wuapi.dev/v1/uploads -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" -d '{ "mimeType": "image/jpeg", "size": 482113 }'   # → { id, uploadUrl, status: "pending" }
curl -X POST "$UPLOAD_URL" -H "Content-Type: image/jpeg" --data-binary @photo.jpg          # → { "storageId": "..." }
curl -X POST https://api.wuapi.dev/v1/uploads/$UPLOAD_ID/complete -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" -d '{ "storageId": "'"$STORAGE_ID"'" }'              # → { status: "ready" }

# Up to 5 MB: the bytes as base64, and the upload comes back ready.
curl -X POST https://api.wuapi.dev/v1/uploads -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" -d '{ "mimeType": "image/png", "base64": "'"$(base64 -w0 paste.png)"'" }'
```

- A `ready` upload can be sent any number of times for 24 hours (`expiresAt`), to any account the key reaches. After that it answers `404`: upload again.
- It belongs to the key's organization (and project): another organization or project gets `404 not_found`, on reads and on sends.
- Every step is safe to repeat: the same `Idempotency-Key` on `POST /v1/uploads` answers the same upload, completing a `ready` upload with the same `storageId` answers it again, and a send retried with the same key returns the first message.
- The file posted to `uploadUrl` must be exactly the declared `size`. Over 100 MB (or 5 MB of `base64`) answers `413 media_too_large`.
- The message's `media.size` is known at once and `media.url` is the stored file, which works until the message is deleted. A sent message keeps its file after the upload expires.
- Limits: 60 uploads per minute and 5 GB per day per organization (`429 rate_limited`, `Retry-After`).
- From a terminal: `npx @wuapidev/cli send +584241112233 "Caption" --file photo.jpg` (`--type voice` for a voice note).

## Every type

```ts
// Image (also video, document, sticker): media.url is fetched by our servers.
await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "image",
  text: "Invoice attached",
  media: { url: "https://example.com/invoice.png", mimeType: "image/png" },
})

// Document with a file name.
await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "document",
  media: { url: "https://example.com/invoice.pdf", filename: "invoice.pdf" },
  text: "Your invoice",
})

// Voice note. Nothing is transcoded, so send ogg/opus.
await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "voice",
  media: { url: "https://example.com/note.ogg", mimeType: "audio/ogg; codecs=opus" },
})

// GIF playback (video), and view once (image, video, audio).
await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "video",
  media: { url: "https://example.com/clip.mp4", gifPlayback: true },
  viewOnce: true,
})

await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "location",
  location: { latitude: 10.4806, longitude: -66.9036, name: "Store", address: "Av. Principal 12" },
})

await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "contact",
  contact: { name: "Front desk", phone: "+584121112222" },
})

await wuapi.messages.send({
  accountId,
  to: "+584241112233",
  type: "contacts",
  contacts: [
    { name: "Front desk", phone: "+584121112222" },
    { name: "Billing", phone: "+584121113333" },
  ],
})

// Poll: votes arrive as poll.voted webhooks; the stored poll keeps the tally.
const poll = await wuapi.messages.send({
  accountId,
  to: "120363041234567890@g.us",
  type: "poll",
  poll: { name: "Team dinner?", options: ["Thursday", "Friday"], selectableCount: 1 },
})

// Calendar event. callType marks it as a scheduled WhatsApp call; WhatsApp creates the link on the phone, so joinUrl stays null.
await wuapi.messages.send({
  accountId,
  to: "120363041234567890@g.us",
  type: "calendar_event",
  calendarEvent: {
    name: "Quarterly review",
    startsAt: "2026-10-02T15:00:00Z",
    endsAt: "2026-10-02T16:00:00Z",
    location: { name: "Room 4" },
    callType: "video",
  },
})
console.log(poll.id)
```

## Replies, mentions and other options

```ts
// Quote any earlier message in the same chat by its wuapi id.
await wuapi.messages.send({ accountId, to: "+584241112233", text: "Yes, it ships today.", replyToMessageId: messageId })

// Mention in a group: put the number in the text and in mentions.
await wuapi.messages.send({
  accountId,
  to: "120363041234567890@g.us",
  text: "@584241112233 can you take this one?",
  mentions: ["+584241112233"],
})

// Everyone in the group.
await wuapi.messages.send({ accountId, to: "120363041234567890@g.us", text: "Standup in 5", mentionAll: true })

// Link preview you provide, disappearing timer, your own metadata and idempotency key.
await wuapi.messages.send(
  {
    accountId,
    to: "+584241112233",
    text: "Tracking: https://example.com/t/4417",
    linkPreview: { url: "https://example.com/t/4417", title: "Order 4417" },
    disappearingSeconds: 86400,
    metadata: { orderId: "4417" },
  },
  { idempotencyKey: "order-4417-shipped" },
)
```

## Acting on a sent or received message

| SDK | REST | notes |
|---|---|---|
| `messages.get(id)` | `GET /v1/messages/{messageId}` | current status, `error`, content |
| `messages.list({ accountId, chatId, direction })` | `GET /v1/messages` | newest first, paginated; also `projectId` with an organization key; `chatId` in contact, group, channel or `stories` form |
| `messages.edit(id, text)` | `PATCH /v1/messages/{messageId}` | outbound text only; WhatsApp accepts edits for about 15 minutes; sets `editedAt` |
| `messages.delete(id, { forEveryone })` | `DELETE /v1/messages/{messageId}` | outbound only; `forEveryone` defaults to `true`; sets `deletedAt` |
| `messages.react(id, emoji)` | `POST /v1/messages/{messageId}/react` | `""` removes the reaction; `204` |
| `messages.star(id)` / `unstar(id)` | `POST /v1/messages/{messageId}/star`, `POST /v1/messages/{messageId}/unstar` | also on the phone; return the message |
| `messages.vote(id, options)` | `POST /v1/messages/{messageId}/vote` | option names; `[]` retracts; returns the poll with its tally |
| `messages.addLabel(id, labelId)` / `removeLabel` | `POST /v1/messages/{messageId}/labels`, `DELETE /v1/messages/{messageId}/labels/{labelId}` | WhatsApp Business only |

```ts
// An outbound message that has left the queue (status "sent" or later).
const sent = await wuapi.messages.get(messageId)
await wuapi.messages.edit(sent.id, "Your order has shipped. Tracking: 1Z999.")
await wuapi.messages.react(sent.id, "\u{1F44D}")
await wuapi.messages.star(sent.id)
await wuapi.messages.delete(sent.id) // for everyone

// Vote in a poll you sent or received (here messageId is the poll), by option name.
const voted = await wuapi.messages.vote(messageId, ["Friday"])
console.log(voted.poll?.options) // [{ name, voteCount }]
```

Edits and poll votes are messages to WhatsApp, so they share the send pace. Poll options are checked against the stored poll: an unknown name, a repeated one, or more than `selectableCount` answers `400`. Delete for me does not exist; delete for everyone does.

## Stories and channel posts

```ts
// A story (WhatsApp Status): text, image or video. Stored with chatId "stories", chatType "story".
await wuapi.stories.create(accountId, { type: "text", text: "Closed today for inventory.", backgroundColor: "#1F2937", font: 1 })
await wuapi.stories.create(accountId, { type: "image", text: "New stock", media: { url: "https://example.com/shelf.jpg" } })

// Post to a channel the account administers: a normal send with the channel id as `to`.
await wuapi.messages.send({ accountId, to: "120363198765432109@newsletter", text: "Doors open at 8." })
```

REST: `POST /v1/accounts/{accountId}/stories` and `POST /v1/messages`. Both are queued and paced like a send and return `202` with the message. `font` is one of `0`, `1`, `2`, `6`, `7`, `8`, `9`, `10`. Who sees a story follows the account's story privacy. Contacts' own stories are not received.

## Typing indicator

With `pacing.typing.enabled` on (off by default), every send shows "typing" for 0.8 to 6 seconds first. To show it yourself while your code works on a reply (an AI agent, a lookup):

```ts
await wuapi.chats.sendPresence(accountId, "+584241112233", "typing") // or "recording", "paused"
```

## Pacing and failures

- Sends go out one at a time per account. The anti-ban protections are off by default: no per-minute cap, no first-contact cap, no typing. Turn them on per account (`pacing` on `PATCH /v1/accounts/{accountId}`; ranges in `wuapi-rules`) before bulk, cold or marketing sends. Recommended: 12 messages per minute, 5 per minute to people who never wrote to that number, typing on.
- With a cap on, messages over the pace wait in the queue up to 1 hour (`queueTimeoutMinutes`), then fail with `error.code` `rate_limited`. Order out of the queue is not guaranteed. Faster pacing raises the chance WhatsApp restricts the number.

```ts
// Recommended protections for bulk, cold or marketing sends.
await wuapi.accounts.update(accountId, {
  pacing: { messagesPerMinute: 12, firstContactPerMinute: 5, typing: { enabled: true } },
})
// Slower and patient: 6/min, wait up to 3 hours in the queue.
await wuapi.accounts.update(accountId, { pacing: { messagesPerMinute: 6, queueTimeoutMinutes: 180 } })
await wuapi.accounts.update(accountId, { pacing: null }) // back to the defaults: every protection off
```

- A message ends `failed` with `error: {code, message}`, `code` one of `not_on_whatsapp` (no WhatsApp on that number), `rate_limited`, `account_offline` (the account was reconnecting past the offline tolerance, 3 minutes, or went down for good while the message waited) or `send_failed`. That is a webhook (`message.failed`), not an HTTP error.
- HTTP errors on the send itself: `400 invalid_request` (`details.field`), `409 account_not_ready`, `403 project_suspended`, `409 idempotency_conflict` (the same key with a different body), `429 rate_limited` (600 requests per minute per key; honor `Retry-After`).
- Check numbers before a first contact with `wuapi.contacts.check(accountId, phones)` (see `chats-contacts-profile`).

```ts
import { WuapiError } from "@wuapidev/sdk"

async function sendOnce(to: string, text: string, key: string) {
  try {
    return await wuapi.messages.send({ accountId, to, text }, { idempotencyKey: key })
  } catch (err) {
    if (err instanceof WuapiError && err.code === "account_not_ready") return null // relink first
    throw err
  }
}
```
