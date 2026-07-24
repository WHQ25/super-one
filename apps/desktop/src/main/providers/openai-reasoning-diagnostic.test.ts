import { afterEach, describe, expect, it, vi } from "vitest";

const { traceMock } = vi.hoisted(() => ({ traceMock: vi.fn() }));

vi.mock("../agent/event-trace", () => ({ trace: traceMock }));

import {
  normalizeAdaptiveThinkingRequest,
  normalizeOpenAiReasoningRequest,
  OpenAiReasoningDiagnostic,
} from "./openai-reasoning-diagnostic";

describe("OpenAiReasoningDiagnostic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports reasoning field names without logging the reasoning text", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\ndata: [DONE]\n\n';
    const diagnostic = new OpenAiReasoningDiagnostic();

    const response = await diagnostic.transformResponseOut(
      new Response(sse, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    expect(await response.text()).toBe(sse);
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("delta.reasoning_content"),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("keys=delta=[reasoning_content]"),
    );
    expect(write).not.toHaveBeenCalledWith(
      expect.stringContaining("private reasoning"),
    );
    expect(traceMock).toHaveBeenCalledWith(
      "llm-proxy.upstream",
      "sse",
      { choices: [{ delta: { reasoning_content: "private reasoning" } }] },
      undefined,
    );
  });

  it("maps adaptive thinking to enabled before the Anthropic conversion", () => {
    const adaptive = { thinking: { type: "adaptive" } };
    const disabled = { thinking: { type: "disabled" } };

    normalizeAdaptiveThinkingRequest(adaptive);
    normalizeAdaptiveThinkingRequest(disabled);

    expect(adaptive).toEqual({ thinking: { type: "enabled" } });
    expect(disabled).toEqual({ thinking: { type: "disabled" } });
  });

  it("maps enabled GPT-5 reasoning to reasoning_effort", () => {
    const request = {
      model: "gpt-5.6-sol",
      reasoning: { enabled: true, effort: "high" },
      thinking: { type: "enabled" },
      enable_thinking: true,
    };

    normalizeOpenAiReasoningRequest(request);

    expect(request).toEqual({
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
    });
  });
});
