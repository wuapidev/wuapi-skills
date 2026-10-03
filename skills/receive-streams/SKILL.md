---
name: receive-streams
description: Receive wuapi events live with Streams when the code has no public HTTPS endpoint for Webhooks. Use when a client must get inbound WhatsApp messages, delivery and read receipts or account status changes as they happen without exposing a URL (local development, a desktop or CLI app, a worker behind NAT, an agent), when choosing between Webhooks and Streams, when handling Last-Event-ID resume and reset frames, or when someone asks to poll wuapi for new events.
---

# Receive events with Streams

Streams delivers the same events as Webhooks, over one long-lived HTTPS request your code opens: `GET https://stream.wuapi.dev/v1/events/stream`. Each event arrives as a Server-Sent Events frame whose `data` is the webhook envelope, unchanged: `{id, object: "event", type, createdAt, organizationId, projectId, data: {object}}`.

## Webhooks or Streams

| You have | Use |
|---|---|
| A server with a public HTTPS endpoint | Webhooks (signed, six attempts): the `receive-webhooks` skill |
| No public endpoint: local development, a desktop or CLI app, a worker behind NAT, an agent | Streams |
| History, or catching up after a `reset` | REST: `GET /v1/messages`, `GET /v1/accounts/{accountId}/chats` |

Never poll for events. Polling with 2 requests every 4 seconds is 43,200 requests a day against the key's limit of 600 requests a minute, and an event still arrives up to 4 seconds late. A stream connection costs one connect attempt and then no request at all.

## Workflow

1. Send the key in the `Authorization: Bearer $WUAPI_API_KEY` header. A key in the URL is refused with `401`. The key never goes into front-end code.
2. Read the response as `text/event-stream`. Every stream starts with `retry: 3000`. An event is a frame with `id` (an opaque cursor), `event` (the type, such as `message.received`) and `data` (one JSON line). A line that starts with a colon is a heartbeat, sent every 15 seconds when nothing else is; it may carry an `id` too.
3. Keep the last `id`. After a disconnect, wait the `retry` time and reconnect with `Last-Event-ID` set to it (clients that cannot set a header can pass `?cursor=<id>`). Within 30 minutes wuapi replays what you missed, then goes live.
4. Deduplicate on the event id (`evt_...` inside `data`): delivery is at-least-once, and a replay can repeat an event you already handled.
5. A frame named `reset` means the cursor is too old or unknown. Resync through REST, then carry on with the live stream.
6. A connection without `Last-Event-ID` starts from now. Events before it are read through REST.

```ts
const STREAM_URL = "https://stream.wuapi.dev/v1/events/stream"
const seen = new Set<string>()
let lastEventId = ""
let retryMs = 3000

function resync(): void {
  // The cursor is too old or unknown: read what you missed through REST (GET /v1/messages), then carry on.
  lastEventId = ""
}

function handleFrame(frame: string): void {
  const field = (name: string) => frame.split("\n").find((line) => line.startsWith(name + ":"))?.slice(name.length + 1).trim()
  const id = field("id")
  if (id) lastEventId = id
  const retry = Number(field("retry"))
  if (retry > 0) retryMs = retry
  const data = field("data")
  if (!data) return // a heartbeat, or the retry line that opens every stream
  if (field("event") === "reset") return resync()
  const event = JSON.parse(data) as { id: string; type: string }
  if (seen.has(event.id)) return // a replay can repeat an event: deduplicate on its id
  seen.add(event.id)
  console.log(event.type, event.id)
}

async function readStream(): Promise<void> {
  const headers: Record<string, string> = { Authorization: "Bearer " + process.env.WUAPI_API_KEY }
  if (lastEventId) headers["Last-Event-ID"] = lastEventId
  const res = await fetch(STREAM_URL, { headers })
  if (!res.ok || !res.body) throw new Error("The stream answered " + res.status)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += value
    let end = buffer.indexOf("\n\n")
    while (end !== -1) {
      handleFrame(buffer.slice(0, end))
      buffer = buffer.slice(end + 2)
      end = buffer.indexOf("\n\n")
    }
  }
}

for (;;) {
  try {
    await readStream()
  } catch (error) {
    console.error(error)
  }
  await new Promise((resolve) => setTimeout(resolve, retryMs)) // wait the retry time the stream sent
}
```

To watch it work from a terminal, with no code: `npx @wuapidev/cli events stream` prints one JSON event per line, reconnects by itself and prints an event once. The same with curl:

```bash
curl -N https://stream.wuapi.dev/v1/events/stream \
  -H "Authorization: Bearer $WUAPI_API_KEY"
```

## The contract

| Topic | Rule |
|---|---|
| Frames | `id`, `event`, `data`; `: ping` every 15 seconds; `retry: 3000` first |
| Resume | `Last-Event-ID` header or `cursor` query parameter; replay for 30 minutes |
| `reset` | `event: reset` with `data: {"reason": ...}`, the reason being `cursor_expired`, `cursor_unknown` or `not_logged` (nothing was kept for that cursor). No replay follows, and the stream continues live |
| Filters | `types` and `accounts` query parameters, at most 50 values each, repeated or comma separated. A presence type (`chat.presence_updated`, `contact.presence_updated`), `webhook.test` or an unknown type is `400` |
| Scope | Like REST: an organization key sees every project, a project key its own; `Wuapi-Project` scopes an organization key. A project that is not yours is `404 project_not_found` |
| Limits | The Free plan allows 3 open stream connections per organization, across keys and projects; a fourth is `429 stream_connection_limit`. 30 connect attempts a minute per organization (`429 rate_limited`), apart from the 600 requests a minute of REST. Events on an open stream cost nothing |
| Closing | The server may close a stream at any time (a deploy, a long-lived connection). It sends `retry` first: reconnect with the last id and nothing is lost |

Errors before the stream opens use the usual `{code, message, details?}` body: `400 invalid_request`, `401 unauthorized`, `403 organization_suspended`, `404 project_not_found`, `429`, and `503 service_unavailable`. A `429` and a `503` carry `Retry-After` (seconds): wait it, do not retry in a loop.

## A web app

A browser's `EventSource` cannot set the `Authorization` header, and the key must not go into a URL. A web app goes through your backend: the backend opens the stream with the key and passes the events on to the page (its own SSE route or a WebSocket). Never ship the key to the browser.

## Not on Streams

- Presence events (`chat.presence_updated`, `contact.presence_updated`) are never sent.
- No history on connect, no delivery guarantee past 30 minutes: that is REST's job.
