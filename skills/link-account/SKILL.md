---
name: link-account
description: Connect a WhatsApp number to wuapi as a linked device, by QR code or by 8-character pairing code, and keep it connected. Use when writing code that creates accounts, shows a QR code or pairing code to a phone owner, waits for an account to become ready, picks the proxy location (the country and city the number's traffic exits from), handles disconnects, or reconnects, logs out or deletes an account.
---

# Link a WhatsApp number (account)

An **account** is one WhatsApp number linked to wuapi as a linked device, like WhatsApp Web. The phone keeps working normally; wuapi becomes one more device on it. Everything else (sending, groups, chats) needs the account in status `ready`.

An organization without a paid subscription is on the Free plan: 1 number, 2,000 messages and 0.5 GB of proxy traffic a month, no card. Its one account works fully (sends, webhooks, every call); a second answers `402 upgrade_required` (`details.maxAccounts`, `details.upgradeUrl`, and `details.accountId` when the first is still linking) until the organization upgrades in Billing. On Free an account that has not linked within 15 minutes stops (`disconnectReason: link_timeout`); reconnect for a new code. At a monthly Free limit the account pauses (`disconnectReason: free_limit_reached`, the device stays linked) and reconnects on its own when the month ends (UTC) or on upgrade. In a project scope the account lands in that project; `403 project_limit_reached` when the project is at `maxAccounts`, `403 project_suspended` when it is suspended.

If someone else (your customer) must link their own number, do not build this flow: send them an invitation, a hosted page that does it. See the `projects-and-invitations` skill.

## First: choose a proxy location

Every account connects through its own residential proxy, metered (each billable account includes 0.5 GB a month, pooled; past that $0.99 per GB), and `proxyLocation: {country, city}` is **required** when you create it. Pick the country of the phone number, so the number keeps a consistent network identity, and a city from `GET /v1/proxy-locations?country=..`: a list of `proxy_location` objects `{object, country, countryName, city, cityName}`, ordered by country name, then by city population (largest first). `country` is ISO 3166-1 alpha-2 (`"VE"`), `city` the city code from `GET /v1/proxy-locations`: lowercase, one word, accents kept (`"caracas"`, `"newyorkcity"`, `"bogotá"`); the unaccented form is accepted and stored with its accents. A missing `proxyLocation` answers `400 invalid_request` (`details.field: "proxyLocation"`); one that is not in the list answers `400 unsupported_proxy_location`. The account returns it as `proxyLocation`.

To turn a city someone typed into a pair, search instead of listing: `?q=` (1 to 100 characters) matches the city name, the city code, the country name and the ISO code, ignoring case and accents, best first (exact, then prefix, then a later word, then anywhere; ties go to the bigger city). `q=bogo` returns Bogotá first, `q=sao` São Paulo, `q=new york` New York City, `q=cl` every Chilean city. It combines with `country` and pages like any list. People can browse the same list without a key at https://wuapi.dev/proxy-locations.

```ts
import { Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi() // reads WUAPI_API_KEY

// Every city available in Venezuela; show them to the user, or take the first.
const cities = await wuapi.proxyLocations.list({ country: "VE" }).toArray()
for (const l of cities) console.log(l.country, l.city, l.cityName)

// Or search: the first match for what the user typed.
const [bogota] = await wuapi.proxyLocations.list({ q: "bogota" }).toArray(1)
// bogota.country === "CO", bogota.city === "bogotá"
```

```bash
curl "https://api.wuapi.dev/v1/proxy-locations?country=VE" \
  -H "Authorization: Bearer $WUAPI_API_KEY"

curl "https://api.wuapi.dev/v1/proxy-locations?q=sao" \
  -H "Authorization: Bearer $WUAPI_API_KEY"
```

Invitations can preset it or let the invitee pick it on their page (see `projects-and-invitations`).

## Workflow: link by QR code

1. `POST /v1/accounts` with `{proxyLocation, name?}`. Returns `201` with the account (`object: "account"`) in `initializing`.
2. Wait until `status` is `qr_ready`: `qrCodeUrl` then holds a PNG data URL you can put straight into an `<img>`.
3. The phone owner opens WhatsApp, Settings, Linked devices, Link a device, and scans it. The QR code rotates while it waits: always show the latest one.
4. The account goes `authenticating`, then `ready`. `phone` and `profileName` are set; the account is billable from its first `ready`.

```ts
const account = await wuapi.accounts.create({
  name: "Support line",
  proxyLocation: { country: "VE", city: "caracas" },
})

// Resolves with the account once `qrCodeUrl` is set (or at once if it is already ready).
const withQr = await wuapi.accounts.waitForQrCode(account.id)
console.log("Scan:", withQr.qrCodeUrl) // data:image/png;base64,...

// Polls until ready; onQrCode fires for every new QR code while it waits.
const ready = await wuapi.accounts.waitUntilReady(account.id, {
  onQrCode: (qrCodeUrl) => console.log("New QR code:", qrCodeUrl),
  timeoutMs: 180_000,
})
console.log("Linked", ready.phone, ready.profileName)
```

The wait helpers poll `GET /v1/accounts/{accountId}` every `intervalMs` (default 2000) until `timeoutMs` (default 180000). They throw `WuapiError` with code `account_failed` when the account reaches `failed`, and `wait_timeout` on timeout; both carry the last account in `details.account`. They also accept an `AbortSignal` as `signal`.

Without the SDK, poll `GET /v1/accounts/{accountId}` yourself, or subscribe to the `account.qr_code_issued` webhook. It fires once, when the account *enters* `qr_ready`, not on every rotation: keep reading `qrCodeUrl` from the account while you display it.

```bash
curl -X POST https://api.wuapi.dev/v1/accounts \
  -H "Authorization: Bearer $WUAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: onboarding-7741" \
  -d '{ "name": "Support line", "proxyLocation": { "country": "VE", "city": "caracas" } }'

curl https://api.wuapi.dev/v1/accounts/$ACCOUNT_ID \
  -H "Authorization: Bearer $WUAPI_API_KEY"
```

## Workflow: link by pairing code

Use it when the person cannot scan a screen, for example when your UI runs on the same phone. They type an 8-character code (`XXXX-XXXX`) in WhatsApp, Settings, Linked devices, Link a device, **Link with phone number instead**.

```ts
// Create the account already set to pair with that number...
const account = await wuapi.accounts.create({
  name: "Field phone",
  proxyLocation: { country: "VE", city: "caracas" },
  pairingPhone: "+584121234567",
})
const withCode = await wuapi.accounts.waitForPairingCode(account.id)
console.log("Type on the phone:", withCode.pairingCode, "until", withCode.pairingCodeExpiresAt)

// ...or ask for a code for an account that is not linked yet.
const pairing = await wuapi.accounts.createPairingCode(account.id, { phone: "+584121234567" })
console.log(pairing.code, pairing.expiresAt)

// A code lives about 160 seconds (WhatsApp's own lifetime). New codes appear while waiting.
await wuapi.accounts.waitUntilReady(account.id, { onPairingCode: (code) => console.log("New code:", code) })
```

- `pairingPhone` and `createPairingCode({ phone })` take the number being linked, in E.164 or digits.
- With `pairingPhone`, the code is exposed as `account.pairingCode` and `account.pairingCodeExpiresAt` instead of `qrCodeUrl` (which stays `null`), and the `account.pairing_code_issued` webhook fires each time the code changes.
- `POST /v1/accounts/{accountId}/pairing-code` `{phone}` returns `201` with a `pairing_code`: `{object, accountId, code, expiresAt}`. On an account that is already `ready` it answers `409 already_linked`.

## Statuses

| status | meaning |
|---|---|
| `initializing` | the session is starting |
| `qr_ready` | waiting for the scan or the code; `qrCodeUrl` or `pairingCode` is set |
| `authenticating` | the phone accepted the link and is completing it |
| `ready` | linked; you can send |
| `disconnected` | the connection dropped; `disconnectReason` says why; most reasons reconnect on their own |
| `failed` | stopped and will not recover on its own; reconnect to start again |

`disconnectReason` values that do **not** reconnect automatically: `logged_out` (the device was removed on the phone), `connection_replaced`, `temporary_ban`, `client_outdated`. After `qr_timeout` or `logged_out`, reconnect to get a fresh QR code.

Webhooks for the transitions, each with the account as `data.object`: `account.qr_code_issued`, `account.pairing_code_issued`, `account.connected` (reached `ready`), `account.disconnected`, `account.failed`. Each fires only on a real transition. Deleting an account fires nothing.

```ts
import { verifyWebhook } from "@wuapidev/sdk"

export async function POST(request: Request) {
  const event = await verifyWebhook(await request.text(), request.headers.get("wuapi-signature"), process.env.WUAPI_WEBHOOK_SECRET!)
  if (event.type === "account.disconnected" && event.data.object.disconnectReason === "logged_out") {
    // The owner removed the device on the phone: it will not come back by itself.
    console.log("Relink needed for", event.data.object.id)
  }
  return new Response(null, { status: 204 })
}
```

## Operations

| SDK | REST | effect |
|---|---|---|
| `accounts.list({ projectId? })` | `GET /v1/accounts` | paginated; `projectId` filter with an organization key |
| `accounts.get(id)` | `GET /v1/accounts/{accountId}` | current status, `qrCodeUrl`, `pairingCode`, `phone` |
| `accounts.update(id, { name })` | `PATCH /v1/accounts/{accountId}` | rename; also call settings (see `chats-contacts-profile`) and `pacing` (anti-ban protections, off by default; recommended 12/min, 5/min to first contacts, typing on; see `wuapi-rules`) |
| `accounts.reconnect(id)` | `POST /v1/accounts/{accountId}/reconnect` | restart the session, `202`; a fresh QR code when the link was lost |
| `accounts.logout(id)` | `POST /v1/accounts/{accountId}/logout` | unlink from the phone and stop billing, keep the record and its messages; reconnect to link again |
| `accounts.delete(id)` | `DELETE /v1/accounts/{accountId}` | unlink, delete and stop billing, `204` |
| `accounts.setPresence(id, "online")` | `POST /v1/accounts/{accountId}/presence` | appear `online` or `offline` to contacts |

```ts
const acc = await wuapi.accounts.get(accountId)
if (acc.status === "failed" || acc.disconnectReason === "logged_out" || acc.disconnectReason === "qr_timeout") {
  await wuapi.accounts.reconnect(accountId)
  const again = await wuapi.accounts.waitForQrCode(accountId)
  console.log("Show this QR code again:", again.qrCodeUrl)
}
```

## Gotchas

- Do not cache the QR code for long: it rotates. Show the latest `qrCodeUrl` from the account.
- `waitUntilReady` can take minutes when a human is involved. Run it in a background job, or rely on `account.connected` instead of holding an HTTP request open.
- Chat history is not imported unless you create the account with `historySync: "recent"`. WhatsApp sends it once, right after linking, so set it before the number links; it is stored with `source: "history"` and reported by `history.synced` (see `receive-webhooks`).
- Sending from an account that is not `ready` answers `409 account_not_ready`.
