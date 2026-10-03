import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { routerEntry, snippet, mergeConfig, configPath, loadConfig, writeConfig } from "../src/config.js";

const ENTRY = routerEntry("http://127.0.0.1:8000", "SECRET");

test("routerEntry builds the docs-shaped block", () => {
  assert.deepEqual(ENTRY, {
    type: "local",
    command: ["npx", "-y", "@humayunkabir/jev-router-mcp"],
    environment: { JEV_URL: "http://127.0.0.1:8000", JEV_API_KEY: "SECRET" },
    enabled: true,
  });
});

test("snippet renders a pasteable one-entry block", () => {
  assert.equal(snippet("jev-router", ENTRY), `"jev-router": ${JSON.stringify(ENTRY, null, 2)}`);
  assert.match(snippet("jev-router", ENTRY), /"JEV_API_KEY": "SECRET"/);
});

test("mergeConfig uses mcp.servers shape when the file already has it", () => {
  const merged = mergeConfig(
    { mcp: { servers: { codegraph: { disabled: false } } } },
    "jev-router",
    ENTRY,
  );
  assert.deepEqual(merged.mcp.servers["jev-router"], ENTRY);
  assert.equal(merged.mcp.servers.codegraph.disabled, false); // untouched
});

test("mergeConfig uses docs mcp.<name> shape otherwise", () => {
  const merged = mergeConfig({ plugins: [] }, "jev-router", ENTRY);
  assert.deepEqual(merged.mcp["jev-router"], ENTRY);
  assert.deepEqual(merged.plugins, []);
});

test("mergeConfig tolerates null (new/empty file)", () => {
  const merged = mergeConfig(null, "jev-router", ENTRY);
  assert.deepEqual(merged.mcp["jev-router"], ENTRY);
});

test("write -> load roundtrip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-config-"));
  const file = path.join(dir, "opencode.jsonc");
  writeConfig(file, mergeConfig(null, "jev-router", ENTRY));
  assert.deepEqual(loadConfig(file).mcp["jev-router"], ENTRY);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadConfig returns null for missing or non-JSON files", () => {
  assert.equal(loadConfig("/nonexistent/opencode.json"), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-config-"));
  const file = path.join(dir, "opencode.jsonc");
  fs.writeFileSync(file, "// comment\n{ invalid", "utf8"); // JSONC — refuse to parse
  assert.equal(loadConfig(file), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("configPath prefers an existing file under XDG_CONFIG_HOME", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-xdg-"));
  fs.mkdirSync(path.join(dir, "opencode"), { recursive: true });
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    assert.equal(configPath(), path.join(dir, "opencode", "opencode.jsonc"));
    fs.writeFileSync(path.join(dir, "opencode", "opencode.json"), "{}");
    assert.equal(configPath(), path.join(dir, "opencode", "opencode.json"));
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});