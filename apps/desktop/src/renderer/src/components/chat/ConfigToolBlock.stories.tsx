import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import type {
  ConfigConfirmField,
  ConfigConfirmPayload,
} from "@superone/shared/agent-types";
import {
  customEndpointsFor,
  type Credential,
  type Platform,
  type ServiceEndpoint,
} from "@superone/shared/platform-registry";
import { mockIpc } from "../../../../../.storybook/mock-ipc";
import { ConfigConfirmPrompt } from "./ConfigConfirmPrompt";
import { ToolBlock } from "./ToolBlock";

const RELAY: Platform = {
  id: "custom:relay",
  brand: "custom",
  name: "My Relay",
  plans: [
    {
      id: "api",
      name: "API",
      auth: "api-key",
      baseUrl: "https://relay.example.com",
      endpoints: customEndpointsFor(["openai-chat", "openai-images"]).map((endpoint: ServiceEndpoint) => ({
        ...endpoint,
        defaults: {
          extraEnv: { ANTHROPIC_API_TIMEOUT_MS: "60000", KEEP_ME: "1" },
        },
      })),
    },
  ],
};

const RELAY_KEY: Credential = {
  id: "cred-1",
  platformId: RELAY.id,
  planId: "api",
  name: "Personal Key",
  secret: "***abc123",
  notes: "",
  sortOrder: 0,
  overrides: {
    openai: {
      models: [
        { id: "glm-4.5", name: "GLM 4.5", tasks: ["chat"] },
        { id: "seedream-4", name: "Seedream 4", tasks: ["image"] },
      ],
    },
  },
};

const PLATFORM_CONTEXT = { platformId: RELAY.id, planId: "api" };
const ENDPOINT_CONTEXT = {
  ...PLATFORM_CONTEXT,
  endpointId: "openai",
  credentialId: RELAY_KEY.id,
};

function field(
  partial: Omit<ConfigConfirmField, "domain"> & { domain?: string },
): ConfigConfirmField {
  return { domain: "custom-platform", ...partial };
}

function resourcePayload(
  operation: "create" | "update" | "delete",
  fields: ConfigConfirmField[],
  overrides: Partial<ConfigConfirmPayload["resource"]> = {},
): ConfigConfirmPayload {
  return {
    resource: {
      resource: "custom-platform",
      operation,
      recordId: RELAY.id,
      title: "My Relay",
      subtitle: "custom",
      context: PLATFORM_CONTEXT,
      fields,
      ...overrides,
    } as NonNullable<ConfigConfirmPayload["resource"]>,
  };
}

mockIpc("app", "listPlatforms", () => Promise.resolve([RELAY]));
mockIpc("app", "listCredentials", () => Promise.resolve([RELAY_KEY]));
mockIpc("app", "listBindings", () => Promise.resolve([]));

function ConfigPermissionPrompt({
  payload,
}: {
  payload: ConfigConfirmPayload;
}) {
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="@container w-[560px]">
      <ConfigConfirmPrompt
        payload={payload}
        onConfirm={(values) => setResult(`confirm ${JSON.stringify(values)}`)}
        onReject={(feedback) => setResult(`reject "${feedback}"`)}
      />
      {result && (
        <pre className="mx-3 rounded bg-muted/40 p-2 text-[10px] break-all whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}

function StoryShell({
  children,
  width = 680,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="@container space-y-4" style={{ maxWidth: width }}>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
  );
}

function block(
  tool: string,
  input: Record<string, unknown>,
  opts: {
    status?: "streaming" | "complete";
    result?: string;
    isError?: boolean;
  } = {},
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__${tool}`}
      input={JSON.stringify(input)}
      status={opts.status ?? "complete"}
      result={opts.result}
      isError={opts.isError}
    />
  );
}

const meta: Meta = {
  title: "Tool UI/SuperOne MCP/Config",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

export const Gallery: Story = {
  name: "Gallery",
  render: () => (
    <StoryShell>
      <Note>Config MCP tools grouped by tool-level stories.</Note>
      <Section title="config_read / config_apply">
        {block("config_read", { domain: "appearance" })}
        {block(
          "config_apply",
          { changes: [{ key: "theme", value: "dark" }] },
          { status: "streaming", result: JSON.stringify({ status: "ok" }) },
        )}
      </Section>
    </StoryShell>
  ),
};

export const ConfigRead: Story = {
  name: "config_read",
  render: () => (
    <StoryShell>
      <Section title="config_read">
        {block("config_read", { domain: "appearance" })}
        {block(
          "config_read",
          { domain: "widget" },
          {
            result: JSON.stringify({
              label: "Appearance",
              value: { theme: "dark" },
            }),
          },
        )}
      </Section>
    </StoryShell>
  ),
};

export const ConfigApply: Story = {
  name: "config_apply",
  render: () => (
    <StoryShell>
      <Section title="config_apply">
        {block(
          "config_apply",
          { changes: [{ key: "theme", value: "dark" }] },
          { status: "streaming" },
        )}
        {block(
          "config_apply",
          { changes: [{ key: "theme", value: "dark" }] },
          {
            result: JSON.stringify({
              status: "ok",
              changes: [{ key: "theme", value: "dark" }],
            }),
          },
        )}
        {block(
          "config_apply",
          { changes: [{ key: "theme", value: "light" }] },
          {
            result: JSON.stringify({
              status: "error",
              message: "config key forbidden by policy",
            }),
            isError: true,
          },
        )}
      </Section>
    </StoryShell>
  ),
};

export const AppSettings: Story = {
  name: "config_apply · Permission Prompt · app settings",
  render: () => (
    <ConfigPermissionPrompt
      payload={{
        fields: [
          field({
            domain: "general",
            key: "analyticsEnabled",
            label: "Analytics",
            type: "boolean",
            currentValue: true,
            proposedValue: false,
          }),
          field({
            domain: "general",
            key: "updateChannel",
            label: "Update Channel",
            type: "enum",
            enumValues: ["alpha", "beta", "stable"],
            clearable: true,
            note: "Clear to follow the channel this build shipped on.",
            currentValue: "stable",
            proposedValue: "beta",
          }),
          field({
            domain: "appearance",
            key: "terminalFontSize",
            label: "Terminal Font Size",
            type: "number",
            min: 12,
            max: 22,
            currentValue: 14,
            proposedValue: 16,
          }),
          field({
            domain: "appearance",
            key: "uiFontFamily",
            label: "UI Font",
            type: "string",
            clearable: true,
            currentValue: null,
            proposedValue: "Inter",
          }),
          field({
            domain: "appearance",
            key: "terminalDarkPalette",
            label: "Terminal Dark Palette",
            type: "enum",
            enumValues: [
              "monokai-remastered",
              "catppuccin-mocha",
              "tokyo-night",
              "dracula",
            ],
            clearable: true,
            currentValue: null,
            proposedValue: "dracula",
          }),
          field({
            domain: "appearance",
            key: "mermaidLightTheme",
            label: "Mermaid Light Theme",
            type: "enum",
            enumValues: [
              "default",
              "forest",
              "neutral",
              "neo",
              "redux",
              "redux-color",
            ],
            clearable: true,
            currentValue: null,
            proposedValue: "forest",
          }),
        ],
      }}
    />
  ),
};

export const SingleEnvVar: Story = {
  name: "config_apply · Permission Prompt · environment variable",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload("update", [
        field({
          key: "extraEnv",
          label: "Environment Variables",
          type: "env",
          currentValue: { ANTHROPIC_API_TIMEOUT_MS: "60000", KEEP_ME: "1" },
          proposedValue: { ANTHROPIC_API_TIMEOUT_MS: "120000", KEEP_ME: "1" },
        }),
      ])}
    />
  ),
};

export const ModelMapping: Story = {
  name: "config_apply · Permission Prompt · model mapping",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload("update", [
        field({
          key: "modelMapping",
          label: "Model Mapping",
          type: "model-mapping",
          currentValue: { opus: { id: "glm-4.5", name: "GLM 4.5" } },
          proposedValue: {
            opus: { id: "glm-4.6", name: "GLM 4.6" },
            haiku: { id: "glm-4.5-air" },
          },
        }),
      ])}
    />
  ),
};

export const Capabilities: Story = {
  name: "config_apply · Permission Prompt · capabilities",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload("update", [
        field({
          key: "capabilities",
          label: "Formats & Capabilities",
          type: "capabilities",
          currentValue: {
            families: ["openai"],
            tasks: { openai: ["chat", "image"] },
            extras: {},
          },
          proposedValue: {
            families: ["openai", "anthropic"],
            tasks: { openai: ["chat", "image", "video"], anthropic: ["chat"] },
            extras: { openai: ["openai-responses"] },
          },
        }),
      ])}
    />
  ),
};

export const EnabledModels: Story = {
  name: "config_apply · Permission Prompt · enabled models",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload(
        "update",
        [
          field({
            domain: "ai-provider",
            key: "models",
            label: "Enabled Models",
            type: "models",
            context: ENDPOINT_CONTEXT,
            currentValue: [
              { id: "glm-4.5", name: "GLM 4.5", tasks: ["chat"] },
              { id: "seedream-4", name: "Seedream 4", tasks: ["image"] },
            ],
            proposedValue: [
              { id: "glm-4.6", name: "GLM 4.6", tasks: ["chat"] },
              { id: "seedream-4", name: "Seedream 4", tasks: ["image"] },
            ],
          }),
        ],
        {
          resource: "ai-provider",
          recordId: RELAY_KEY.id,
          title: "Personal Key",
          subtitle: "custom:relay / api",
          context: ENDPOINT_CONTEXT,
        },
      )}
    />
  ),
};

export const CreateProvider: Story = {
  name: "config_apply · Permission Prompt · create provider",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload(
        "create",
        [
          field({
            key: "name",
            label: "Name",
            type: "string",
            currentValue: null,
            proposedValue: "My Relay",
          }),
          field({
            key: "baseUrl",
            label: "Base URL",
            type: "string",
            currentValue: null,
            proposedValue: "https://relay.example.com",
          }),
          field({
            key: "capabilities",
            label: "Formats & Capabilities",
            type: "capabilities",
            currentValue: null,
            proposedValue: {
              families: ["openai"],
              tasks: { openai: ["chat", "image"] },
              extras: {},
            },
          }),
          field({
            key: "extraEnv",
            label: "Environment Variables",
            type: "env",
            currentValue: null,
            proposedValue: { ANTHROPIC_API_TIMEOUT_MS: "600000" },
          }),
          field({
            key: "apiKey",
            label: "API Key",
            type: "string",
            secret: true,
            currentValue: null,
            proposedValue: "sk-example-123456",
          }),
          field({
            key: "keyName",
            label: "Key Label",
            type: "string",
            currentValue: null,
            proposedValue: "Personal Key",
          }),
        ],
        { recordId: undefined, title: "My Relay", subtitle: undefined },
      )}
    />
  ),
};

export const DeleteProvider: Story = {
  name: "config_apply · Permission Prompt · delete provider",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload("delete", [], {
        title: "My Relay",
        subtitle: "custom · 1 key",
      })}
    />
  ),
};

export const MixedFields: Story = {
  name: "config_apply · Permission Prompt · mixed fields",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload("update", [
        field({
          key: "name",
          label: "Name",
          type: "string",
          currentValue: "My Relay",
          proposedValue: "Work Relay",
        }),
        field({
          key: "baseUrl",
          label: "Base URL",
          type: "string",
          currentValue: "https://relay.example.com/v1",
          proposedValue: "https://relay.internal/v1",
        }),
        field({
          key: "capabilities",
          label: "Formats & Capabilities",
          type: "capabilities",
          currentValue: {
            families: ["openai"],
            tasks: { openai: ["chat"] },
            extras: {},
          },
          proposedValue: {
            families: ["openai"],
            tasks: { openai: ["chat", "image"] },
            extras: {},
          },
        }),
        field({
          key: "extraEnv",
          label: "Environment Variables",
          type: "env",
          currentValue: { KEEP_ME: "1" },
          proposedValue: { KEEP_ME: "1", ANTHROPIC_API_TIMEOUT_MS: "600000" },
        }),
      ])}
    />
  ),
};

export const RawJsonFallback: Story = {
  name: "config_apply · Permission Prompt · raw JSON fallback",
  render: () => (
    <ConfigPermissionPrompt
      payload={resourcePayload("update", [
        field({
          key: "schedule",
          label: "Schedule",
          type: "json",
          note: "Only reached by fields with no dedicated editor.",
          currentValue: JSON.stringify(
            { type: "recurring", preset: "daily" },
            null,
            2,
          ),
          proposedValue: JSON.stringify(
            { type: "recurring", preset: "weekly", dayOfWeek: 1 },
            null,
            2,
          ),
        }),
      ])}
    />
  ),
};
