import { expect, it } from "vitest";
import { PlanningCallError, type PlanningExecutionConfig } from "@tuyile/core";
import { CompatiblePlanningProvider } from "@tuyile/infrastructure";

const config: PlanningExecutionConfig = {
  mode: "openai",
  baseUrl: "https://synthetic.invalid/v1",
  apiKey: "synthetic",
  model: "test-planner",
  supportsImages: true,
  responseMode: "json_object",
  maxOutputTokens: 1024,
  maxInputCharacters: 1000,
};
const privateFailure = (code: string) =>
  Object.assign(new TypeError("PRIVATE_ERROR https://private.invalid"), {
    cause: { code },
  });
async function failure(
  fetcher: typeof fetch,
  signal = new AbortController().signal,
) {
  try {
    await new CompatiblePlanningProvider(false, fetcher).complete(
      config,
      [{ role: "user", content: "Return JSON" }],
      256,
      signal,
    );
    throw new Error("EXPECTED_FAILURE");
  } catch (error) {
    expect(error).toBeInstanceOf(PlanningCallError);
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_|private\.invalid/);
    return error as PlanningCallError;
  }
}
it.each([
  ["ENOTFOUND", "PLANNING_DNS_FAILURE"],
  ["EAI_AGAIN", "PLANNING_DNS_FAILURE"],
  ["UND_ERR_CONNECT_TIMEOUT", "PLANNING_CONNECT_TIMEOUT"],
  ["ETIMEDOUT", "PLANNING_CONNECT_TIMEOUT"],
  ["ECONNREFUSED", "PLANNING_CONNECT_REFUSED"],
  ["ECONNRESET", "PLANNING_CONNECTION_LOST"],
  ["CERT_HAS_EXPIRED", "PLANNING_TLS_FAILURE"],
  ["UND_ERR_HEADERS_TIMEOUT", "PLANNING_RESPONSE_TIMEOUT"],
  ["UNRECOGNIZED_PRIVATE_CODE", "PLANNING_TRANSPORT_FAILED"],
])(
  "classifies %s without retaining private exception data or retrying",
  async (code, diagnosticCode) => {
    let calls = 0;
    const error = await failure(async () => {
      calls++;
      throw privateFailure(code);
    });
    expect(error).toMatchObject({
      kind: "unknown",
      code: "PLANNING_RESULT_UNKNOWN",
      diagnosticCode,
    });
    expect(calls).toBe(1);
  },
);
it.each([
  ["UND_ERR_BODY_TIMEOUT", "PLANNING_RESPONSE_TIMEOUT"],
  ["ECONNRESET", "PLANNING_CONNECTION_LOST"],
  ["OTHER", "PLANNING_RESPONSE_READ_FAILED"],
])("classifies response read failure %s", async (code, diagnosticCode) => {
  const error = await failure(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(privateFailure(code));
          },
        }),
      ),
  );
  expect(error.diagnosticCode).toBe(diagnosticCode);
});
it("distinguishes outer JSON parsing from a valid envelope with invalid content", async () => {
  expect(
    await failure(async () => new Response("PRIVATE_BODY <html>")),
  ).toMatchObject({
    code: "PLANNING_RESULT_UNKNOWN",
    diagnosticCode: "PLANNING_RESPONSE_JSON_INVALID",
  });
  const error = await failure(async () => Response.json({ choices: [] }));
  expect(error.code).toBe("PLANNING_RESPONSE_INVALID");
  expect(error.diagnosticCode).toBeUndefined();
});
it("preserves explicit HTTP rejection and interrupted-call semantics", async () => {
  const rejected = await failure(
    async () => new Response(null, { status: 429 }),
  );
  expect(rejected).toMatchObject({
    kind: "rejected",
    code: "UPSTREAM_RATE_LIMIT",
    status: 429,
  });
  expect(rejected.diagnosticCode).toBeUndefined();
  const controller = new AbortController();
  const interrupted = await failure(async () => {
    controller.abort();
    throw privateFailure("ECONNRESET");
  }, controller.signal);
  expect(interrupted.code).toBe("PLANNING_INTERRUPTED");
  expect(interrupted.diagnosticCode).toBeUndefined();
});
