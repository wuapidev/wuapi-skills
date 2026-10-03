# Releasing the wuapi agent skills

The skills are not an npm package. People get them from the public repository
`wuapidev/wuapi-skills`, a mirror of this directory, in two ways:

- `npx skills add wuapidev/wuapi-skills` copies the skills into a project.
- The Claude Code plugin: `/plugin marketplace add wuapidev/wuapi-skills`, then
  `/plugin install wuapi-skills@wuapi-marketplace`.

## The rule

Every change that reaches those people gets a new version, in the same pull
request:

1. Set `version` in `.claude-plugin/plugin.json`: a new skill or new guidance
   is a minor, a correction is a patch.
2. Set `metadata.version` in `.claude-plugin/marketplace.json` to the same
   value.

`Version bumped (skills)` (`.github/workflows/skills-version.yml` in the
monorepo) fails a pull request that changes `skills/**`, `.claude-plugin/**`,
`README.md`, `LICENSE` or `sdk.json` without a version above the base branch's,
or whose two files disagree. `.github/`, `scripts/` and this file need no bump.
The rule is `scripts/release.mjs` (`check-bump`, and `check` for the working
tree), tested by `scripts/release.test.mjs`.

The bump is what delivers the change. Claude Code keeps an installed plugin at
the version its `plugin.json` states: new commits with the same version are not
applied.

## The SDK versions

The skills teach how the SDKs are used, so they are written against one version
of each. `sdk.json` states which, and the generator writes it: `bun run
codegen` copies every `package_version` of `packages/sdk-codegen/wuapi.sdk.toml`
into it, and `bun run codegen:check` fails while it is stale. Never edit it by
hand.

A new SDK version therefore changes `sdk.json`, and the version gate asks for a
bump. Before bumping, read the skills against what changed in the SDK
(`packages/wuapi-sdk/CHANGELOG.md`): the TypeScript blocks are type-checked
against the SDK source by `apps/wuapi/lib/__tests__/skills.test.ts`, the prose
and the Rust blocks are not.

## What happens on merge

`sync-skills.yml` pushes this directory to `wuapidev/wuapi-skills`. Nothing else
is published: there is no tag and no release, and neither installer needs one.
