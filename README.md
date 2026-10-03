# jev-router-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an agent decide
**which tool should answer a question** using a
[Jev](https://github.com/NandhaKishorM/laya) System-1 decision engine instead
of guessing. It speaks the Jev `/v1/systemone` wire protocol, so it works with
**any Jev-compatible server** — Laya is the reference implementation.

Give it a question, it returns the best tool pick with a confidence score, and
the agent calls that tool.

## What it does

- `route_code(question)` — preset that picks between `codegraph` (exact
  symbols, signatures, call paths, blast radius, source), `graft` (repo
  overview, module wiring, related files), `both`, or `neither` (not a
  code-structure question).
- `route_query(question, options)` — generic: you pass the tool ids and
  when-to-use descriptions, the decision engine picks the winner.

Both return `{ choice, confidence, probabilities, advice }` so the agent knows
what to call — and when the server is unreachable it says so and tells the
agent to fall back to its own judgment.

```
$ jev-router-mcp
→ { "choice": "graft", "confidence": 0.39,
    "probabilities": { codegraph: 0.29, graft: 0.39, both: 0.23, neither: 0.09 },
    "advice": "Call the \"graft\" tool." }
```

## Requirements

- Node.js >= 20 (global `fetch`)
- A running Jev-compatible server exposing `POST /v1/systemone` (e.g. Laya —
  see its [self-host docs](https://github.com/NandhaKishorM/laya))
- The tools you route to (e.g. graft, codegraph) configured as MCP servers in
  your client, so the agent can act on the verdict

## Install

```bash
# run directly
npx -y @humayunkabir/jev-router-mcp

# install globally
npm install -g @humayunkabir/jev-router-mcp
```

### Quick setup (interactive)

```bash
npx -y @humayunkabir/jev-router-mcp init
```

Answers two prompts (server URL, API key), then asks "Write to
`~/.config/opencode/opencode.jsonc`?" — answering **y** merges the server into
your opencode config automatically (it respects an existing `mcp.servers`
shape; refuses and prints a snippet if your config is JSONC-with-comments it
can't safely parse). Use `init --write` to skip the confirmation. Restart
opencode afterwards.

### OpenCode (manual)

Add to your `opencode.json` / `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jev-router": {
      "type": "local",
      "command": ["npx", "-y", "@humayunkabir/jev-router-mcp"],
      "environment": {
        "JEV_URL": "http://localhost:8000",
        "JEV_API_KEY": "your-bearer-token"
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
git clone https://github.com/humayunkabir/jev-router-mcp
cd jev-router-mcp
npm install
node src/index.js        # speaks MCP over stdio; for config use:
# "command": ["node", "/path/to/jev-router-mcp/src/index.js"]
```

## Configuration

| env var | default | description |
| --- | --- | --- |
| `JEV_URL` | `http://localhost:8000` | Base URL of the decision server (trailing `/v1/systemone` is normalized). |
| `JEV_API_KEY` | *(none)* | Bearer token for `POST /v1/systemone`. Omit for servers without auth. |
| `JEV_ROUTER_INSTRUCTIONS` | built-in | Instructions for the `route_query` choice question. |

`LAYA_URL` / `LAYA_API_KEY` are accepted as aliases for `JEV_URL` /
`JEV_API_KEY`, so existing Laya deployments keep working unchanged.

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

Unit tests cover URL normalization, body building, verdict parsing, advice and
env aliasing. Set `TEST_JEV_URL` (and optionally `TEST_JEV_API_KEY`) to also
run a live routing test against your server.

## License

MIT