#!/usr/bin/env node
// jev-router-mcp: wraps a Jev decision engine (e.g. Laya) as an MCP server so
// an agent can route a question to the right tool before calling it.
//
// Usage:
//   jev-router-mcp              speak MCP over stdio
//   jev-router-mcp init         interactively collect JEV_URL/JEV_API_KEY and
//                               print a ready-to-paste opencode config snippet
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { askJev, DEFAULT_CRITERIA, adviceFor, envConfig } from "./jev.js";

const { url: JEV_URL, apiKey: JEV_API_KEY, instructions: INSTRUCTIONS } = envConfig();
const VERSION = "0.1.0";

// -- init: interactive setup for first-time installers -----------------------
async function init() {
  const isTTY = !!process.stdin.isTTY;
  if (isTTY) process.stdout.write("Jev server URL (default http://localhost:8000): ");
  // Read two lines (url, key) from stdin; plain read avoids readline's
  // EOF/close races entirely and works piped or interactive.
  const input = await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
  const [urlRaw = "", keyRaw = ""] = input.split(/\r?\n/);
  const url = urlRaw.trim() || "http://localhost:8000";
  const apiKey = keyRaw.trim();
  console.log("\nPaste this into your opencode.json / opencode.jsonc:\n");
  console.log(`"jev-router": {`);
  console.log(`  "type": "local",`);
  console.log(`  "command": ["npx", "-y", "@humayunkabir/jev-router-mcp"],`);
  console.log(`  "environment": { "JEV_URL": ${JSON.stringify(url)}, "JEV_API_KEY": ${JSON.stringify(apiKey)} },`);
  console.log(`  "enabled": true`);
  console.log(`}`);
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