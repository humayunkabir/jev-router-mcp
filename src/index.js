#!/usr/bin/env node
// jev-router-mcp: wraps a Jev decision engine (e.g. Laya) as an MCP server so
// an agent can route a question to the right tool before calling it.
//
// Usage:
//   jev-router-mcp              speak MCP over stdio
//   jev-router-mcp init         collect JEV_URL/JEV_API_KEY, then offer to
//                               write them into your opencode config
//   jev-router-mcp init --write same, but skip the confirmation prompt
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { askJev, DEFAULT_CRITERIA, adviceFor, envConfig } from "./jev.js";
import { routerEntry, mergeConfig, configPath, loadConfig, writeConfig, snippet } from "./config.js";
import fs from "node:fs";

const { url: JEV_URL, apiKey: JEV_API_KEY, instructions: INSTRUCTIONS } = envConfig();
const VERSION = "0.1.0";

// -- init: interactive setup for first-time installers -----------------------
async function init() {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ask each field from readline's async iterator: it yields buffered lines in
  // order (piped input) and waits for each line interactively, resolving
  // {done:true} on EOF so we fall back to defaults instead of hanging.
  const iter = rl[Symbol.asyncIterator]();
  const ask = async (prompt, fallback) => {
    process.stdout.write(prompt);
    const { value, done } = await iter.next();
    if (done || value === undefined) return fallback;
    return value.trim() || fallback;
  };
  try {
    const url = await ask("Jev server URL (default http://localhost:8000): ", "http://localhost:8000");
    const apiKey = await ask("API key (empty for none): ", "");
    const entry = routerEntry(url, apiKey);
    const file = configPath();
    const existing = loadConfig(file);
    const willWrite =
      process.argv.includes("--write") ||
      (await ask(`Write to ${file}? [y/N] `, "n")).toLowerCase() === "y";
    if (willWrite && existing === null && fs.existsSync(file)) {
      console.log(`\nCould not parse ${file} (JSONC with comments?). Edit it manually:\n`);
      console.log(snippet("jev-router", entry));
    } else if (willWrite) {
      writeConfig(file, mergeConfig(existing, "jev-router", entry));
      console.log(`\nWrote "jev-router" into ${file}. Restart opencode to load the server.`);
    } else {
      console.log("\nPaste this into your opencode.json / opencode.jsonc:\n");
      console.log(snippet("jev-router", entry));
    }
  } finally {
    rl.close();
  }
}

// -- decision core: never throws; always returns a text-able verdict ---------
async function decide(question, options, instructions) {
  let verdict;
  try {
    verdict = await askJev({
      question,
      options,
      instructions,
      url: JEV_URL,
      apiKey: JEV_API_KEY,
    });
  } catch (err) {
    return {
      error: err.message,
      advice: "decision server unreachable — fall back to your own tool judgment.",
    };
  }
  return { ...verdict, advice: adviceFor(verdict) };
}

const textContent = (obj) => [{ type: "text", text: JSON.stringify(obj, null, 2) }];

if (process.argv[2] === "init") {
  await init();
  process.exit(0);
}

const server = new McpServer({ name: "jev-router", version: VERSION });

server.registerTool(
  "route_code",
  {
    description:
      "Decide whether a code question should be answered by codegraph (exact symbols, signatures, call paths, blast radius, source), graft (repo overview, module wiring, related files), both, or neither (not a code-structure question). Returns the choice with confidence so the agent knows which tool to call.",
    inputSchema: {
      question: z.string().describe("The developer question to route."),
    },
  },
  async ({ question }) => {
    const options = Object.entries(DEFAULT_CRITERIA).map(([id, description]) => ({
      id,
      description,
    }));
    const verdict = await decide(
      question,
      options,
      "Choose which code-intelligence tool should answer this developer question.",
    );
    return { content: textContent(verdict) };
  },
);

server.registerTool(
  "route_query",
  {
    description:
      "Generic router: given a question and a list of tool options (id + when-to-use description), uses the decision engine to pick the best tool. Route_code is a preset of this.",
    inputSchema: {
      question: z.string().describe("The question to route."),
      options: z
        .array(
          z.object({
            id: z.string().describe("Short unique tool label (the choice returned)."),
            description: z
              .string()
              .describe("What the tool is good for — when to pick it."),
          }),
        )
        .describe("The candidate tools: id + when-to-use description."),
    },
  },
  async ({ question, options }) => {
    const verdict = await decide(question, options, INSTRUCTIONS);
    return { content: textContent(verdict) };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);