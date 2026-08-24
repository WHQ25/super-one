import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useState } from "react";
import { ToolBlock } from "./ToolBlock";
import {
  VideoGenConfirmPrompt,
  type VideoGenParams,
  type VideoGenProviderOption,
} from "./VideoGenConfirmPrompt";
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from "@/stores/chat";

const SB_PROJECT = "__storybook__";
const SB_SESSION = "sb";

const TOOL_VIDEO = "mcp__superone__media_generate_video";
const TOOL_IMAGE = "mcp__superone__media_generate_image";
const TOOL_LIST_PROVIDERS = "mcp__superone__media_list_providers";
const TOOL_VIDEO_STATUS = "mcp__superone__media_video_status";

function svgPlaceholder(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},55%,55%)"/><text x="50%" y="50%" font-size="22" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function mockApp(): void {
  (window as any).app = {
    ...((window as any).app ?? {}),
    readFileAsDataUri: (path: string) => {
      const name = path.split("/").pop() ?? "img";
      return Promise.resolve({
        ok: true,
        dataUri: svgPlaceholder(200 + (path.length % 100), name),
      });
    },
  };
}

function seedSession(videoGenStatuses: Record<string, unknown>): void {
  const session = createDefaultPerSessionState();
  session.cwd = "/Users/me/projects/super-one";
  session.videoGenStatuses = videoGenStatuses as any;
  const project = createDefaultProjectState();
  project._activeSessionId = SB_SESSION;
  project._sessions = { [SB_SESSION]: session };
  project.homedir = "/Users/me";
  useChatStore.setState({
    activeProject: SB_PROJECT,
    projectSessions: { [SB_PROJECT]: project },
  });
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
  toolName: string,
  input: Record<string, unknown>,
  opts: {
    result?: string;
    status?: "streaming" | "complete";
    isError?: boolean;
  } = {},
) {
  return (
    <ToolBlock
      toolName={toolName}
      input={JSON.stringify(input)}
      status={opts.status ?? "complete"}
      result={opts.result}
      isError={opts.isError}
    />
  );
}

const PROMPT =
  "A golden retriever runs across a sunlit beach at sunset, camera tracking alongside at a low angle";
const INPUT = {
  prompt: PROMPT,
  provider: "ark",
  model: "seedance-1-pro",
  aspect_ratio: "16:9",
  resolution: "1080p",
  duration: 6,
  generate_audio: true,
  watermark: false,
  camera_fixed: false,
};

const INPUT_REFS = {
  ...INPUT,
  first_frame_path: "/Users/me/video/start.png",
  last_frame_path: "/Users/me/video/end.png",
  reference_image_paths: [
    "/Users/me/video/ref-a.png",
    "/Users/me/video/ref-b.png",
    "/Users/me/video/ref-c.png",
  ],
  reference_video_paths: ["/Users/me/video/source.mp4"],
  reference_audio_paths: ["/Users/me/video/bgm.wav"],
  fps: 24,
  seed: 42,
};

const VIDEO_PROVIDERS: VideoGenProviderOption[] = [
  {
    id: "ark",
    label: "Volcengine Ark (Seedance)",
    models: [
      { id: "seedance-1-pro", label: "Seedance 1 Pro" },
      { id: "seedance-1-lite", label: "Seedance 1 Lite" },
    ],
    aspectRatios: ["16:9", "9:16", "1:1"],
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    id: "openai",
    label: "OpenAI (Sora)",
    models: [{ id: "sora-2", label: "Sora 2" }],
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["1280x720", "720x1280", "1792x1024", "1024x1792"],
  },
  {
    id: "google",
    label: "Google (Veo)",
    models: [{ id: "veo-3", label: "Veo 3" }],
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p", "1080p"],
  },
];

const VIDEO_BASE_PARAMS: VideoGenParams = {
  prompt:
    "A golden retriever runs across a sunlit beach at sunset, camera tracking alongside at a low angle, waves crashing gently in the background.",
  provider: "ark",
  model: "seedance-1-pro",
  aspectRatio: "16:9",
  resolution: "1080p",
  duration: 6,
  generateAudio: true,
  watermark: false,
  cameraFixed: false,
};

function VideoPermissionPrompt(
  props: ComponentProps<typeof VideoGenConfirmPrompt>,
) {
  return (
    <div className="@container" style={{ maxWidth: 820 }}>
      <VideoGenConfirmPrompt {...props} />
    </div>
  );
}

function StoryShell({
  children,
  w = 720,
}: {
  children: ReactNode;
  w?: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    mockApp();
    setReady(true);
  }, []);
  if (!ready) return null;
  return (
    <div className="@container space-y-4" style={{ maxWidth: w }}>
      {children}
    </div>
  );
}

function SeedAndRender({
  genStatuses,
  input,
  result,
  status,
}: {
  genStatuses: Record<string, unknown>;
  input: Record<string, unknown>;
  result?: string;
  status?: "streaming" | "complete";
}) {
  useEffect(() => {
    seedSession(genStatuses);
  }, [genStatuses]);

  return block(TOOL_VIDEO, input, { result, status });
}

const meta: Meta = {
  title: "Tool UI/SuperOne MCP/Media",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

export const Gallery: Story = {
  name: "Gallery",
  render: () => (
    <StoryShell>
      <Note>
        Media generation states grouped by lifecycle and failure modes.
      </Note>
      <Section title="submitted">
        <SeedAndRender
          genStatuses={{
            g1: {
              status: "submitted",
              generationId: "g1",
              prompt: PROMPT,
              provider: "ark",
              model: "seedance-1-pro",
            },
          }}
          input={INPUT}
          result={JSON.stringify({ status: "submitted", generationId: "g1" })}
        />
      </Section>
      <Section title="generated">
        <SeedAndRender
          genStatuses={{
            g3: {
              status: "generated",
              generationId: "g3",
              prompt: PROMPT,
              provider: "google",
              model: "veo-3",
              savedPaths: ["/tmp/v.mp4"],
            },
          }}
          input={INPUT}
          result={JSON.stringify({
            status: "generated",
            generationId: "g3",
            savedPaths: ["/tmp/v.mp4"],
          })}
        />
      </Section>
      <Section title="generated with warnings">
        <SeedAndRender
          genStatuses={{
            g5: {
              status: "generated",
              generationId: "g5",
              prompt: PROMPT,
              provider: "ark",
              model: "seedance-1-pro",
              savedPaths: ["/tmp/v.mp4"],
              warnings: [
                "camera_fixed not supported",
                "generate_audio ignored",
              ],
            },
          }}
          input={INPUT}
          result={JSON.stringify({
            status: "generated",
            generationId: "g5",
            savedPaths: ["/tmp/v.mp4"],
            warnings: ["camera_fixed not supported", "generate_audio ignored"],
          })}
        />
      </Section>
      <Section title="failed">
        <SeedAndRender
          genStatuses={{
            g4: {
              status: "error",
              generationId: "g4",
              prompt: PROMPT,
              provider: "ark",
              model: "seedance-1-pro",
              error: "Provider returned status 500: Internal server error",
            },
          }}
          input={INPUT}
          result={JSON.stringify({
            status: "error",
            generationId: "g4",
            message: "Provider returned status 500: Internal server error",
          })}
        />
      </Section>
      <Section title="with reference materials">
        <SeedAndRender
          genStatuses={{
            g6: {
              status: "submitted",
              generationId: "g6",
              prompt: INPUT_REFS.prompt,
              provider: "ark",
              model: "seedance-1-pro",
            },
          }}
          input={INPUT_REFS}
          result={JSON.stringify({ status: "submitted", generationId: "g6" })}
        />
      </Section>
    </StoryShell>
  ),
};

export const ListProviders: Story = {
  name: "media_list_providers",
  render: () => (
    <StoryShell>
      <Section title="media_list_providers">
        {block(
          TOOL_LIST_PROVIDERS,
          {},
          {
            result: JSON.stringify({
              providers: [
                {
                  id: "grok",
                  label: "Grok",
                  provider: "xAI",
                  kind: "image",
                  models: [{ id: "grok-imagine", label: "Imagine" }],
                },
              ],
            }),
          },
        )}
        {block(TOOL_LIST_PROVIDERS, {}, { status: "streaming" })}
      </Section>
    </StoryShell>
  ),
};

export const GenerateImage: Story = {
  name: "media_generate_image",
  render: () => (
    <StoryShell>
      <Section title="media_generate_image">
        {block(
          TOOL_IMAGE,
          {
            prompt: "a red cube on a table",
            provider: "grok",
            model: "grok-imagine",
            aspect_ratio: "16:9",
            size: "2K",
            reference_image_paths: ["/tmp/ref-a.png"],
          },
          { status: "streaming" },
        )}
        {block(
          TOOL_IMAGE,
          {
            prompt: "a red cube on a table",
            provider: "grok",
            model: "grok-imagine",
          },
          {
            result: JSON.stringify({
              status: "ok",
              imageUrl: "data:image/png;base64,....",
            }),
          },
        )}
        {block(
          TOOL_IMAGE,
          {
            prompt: "a red cube on a table",
            provider: "grok",
            model: "grok-imagine",
          },
          {
            result: JSON.stringify({
              status: "error",
              message: "provider timeout",
            }),
            isError: true,
          },
        )}
      </Section>
    </StoryShell>
  ),
};

export const GenerateVideo: Story = {
  name: "media_generate_video",
  render: () => (
    <StoryShell>
      <Section title="media_generate_video">
        <SeedAndRender
          genStatuses={{
            g7: {
              status: "submitted",
              generationId: "g7",
              prompt: PROMPT,
              provider: "ark",
              model: "seedance-1-pro",
            },
          }}
          input={INPUT}
          status="streaming"
        />
        <SeedAndRender
          genStatuses={{
            g8: {
              status: "generated",
              generationId: "g8",
              prompt: PROMPT,
              provider: "ark",
              model: "seedance-1-pro",
              savedPaths: ["/tmp/v.mp4"],
            },
          }}
          input={INPUT}
          result={JSON.stringify({
            status: "generated",
            generationId: "g8",
            savedPaths: ["/tmp/v.mp4"],
          })}
        />
        <SeedAndRender
          genStatuses={{
            g9: {
              status: "error",
              generationId: "g9",
              prompt: PROMPT,
              provider: "ark",
              model: "seedance-1-pro",
              error: "Provider returned status 500",
            },
          }}
          input={INPUT}
          result={JSON.stringify({
            status: "error",
            generationId: "g9",
            message: "Provider returned status 500",
          })}
        />
      </Section>
    </StoryShell>
  ),
};

export const TextToVideo: Story = {
  name: "media_generate_video · Permission Prompt · text to video",
  render: () => (
    <VideoPermissionPrompt
      params={VIDEO_BASE_PARAMS}
      providers={VIDEO_PROVIDERS}
      onConfirm={(params) => console.log("confirm", params)}
      onReject={(feedback) => console.log("reject", feedback)}
    />
  ),
};

export const ImageToVideoWithFrames: Story = {
  name: "media_generate_video · Permission Prompt · image to video",
  render: () => (
    <VideoPermissionPrompt
      params={{
        ...VIDEO_BASE_PARAMS,
        prompt:
          "Animate the character walking forward from the start frame to the end frame, maintaining consistent lighting and camera position.",
        duration: 4,
      }}
      providers={VIDEO_PROVIDERS}
      referenceImages={[
        {
          path: "/tmp/start.png",
          dataUri: svgPlaceholder(200, "Start"),
          role: "first_frame",
        },
        {
          path: "/tmp/end.png",
          dataUri: svgPlaceholder(20, "End"),
          role: "last_frame",
        },
      ]}
      onConfirm={(params) => console.log("confirm", params)}
      onReject={(feedback) => console.log("reject", feedback)}
    />
  ),
};

export const WithReferenceImages: Story = {
  name: "media_generate_video · Permission Prompt · reference images",
  render: () => (
    <VideoPermissionPrompt
      params={{
        ...VIDEO_BASE_PARAMS,
        prompt:
          "Show the same character from the reference images exploring a neon-lit cyberpunk street market at night.",
        provider: "openai",
        model: "sora-2",
        aspectRatio: "16:9",
        resolution: "1280x720",
        duration: 8,
      }}
      providers={VIDEO_PROVIDERS}
      referenceImages={[
        {
          path: "/tmp/ref1.png",
          dataUri: svgPlaceholder(280, "Ref 1"),
          role: "reference",
        },
        {
          path: "/tmp/ref2.png",
          dataUri: svgPlaceholder(320, "Ref 2"),
          role: "reference",
        },
        {
          path: "/tmp/ref3.png",
          dataUri: svgPlaceholder(160, "Ref 3"),
          role: "reference",
        },
      ]}
      onConfirm={(params) => console.log("confirm", params)}
      onReject={(feedback) => console.log("reject", feedback)}
    />
  ),
};

export const NoReferenceMedia: Story = {
  name: "media_generate_video · Permission Prompt · no reference media",
  render: () => (
    <VideoPermissionPrompt
      params={{
        ...VIDEO_BASE_PARAMS,
        provider: "google",
        model: "veo-3",
        aspectRatio: "9:16",
        resolution: "1080p",
        duration: 5,
        generateAudio: false,
      }}
      providers={VIDEO_PROVIDERS}
      onConfirm={(params) => console.log("confirm", params)}
      onReject={(feedback) => console.log("reject", feedback)}
    />
  ),
};

export const GenerateVideoStatus: Story = {
  name: "media_video_status",
  render: () => (
    <StoryShell>
      <Section title="media_video_status">
        {block(
          TOOL_VIDEO_STATUS,
          { generationId: "gen-1" },
          {
            result: JSON.stringify({
              status: "submitted",
              generationId: "gen-1",
            }),
          },
        )}
        {block(
          TOOL_VIDEO_STATUS,
          { generationId: "gen-1" },
          { status: "streaming" },
        )}
        {block(
          TOOL_VIDEO_STATUS,
          { generationId: "gen-1" },
          {
            result: JSON.stringify({
              status: "error",
              message: "render failed",
            }),
          },
        )}
      </Section>
    </StoryShell>
  ),
};
