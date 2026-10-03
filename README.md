# laya-router-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an agent decide
**which tool should answer a question** using a [Laya](https://github.com/NandhaKishorM/laya)
decision engine instead of guessing. Point it at any Laya `/v1/systemone`
endpoint, give it a list of your tools, and it returns the best pick with a
confidence score.

## What it does

- `route_code(question)` — preset that picks between `codegraph` (exact
  symbols, signatures, call paths, blast radius, source), `graft` (repo
  overview, module wiring, related files), `both`, or `neither` (not a
  code-structure question).
- `route_query(question, options)` — generic: you pass the tool ids and
  when-to-use descriptions, Laya picks the winner.

Both return `{ choice, confidence, probabilities, advice }` so the agent
knows what to call — and when the router is unreachable it says so and tells
the agent to fall back to its own judgment.

```
$ laya-router-mcp
→ { "choice": "graft", "confidence": 0.39,
    "probabilities": { codegraph: 0.29, graft: 0.39, both: 0.23, neither: 0.09 },
    "advice": "Call the \"graft\" tool." }
```

## Requirements

- Node.js >= 20 (global `fetch`)
- A running Laya server exposing `POST /v1/systemone` (see the
  [Laya self-host docs](https://github.com/NandhaKishorM/laya))
- The tools you route to (e.g. graft, codegraph) configured as MCP servers in
  your client, so the agent can act on the verdict

## Install

Published on npm:

```bash
# run directly
npx -y @humayunkabir/laya-router-mcp

# or install globally
npm install -g @humayunkabir/laya-router-mcp
```

### OpenCode

Add to your `opencode.json` / `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "laya-router": {
      "type": "local",
      "command": ["npx", "-y", "@humayunkabir/laya-router-mcp"],
      "environment": {
        "LAYA_URL": "http://localhost:8000",
        "LAYA_API_KEY": "your-laya-bearer-token"
      },
      "enabled": true
    }
  }
}
```

Any MCP client works the same way (Claude Desktop, Cursor, ...): configure a
stdio server with the `npx` command and the env vars below.

### Local checkout

```bash
git clone https://github.com/humayunkabir/laya-router-mcp
cd laya-router-mcp
npm install
node src/index.js        # speaks MCP over stdio; for config use:
# "command": ["node", "/path/to/laya-router-mcp/src/index.js"]
```

## Configuration

| env var | default | description |
| --- | --- | --- |
| `LAYA_URL` | `http://localhost:8000` | Base URL of the Laya server (trailing `/v1/systemone` is normalized). |
| `LAYA_API_KEY` | *(none)* | Bearer token for `POST /v1/systemone`. Omit for servers without auth. |
| `LAYA_ROUTER_INSTRUCTIONS` | built-in | Instructions for the `route_query` choice question. |

`LAYA_API_KEY` is optional — the container in the Laya quickstart ships with
auth, so set it there.

## Using it

Tell the agent to consult the router before answering code-intelligence
questions, e.g. in your `AGENTS.md`:

```markdown
When a question needs code structure or repo context, call `route_code`
first, then the MCP tool it picks (or both when the verdict says `both`).
```

Example session:

1. “Why is `MAX_BODY_BYTES` enforced in two places in serve.py?” →
   `route_code` → `codegraph` (symbols & call paths) → agent calls
   `codegraph_explore`.
2. “How do the onboarding modules fit together?” → `route_code` → `graft` →
   agent calls `graft_trace_calls` / `graft_repo_map`.
3. “Explain how JWT refresh tokens work” → `route_code` → `neither` →
   agent answers from reasoning, no code tool needed.

## Development

```bash
npm test
```

The unit tests cover URL normalization, body building, verdict parsing and
advice. Set `TEST_LAYA_URL` (and optionally `TEST_LAYA_API_KEY`) to also run
one live routing test against your Laya server.

## License

MIT