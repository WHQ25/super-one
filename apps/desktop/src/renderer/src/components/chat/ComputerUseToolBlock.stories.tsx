import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PermissionRequest } from "@superone/shared/agent-types";
import type { ReactNode } from "react";
import { ComputerUseGrantPrompt } from "./ComputerUseGrantPrompt";
import { ToolBlock } from "./ToolBlock";
import type { ComputerOp } from "./computer-tool-display";
import type { RunContinuation } from "@superone/chat-view/presenters/run-display";
import { RunSeed, seedRun } from "./run-story-seed";
import { NestedToolContext } from "./nested-tool-context";
import { liveOf, longSegments, QUESTIONS, resume, runEnvelope, step } from "./run-story-fixtures";

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
    /** computer_run: the resume calls groupContent folds into this block. */
    continuations?: RunContinuation[];
    expanded?: boolean;
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
      runContinuations={options.continuations}
      autoExpand={options.expanded}
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
        {tool("act", {
          description: "Click the Save button",
          input: { stateId: "@s1", actions: [{ type: "click", ref: "@e4" }], recording: true },
          result: JSON.stringify({
            outcome: "worked",
            successorStateId: "@s2",
            recording: {
              savedPath: "/tmp/super-one-recordings/computer/click.mp4",
              mimeType: "video/mp4",
              durationMs: 1600,
            },
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

export const ComputerActRecording: Story = {
  name: "computer_act · recording icon on the right",
  render: () => (
    <StoryShell>
      {tool("act", {
        description: "Click the Save button",
        input: { stateId: "@s1", actions: [{ type: "click", ref: "@e4" }], recording: true },
        result: JSON.stringify({
          outcome: "worked",
          successorStateId: "@s2",
          recording: {
            savedPath: "/tmp/super-one-recordings/computer/click.mp4",
            mimeType: "video/mp4",
            durationMs: 1600,
          },
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

const NOTES = { app: "Notes", bundleId: "com.apple.Notes", title: "Notes" };
const RUN_INPUT = {
  app: "Notes",
  goal: "Create a note titled Scratch and make sure it is saved in the Notes list",
  presets: [{ key: "Title", value: "Scratch", field: "the note title" }],
};
const SEG1 = [step("click", "New Note"), step("type", "Title"), step("scroll", "down", "didnt"), step("press", "Return", "unknown")];
const SEG2 = [step("click", "Save"), step("click", "Notes list", "worked")];

/** Every outcome at a glance: the row alone says how the run ended. */
export const FastRunStates: Story = {
  render: () => (
    <StoryShell width={560}>
      <Note>Collapsed, a run is one row: verb, app, what the caller asked for, time and outcome; the step count shows only while it runs, and in the footer once expanded.</Note>
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, status: "streaming", elapsedSeconds: 7 })}
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, result: runEnvelope({ status: "paused", runId: "r1", completed: SEG1, question: QUESTIONS.risky("Save"), snapshot: { target: NOTES }, goalSatisfied: 0.31 }) })}
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, result: runEnvelope({ status: "done", runId: "r2", completed: [...SEG1, ...SEG2], why: "Jev rates the goal satisfied (0.86)", snapshot: { target: NOTES }, goalSatisfied: 0.86 }) })}
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, result: runEnvelope({ status: "aborted", runId: "r3", completed: SEG1, why: "Aborted by the caller", snapshot: { target: NOTES }, goalSatisfied: 0.12 }) })}
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, result: "[Error] The 'Jev fast inner loop' is disabled. Enable it in Settings → Browser → Experimental Tools.", isError: true })}
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, result: "[denied] User declined" })}
    </StoryShell>
  ),
};

/** A run still going: the rows come from the live events, the header pulses and counts. */
export const FastRunRunning: Story = {
  render: () => {
    const seed = () => seedRun("computer", "rcomputer1", [liveOf(SEG1.slice(0, 3))]);
    return (
      <StoryShell width={560}>
        <RunSeed seed={seed} />
        <Note>Each row reads the way the matching computer_act row would; the check mark is that call's outcome.</Note>
        {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, status: "streaming", elapsedSeconds: 9, expanded: true })}
      </StoryShell>
    );
  },
};

/** Paused on a risky step: the segment ends with the question the caller has to answer. */
export const FastRunPaused: Story = {
  render: () => (
    <StoryShell width={560}>
      <Note>The reason is a chip, the need is the loop's own first sentence; the head-by-head numbers stay in the tool result.</Note>
      {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, expanded: true, result: runEnvelope({ status: "paused", runId: "r1", completed: SEG1, question: QUESTIONS.risky("Save"), snapshot: { target: NOTES }, goalSatisfied: 0.31 }) })}
      {tool("run", { description: "Add a haiku to the draft", input: { app: "TextEdit", goal: "Append a haiku about autumn to the end of the document" }, expanded: true, result: runEnvelope({ status: "paused", runId: "r4", completed: [step("click", "Untitled")], question: QUESTIONS.value("Untitled"), snapshot: { target: { app: "TextEdit" } }, goalSatisfied: 0.08 }) })}
    </StoryShell>
  ),
};

/** Resumed: the answer opens the next segment inside the same block, and the run finishes there. */
export const FastRunResumed: Story = {
  render: () => (
    <StoryShell width={560}>
      <Note>The resume call is a second tool call in the transcript; groupContent folds it into the block that started the run.</Note>
      {tool("run", {
        description: "Fill the scratch note title",
        input: RUN_INPUT,
        expanded: true,
        result: runEnvelope({ status: "paused", runId: "r1", completed: SEG1, question: QUESTIONS.risky("Save"), snapshot: { target: NOTES }, goalSatisfied: 0.31 }),
        continuations: [
          resume("r1", { choice: "2" }, { description: "Confirm Save", result: runEnvelope({ status: "done", runId: "r1", completed: SEG2, why: "Jev rates the goal satisfied (0.86)", snapshot: { target: NOTES }, goalSatisfied: 0.86, steps: 6, elapsedMs: 21400 }) }),
        ],
      })}
    </StoryShell>
  ),
};

/** Resumed and still running: the answered segment's rows come from the live events. */
export const FastRunResumedLive: Story = {
  render: () => {
    const seed = () => seedRun("computer", "r1", [liveOf(SEG1), liveOf(SEG2.slice(0, 1))]);
    return (
      <StoryShell width={560}>
        <RunSeed seed={seed} />
        {tool("run", {
          description: "Fill the scratch note title",
          input: RUN_INPUT,
          expanded: true,
          result: runEnvelope({ status: "paused", runId: "r1", completed: SEG1, question: QUESTIONS.risky("Save"), snapshot: { target: NOTES }, goalSatisfied: 0.31 }),
          continuations: [resume("r1", { choice: "2" }, { status: "streaming", elapsedSeconds: 4 })],
        })}
      </StoryShell>
    );
  },
};

/** A hand-over: Jev asked for input it cannot supply, the caller answered with actions and a preset. */
export const FastRunCapability: Story = {
  render: () => (
    <StoryShell width={560}>
      {tool("run", {
        description: "Select the red dot in the picture",
        input: { app: "Preview", goal: "Select the region around the red dot in the picture" },
        expanded: true,
        result: runEnvelope({ status: "paused", runId: "r5", completed: [], question: QUESTIONS.capability(), snapshot: { target: { app: "Preview" } }, goalSatisfied: 0.05 }),
        continuations: [
          resume("r5", { value: { actions: [{ type: "drag", path: [[300, 200], [420, 280]] }], presets: [{ key: "Caption", value: "Red dot" }] } }, {
            result: runEnvelope({ status: "done", runId: "r5", completed: [step("press", "Handed 1 action (drag)", "worked", "Handed 1 action (drag) at [1] Picture"), step("type", "Caption")], note: "1 preset(s) taken over: Caption", why: "Accepted by the caller", snapshot: { target: { app: "Preview" } }, goalSatisfied: 0.28, steps: 2 }),
          }),
        ],
      })}
    </StoryShell>
  ),
};

/** Handed back: the caller stopped the run at a no-progress pause. */
export const FastRunAborted: Story = {
  render: () => (
    <StoryShell width={560}>
      {tool("run", {
        description: "Fill the scratch note title",
        input: RUN_INPUT,
        expanded: true,
        result: runEnvelope({ status: "paused", runId: "r6", completed: SEG1, question: QUESTIONS.noProgress(), snapshot: { target: NOTES }, goalSatisfied: 0.45 }),
        continuations: [resume("r6", { abort: true, goal: "Leave the note unsaved" }, { result: runEnvelope({ status: "aborted", runId: "r6", why: "Aborted by the caller", snapshot: { target: NOTES }, steps: 4 }) })],
      })}
    </StoryShell>
  ),
};

/** Thirty-four steps over three segments in a narrow column: bounded, tail in view, header still one line. */
export const FastRunLongNarrow: Story = {
  render: () => {
    const [s1, s2, s3] = longSegments((i) => `Row ${i}`);
    return (
      <StoryShell width={340}>
        <Note>Bounded height with the tail in view, like a subagent's nested calls; the status word hides below md.</Note>
        {tool("run", {
          description: "Work through the long settings list",
          input: { app: "System Settings", goal: "Open every pane in the sidebar until the Sharing pane is visible" },
          expanded: true,
          result: runEnvelope({ status: "paused", runId: "r7", completed: s1, question: QUESTIONS.budget(), snapshot: { target: { app: "System Settings" } }, goalSatisfied: 0.2 }),
          continuations: [
            resume("r7", { choice: "continue" }, { result: runEnvelope({ status: "paused", runId: "r7", completed: s2, question: QUESTIONS.budget(), snapshot: { target: { app: "System Settings" } }, goalSatisfied: 0.35, steps: 24 }) }),
            resume("r7", { choice: "continue" }, { result: runEnvelope({ status: "done", runId: "r7", completed: s3, why: "done_when satisfied", snapshot: { target: { app: "System Settings" } }, goalSatisfied: 0.9, steps: 34, elapsedMs: 118000 }) }),
          ],
        })}
        {tool("run", { description: "Work through the long settings list", input: { app: "System Settings", goal: "Open every pane" }, result: runEnvelope({ status: "done", runId: "r8", completed: s1, why: "done_when satisfied", snapshot: { target: { app: "System Settings" } } }) })}
      </StoryShell>
    );
  },
};

/** Nested in a subagent card the block is header-only. */
export const FastRunNested: Story = {
  render: () => (
    <StoryShell width={560}>
      <NestedToolContext.Provider value={{ allowExpand: false }}>
        <div className="subagent-container rounded border border-border/50 p-2">
          {tool("run", { description: "Fill the scratch note title", input: RUN_INPUT, result: runEnvelope({ status: "done", runId: "r9", completed: SEG1, snapshot: { target: NOTES } }) })}
        </div>
      </NestedToolContext.Provider>
    </StoryShell>
  ),
};
