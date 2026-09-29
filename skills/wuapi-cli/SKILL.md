---
name: wuapi-cli
description: Use the wuapi command line (`npx @wuapidev/cli`) to log in, link a WhatsApp number through a link the person opens, run the project's code with the key, send a message and call any wuapi API method from a terminal or an agent's shell. Use when setting up wuapi in a project, when the WUAPI_API_KEY variable is missing, when the user asks to link a number or send a test from the terminal, when configuring the wuapi MCP server, or when an agent needs to read or change wuapi data without writing code.
---

# The wuapi CLI

`npx @wuapidev/cli` (npm package `@wuapidev/cli`, command `wuapi`, Node 20+) is the fastest way to get a working key and a linked number. It is built on `@wuapidev/sdk`, so every SDK method is also a command.

## Log in first: never ask for the key in chat

When `npx @wuapidev/cli whoami --json` fails with `not_logged_in`, do not ask the user to paste a key. Run the login: it opens their browser, they sign in (or sign up, on the Free plan), check that the code matches the terminal and approve. The CLI receives a new API key and keeps it in its own storage, `~/.config/wuapi/credentials.json` (mode 0600), outside the project.

```sh
npx @wuapidev/cli login          # opens the browser, waits for the approval
npx @wuapidev/cli whoami         # organization, project, key prefix (never the key)
```

An agent whose shell only shows output after a command ends must not block on the login before the user sees the link. Split it, and run both halves in the same folder (each folder keeps its own pending login, so parallel sessions in different folders do not collide):

```sh
npx @wuapidev/cli login --start --json   # returns {"url", "code", "expiresIn"} at once: show the url and code to the user
npx @wuapidev/cli login --finish         # then wait until they approve (up to 10 minutes)
```

- The approval page lets the user choose an organization key (all projects, the default) or a project key.
- Every command finds the key in this order: `--api-key`, the `WUAPI_API_KEY` environment variable, `WUAPI_API_KEY` in `./.env`, the profile named by `--profile` or `WUAPI_PROFILE`, the current profile.

## Key handling: the agent never sees the key

- Never read, print or copy the API key: do not open `~/.config/wuapi`, do not write it to `.env` or any other file, do not echo `WUAPI_API_KEY`. The CLI and the MCP server use the stored login on their own.
- Code in the project reads `process.env.WUAPI_API_KEY`. To run it (the app, its dev server, its tests), wrap the command: the key goes into that process's environment only, never into a file.

```sh
npx @wuapidev/cli run -- npm run dev        # also sets WUAPI_PROJECT for a project profile; honors --profile
npx @wuapidev/cli run -- npm test           # exits with the command's exit code
```

- `login --env` writes the key to `./.env` (and `.env` to `.gitignore`). That puts the key in a project file: it is for a person at their terminal, not for agents.
- In Claude Code, the user can keep the agent's file tools away from the stored login with a rule in `.claude/settings.json`: `"permissions": {"deny": ["Read(~/.config/wuapi/**)"]}`. Suggest it; do not add it yourself. It cannot stop a shell running as the same user from reading a file the user can read: that rule, plus never writing the key into the project, is the practical protection.
- `npx @wuapidev/cli logout` forgets the stored login; the key itself is revoked at https://wuapi.dev/app/api-keys.

## Several logins: profiles

Each login is a profile (one organization, or one project in it) with its own key named `CLI · <device>`. A new login becomes the current profile.

```sh
npx @wuapidev/cli profiles                  # every profile, * marks the current one
npx @wuapidev/cli switch acme/store-1       # make another one current (no name: a picker in a terminal)
npx @wuapidev/cli accounts list --profile acme   # one command with another profile
npx @wuapidev/cli logout acme               # forget one profile; --all forgets every one
```

`WUAPI_PROFILE=<name>` does what `--profile` does. Before creating accounts or sending, check with `npx @wuapidev/cli whoami` that the current profile is the organization or project the user means.

## Link a number and send a test

```sh
npx @wuapidev/cli link --no-wait --json   # creates an invitation: prints {invitationId, url, expiresAt} and opens the url in the browser
npx @wuapidev/cli wait <invitationId> --json                     # blocks until the number is linked and ready; returns {accountId, phone}
npx @wuapidev/cli send <phone> "Hello from wuapi" --account <accountId> --wait   # a test to their own number
```

- `link` creates an invitation, a link valid for 1 day. Give the user the `url` and tell them to open it and link with the QR code or the pairing code shown there. You never see or relay a pairing code or QR code: the page shows it to them.
- Do not ask the user for their number: the page asks for what it needs, and `wait` returns the linked `phone`. `--phone` (optional) prefills the page and sets the proxy location to the phone's country and its largest city; pass `--country VE --city caracas` to choose. Without either, the user picks the location on the page. Details: the `link-account` skill.
- With `--no-wait`, `link` returns at once, so the link reaches the user before the agent blocks on `wait`. Without it, `link` prints the link and waits itself.
- `wait` takes an invitation id or an account id. It fails with `invitation_failed` (with the reason), `invitation_expired` or `invitation_cancelled`: run `link` again for a new link.
- `link --here` is the old in-terminal flow (a QR code drawn in the terminal, or a pairing code with `--phone`), for a person at the terminal. Agents should not use it.
- On the Free plan a second number answers `upgrade_required`; show `details.upgradeUrl` to the user instead of retrying.

## Every API method

```sh
npx @wuapidev/cli help                      # commands and resources
npx @wuapidev/cli help messages             # the methods of one resource
npx @wuapidev/cli messages send --help      # path ids, query parameters and body fields
npx @wuapidev/cli accounts list --json
npx @wuapidev/cli messages list --accountId acc_123 --limit 5
npx @wuapidev/cli groups get 120363025246125244@g.us --accountId acc_123
npx @wuapidev/cli messages send --data @message.json
```

- Shape: `wuapi <resource> <method> [ids...] [--field value ...] [--data '<json>' | --data @file.json]`. Ids in the path go first, in order. `--a.b 1` builds nested objects, values that parse as JSON (numbers, booleans, arrays) are sent as such, and `--data` is merged under the flags.
- Lists print the first page; `--all` walks every page, `--limit` sets the page size.
- `--project proj_123` scopes one call to a project (the `Wuapi-Project` header).
- `--json` on any command: JSON on stdout, progress on stderr, and on failure a non-zero exit with `{"error": {"code", "message"}}` using the API's error codes (see `wuapi-rules`).
- Sends are idempotent: a retried `send` reuses its idempotency key and never sends twice.

## The MCP server

```sh
npx @wuapidev/cli mcp add                   # detects the client; or --client claude|cursor|vscode, --scope project|user
```

It configures the local server `npx -y @wuapidev/mcp`, which reads the same stored login, so no key goes into any config file. MCP tools may appear only after the client restarts: in the same session, keep using the CLI or the SDK.

Some clients (Claude Code) block an agent from changing their own configuration. If `mcp add` is refused, do not work around it: give the user the command to run themselves (in Claude Code: `! npx @wuapidev/cli mcp add --client claude --scope project`) and continue.

## When to use what

| Task | Use |
|---|---|
| Get a key, link a number, send a test, look at data | the CLI |
| Code that ships in the user's app | the SDK (`@wuapidev/sdk`), reading `WUAPI_API_KEY`; run it with `npx @wuapidev/cli run -- <command>` |
| An agent acting on WhatsApp during a conversation | the MCP server |
