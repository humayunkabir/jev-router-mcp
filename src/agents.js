// AGENTS.md wiring for `jev-router-mcp init`: append a short code-routing
// instruction to an existing agents file so the agent consults the router
// first; when no agents file exists, hand back exactly what to add and where.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// File names checked (in order) in the directory passed to the helpers.
export const AGENTS_FILENAMES = ["AGENTS.md", "agents.md", "AGENT.md", "agent.md"];

// The instruction block — mirrors what README.md documents under "Using it".
export const AGENTS_INSTRUCTION =
  "When a question needs code structure or repo context, call `route_code`\n" +
  "first, then the MCP tool it picks (or both when the verdict says `both`).";

export const AGENTS_SECTION = `## Code routing

${AGENTS_INSTRUCTION}`;

export function findAgentsFile(dir = process.cwd()) {
  for (const name of AGENTS_FILENAMES) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

// True when the instruction is already present — our `## Code routing`
// section (any heading level or casing) or the "call `route_code`" phrase
// (backticks optional). Kept tight so init never appends a second copy, and
// a bare mention of route_code elsewhere doesn't count as "already configured".
export function agentsHasInstruction(text) {
  const lower = text.toLowerCase();
  return (
    /^#{1,6}\s+code routing\b/m.test(lower) ||
    lower.includes("call `route_code`") ||
    lower.includes("call route_code")
  );
}

// Append the section to existing content, separated by a blank line.
export function appendAgentsSection(content) {
  const spacer = content.trim() === "" || content.endsWith("\n\n") ? "" : "\n\n";
  return `${content}${spacer}${AGENTS_SECTION}\n`;
}

export function agentsSetupMessage(dir = process.cwd()) {
  return [
    `No AGENTS.md found in ${dir}.`,
    "Create one at the repo root and add:",
    "",
    "```markdown",
    AGENTS_SECTION,
    "```",
  ].join("\n");
}

// The one call init needs. Never throws; always returns
// { status: "added" | "exists" | "missing" | "error", filePath?, message? }.
export function ensureAgentsInstruction(dir = process.cwd()) {
  try {
    const filePath = findAgentsFile(dir);
    if (!filePath) return { status: "missing", message: agentsSetupMessage(dir) };
    const existing = readFileSync(filePath, "utf8");
    if (agentsHasInstruction(existing)) return { status: "exists", filePath };
    writeFileSync(filePath, appendAgentsSection(existing));
    return { status: "added", filePath };
  } catch (err) {
    return { status: "error", message: `Could not update AGENTS.md: ${err.message}` };
  }
}