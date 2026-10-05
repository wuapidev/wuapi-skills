---
name: groups-and-channels
description: Manage WhatsApp groups, communities and channels through a wuapi account. Use when writing code that lists, creates or edits groups, adds, removes, promotes or demotes participants, handles join requests and invite links, sets group pictures or admin-only settings, builds communities with subgroups, or follows, reads, reacts to, creates and posts to WhatsApp channels.
---

# Groups, communities and channels

All of these run live against WhatsApp through a connected account, so the account must be `ready` (else `409 account_not_ready`). Group ids end in `@g.us`; channel ids end in `@newsletter`. Participants are contact ids (E.164 like `+584241112233`, or `lid:<digits>`). Send to a group, or post to a channel you administer, by using its id as `to` in `messages.send` (see `send-message`).

The account is a regular group member, so this is not Meta's official Groups API (which, per its docs, caps a group at 8 participants, joins people by invite link only, needs an Official Business Account and does not support editing or deleting). Here you can add participants directly, groups follow WhatsApp's own size limits, and you can act in groups the number was already in. Adding someone can still fail on their privacy settings: that result carries the error `privacy_restricted` and an `inviteCode` to send them instead.

## Groups

```ts
import { Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi() // reads WUAPI_API_KEY

// Read live from WhatsApp, paginated like every list.
for await (const g of wuapi.groups.list(accountId)) console.log(g.id, g.name, g.participants.length)

const group = await wuapi.groups.create(accountId, { name: "Night shift", participants: ["+584241112233", "+584141234567"] })

await wuapi.groups.update(accountId, group.id, {
  name: "Night shift (Caracas)",
  description: "Handover notes only.",
  announce: true, // only admins send
  locked: true, // only admins edit the info
  joinApproval: true, // new members need approval
  memberAddMode: "admins", // or "all_members"
})

const results = await wuapi.groups.addParticipants(accountId, group.id, ["+584121112222"])
for (const r of results) {
  // A privacy setting can block a direct add: send them r.inviteCode instead.
  if (r.error) console.log(r.contactId, r.error, r.inviteCode)
}
await wuapi.groups.promoteParticipants(accountId, group.id, ["+584241112233"])

await wuapi.messages.send({ accountId, to: group.id, text: "Welcome to the night shift." })
```

| SDK | REST (under `/v1/accounts/{accountId}`) |
|---|---|
| `groups.list(accountId)` | `GET /groups` (list, paginated) |
| `groups.create(accountId, { name, participants?, community?, communityId? })` | `POST /groups` (201) |
| `groups.get(accountId, groupId)` | `GET /groups/{groupId}` |
| `groups.update(accountId, groupId, {...})` | `PATCH /groups/{groupId}` |
| `groups.addParticipants` / `removeParticipants` / `promoteParticipants` / `demoteParticipants` | `POST /groups/{groupId}/participants/add`, `/remove`, `/promote`, `/demote` with `{contactIds}`; one `participant_result` per contact |
| `groups.leave(accountId, groupId)` | `POST /groups/{groupId}/leave` (204) |
| `groups.setPicture(accountId, groupId, { url })` / `deletePicture` | `PUT` / `DELETE /groups/{groupId}/picture`; JPEG, `{url}` (HTTPS) or `{base64}`; `PUT` returns a `picture` |

The group: `{object: "group", id, accountId, name, description, ownerId, community, communityId, default, locked, announce, participants: [{contactId, name, role}], createdAt}`, with `role` one of `member`, `admin`, `owner`. A `participant_result` is `{object, contactId, error, inviteCode}`; `error` is `null` when it worked.

## Invite links and joining

```ts
const link = await wuapi.groups.getInviteLink(accountId, groupId) // { url: "https://chat.whatsapp.com/..." }
const fresh = await wuapi.groups.resetInviteLink(accountId, groupId) // revokes the old one

const preview = await wuapi.groups.getInvite(accountId, "AbCdEf123") // the group behind a code, without joining
const joined = await wuapi.groups.join(accountId, "https://chat.whatsapp.com/AbCdEf123") // code or link; 404 invite_not_found for a dead one
console.log(link.url, fresh.url, preview.name, joined.groupId)
```

REST: `GET /v1/accounts/{accountId}/groups/{groupId}/invite-link`, `POST /v1/accounts/{accountId}/groups/{groupId}/invite-link/reset`, `GET /v1/accounts/{accountId}/groups/invites/{code}`, `POST /v1/accounts/{accountId}/groups/join` with `{code}` (the code or the full link), which returns a `group_join`: `{object, accountId, groupId}`.

## Join requests

With `joinApproval` on, requests wait for an admin.

```ts
const pending = await wuapi.groups.listJoinRequests(accountId, groupId).toArray() // [{ contactId, requestedAt }]
await wuapi.groups.approveJoinRequests(accountId, groupId, pending.map((r) => r.contactId))
```

REST: `GET /v1/accounts/{accountId}/groups/{groupId}/join-requests`, `POST .../join-requests/approve` and `POST .../join-requests/reject` with `{contactIds}`. New and withdrawn requests arrive as `group.join_requested` and `group.join_request_revoked`.

## Communities

A community is a group with `community: true` that links other groups, its subgroups.

```ts
const community = await wuapi.groups.create(accountId, { name: "Riverside projects", community: true }) // participants optional
await wuapi.groups.linkSubgroup(accountId, community.id, groupId)
const subgroups = await wuapi.groups.listSubgroups(accountId, community.id).toArray() // [{ id, name, default }]
const everyone = await wuapi.groups.listCommunityParticipants(accountId, community.id).toArray() // [{ contactId }]
await wuapi.groups.unlinkSubgroup(accountId, community.id, groupId)
console.log(subgroups.length, everyone.length)
```

REST, under `/v1/accounts/{accountId}/groups/{groupId}`: `GET` and `POST .../subgroups` (`{groupId}`), `DELETE .../subgroups/{subgroupId}`, `GET .../community-participants`.

Every group says where it belongs: `communityId` is its community's id (`null` when it is in none, and on a community itself) and `default` is `true` for the community's announcement group. `groups.list` carries both, so one call is enough to show an account's groups by community:

```ts
const groups = await wuapi.groups.list(accountId).toArray()
const communities = groups.filter((g) => g.community)
const subgroupsOf = (communityId: string) => groups.filter((g) => g.communityId === communityId)
console.log(communities.map((c) => [c.name, subgroupsOf(c.id).length]))
```

Create a group directly inside a community with `communityId` (not together with `community: true`, which is `400 invalid_request`; `400 not_supported`, with nothing created, for an account that cannot do it yet):

```ts
const volunteers = await wuapi.groups.create(accountId, { name: "Volunteers", participants: ["+584121234567"], communityId: "120363055500000000@g.us" })
console.log(volunteers.communityId) // "120363055500000000@g.us"
```

## Group events

- `group.joined`: the account was added to a group or created one; `data.object` is the group.
- `group.updated`: participants, admins, name, description or settings changed; `data.object` is a `group_change` with `added`, `removed`, `promoted`, `demoted`, `name`, `description`, `locked`, `announce` and `changes`, the list of what changed. A subgroup linked to a community or unlinked from it arrives here too: `changes` has `subgroups_linked` or `subgroups_unlinked`, `linked` / `unlinked` are the subgroups' ids and `communityId` is their community (`groupId` itself, or the other group when WhatsApp reports the change on the subgroup).
- `group.join_requested` / `group.join_request_revoked`: `data.object` is a `group_join_request` `{groupId, contactId, requestedAt}`.

## Group errors

`403 whatsapp_forbidden` (usually the account is not an admin), `404 group_not_found` (not a member, or no such group), `404 invite_not_found` (revoked or unknown invite), `502 whatsapp_error` (WhatsApp rejected or did not answer).

## Channels

WhatsApp channels are one-way broadcasts. Read, follow and react with any account; post only to a channel the account administers.

```ts
const channels = await wuapi.channels.list(accountId).toArray() // followed or owned
const created = await wuapi.channels.create(accountId, { name: "Store updates", description: "Hours and new stock." })
const byInvite = await wuapi.channels.getInvite(accountId, "0029VaAbCdEf") // the code of https://whatsapp.com/channel/<code>

await wuapi.channels.follow(accountId, byInvite.id)
await wuapi.channels.mute(accountId, byInvite.id)

const page = await wuapi.channels.listMessages(accountId, byInvite.id, { limit: 20 }).page() // newest first
const newest = page.items[0]
if (newest) {
  await wuapi.channels.react(accountId, byInvite.id, newest.id, "\u{1F525}")
  await wuapi.channels.markViewed(accountId, byInvite.id, [newest.id])
}

// Post (admins): a normal send with the channel id as `to`; text, image, video or document. Queued and paced.
await wuapi.messages.send({ accountId, to: created.id, type: "image", text: "New stock", media: { url: "https://example.com/shelf.jpg" } })
await wuapi.channels.unfollow(accountId, byInvite.id)
console.log(channels.length)
```

| SDK | REST (under `/v1/accounts/{accountId}`) |
|---|---|
| `channels.list(accountId)` | `GET /channels` (list) |
| `channels.create(accountId, { name, description?, pictureBase64? })` | `POST /channels` (201) |
| `channels.get(accountId, channelId)` | `GET /channels/{channelId}` |
| `channels.getInvite(accountId, code)` | `GET /channels/invites/{code}` |
| `channels.follow` / `unfollow` | `POST /channels/{channelId}/follow`, `POST /channels/{channelId}/unfollow` |
| `channels.mute` / `unmute` | `POST /channels/{channelId}/mute`, `POST /channels/{channelId}/unmute` |
| `channels.listMessages(accountId, channelId, { limit?, cursor? })` | `GET /channels/{channelId}/messages` (list of `channel_message`) |
| `channels.react(accountId, channelId, channelMessageId, emoji)` | `POST /channels/{channelId}/messages/{channelMessageId}/react`; `""` removes |
| `channels.markViewed(accountId, channelId, channelMessageIds)` | `POST /channels/{channelId}/mark-viewed`; 1 to 100 ids |
| `messages.send({ accountId, to: channelId, ... })` | `POST /v1/messages` (202) |

The channel: `{object: "channel", id, accountId, name, description, inviteCode, subscriberCount, verified, status, role, muted, pictureUrl, previewUrl, createdAt}`. A `channel_message` is `{object, id, accountId, channelId, type, text, viewCount, reactions, sentAt}`, read from WhatsApp and not stored. New posts in followed channels arrive as `channel.message_received`, new view and reaction counts as `channel.message_updated`; follow, unfollow and mute changes as `channel.updated`. Posts you make are stored as outbound messages whose `chatId` is the channel id and `chatType` is `channel`. `404 channel_not_found` when it does not exist.
