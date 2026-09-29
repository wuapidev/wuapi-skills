---
name: wuapi-cli
description: Use the wuapi command line (`npx wuapi`) to log in, link a WhatsApp number, send a message and call any wuapi API method from a terminal or an agent's shell. Use when setting up wuapi in a project, when the WUAPI_API_KEY variable is missing, when the user asks to link a number or send a test from the terminal, when configuring the wuapi MCP server, or when an agent needs to read or change wuapi data without writing code.
---

# The wuapi CLI

`npx wuapi` (npm package `wuapi`, Node 20+) is the fastest way to get a working key and a linked number. It is built on `@wuapidev/sdk`, so every SDK method is also a command.

## Log in first: never ask for the key in chat

When `WUAPI_API_KEY` is not set, do not ask the user to paste a key. Run the login: it opens their browser, they sign in (or sign up, on the Free plan), check that the code matches the terminal and approve. The CLI receives a new API key and keeps it in `~/.config/wuapi/credentials.json` (mode 0600).

```sh
npx wuapi login --env   # also writes WUAPI_API_KEY to ./.env and adds .env to .gitignore
npx wuapi whoami        # organization, project, key prefix
```

An agent whose shell only shows output after a command ends must not block on the login before the user sees the link. Split it:

```sh
npx wuapi login --start --json   # returns {"url", "code", "expiresIn"} at once: show the url and code to the user
npx wuapi login --finish --env   # then wait until they approve (up to 10 minutes)
```

- The approval page lets the user choose an organization key (all projects, the default) or a project key.
- Every command finds the key in this order: `--api-key`, the `WUAPI_API_KEY` environment variable, `WUAPI_API_KEY` in `./.env`, the profile named by `--profile` or `WUAPI_PROFILE`, the current profile. Code that uses the SDK reads `WUAPI_API_KEY`, which is why `--env` exists.
- Never print, log or commit the key. `npx wuapi logout` forgets the stored login; the key itself is revoked at https://wuapi.dev/app/api-keys.

## Several logins: profiles

Each login is a profile (one organization, or one project in it) with its own key named `CLI · <device>`. A new login becomes the current profile.

```sh
npx wuapi profiles                  # every profile, * marks the current one
npx wuapi switch acme/store-1       # make another one current (no name: a picker in a terminal)
npx wuapi accounts list --profile acme   # one command with another profile
npx wuapi logout acme               # forget one profile; --all forgets every one
```

`WUAPI_PROFILE=<name>` does what `--profile` does. Before creating accounts or sending, check with `npx wuapi whoami` that the current profile is the organization or project the user means.

## Link a number and send a test

```sh
npx wuapi link --phone +584121234567 --no-wait --json  # creates the account, prints accountId and the 8-character pairing code
npx wuapi wait acc_123                                   # blocks until the account is ready
npx wuapi send +584121234567 "Hello from wuapi" --wait   # queues the message, waits until it is sent or delivered
```

- With `--phone`, tell the user to type the code in WhatsApp, Settings, Linked devices, Link a device, Link with phone number instead. The code expires; if `wait` reports a new code, show the new one.
- Without `--phone`, `link` shows a QR code in the terminal (`--open` opens it in the browser), which suits a person at the terminal, not an agent.
- The proxy location defaults to the phone's country and its largest city; pass `--country VE --city caracas` to choose. Details: the `link-account` skill.
- With `--no-wait`, `link` returns at once, so the code reaches the user before the agent blocks on `wait`.
- On the Free plan a second number answers `upgrade_required`; show `details.upgradeUrl` to the user instead of retrying.

## Every API method

```sh
npx wuapi help                      # commands and resources
npx wuapi help messages             # the methods of one resource
npx wuapi messages send --help      # path ids, query parameters and body fields
npx wuapi accounts list --json
npx wuapi messages list --accountId acc_123 --limit 5
npx wuapi groups get 120363025246125244@g.us --accountId acc_123
npx wuapi messages send --data @message.json
```

- Shape: `wuapi <resource> <method> [ids...] [--field value ...] [--data '<json>' | --data @file.json]`. Ids in the path go first, in order. `--a.b 1` builds nested objects, values that parse as JSON (numbers, booleans, arrays) are sent as such, and `--data` is merged under the flags.
- Lists print the first page; `--all` walks every page, `--limit` sets the page size.
- `--project proj_123` scopes one call to a project (the `Wuapi-Project` header).
- `--json` on any command: JSON on stdout, progress on stderr, and on failure a non-zero exit with `{"error": {"code", "message"}}` using the API's error codes (see `wuapi-rules`).
- Sends are idempotent: a retried `send` reuses its idempotency key and never sends twice.

## The MCP server

```sh
npx wuapi mcp add                   # detects the client; or --client claude|cursor|vscode, --scope project|user
```

It configures the local server `npx -y @wuapidev/mcp`, which reads the same stored login, so no key goes into any config file. MCP tools may appear only after the client restarts: in the same session, keep using the CLI or the SDK.

## When to use what

| Task | Use |
|---|---|
| Get a key, link a number, send a test, look at data | the CLI |
| Code that ships in the user's app | the SDK (`@wuapidev/sdk`), reading `WUAPI_API_KEY` |
| An agent acting on WhatsApp during a conversation | the MCP server |
