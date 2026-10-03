// Config discovery + safe merge for `init --write`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Entry written into opencode's mcp config.
export function routerEntry(url, apiKey) {
  return {
    type: "local",
    command: ["npx", "-y", "@humayunkabir/jev-router-mcp"],
    environment: { JEV_URL: url, JEV_API_KEY: apiKey },
    enabled: true,
  };
}

// One-entry config snippet, for manual paste fallbacks.
export function snippet(name, entry) {
  return `"${name}": ${JSON.stringify(entry, null, 2)}`;
}

// Merge the router into an opencode config object, matching the shape the file
// already uses: `mcp.servers.<name>` (v2-style) or `mcp.<name>` (docs-style).
export function mergeConfig(existing, name, entry) {
  const cfg = existing && typeof existing === "object" ? structuredClone(existing) : {};
  const servers = cfg.mcp && typeof cfg.mcp === "object" && cfg.mcp.servers;
  if (servers && typeof servers === "object") {
    servers[name] = entry;
  } else {
    cfg.mcp = { ...(cfg.mcp && typeof cfg.mcp === "object" ? cfg.mcp : {}), [name]: entry };
  }
  return cfg;
}

// Resolve the opencode global config path. Prefer an existing file (json or
// jsonc); otherwise fall back to ~/.config/opencode/opencode.jsonc.
export function configPath() {
  const dir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const base = path.join(dir, "opencode");
  if (fs.existsSync(path.join(base, "opencode.json"))) return path.join(base, "opencode.json");
  return path.join(base, "opencode.jsonc");
}

// Returns the parsed config, or null when the file is missing or not plain
// JSON (e.g. JSONC with comments — refuse to guess at surgery there).
export function loadConfig(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeConfig(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}