import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PermissionRequest } from "@superone/shared/agent-types";
import type { ReactNode } from "react";
import { ComputerUseGrantPrompt } from "./ComputerUseGrantPrompt";
import { ToolBlock } from "./ToolBlock";
import type { ComputerOp } from "./computer-tool-display";

function StoryShell({
  children,
  width = 720,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
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

function tool(
  op: ComputerOp,
  options: {
    description: string;
    input?: Record<string, unknown>;
    result?: string;
    status?: "streaming" | "complete";
    elapsedSeconds?: number;
    isError?: boolean;
  },
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__computer_${op}`}
      input={JSON.stringify({
        description: options.description,
        ...(options.input ?? {}),
      })}
      result={options.result}
      status={options.status ?? "complete"}
      elapsedSeconds={options.elapsedSeconds}
      isError={options.isError}
    />
  );
}

/** Tiny 1×1 green PNG as a stand-in app icon. */
const SAMPLE_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makePermissionRequest(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    requestId: "story-cugrant-1",
    toolName: "computer_snapshot",
    input: { app: "豆包", bundleId: "com.bot.pc.doubao" },
    allowAlwaysAllow: true,
    supportsAlwaysPersist: true,
    requestKind: "computer_use_grant",
    message: "Allow Computer Use for 豆包?",
    subtitle: "com.bot.pc.doubao",
    riskLevel: "medium",
    computerUseGrant: {
      app: "豆包",
      bundleId: "com.bot.pc.doubao",
      toolName: "computer_snapshot",
      iconDataUri: SAMPLE_ICON,
    },
    ...overrides,
  };
}

function ComputerPermissionPrompt({ request }: { request: PermissionRequest }) {
  return (
    <StoryShell width={560}>
      <ComputerUseGrantPrompt
        request={request}
        onSessionAllow={() => {}}
        onAlwaysAllow={() => {}}
        onDeny={() => {}}
      />
    </StoryShell>
  );
}

const meta: Meta = {
  title: "Tool UI/SuperOne MCP/Computer",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

const TOON_OUTLINE = [
  "outline[12]{ref,depth,role,name,value,x,y,w,h,can,state}:",
  '  @e1,0,window,Kimi,"",0,0,1300,800,focus,""',
  '  @e2,1,group,Kimi,"",0,0,1300,800,setText|typeText,""',
  '  @e8,3,webArea,Kimi Agent,"",0,0,1300,800,typeText,""',
  '  @e12,6,tabGroup,"","",8,48,224,36,"",""',
  '  @e13,7,radioButton,Work,"1",10,50,110,32,press,""',
  '  @e14,7,radioButton,Chat,"0",120,50,110,32,press,focused',
  '  @e16,6,button,新建任务,"",8,96,224,40,press,""',
  '  @e18,7,button,看板,"",8,144,224,40,press,""',
  '  @e19,7,button,插件,"",8,184,224,40,press,""',
  '  @e20,7,button,定时任务,"",8,224,224,40,press,""',
  '  @e52,8,textArea,"",尽管问，或做个任务...,392,319,752,60,press|setText|typeText,""',
  '  @e61,9,button,"","",1106,391,36,36,press,disabled',
].join("\n");

/**
 * The outline ships to the model as one compact TOON string. Rendered naively
 * that is a single 10k-character JSON line, so the block splits it back out
 * into a real table — this story is what guards that.
 */
export const Gallery: Story = {
  render: () => (
    <StoryShell width={760}>
      <Note>
        Split by action family for easier component-level verification.
      </Note>
      <Section title="App lifecycle">
        {tool("apps", {
          description: "Check available desktop apps",
          result: JSON.stringify({
            granted: [{ app: "TextEdit" }],
            running: [
              { app: "TextEdit" },
              { app: "Finder" },
              { app: "Preview" },
            ],
            roots: [{ rootId: "@r1" }, { rootId: "@r2" }],
            frontmost: "TextEdit",
          }),
        })}
        {tool("apps", {
          description: "Open Preview",
          input: { action: "launch", app: "Preview" },
          result: JSON.stringify({ running: [], roots: [] }),
        })}
      </Section>
      <Section title="Capture">
        {tool("snapshot", {
          description: "Inspect the Meeting notes window",
          input: { root: "@r1", mode: "fused", capture: "window" },
          result: JSON.stringify({
            stateId: "@s1",
            root: {
              app: "TextEdit",
              bundleId: "com.apple.TextEdit",
              title: "Meeting notes",
            },
            image: {
              path: "/tmp/superone-computer-use/observe.png",
              width: 1280,
              height: 800,
            },
            outline: { ref: "@e1", role: "window", name: "Meeting notes" },
          }),
        })}
        {tool("zoom", {
          description: "Inspect the document controls more closely",
          input: { stateId: "@s1", region: [120, 80, 620, 420] },
          result: JSON.stringify({
            stateId: "@s1",
            root: { app: "TextEdit", bundleId: "com.apple.TextEdit" },
            image: { path: "/tmp/superone-computer-use/zoom.png" },
          }),
        })}
        {tool("query", {
          description: "Find the Save button",
          input: { stateId: "@s1", op: "search", text: "Save" },
          result: JSON.stringify({
            matches: [{ ref: "@e4", role: "button", name: "Save" }],
          }),
        })}
      </Section>
      <Section title="Action + wait">
        {tool("act", {
          description: "Save the meeting notes",
          input: { stateId: "@s1", actions: [{ type: "click", ref: "@e4" }] },
          result: JSON.stringify({
            outcome: "worked",
            successorStateId: "@s2",
            successorRoot: {
              app: "TextEdit",
              bundleId: "com.apple.TextEdit",
              title: "Meeting notes",
            },
            successorImage: { path: "/tmp/superone-computer-use/after.png" },
            evidence: [{ description: "button state changed" }],
          }),
        })}
        {tool("wait_for", {
          description: "Wait for the save confirmation",
          input: {
            stateId: "@s2",
            condition: { kind: "exists", ref: "@e7" },
            timeoutMs: 5000,
          },
          result: JSON.stringify({
            status: "verified",
            successorStateId: "@s3",
          }),
        })}
      </Section>
    </StoryShell>
  ),
};

export const ComputerApps: Story = {
  name: "computer_apps",
  render: () => (
    <StoryShell>
      {tool("apps", {
        description: "Check available desktop apps",
        result: JSON.stringify({
          granted: [{ app: "TextEdit" }],
          running: [{ app: "TextEdit" }],
          roots: [{ rootId: "@r1" }],
        }),
      })}
    </StoryShell>
  ),
};

export const LongBundleId: Story = {
  name: "computer_apps · Permission Prompt · long bundle ID",
  render: () => (
    <ComputerPermissionPrompt
      request={makePermissionRequest({
        toolName: "computer_apps",
        computerUseGrant: {
          app: "Google Chrome",
          bundleId: "com.google.Chrome.helper.renderer.very.long.identifier",
          toolName: "computer_apps",
          iconDataUri: SAMPLE_ICON,
        },
      })}
    />
  ),
};

export const ComputerSnapshot: Story = {
  name: "computer_snapshot",
  render: () => (
    <StoryShell>
      {tool("snapshot", {
        description: "Inspect the Meeting notes window",
        input: { root: "@r1", mode: "fused", capture: "window" },
        result: JSON.stringify({
          stateId: "@s1",
          root: { app: "TextEdit", title: "Meeting notes" },
          outline: { ref: "@e1", role: "window" },
        }),
      })}
      {tool("snapshot", {
        description: "Inspect the current outline",
        result: TOON_OUTLINE,
      })}
    </StoryShell>
  ),
};

export const WithIcon: Story = {
  name: "computer_snapshot · Permission Prompt · app grant with icon",
  render: () => <ComputerPermissionPrompt request={makePermissionRequest()} />,
};

export const ComputerZoom: Story = {
  name: "computer_zoom",
  render: () => (
    <StoryShell>
      {tool("zoom", {
        description: "Inspect the document controls more closely",
        input: { stateId: "@s1", region: [120, 80, 620, 420] },
        result: JSON.stringify({
          stateId: "@s1",
          image: { path: "/tmp/zoom.png" },
        }),
      })}
    </StoryShell>
  ),
};

export const ComputerQuery: Story = {
  name: "computer_query",
  render: () => (
    <StoryShell>
      {tool("query", {
        description: "Find the Save button",
        input: { stateId: "@s1", op: "search", text: "Save" },
        result: JSON.stringify({
          matches: [{ ref: "@e4", role: "button", name: "Save" }],
        }),
      })}
    </StoryShell>
  ),
};

export const ComputerAct: Story = {
  name: "computer_act",
  render: () => (
    <StoryShell>
      {tool("act", {
        description: "Save the meeting notes",
        input: { stateId: "@s1", actions: [{ type: "click", ref: "@e4" }] },
        result: JSON.stringify({
          outcome: "worked",
          successorStateId: "@s2",
          evidence: [{ description: "button state changed" }],
        }),
      })}
    </StoryShell>
  ),
};

export const WithoutIcon: Story = {
  name: "computer_act · Permission Prompt · app grant without icon",
  render: () => (
    <ComputerPermissionPrompt
      request={makePermissionRequest({
        toolName: "computer_act",
        computerUseGrant: {
          app: "TextEdit",
          bundleId: "com.apple.TextEdit",
          toolName: "computer_act",
        },
      })}
    />
  ),
};

export const ComputerWaitFor: Story = {
  name: "computer_wait_for",
  render: () => (
    <StoryShell>
      {tool("wait_for", {
        description: "Wait for the save confirmation",
        input: {
          stateId: "@s2",
          condition: { kind: "exists", ref: "@e7" },
          timeoutMs: 5000,
        },
        result: JSON.stringify({ status: "verified", successorStateId: "@s3" }),
      })}
    </StoryShell>
  ),
};

export const ComputerObserve: Story = {
  name: "computer_observe (legacy)",
  render: () => (
    <StoryShell>
      <ToolBlock
        toolName="mcp__superone__computer_observe"
        input={JSON.stringify({ description: "Inspect the current desktop" })}
        status="complete"
        result={TOON_OUTLINE}
      />
    </StoryShell>
  ),
};
