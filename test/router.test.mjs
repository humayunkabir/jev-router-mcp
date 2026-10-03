import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLayaUrl,
  buildBody,
  parseVerdict,
  adviceFor,
  askLaya,
} from "../src/laya.js";

describe("normalizeLayaUrl", () => {
  test("defaults to localhost:8000", () => {
    assert.equal(normalizeLayaUrl(undefined), "http://localhost:8000/v1/systemone");
    assert.equal(normalizeLayaUrl(""), "http://localhost:8000/v1/systemone");
  });
  test("appends /v1/systemone", () => {
    assert.equal(
      normalizeLayaUrl("http://laya.local:9000"),
      "http://laya.local:9000/v1/systemone",
    );
  });
  test("accepts a full /v1/systemone URL", () => {
    assert.equal(
      normalizeLayaUrl("http://laya.local:9000/v1/systemone"),
      "http://laya.local:9000/v1/systemone",
    );
  });
  test("strips a /v1 prefix too", () => {
    assert.equal(normalizeLayaUrl("http://laya.local:9000/v1"), "http://laya.local:9000/v1/systemone");
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
    assert.throws(() => parseVerdict({ answers: {} }), /unexpected laya response/);
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

describe("askLaya (live, gated)", async () => {
  const url = process.env.TEST_LAYA_URL;
  const apiKey = process.env.TEST_LAYA_API_KEY;
  test("routes a real question when TEST_LAYA_URL is set", { skip: !url }, async () => {
    const verdict = await askLaya({
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