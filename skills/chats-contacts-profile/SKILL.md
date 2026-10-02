---
name: chats-contacts-profile
description: Chats, contacts, the account's own profile and calls in wuapi. Use when writing code that lists an account's chats or reads their unread, pinned, archived or muted state, sends read receipts, shows typing, archives, pins, mutes, marks or deletes chats, sets disappearing timers, uses WhatsApp Business labels, lists the account's address book, checks which numbers have WhatsApp, looks up contacts, pictures or business profiles, follows a contact's presence, blocks or unblocks, changes the account's name, about, picture or privacy settings, resolves contact links, or sees and rejects incoming calls.
---

# Chats, contacts, profile and calls

Everything here takes the `accountId` first and, except listing and reading chats, runs live against WhatsApp, so the account must be `ready` (else `409 account_not_ready`). A `chatId` is a contact id (E.164 like `+584241112233`, digits, or `lid:<digits>`) or a group id (`...@g.us`); a `contactId` is a contact id. Changes sync to the phone and every linked device, as if made there. Reads (check, lookup, picture, resolve) keep working for a suspended project; writes answer `403 project_suspended`. Opposites are two methods, never a boolean: `archive` / `unarchive`, `pin` / `unpin`, `mute` / `unmute`, `block` / `unblock`.

## Chats

`chats.list` returns the chats wuapi stored a message of, the one with the newest message first, and needs no connection. Each `chat` has `id` (the same value as `chatId` on its messages), `type` (`direct`, `group`, `channel`), `name` (`savedName` from the phone's address book, else the group name or the contact's `profileName`), `username`, `pictureId`, `lastMessage` (a full `message`), `lastMessageAt`, and WhatsApp's state: `unread`, `unreadCount`, `pinned`, `pinnedAt`, `archived`, `muted`, `muteExpiresAt`. wuapi takes that state from what WhatsApp syncs to the linked number (which chats are pinned, archived and muted; each chat's unread count at linking) and then follows changes as they happen (the API, the phone, another device). A value it does not know yet is `null`: treat `null` as unknown, never as `false`. `pinnedAt` is when the chat was pinned, `null` when it is not pinned or the time is unknown.

`pictureId` is the id of the chat's picture (the contact's profile picture, or the group's). It changes when the picture does, so keep the picture you downloaded and ask `contacts.getPicture(accountId, chat.id)` again only when the id differs; a group id works there too. wuapi learns it from `contact.picture_updated`, picture reads and contact lookups, never while listing, so `null` means unknown, no picture, or hidden from the account (and always for channels).

```ts
for await (const chat of wuapi.chats.list(accountId, { unread: true })) { // also archived, type, q (search), limit
  console.log(chat.name ?? chat.id, chat.unreadCount, chat.lastMessage?.text)
}
const one = await wuapi.chats.get(accountId, "+584241112233") // 404 not_found when wuapi holds no message of it
const thread = wuapi.messages.list({ accountId, chatId: one.id }) // the conversation, newest first
```

`archived: false` and `unread: false` include the chats whose state is `null`. With `q` (the name, the number, the username or words of recent messages) results come best match first instead of by date.

```ts
import { Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi() // reads WUAPI_API_KEY
const chat = "+584241112233"

const read = await wuapi.chats.sendReadReceipts(accountId, chat) // blue ticks for every unread inbound message stored, up to 500
await wuapi.chats.sendReadReceipts(accountId, chat, { messageIds: [messageId] }) // or specific wuapi message ids

await wuapi.chats.sendPresence(accountId, chat, "typing") // "recording", "paused"
await wuapi.chats.archive(accountId, chat) // unarchive(accountId, chat) undoes it
await wuapi.chats.pin(accountId, chat)
await wuapi.chats.mute(accountId, chat, { durationSeconds: 28800 }) // no duration or 0: until unmuted
await wuapi.chats.markUnread(accountId, chat) // the unread badge, as the phone's chat list does; sends no receipts
await wuapi.chats.setDisappearingTimer(accountId, chat, 604800) // 0, 86400, 604800 or 7776000
await wuapi.chats.delete(accountId, chat, { deleteMedia: true }) // on the devices; messages stored in wuapi stay
console.log(read.messageCount)
```

| SDK | REST (under `/v1/accounts/{accountId}`) |
|---|---|
| `chats.list(accountId, { archived?, unread?, type?, q?, limit? })` | `GET /chats`, a list of `chat` |
| `chats.get(accountId, chatId)` | `GET /chats/{chatId}`, a `chat` |
| `chats.sendReadReceipts(accountId, chatId, { messageIds? })` | `POST /chats/{chatId}/read`, returns a `chat_read` `{accountId, chatId, messageCount}` |
| `chats.sendPresence(accountId, chatId, state)` | `POST /chats/{chatId}/presence` `{state}` |
| `chats.markRead` / `markUnread` | `POST /chats/{chatId}/mark-read`, `/mark-unread` |
| `chats.archive` / `unarchive`, `pin` / `unpin` | `POST /chats/{chatId}/archive`, `/unarchive`, `/pin`, `/unpin` |
| `chats.mute(accountId, chatId, { durationSeconds? })` / `unmute` | `POST /chats/{chatId}/mute`, `/unmute` |
| `chats.delete(accountId, chatId, { deleteMedia? })` | `DELETE /chats/{chatId}` |
| `chats.setDisappearingTimer(accountId, chatId, durationSeconds)` | `PUT /chats/{chatId}/disappearing-timer` `{durationSeconds}` |
| `accounts.setDefaultDisappearingTimer(accountId, durationSeconds)` | `PUT /disappearing-timer` (the default for new chats) |

Each change shows in the chat's state (`chats.get`) at once. Changes made on the phone arrive as `chat.updated` (`data.object.change`: `archive`, `pin`, `mute`, `read`, `delete`, `clear`, `star`). Typing in a chat arrives as `chat.presence_updated`.

## Labels (WhatsApp Business only)

On a number linked from the consumer app these answer `400 not_supported`. There is no endpoint that lists labels: after linking, WhatsApp sends the existing labels, and every later change, as `label.updated`. Keep your own copy from those events.

```ts
const label = await wuapi.labels.upsert(accountId, "3", { name: "Paid", color: 5 }) // create or edit; color is WhatsApp's palette index 0-19
await wuapi.chats.addLabel(accountId, "+584241112233", label.id)
await wuapi.messages.removeLabel(messageId, label.id)
await wuapi.labels.delete(accountId, label.id)
```

REST: `PUT` and `DELETE /v1/accounts/{accountId}/labels/{labelId}` (`PUT` takes `{name, color?}` and returns the `label`), `POST /v1/accounts/{accountId}/chats/{chatId}/labels` and `POST /v1/messages/{messageId}/labels` with `{labelId}`, `DELETE /v1/accounts/{accountId}/chats/{chatId}/labels/{labelId}` and `DELETE /v1/messages/{messageId}/labels/{labelId}`.

## Contacts

`contacts.list` is the address book of the linked phone as WhatsApp synced it to wuapi, ordered by saved name, and needs no connection. It holds the contacts the phone has a saved name (or a business name) for: it fills in when the number is linked (allow a few minutes) and follows every contact added, renamed or deleted on the phone. People the account only chatted with are not in it; they are in `chats.list`. Each `contact` has `id`, `phone` (`null` when WhatsApp hides the number and only `lid` is known), `lid`, `savedName`, `profileName`, `businessName`, and the `username` and `pictureId` wuapi has seen so far. `about` and `deviceCount` are `null` there: `contacts.lookup` asks WhatsApp for those, and its answer leaves `savedName` and `profileName` `null`.

```ts
for await (const contact of wuapi.contacts.list(accountId, { q: "maria" })) { // q searches names, usernames and numbers
  console.log(contact.savedName, contact.phone ?? contact.lid, contact.pictureId)
}
const saved = await wuapi.contacts.get(accountId, "+584241112233") // 404 not_found when the phone has not saved it

// Which numbers have WhatsApp, 1 to 50 per call. Do this before a first contact.
const checks = await wuapi.contacts.check(accountId, ["+584241112233", "+584141234567"])
const reachable = checks.filter((c) => c.onWhatsApp).map((c) => c.contactId)

const contacts = await wuapi.contacts.lookup(accountId, ["+584241112233"]) // about, pictureId, businessName, deviceCount; 1 to 50
const pic = await wuapi.contacts.getPicture(accountId, "+584241112233", { preview: true }) // 404 picture_not_found when none or hidden
const biz = await wuapi.contacts.getBusinessProfile(accountId, "+584241112233") // 404 business_profile_not_found for consumer accounts
await wuapi.contacts.subscribePresence(accountId, "+584241112233") // then contact.presence_updated webhooks
console.log(reachable, contacts[0]?.about, pic.url, biz.categories)
```

| SDK | REST (under `/v1/accounts/{accountId}`) |
|---|---|
| `contacts.list(accountId, { q?, limit? })` | `GET /contacts`, a list of `contact` |
| `contacts.get(accountId, contactId)` | `GET /contacts/{contactId}`, a `contact` |
| `contacts.check(accountId, phones)` | `POST /contacts/check` `{phones}` → list of `contact_check` `{phone, onWhatsApp, contactId, businessName}` |
| `contacts.lookup(accountId, contactIds)` | `POST /contacts/lookup` `{contactIds}` → list of `contact` |
| `contacts.getPicture(accountId, contactId, { preview? })` | `GET /contacts/{contactId}/picture` → `picture` `{id, url, preview}`; `contactId` may be a group id |
| `contacts.getBusinessProfile(accountId, contactId)` | `GET /contacts/{contactId}/business-profile` (address, email, categories, hours) |
| `contacts.subscribePresence(accountId, contactId)` | `POST /contacts/{contactId}/subscribe-presence` |
| `contacts.block` / `unblock` | `POST /contacts/{contactId}/block`, `/unblock` |
| `contacts.listBlocked(accountId)` | `GET /blocklist` → list of `blocked_contact` `{contactId}` |
| `contacts.getLink(accountId)` / `resetLink` | `GET /contact-link`, `POST /contact-link/reset`; the account's own contact link, `{url}` |
| `contacts.resolveLink(accountId, { kind, code })` | `POST /links/resolve`; `kind` `contact` or `business`; `404 link_not_found` |

Contact changes arrive as `contact.updated` (about text), `contact.picture_updated`, `contact.presence_updated` (subscribed contacts) and `blocklist.updated` (with `refetch: true`, read the list again).

```ts
await wuapi.contacts.block(accountId, "+584241112233")
const blocked = await wuapi.contacts.listBlocked(accountId).toArray() // [{ contactId }]
const who = await wuapi.contacts.resolveLink(accountId, { kind: "business", code: "https://wa.me/message/ABCDEF123" })
console.log(blocked, who.contactId, who.businessName, who.prefilledText)
```

## The account's own profile and privacy

```ts
await wuapi.profile.update(accountId, { name: "Acme Support", about: "Mon-Fri 9-18" }) // name up to 25, about up to 139
const picture = await wuapi.profile.setPicture(accountId, { url: "https://example.com/logo.jpg" }) // JPEG; or { base64 }
await wuapi.profile.deletePicture(accountId)

const privacy = await wuapi.privacy.update(accountId, { readReceipts: "none", lastSeen: "contacts" }) // returns every setting
const storyAudience = await wuapi.privacy.getStoryPrivacy(accountId) // who sees the account's stories
console.log(picture.id, privacy.lastSeen, storyAudience.lists)
```

REST: `PATCH /v1/accounts/{accountId}/profile` (`204`), `PUT` and `DELETE /v1/accounts/{accountId}/profile/picture`, `GET` and `PATCH /v1/accounts/{accountId}/privacy` (any subset of the settings; returns the `privacy_settings`), `GET /v1/accounts/{accountId}/privacy/stories`.

| privacy setting | values |
|---|---|
| `groupAdd`, `lastSeen`, `stories`, `profile` | `all`, `contacts`, `contact_blacklist`, `none` |
| `readReceipts` | `all`, `none` |
| `online` | `all`, `match_last_seen` |
| `callAdd` | `all`, `known` |
| `messages` | `all`, `contacts` |

## Calls

wuapi does not answer or place calls. It reports them and can turn them down.

```ts
// Reject every incoming call as it rings and reply to the caller (up to 1,000 characters).
await wuapi.accounts.update(accountId, { rejectCalls: true, rejectCallsMessage: "We do not take calls here. Write to us instead." })
```

```ts
import { verifyWebhook, Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi()

// Or decide per call, from the call.received webhook.
export async function POST(request: Request) {
  const event = await verifyWebhook(await request.text(), request.headers.get("wuapi-signature"), process.env.WUAPI_WEBHOOK_SECRET!)
  if (event.type === "call.received") {
    const call = event.data.object
    if (call.id && call.from) await wuapi.calls.reject(call.accountId, call.id, { from: call.from })
  }
  return new Response(null, { status: 204 })
}
```

- The automatic reply goes through the account's pacing and is skipped for group calls.
- `call.received` carries `startedAt`; `call.ended` carries `endedAt` and `endReason`; `video` is reliable on `call.received` only.
- REST: `PATCH /v1/accounts/{accountId}` `{rejectCalls, rejectCallsMessage}` and `POST /v1/accounts/{accountId}/calls/{callId}/reject` `{from}`.

## Favorite stickers

The star tab of WhatsApp's sticker picker, which WhatsApp syncs between the phone and its linked devices. All under `/v1/accounts/{accountId}`.

| SDK | REST |
|---|---|
| `favoriteStickers.list(accountId, { limit?, cursor? })` | `GET /stickers/favorites` → list of `favorite_sticker` `{id, mimeType, animated, lottie, width, height, size, emojis, favoritedAt, media: {url, downloaded}}`, newest first; stored by wuapi, no `ready` account needed |
| `favoriteStickers.getMedia(accountId, stickerId)` | `GET /stickers/favorites/{stickerId}/media` → `{url, mimeType, size}`; fetches the file from WhatsApp the first time (account `ready`), then serves the stored copy; `410 media_expired` when WhatsApp no longer has it |
| `favoriteStickers.add(accountId, { messageId })` or `{ uploadId }` | `POST /stickers/favorites` → the `favorite_sticker` (`201`); a sticker message of the account, or a WebP upload (`image/webp`, at most 2 MB) |
| `favoriteStickers.remove(accountId, stickerId)` | `DELETE /stickers/favorites/{stickerId}` → `204` |

- The list is empty until wuapi's first read of it, a minute or two after a newly linked account is `ready`; `sticker.favorites_updated` says when it changes (`reason` `added`, `removed` or `synced`).
- `media.downloaded: false`: `media.url` needs the API key and fetches the file on first use. `animated` and `emojis` are `null` until then. Fetch the files a picker shows, not the whole list (60 first downloads per minute per account, shared with message media).
- Being turned on account by account: until an account has them, the list is empty and `add` / `remove` answer `400 not_supported`.
- Adding and removing write to WhatsApp (account `ready`), so the phone shows the change. Both are safe to repeat. At most 30 changes per minute per account.

```ts
const stickers = await wuapi.favoriteStickers.list(accountId).toArray()
const first = stickers[0]
if (first && !first.media.downloaded) {
  const file = await wuapi.favoriteStickers.getMedia(accountId, first.id)
  console.log(file.url) // a direct URL, no API key needed
}
```

## Extras

`stickerPacks.get(accountId, stickerPackId)` (`GET /v1/accounts/{accountId}/sticker-packs/{stickerPackId}`), `orders.get(accountId, orderId, { token })` for a catalog order a customer sent (`GET /v1/accounts/{accountId}/orders/{orderId}?token=`; the token comes with the order message; amounts are `subtotalCents`, `totalCents` with `currency`), and `bots.list(accountId)` for WhatsApp's AI bot directory (`GET /v1/accounts/{accountId}/bots`).
