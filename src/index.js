#!/usr/bin/env node
// laya-router-mcp: wraps a Laya decision engine as an MCP server so an agent
// can route a question to the right tool before calling it.
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { askLaya, DEFAULT_CRITERIA, adviceFor } from "./laya.js";

const LAYA_URL = process.env.LAYA_URL ?? "http://localhost:8000";
const LAYA_API_KEY = process.env.LAYA_API_KEY ?? "";
const INSTRUCTIONS =
  process.env.LAYA_ROUTER_INSTRUCTIONS ??
  "Choose which available tool should answer this question. Pick the one whose description best matches what the question needs.";
const NAME = "laya-router";
const VERSION = "0.1.0";

// -- decision core (shareable): never throws; returns a text-able verdict -----
async function decide(question, options, instructions) {
  let verdict;
  try {
    verdict = await askLaya({
      question,
      options,
      instructions,
      url: LAYA_URL,
      apiKey: LAYA_API_KEY,
    });
  } catch (err) {
    return {
      error: err.message,
      advice: "laya unreachable — fall back to your own tool judgment.",
    };
  }
  return { ...verdict, advice: adviceFor(verdict) };
}

const textContent = (obj) => [{ type: "text", text: JSON.stringify(obj, null, 2) }];

const server = new McpServer({ name: NAME, version: VERSION });

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
      "Generic router: given a question and a list of tool options (id + when-to-use description), uses the Laya decision engine to pick the best tool. Route_code is a preset of this.",
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
        .describe(
          "The candidate tools: id + when-to-use description.",
        ),
    },
  },
  async ({ question, options }) => {
    const verdict = await decide(question, options, INSTRUCTIONS);
    return { content: textContent(verdict) };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);