---
name: projects-and-invitations
description: Build a platform on wuapi where each of your customers links their own WhatsApp number. Use when writing code that creates projects (one per customer or environment), addresses them by id or ext:<externalId>, issues project-scoped API keys, sends the Wuapi-Project header, sets up per-project webhook endpoints, suspends or limits a project, exports per-project usage for rebilling, sends invitations (the hosted, white-label page where someone else links their number), or sets the organization's branding.
---

# Projects and invitations: running a platform

Three levels, the same words everywhere:

- **Organization**: who pays. Holds the subscription, the branding and the organization keys.
- **Project**: one of your customers, or an environment. Its own accounts, API keys, webhook endpoints, limits and usage, isolated from every other project.
- **Account**: a linked WhatsApp number with a name ("Sales", "Support").

wuapi bills the organization, across every project, counting all its connected accounts together through graduated bands, each at its own price: $6 for your first number, $4.50 for every one after, and $3.50 from the 51st, per month. It never bills a project: you rebill your customers from the per-project usage it reports. An organization without a paid subscription is on the Free plan: 1 number, 2,000 messages and 0.5 GB of proxy traffic a month, no card, which is not enough to run a platform; upgrade before inviting customers.

## Workflow: onboard a customer

1. Create a project with your own id for the customer as `externalId`, then address it as `ext:<externalId>` anywhere a project id goes.
2. Optionally create a project key for code that must only reach that customer.
3. Create a project webhook endpoint (or keep one organization endpoint and route on `projectId`).
4. Send the customer an invitation; they link their own number on a hosted page with your branding.
5. On `invitation.status_changed` with status `completed` (or `account.connected`), store the new `accountId`.
6. Each month, read `GET /v1/usage/by-project` and invoice.

```ts
import { Wuapi } from "@wuapidev/sdk"

const wuapi = new Wuapi() // an organization key, from WUAPI_API_KEY

const project = await wuapi.projects.create(
  { name: "Northwind Dental", externalId: "customer_8812", maxAccounts: 3, metadata: { plan: "pro" } },
  { idempotencyKey: "project-customer_8812" },
)

// Act inside the project: every request carries Wuapi-Project.
const northwind = wuapi.withProject("ext:customer_8812") // or project.id
await northwind.webhookEndpoints.create({ url: "https://example.com/hooks/northwind", events: ["message.received", "invitation.status_changed"] })

// A key that can only reach this project. The key is shown only here.
const apiKey = await wuapi.projects.apiKeys.create(project.id, { name: "Northwind production" })
const theirs = new Wuapi({ apiKey: apiKey.key! })
const page = await theirs.accounts.list().page() // only Northwind's accounts
console.log(page.items.length)
```

```bash
curl -X POST https://api.wuapi.dev/v1/projects \
  -H "Authorization: Bearer $WUAPI_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: project-customer_8812" \
  -d '{ "name": "Northwind Dental", "externalId": "customer_8812", "maxAccounts": 3 }'

# Any /v1 request, scoped to that project by the header.
curl https://api.wuapi.dev/v1/accounts \
  -H "Authorization: Bearer $WUAPI_API_KEY" -H "Wuapi-Project: ext:customer_8812"
```

## Scoping rules

| Credential | `Wuapi-Project` header | Scope |
|---|---|---|
| organization key | absent | whole organization: every project plus unassigned resources |
| organization key | a project id or `ext:<externalId>` | that project only; `404 project_not_found` otherwise |
| project key | absent, or its own project | its project only |
| project key | another project | `403 forbidden` |

- Outside the scope is `404 not_found`, never `403`: one project cannot learn another's ids exist.
- Accounts, messages, webhook endpoints and invitations created in a project scope belong to it for good. With an organization key, `POST /v1/accounts`, `POST /v1/webhook-endpoints` and `POST /v1/invitations` take an optional `projectId` instead of the header.
- Lists are filtered by scope. With an organization key they accept `?projectId=` with an id, `ext:<externalId>`, or `none` (unassigned only).
- Project keys cannot manage projects, branding, usage or organization keys (`403 forbidden`); on those organization routes the header changes nothing.
- Project keys start with `wu_live_` like any key and each has its own 600 requests per minute. Limits: 50 active organization keys, 20 per project; 5 webhook endpoints for the organization plus 5 per project. An `Idempotency-Key` replays only within the caller's scope.
- `new Wuapi({ project: "ext:customer_8812" })` is the same as `withProject`. `wuapi.me()` returns the resolved `project`.

## Webhook endpoints per project

Every event carries top-level `organizationId` and `projectId` (`null` when unassigned). An organization endpoint receives every project's events; a project endpoint only its own. Project lifecycle events, with the project as `data.object`: `project.created`, `project.updated`, `project.deleted` (fires when the background delete finishes).

## Suspension, limits, deletion

```ts
await wuapi.projects.update("ext:customer_8812", { status: "suspended" }) // sends and writes answer 403 project_suspended; reads work; inbound keeps arriving
await wuapi.projects.update("ext:customer_8812", { status: "active" })
await wuapi.projects.update("ext:customer_8812", { maxAccounts: 5 }) // null removes the limit
await wuapi.projects.delete("ext:customer_8812") // 204 at once; accounts logged out and deleted in the background
```

- Suspension keeps the numbers linked and stores and delivers inbound, so nothing is lost while billing is sorted out.
- One account over `maxAccounts` answers `403 project_limit_reached` (`details.maxAccounts`).
- After `DELETE /v1/projects/{projectId}` the project is `404` at once, its keys answer `401`, and its `externalId` can be reused.

| SDK | REST |
|---|---|
| `projects.create({ name, externalId?, metadata?, maxAccounts? })` | `POST /v1/projects` (`409 already_exists` on a duplicate `externalId`) |
| `projects.list({ externalId?, status? })` | `GET /v1/projects` |
| `projects.get(id)` | `GET /v1/projects/{projectId}` (id or `ext:...`) |
| `projects.update(id, {...})` | `PATCH /v1/projects/{projectId}` (also `status: "suspended" \| "active"`) |
| `projects.delete(id)` | `DELETE /v1/projects/{projectId}` (204) |
| `projects.apiKeys.create(id, { name })` / `list(id)` / `revoke(id, apiKeyId)` | `POST` / `GET /v1/projects/{projectId}/api-keys`, `DELETE /v1/projects/{projectId}/api-keys/{apiKeyId}` |
| `projects.getUsage(id, { month? })` | `GET /v1/projects/{projectId}/usage` |
| `usage.byProject({ month? })` | `GET /v1/usage/by-project?month=YYYY-MM` |

## Usage for rebilling

```ts
const report = await wuapi.usage.byProject({ month: "2026-09" })
for (const line of report.projects) {
  console.log(line.externalId, line.billableAccountCount, line.proxyBytes, line.sentMessageCount, line.receivedMessageCount)
}
console.log(report.unassigned, report.totals)
```

`accountCount` and `billableAccountCount` are current counts; `month` selects the month of `proxyBytes`, `sentMessageCount` and `receivedMessageCount`. `sentMessageCount` counts API sends WhatsApp accepted plus messages sent from the phone; `receivedMessageCount` counts contacts' messages; history imports count for neither. Organization keys only. `GET /v1/usage` is the organization's own bill for the current month (`billableAccountCount`, `accountFeeCents`, `proxyBytes`, `includedProxyBytes`, `billableProxyBytes`, `proxyFeeCents`, `totalCents`, `currency`). Every billable account includes 0.5 GB of proxy a month, pooled across the organization; `proxyFeeCents` bills only `billableProxyBytes`, the traffic past that, at $0.99 per GB.

## Invitations: let the customer link their own number

An invitation is a page at `wuapi.dev/invite/...` that you send to someone else (your customer, a store manager, a sales rep). They need no account, dashboard or key. If you did not preset `proxyLocation`, they pick the country and city the number's proxy exits from, then scan a live QR code or type a pairing code; the number arrives as an account in the project. Use this instead of building your own QR code screen.

```ts
await wuapi.branding.update({ displayName: "Northwind Cloud", accentColor: "#0F766E" })

const invitation = await wuapi.invitations.create({
  projectId: "ext:customer_8812", // organization keys; a project key invites into its own project
  inviteeName: "Maria Perez",
  inviteeEmail: "maria@example.com",
  accountName: "Front desk",
  suggestedCountry: "MX",
  proxyLocation: { country: "MX", city: "mexicocity" }, // optional: omit it and the invitee picks on the page
  returnUrl: "https://app.example.com/settings/whatsapp",
  expiresInDays: 7,
  metadata: { store: "cdmx-2" },
})
if (!invitation.emailSentAt) console.log("Send this yourself:", invitation.url) // returned only by create and resend
```

| field | notes |
|---|---|
| `projectId` | the project the account lands in; without it (organization key) the account is unassigned |
| `accountName` | the new account's name; default `inviteeName`, else the WhatsApp profile name |
| `inviteeName`, `inviteeEmail` | shown on the page; with an email we send it when email is enabled (`emailSentAt` says when it was queued) |
| `proxyLocation` | optional `{country, city}` from `GET /v1/proxy-locations`; without it the invitee picks the country and city on the page before the QR code or pairing code is shown, and `invitation.proxyLocation` is `null` until then; `400 unsupported_proxy_location` for a pair not in the list |
| `inviteePhone` | E.164; preselects the country and prefills the pairing-code form |
| `suggestedCountry` | ISO 3166-1 alpha-2; preselects the country on the page when `proxyLocation` is not preset; derived from `inviteePhone` when absent |
| `methods` | `["qr_code", "pairing_code"]` by default |
| `historySync` | `none` (default) or `recent`: whether the linked account imports the recent chats the phone sends once, right after linking |
| `returnUrl` | HTTPS; the success page links back with `?invitation_id=...&account_id=...` (no automatic redirect) |
| `expiresInDays` | 1 to 30, default 7 |
| `metadata` | up to 20 string pairs, copied onto the account when the number links |

Creating an invitation checks what creating an account checks (`402 upgrade_required` once the Free plan's 1 account is taken, `402 free_limit_reached`, `403 project_suspended`, `403 project_limit_reached`), again when the invitee starts. `url` is `null` on every read except create and resend: the token is stored hashed.

### Statuses and events

| status | meaning |
|---|---|
| `pending` | created or resent; `viewedAt` set once opened |
| `in_progress` | the invitee started; the account exists, not `ready` yet |
| `completed` | the account reached `ready`; `accountId` is set; `account.connected` fires too |
| `failed` | linking stopped; `failureReason` is `abandoned` (1 hour without linking), `qr_timeout`, `logged_out`, `temporary_ban`, `connect_failed` or `account_deleted`; the link keeps working and a retry reuses the account |
| `cancelled` | you cancelled it; the link stops working |
| `expired` | pending or failed past `expiresAt`; computed on read, no event |

Every real change fires `invitation.status_changed`, with the invitation as `data.object` and the old status in `data.previousAttributes.status`, to organization endpoints and the project's endpoints.

```ts
import { verifyWebhook } from "@wuapidev/sdk"

export async function POST(request: Request) {
  const event = await verifyWebhook(await request.text(), request.headers.get("wuapi-signature"), process.env.WUAPI_WEBHOOK_SECRET!)
  if (event.type === "invitation.status_changed" && event.data.object.status === "completed") {
    const { accountId, metadata } = event.data.object
    console.log("Linked", accountId, "for store", metadata.store, "in project", event.projectId, "was", event.data.previousAttributes.status)
  }
  return new Response(null, { status: 204 })
}
```

```ts
for await (const inv of wuapi.invitations.list({ status: "failed" })) console.log(inv.id, inv.failureReason)
const again = await wuapi.invitations.resend(invitationId) // new url; the old one stops working; emailed again
console.log(again.url)
await wuapi.invitations.cancel(invitationId) // 409 already_completed once completed; cancelling twice is a no-op
```

REST: `POST` and `GET /v1/invitations`, `GET /v1/invitations/{invitationId}`, `POST /v1/invitations/{invitationId}/cancel`, `POST /v1/invitations/{invitationId}/resend`.

### Branding

`GET` and `PATCH /v1/branding`, organization keys only. `displayName` (up to 60 characters) is required the first time; `logoUrl` and `supportUrl` are HTTPS and `accentColor` is `#RRGGBB`, all three clearable with `null`. `hideWuapiBranding: true` removes the "Powered by wuapi" footer from the page and the email, and needs the White label add-on ($100/month, added in the dashboard under Billing or Branding): without it the call throws `402 addon_required` (`details: {addon: "white_label", priceCents: 10000}`), and `branding.get()` reports `hideWuapiBranding: false` because the footer shows. A logo uploaded in the dashboard wins over `logoUrl`; setting `logoUrl` replaces it. Until branding is set, `branding.get()` returns it with `displayName: null`.
