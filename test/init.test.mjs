import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

function runInit(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, "init"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

test("init prints a snippet with piped url + key", async () => {
  const { code, out } = await runInit("https://jev.example.com\nsecret123\n");
  assert.equal(code, 0);
  assert.match(out, /"JEV_URL": "https:\/\/jev\.example\.com"/);
  assert.match(out, /"JEV_API_KEY": "secret123"/);
  assert.match(out, /"command": \["npx", "-y", "@humayunkabir\/jev-router-mcp"\]/);
});

test("init falls back to defaults on empty piped input (does not hang)", async () => {
  const { code, out } = await runInit("");
  assert.equal(code, 0);
  assert.match(out, /"JEV_URL": "http:\/\/localhost:8000"/);
  assert.match(out, /"JEV_API_KEY": ""/);
});

test("init accepts a bare url line and default key", async () => {
  const { code, out } = await runInit("http://127.0.0.1:9000\n");
  assert.equal(code, 0);
  assert.match(out, /"JEV_URL": "http:\/\/127\.0\.0\.1:9000"/);
  assert.match(out, /"JEV_API_KEY": ""/);
});