// Laya wire client: POST /v1/systemone with a `choice` question, parse the verdict.

export const DEFAULT_CRITERIA = {
  codegraph:
    "exact symbols, function signatures, call paths, blast radius, verbatim source lines",
  graft: "repo-level overview, wiring between modules, prose summaries, related files",
  both: "needs both precise symbols and broad repo context",
  neither: "not a question about code structure",
};

// Accept http://host:8000, .../v1, or .../v1/systemone in LAYA_URL; always hit the same endpoint.
export function normalizeLayaUrl(url) {
  let u = (url || "http://localhost:8000").trim().replace(/\/+$/, "");
  for (const suffix of ["/v1/systemone", "/v1", "/systemone"]) {
    if (u.endsWith(suffix)) {
      u = u.slice(0, -suffix.length);
      break;
    }
  }
  return `${u}/v1/systemone`;
}

export function buildBody(question, options, instructions) {
  const criteria = Object.fromEntries(options.map((o) => [o.id, o.description]));
  return {
    state: { body: question },
    questions: {
      route: { type: "choice", instructions, criteria },
    },
  };
}

export function parseVerdict(data) {
  const ans = data && data.answers && data.answers.route;
  if (!ans || !ans.choice || !ans.probabilities) {
    throw new Error(`unexpected laya response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    choice: ans.choice,
    confidence: ans.probabilities[ans.choice] ?? 0,
    probabilities: ans.probabilities,
  };
}

export async function askLaya({ question, options, instructions, url, apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(normalizeLayaUrl(url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(buildBody(question, options, instructions)),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`laya returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return parseVerdict(await res.json());
}

export function adviceFor(verdict) {
  if (verdict.choice === "neither") {
    return "No tool fits — answer from general knowledge or reasoning.";
  }
  const advice = `Call the "${verdict.choice}" tool.`;
  if (verdict.choice === "both") {
    return "Call codegraph and graft both; cross-check their outputs.";
  }
  const runnerUp = Object.entries(verdict.probabilities).sort((a, b) => b[1] - a[1])[1];
  const low =
    verdict.confidence < 0.5
      ? ` Low confidence — if the runner-up (${runnerUp ? runnerUp[0] : "?"}) looks relevant, call it too.`
      : "";
  return advice + low;
}