import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  normalizeJevUrl,
  buildBody,
  parseVerdict,
  adviceFor,
  askJev,
  pickEnv,
  envConfig,
} from "../src/jev.js";
import {
  AGENTS_SECTION,
  AGENTS_INSTRUCTION,
  AGENTS_FILENAMES,
  findAgentsFile,
  agentsHasInstruction,
  appendAgentsSection,
  agentsSetupMessage,
  ensureAgentsInstruction,
} from "../src/agents.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "jev-router-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("normalizeJevUrl", () => {
  test("defaults to localhost:8000", () => {
    assert.equal(normalizeJevUrl(undefined), "http://localhost:8000/v1/systemone");
    assert.equal(normalizeJevUrl(""), "http://localhost:8000/v1/systemone");
  });
  test("appends /v1/systemone", () => {
    assert.equal(
      normalizeJevUrl("http://jev.local:9000"),
      "http://jev.local:9000/v1/systemone",
    );
  });
  test("accepts a full /v1/systemone URL", () => {
    assert.equal(
      normalizeJevUrl("http://jev.local:9000/v1/systemone"),
      "http://jev.local:9000/v1/systemone",
    );
  });
  test("strips a /v1 prefix too", () => {
    assert.equal(normalizeJevUrl("http://jev.local:9000/v1"), "http://jev.local:9000/v1/systemone");
  });
});

describe("buildBody", () => {
  test("maps options to criteria and wraps the question", () => {
    const body = buildBody(
      "where is the cache?",
      [
        { id: "grep", description: "text search" },
        { id: "graph", description: "symbols and call paths" },
      ],
      "pick one",
    );
    assert.deepEqual(body.state, { body: "where is the cache?" });
    assert.deepEqual(body.questions.route, {
      type: "choice",
      instructions: "pick one",
      criteria: { grep: "text search", graph: "symbols and call paths" },
    });
  });
});

describe("parseVerdict", () => {
  test("extracts choice and confidence", () => {
    const verdict = parseVerdict({
      answers: {
        route: {
          choice: "graph",
          probabilities: { grep: 0.2, graph: 0.7, neither: 0.1 },
        },
      },
    });
    assert.equal(verdict.choice, "graph");
    assert.equal(verdict.confidence, 0.7);
    assert.deepEqual(verdict.probabilities, { grep: 0.2, graph: 0.7, neither: 0.1 });
  });
  test("throws on a malformed response", () => {
    assert.throws(() => parseVerdict({ answers: {} }), /unexpected Jev response/);
  });
});

describe("adviceFor", () => {
  const v = (choice, probabilities) => ({ choice, confidence: probabilities[choice], probabilities });
  test("neither means answer from reasoning", () => {
    assert.match(adviceFor(v("neither", { neither: 0.8 })), /general knowledge/);
  });
  test("both means call both", () => {
    assert.match(adviceFor(v("both", { both: 0.6 })), /codegraph and graft/);
  });
  test("low confidence names the runner-up", () => {
    const advice = adviceFor(v("graph", { grep: 0.3, graph: 0.4, neither: 0.3 }));
    assert.match(advice, /Call the "graph" tool/);
    assert.match(advice, /runner-up \(grep\)/);
  });
});

describe("pickEnv", () => {
  test("prefers JEV_ over LAYA_ alias", () => {
    process.env.JEV_URL = "http://a";
    process.env.LAYA_URL = "http://b";
    assert.equal(pickEnv("URL"), "http://a");
  });
  test("falls back to LAYA_ alias", () => {
    delete process.env.JEV_URL;
    process.env.LAYA_URL = "http://b";
    assert.equal(pickEnv("URL"), "http://b");
  });
  test("empty when neither is set", () => {
    delete process.env.JEV_URL;
    delete process.env.LAYA_URL;
    assert.equal(pickEnv("URL"), "");
  });
  test("envConfig defaults", () => {
    delete process.env.JEV_URL;
    delete process.env.LAYA_URL;
    delete process.env.JEV_API_KEY;
    delete process.env.LAYA_API_KEY;
    const cfg = envConfig();
    assert.equal(cfg.url, "http://localhost:8000");
    assert.equal(cfg.apiKey, "");
  });
});

describe("askJev (live, gated)", async () => {
  const url = process.env.TEST_JEV_URL;
  const apiKey = process.env.TEST_JEV_API_KEY;
  test("routes a real question when TEST_JEV_URL is set", { skip: !url }, async () => {
    const verdict = await askJev({
      question: "Give me a high-level overview of how the onboarding intent modules fit together",
      options: Object.entries({
        codegraph: "exact symbols, signatures, call paths, source",
        graft: "repo overview, module wiring, related files",
        both: "needs precise symbols and broad context",
        neither: "not a code question",
      }).map(([id, description]) => ({ id, description })),
      instructions: "Choose which code-intelligence tool should answer this question.",
      url,
      apiKey,
    });
    assert.ok(["codegraph", "graft", "both", "neither"].includes(verdict.choice));
    assert.ok(verdict.confidence >= 0 && verdict.confidence <= 1);
  });
});

describe("agents file", () => {
  test("findAgentsFile finds AGENTS.md", (t) => {
    const dir = tempDir(t);
    writeFileSync(path.join(dir, "AGENTS.md"), "hello");
    assert.equal(findAgentsFile(dir), path.join(dir, "AGENTS.md"));
  });
  test("findAgentsFile finds a lowercase agents.md too", (t) => {
    const dir = tempDir(t);
    writeFileSync(path.join(dir, "agents.md"), "hello");
    const file = findAgentsFile(dir);
    assert.ok(file);
    assert.ok(AGENTS_FILENAMES.includes(path.basename(file)));
    assert.ok(existsSync(file));
  });
  test("findAgentsFile returns null when absent", (t) => {
    const dir = tempDir(t);
    assert.equal(findAgentsFile(dir), null);
  });
  test("agentsHasInstruction detects the section or the instruction phrase", () => {
    assert.ok(agentsHasInstruction("## Code routing\n\nWhen a question needs..."));
    assert.ok(agentsHasInstruction(AGENTS_INSTRUCTION));
    assert.ok(agentsHasInstruction("...call `route_code` first, then the tool it picks"));
    assert.ok(agentsHasInstruction("## code routing")); // lowercase heading still counts
    assert.ok(agentsHasInstruction("### CODE ROUTING")); // any heading level/casing counts
    assert.ok(agentsHasInstruction("Call route_code first and then the tool it picks")); // no backticks
    assert.ok(!agentsHasInstruction("please use route_code here")); // bare mention is not installed
    assert.ok(!agentsHasInstruction("Code routing is handled by our ops dashboard")); // prose, not a heading
    assert.ok(!agentsHasInstruction("no instructions here"));
  });
  test("appendAgentsSection adds a blank-line-separated section", () => {
    const out = appendAgentsSection("# Repo\n");
    assert.match(out, /\n\n## Code routing\n\n/);
    assert.ok(out.endsWith("`both`).\n"));
  });
  test("appendAgentsSection handles an empty file", () => {
    assert.equal(appendAgentsSection(""), `${AGENTS_SECTION}\n`);
  });
  test("agentsSetupMessage says where and what to add", () => {
    const msg = agentsSetupMessage("/tmp/repo");
    assert.match(msg, /\/tmp\/repo/);
    assert.match(msg, /AGENTS\.md/);
    assert.match(msg, /route_code/);
  });
  test("ensureAgentsInstruction adds once, then reports exists unchanged", (t) => {
    const dir = tempDir(t);
    const file = path.join(dir, "AGENTS.md");
    writeFileSync(file, "# Notes\n");
    const first = ensureAgentsInstruction(dir);
    assert.equal(first.status, "added");
    assert.equal(first.filePath, file);
    const content = readFileSync(file, "utf8");
    assert.match(content, /## Code routing/);
    assert.match(content, /route_code/);
    const second = ensureAgentsInstruction(dir);
    assert.equal(second.status, "exists");
    assert.equal(readFileSync(file, "utf8"), content);
  });
  test("ensureAgentsInstruction reports missing", (t) => {
    const dir = tempDir(t);
    const out = ensureAgentsInstruction(dir);
    assert.equal(out.status, "missing");
    assert.match(out.message, /AGENTS\.md/);
  });
  test("README documents the same instruction init installs", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    assert.ok(readme.includes(AGENTS_INSTRUCTION), "README should contain the instruction text");
    assert.ok(readme.includes("## Code routing"), "README should show the section heading");
  });
});

describe("init (AGENTS.md wiring)", () => {
  const runInit = (cwd, input) =>
    spawnSync(process.execPath, [path.join(repoRoot, "src", "index.js"), "init"], {
      cwd,
      input,
      encoding: "utf8",
    });

  test("adds code-routing instructions to an existing AGENTS.md", (t) => {
    const dir = tempDir(t);
    writeFileSync(path.join(dir, "AGENTS.md"), "# Repo\n");
    const res = runInit(dir, "http://localhost:8000\nkey\n");
    assert.equal(res.status, 0);
    assert.match(res.stdout, /"jev-router": {/);
    assert.match(res.stdout, /Added code-routing instructions to/);
    const content = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(content, /## Code routing/);
    assert.match(content, /route_code/);
  });

  test("does not duplicate when AGENTS.md already has the instruction", (t) => {
    const dir = tempDir(t);
    writeFileSync(path.join(dir, "AGENTS.md"), `# Repo\n\n${AGENTS_SECTION}\n`);
    const res = runInit(dir, "http://localhost:8000\nkey\n");
    assert.equal(res.status, 0);
    assert.match(res.stdout, /already has code-routing instructions/);
  });

  test("running init twice never appends a second copy", (t) => {
    const dir = tempDir(t);
    const file = path.join(dir, "AGENTS.md");
    writeFileSync(file, "# Repo\n");
    const first = runInit(dir, "http://localhost:8000\nkey\n");
    assert.equal(first.status, 0);
    assert.match(first.stdout, /Added code-routing instructions/);
    const afterFirst = readFileSync(file, "utf8");
    assert.equal((afterFirst.match(/## Code routing/g) || []).length, 1);

    const second = runInit(dir, "http://localhost:8000\nkey\n");
    assert.equal(second.status, 0);
    assert.match(second.stdout, /already has code-routing instructions/);
    assert.equal(readFileSync(file, "utf8"), afterFirst);
  });

  test("prints exactly what to add where when no AGENTS.md exists", (t) => {
    const dir = tempDir(t);
    const res = runInit(dir, "http://localhost:8000\nkey\n");
    assert.equal(res.status, 0);
    assert.match(res.stdout, /No AGENTS\.md found/);
    assert.match(res.stdout, /Create one at the repo root/);
    assert.match(res.stdout, /## Code routing/);
    assert.match(res.stdout, /route_code/);
  });
});