// Tests for scripts/release.mjs: the gate that keeps every change to the
// skills on a new version. Each test builds a small git repository, in the
// monorepo layout (packages/wuapi-skills) or the mirror's (the root).
//
//   node --test packages/wuapi-skills/scripts/release.test.mjs

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "release.mjs");

/** A repository with the skills package at `prefix` ("" for the mirror), committed at 1.0.0. */
function repo(prefix = "packages/wuapi-skills") {
  const root = mkdtempSync(join(tmpdir(), "wuapi-skills-gate-"));
  const pkg = join(root, prefix);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(pkg, path)), { recursive: true });
    writeFileSync(join(pkg, path), text);
  };
  const versions = (plugin, marketplace = plugin, entry) => {
    write(".claude-plugin/plugin.json", JSON.stringify({ name: "wuapi-skills", version: plugin }, null, 2));
    write(
      ".claude-plugin/marketplace.json",
      JSON.stringify({ name: "m", metadata: { version: marketplace }, plugins: [{ name: "wuapi-skills", source: "./", ...(entry ? { version: entry } : {}) }] }, null, 2),
    );
  };
  const commit = (message) => {
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  cpSync(SCRIPT, join(pkg, "scripts/release.mjs"), { recursive: true });
  versions("1.0.0");
  write("skills/send-message/SKILL.md", "---\nname: send-message\n---\n");
  write("sdk.json", JSON.stringify({ sdk: { typescript: "0.12.0", rust: "0.12.0" } }));
  write("README.md", "# skills\n");
  writeFileSync(join(root, "unrelated.txt"), "x");
  const base = commit("base");
  const run = (...args) => {
    const r = spawnSync("node", [join(pkg, "scripts/release.mjs"), ...args], { cwd: root, encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { root, base, write, versions, commit, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("a change outside the skills needs no bump", () => {
  const r = repo();
  writeFileSync(join(r.root, "unrelated.txt"), "y");
  const { code, out } = r.run("check-bump", r.base, r.commit("elsewhere"));
  assert.equal(code, 0, out);
  assert.match(out, /no version bump needed/);
  r.done();
});

test("a changed skill without a new version fails, naming the files and the fix", () => {
  const r = repo();
  r.write("skills/send-message/SKILL.md", "---\nname: send-message\n---\nchanged\n");
  const { code, out } = r.run("check-bump", r.base, r.commit("edit a skill"));
  assert.equal(code, 1, out);
  assert.match(out, /::error file=packages\/wuapi-skills\/\.claude-plugin\/plugin\.json,title=Skills version not bumped::/);
  assert.match(out, /skills\/send-message\/SKILL\.md/);
  assert.match(out, /`1\.0\.1`, `1\.1\.0`/);
  assert.match(out, /marketplace\.json/);
  r.done();
});

test("a new skill, the README and the plugin manifests are released files too", () => {
  for (const [path, text] of [
    ["skills/receive-streams/SKILL.md", "---\nname: receive-streams\n---\n"],
    ["README.md", "# skills\n\nmore\n"],
    [".claude-plugin/plugin.json", JSON.stringify({ name: "wuapi-skills", version: "1.0.0", description: "new" })],
  ]) {
    const r = repo();
    r.write(path, text);
    assert.equal(r.run("check-bump", r.base, r.commit("change")).code, 1, path);
    r.done();
  }
});

test("a new SDK version in the generator's stamp asks for a skills bump", () => {
  const r = repo();
  r.write("sdk.json", JSON.stringify({ sdk: { typescript: "0.13.0", rust: "0.13.0" } }));
  const failed = r.run("check-bump", r.base, r.commit("sdk 0.13.0"));
  assert.equal(failed.code, 1, failed.out);
  assert.match(failed.out, /sdk\.json/);
  assert.match(failed.out, /review the skills against the new SDK/i);
  r.versions("1.1.0");
  const passed = r.run("check-bump", r.base, r.commit("bump"));
  assert.equal(passed.code, 0, passed.out);
  assert.match(passed.out, /1\.0\.0 -> 1\.1\.0/);
  r.done();
});

test("the version must go up, not just differ", () => {
  const r = repo();
  r.write("skills/send-message/SKILL.md", "changed");
  r.versions("0.9.0");
  const { code, out } = r.run("check-bump", r.base, r.commit("down"));
  assert.equal(code, 1, out);
  assert.match(out, /0\.9\.0 here, 1\.0\.0 on the base branch/);
  r.done();
});

test("every place that states the version must agree", () => {
  const r = repo();
  r.write("skills/send-message/SKILL.md", "changed");
  r.versions("1.1.0", "1.0.0");
  const metadata = r.run("check-bump", r.base, r.commit("plugin only"));
  assert.equal(metadata.code, 1, metadata.out);
  assert.match(metadata.out, /marketplace\.json states 1\.0\.0 \(metadata\.version\) but \.claude-plugin\/plugin\.json states 1\.1\.0/);
  r.versions("1.1.0", "1.1.0", "1.0.5");
  const entry = r.run("check-bump", r.base, r.commit("stale entry"));
  assert.equal(entry.code, 1, entry.out);
  assert.match(entry.out, /plugins\[0\]\.version/);
  r.done();
});

test("tests, workflows, scripts and RELEASING.md need no bump", () => {
  const r = repo();
  r.write(".github/workflows/validate.yml", "name: v\n");
  r.write("scripts/extra.mjs", "// tool\n");
  r.write("RELEASING.md", "# how\n");
  const { code, out } = r.run("check-bump", r.base, r.commit("tooling"));
  assert.equal(code, 0, out);
  r.done();
});

test("it works in the mirror, where the package is the repository root", () => {
  const r = repo("");
  r.write("skills/send-message/SKILL.md", "changed");
  const failed = r.run("check-bump", r.base, r.commit("edit"));
  assert.equal(failed.code, 1, failed.out);
  assert.match(failed.out, /::error file=\.claude-plugin\/plugin\.json/);
  r.versions("1.0.1");
  assert.equal(r.run("check-bump", r.base, r.commit("bump")).code, 0);
  r.done();
});

test("check validates the working tree: semver, agreement and the SDK stamp", () => {
  const r = repo();
  assert.equal(r.run("check").code, 0);
  r.versions("1.1", "1.1");
  assert.match(r.run("check").out, /not a semver version/);
  r.versions("1.1.0", "1.0.0");
  const disagree = r.run("check");
  assert.equal(disagree.code, 1, disagree.out);
  r.versions("1.1.0");
  r.write("sdk.json", "{}");
  const stamp = r.run("check");
  assert.equal(stamp.code, 1, stamp.out);
  assert.match(stamp.out, /sdk\.json names no SDK version/);
  r.done();
});

test("a wrong call is a usage error, not a pass", () => {
  const r = repo();
  assert.equal(r.run("check-bump").code, 2);
  assert.equal(r.run("nope").code, 2);
  r.done();
});
