# wuapi agent skills

[![Validate](https://github.com/wuapidev/wuapi-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/wuapidev/wuapi-skills/actions/workflows/validate.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Agent skills for [wuapi](https://wuapi.dev), the WhatsApp API for developers. They give a coding agent (Claude Code, Cursor, Codex and others that read `SKILL.md` files) what it needs to write correct wuapi code: one skill per task, each a workflow plus a reference, with TypeScript examples that use the real [`@wuapidev/sdk`](https://www.npmjs.com/package/@wuapidev/sdk) and curl where it helps.

```sh
npx skills add wuapidev/wuapi-skills
```

In Claude Code you can also install them as a plugin:

```sh
/plugin marketplace add wuapidev/wuapi-skills
/plugin install wuapi-skills@wuapi-marketplace
```

To get a newer version of what you installed:

```sh
npx skills update                                         # the skills CLI
claude plugin update wuapi-skills@wuapi-marketplace       # the Claude Code plugin
```

The plugin is updated when its version changes (`.claude-plugin/plugin.json`), and every change to the skills gets a new one.

| Skill | Covers |
|---|---|
| `wuapi-rules` | Always loaded. What wuapi is and is not, auth, projects, errors, pagination, idempotency, pacing, webhook signing. |
| `wuapi-cli` | Log in with `npx @wuapidev/cli login` (no key to copy), link a number and send a test from the terminal, call any API method, set up the MCP server. |
| `link-account` | Link a number by QR or pairing code, wait for ready, pick the exit country, reconnect or log out. |
| `send-message` | Every send type and option, replies, mentions, polls, events, edits, reactions, Status and channel posts. |
| `receive-webhooks` | Endpoints, signature verification, the full event catalog, retries and history sync. |
| `receive-streams` | Streams: live events with no public endpoint. The SDK's `events.stream` in TypeScript and Rust, choosing Webhooks or Streams, resuming with `Last-Event-ID`, reset, deduplication, filters and limits. |
| `groups-and-channels` | Groups, communities, join requests, invite links and channels. |
| `chats-contacts-profile` | Listing chats and their state, chat actions, read receipts, labels, contacts, blocklist, profile, privacy and calls. |
| `projects-and-invitations` | A platform on wuapi: projects, project keys, per-project webhooks and usage, invitations, branding. |

Docs: [wuapi.dev/docs](https://wuapi.dev/docs). The whole reference as one Markdown file for any agent: [wuapi.dev/llms-full.txt](https://wuapi.dev/llms-full.txt).

> **How it works.** wuapi links your own numbers as devices, the same way WhatsApp Web works. It does not use the WhatsApp Business Platform. WhatsApp can restrict numbers that behave like spam: send only to people who expect your messages.

This repository is a read-only mirror: the skills are written and tested next to the API they describe, and every change is synced here. Report problems in [issues](https://github.com/wuapidev/wuapi-skills/issues).

Licensed under [Apache-2.0](LICENSE).
