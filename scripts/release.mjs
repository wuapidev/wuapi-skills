#!/usr/bin/env node
// Release helpers for the wuapi agent skills. Node built-ins only. Works both
// in the wuapi monorepo (package at packages/wuapi-skills) and in the
// standalone wuapidev/wuapi-skills repository (package at the root).
//
//   node scripts/release.mjs check-bump <base-sha> <head-sha>
//     Pull requests in the monorepo (.github/workflows/skills-version.yml):
//     fails when a file that ships to the people who installed the skills
//     changed but the version in .claude-plugin/plugin.json is not above the
//     base branch's, or when another place that states the version disagrees.
//   node scripts/release.mjs check
//     The working tree: the version is a semver version, every place that
//     states it agrees, and sdk.json names the SDK versions the skills were
//     written against. Needs no git.
//
// The same rule as the SDK, the MCP server and the CLI (their own
// scripts/release.mjs), without the npm part: the skills are not an npm
// package. See RELEASING.md.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = ".claude-plugin/plugin.json";
const MARKETPLACE = ".claude-plugin/marketplace.json";
/** Written by `bun run codegen`: the SDK versions the skills document. */
const SDK_STAMP = "sdk.json";

let layout = null;
function repo() {
  if (layout === null) {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: pkgDir, encoding: "utf8" }).trim();
    const path = relative(root, pkgDir).split("\\").join("/");
    layout = { root, path, prefix: path === "" ? "" : `${path}/` };
  }
  return layout;
}

/**
 * What reaches someone who installed the skills: the skills themselves, the
 * plugin and marketplace manifests, the README and the license, and the SDK
 * versions the generator stamped (a new SDK version means the skills have to
 * be read again). Workflows, these scripts and RELEASING.md do not.
 */
const RELEASED = [/^skills\//, /^\.claude-plugin\//, /^README\.md$/, /^LICENSE$/, /^sdk\.json$/];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const m = SEMVER.exec(String(version));
  if (!m) throw new Error(`\`${version}\` is not a semver version`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // a release outranks its pre-releases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function git(...args) {
  return execFileSync("git", args, { cwd: repo().root, encoding: "utf8" });
}

/** A JSON file of the package at a git ref, or null when it is not there. */
function jsonAt(ref, path) {
  try {
    return JSON.parse(git("show", `${ref}:${repo().prefix}${path}`));
  } catch {
    return null;
  }
}

function localJson(path) {
  return JSON.parse(readFileSync(join(pkgDir, path), "utf8"));
}

/**
 * Every place besides plugin.json that states the version and does not agree
 * with it: the marketplace's own `metadata.version`, and a `version` on its
 * entry for this plugin (which Claude Code reads when plugin.json has none).
 */
function disagreements(plugin, marketplace) {
  const problems = [];
  const stated = marketplace?.metadata?.version;
  if (stated !== plugin.version) {
    problems.push(`${MARKETPLACE} states ${stated ?? "no version"} (metadata.version) but ${PLUGIN} states ${plugin.version}.`);
  }
  (marketplace?.plugins ?? []).forEach((entry, i) => {
    if (entry.name === plugin.name && entry.version !== undefined && entry.version !== plugin.version) {
      problems.push(`${MARKETPLACE} states ${entry.version} (plugins[${i}].version) but ${PLUGIN} states ${plugin.version}.`);
    }
  });
  return problems;
}

function suggestions(base) {
  const [major, minor, patch] = parse(base).core;
  return [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`];
}

function checkBump(base, head) {
  if (!base || !head) throw new Error("usage: release.mjs check-bump <base-sha> <head-sha>");
  const { path, prefix } = repo();
  const pkgPath = path === "" ? "." : path;
  const changed = git("diff", "--name-only", `${base}...${head}`, "--", pkgPath)
    .split("\n")
    .filter(Boolean)
    .map((f) => f.slice(prefix.length));
  const released = changed.filter((f) => RELEASED.some((re) => re.test(f)));
  if (released.length === 0) {
    console.log(`No released file of ${pkgPath} changed (${changed.length ? changed.join(", ") : "nothing"}): no version bump needed.`);
    return;
  }
  const plugin = jsonAt(head, PLUGIN);
  if (plugin === null) throw new Error(`${prefix}${PLUGIN} is missing at ${head}`);
  const from = jsonAt(base, PLUGIN)?.version ?? null;
  const to = plugin.version;
  if (from === null) {
    console.log(`${pkgPath} is new on this branch; its version is ${to}.`);
    return;
  }
  parse(to);
  const stale = disagreements(plugin, jsonAt(head, MARKETPLACE));
  if (compare(to, from) > 0 && stale.length === 0) {
    console.log(`${pkgPath}: ${from} -> ${to}. It reaches the mirror when this is merged into the default branch.`);
    return;
  }
  if (compare(to, from) > 0) fail(["The skills version is stated in more than one place, and they disagree.", ...stale, `Set them all to ${to}.`].join("\n"));
  const next = suggestions(from);
  const sdk = released.includes(SDK_STAMP);
  fail(
    [
      `${pkgPath} changed but its version was not bumped (${to} here, ${from} on the base branch).`,
      `Changed released files: ${released.join(", ")}.`,
      ...(sdk
        ? [`${SDK_STAMP} changed: the generator emits a new SDK version (package_version in packages/sdk-codegen/wuapi.sdk.toml). Review the skills against the new SDK, then bump.`]
        : []),
      `An installed copy is updated only when the version changes, so give this change a new version above ${from}:`,
      `  1. Set "version" in ${prefix}${PLUGIN} to ${next.map((v) => `\`${v}\``).join(", ")} or another version above ${from} (a new skill or new guidance is a minor, a correction is a patch).`,
      `  2. Set "metadata.version" in ${prefix}${MARKETPLACE} to the same value.`,
      `Changes to .github/, scripts/ and ${prefix}RELEASING.md need no bump. See ${prefix}RELEASING.md.`,
    ].join("\n"),
  );
}

function check() {
  const plugin = localJson(PLUGIN);
  parse(plugin.version);
  const problems = disagreements(plugin, localJson(MARKETPLACE));
  let sdk = {};
  try {
    sdk = localJson(SDK_STAMP).sdk ?? {};
  } catch {
    // Reported below.
  }
  const versions = Object.entries(sdk);
  if (versions.length === 0) problems.push(`${SDK_STAMP} names no SDK version: run \`bun run codegen\` in the wuapi monorepo.`);
  for (const [, version] of versions) parse(version);
  if (problems.length) fail(problems.join("\n"));
  console.log(`wuapi-skills ${plugin.version}, written against ${versions.map(([name, v]) => `${name} SDK ${v}`).join(", ")}.`);
}

function fail(message) {
  // One annotation on plugin.json in the pull request, then the full text in the log.
  console.log(`::error file=${repo().prefix}${PLUGIN},title=Skills version not bumped::${message.split("\n")[0]}`);
  console.error(message);
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "check-bump") checkBump(args[0], args[1]);
  else if (cmd === "check") check();
  else throw new Error("usage: release.mjs check-bump <base-sha> <head-sha> | check");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
