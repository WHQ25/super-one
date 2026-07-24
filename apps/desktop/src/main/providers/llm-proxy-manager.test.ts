import { describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../agent/resolve-cli", () => ({
  getNodeRuntime: vi.fn(() => ({ env: process.env })),
}));
import {
  buildProxyConfig,
  buildProxyEnv,
  type ProxyUpstream,
} from "./llm-proxy-manager";

describe("buildProxyConfig", () => {
  const upstream: ProxyUpstream = {
    name: "test-provider",
    api_base_url: "https://example.com/v1/chat/completions",
    api_key: "test-key",
    models: ["test-model"],
    transformerUse: ["reasoning"],
  };

  it("maps configured transformers to the llms provider schema", () => {
    expect(buildProxyConfig(4321, upstream)).toEqual({
      PORT: 4321,
      HOST: "127.0.0.1",
      providers: [
        {
          name: "test-provider",
          api_base_url: "https://example.com/v1/chat/completions",
          api_key: "test-key",
          models: ["test-model"],
          transformer: { use: ["reasoning"] },
        },
      ],
    });
  });

  it("passes reasoning configuration to the proxy without exposing it to the upstream provider", () => {
    const config = buildProxyConfig(4321, {
      ...upstream,
      reasoningConfig: {
        supportsThinking: false,
        supportsEffort: true,
        thinkingParam: "none",
        effortParam: "reasoning.effort",
        effortValueMode: "openrouter",
      },
    });

    expect(config).toMatchObject({
      superoneReasoningConfig: {
        effortParam: "reasoning.effort",
        effortValueMode: "openrouter",
      },
    });
    expect((config.providers as Array<Record<string, unknown>>)[0].reasoningConfig).toBeUndefined();
  });

  it("preserves the parent environment for the proxy child", () => {
    const env = buildProxyEnv({ PORT: 4321 }, { ELECTRON_RUN_AS_NODE: "1" });

    expect(env.NODE_ENV).toBe(process.env.NODE_ENV);
    expect(env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      SUPERONE_PROXY_CONFIG: JSON.stringify({ PORT: 4321 }),
      SUPERONE_EVENT_TRACE_CHILD: "1",
      SUPERONE_EVENT_TRACE_DB: expect.stringMatching(/llm-proxy-event-trace\.db$/),
    });
  });
});
