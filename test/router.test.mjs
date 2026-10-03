import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeJevUrl,
  buildBody,
  parseVerdict,
  adviceFor,
  askJev,
  pickEnv,
  envConfig,
} from "../src/jev.js";

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