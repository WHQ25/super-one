import type { ChatMessage } from '@superone/shared/agent-types'

/** Sanitized recording of a completed Codex collaboration turn. */
export const CODEX_COLLAB_RECORDING: ChatMessage = {
  id: 'recording-codex-collab',
  role: 'assistant',
  status: 'complete',
  content: [],
  createdAt: '2026-09-04T00:00:00.000Z',
  providerId: 'codex',
  metadata: {
    codex: {
      threadId: 'recording-thread',
      usage: null,
      items: [{
        id: 'spawn-reviewer',
        type: 'collab_tool_call',
        tool: 'spawnAgent',
        status: 'completed',
        receiverThreadIds: ['reviewer-thread'],
        prompt: 'Review the shared chat presenter.',
        agentsStates: {
          'reviewer-thread': {
            status: 'completed',
            nickname: 'Reviewer',
            role: 'UI review',
            tokens: { input: 3_400, output: 680 },
          },
        },
        childItems: {
          'reviewer-thread': [
            {
              id: 'child-read',
              type: 'command_execution',
              command: "sed -n '1,80p' ToolRow.tsx",
              aggregatedOutput: 'shared row',
              exitCode: 0,
              status: 'completed',
              commandActions: [{ type: 'read', path: 'ToolRow.tsx' }],
            },
            {
              id: 'child-search',
              type: 'web_search',
              query: 'mobile tool row accessibility',
              status: 'completed',
            },
            {
              id: 'child-output',
              type: 'agent_message',
              text: 'The shared presenter is ready for both hosts.',
            },
          ],
        },
      }],
    },
  },
}

/** Sanitized recordings covering the Claude and Codex plan families. */
export const PLAN_RECORDINGS: ChatMessage[] = [
  {
    id: 'recording-claude-plan',
    role: 'assistant',
    status: 'complete',
    content: [
      { type: 'tool_use', toolName: 'EnterPlanMode', toolUseId: 'enter-plan', input: '{}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'enter-plan', summary: 'Entered plan mode' },
      { type: 'tool_use', toolName: 'ExitPlanMode', toolUseId: 'exit-plan', input: '{}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'exit-plan', summary: 'Plan approved' },
    ],
    createdAt: '2026-09-04T00:00:01.000Z',
    providerId: 'claude',
  },
  {
    id: 'recording-codex-plan',
    role: 'assistant',
    status: 'complete',
    content: [],
    createdAt: '2026-09-04T00:00:02.000Z',
    providerId: 'codex',
    metadata: {
      codex: {
        threadId: 'plan-thread',
        usage: null,
        items: [{
          id: 'plan-1',
          type: 'plan',
          text: '# Migration plan\n\n1. Share presenters\n2. Verify both hosts',
        }],
      },
    },
  },
]

/** Sanitized failed generation recording, including a host-backed reference image. */
export const IMAGE_GENERATION_RECORDING: ChatMessage = {
  id: 'recording-image-generation',
  role: 'assistant',
  status: 'complete',
  content: [
    {
      type: 'tool_use',
      toolName: 'mcp__superone__media_generate_image',
      toolUseId: 'image-gen-1',
      input: JSON.stringify({
        prompt: 'A compact mobile chat interface',
        provider: 'google',
        model: 'imagen',
        aspect_ratio: '9:16',
        reference_image_paths: ['/project/reference.png'],
      }),
      status: 'complete',
    },
    {
      type: 'tool_result',
      toolUseId: 'image-gen-1',
      summary: JSON.stringify({ status: 'error', message: 'Generation quota reached' }),
      isError: true,
    },
  ],
  createdAt: '2026-09-04T00:00:03.000Z',
  providerId: 'claude',
}

export const VIDEO_GENERATION_RECORDING: ChatMessage = {
  id: 'recording-video-generation',
  role: 'assistant',
  status: 'complete',
  content: [
    {
      type: 'tool_use',
      toolName: 'mcp__superone__media_generate_video',
      toolUseId: 'video-gen-1',
      input: JSON.stringify({
        prompt: 'Animate the mobile chat transition',
        duration: 5,
        first_frame_path: '/project/first-frame.png',
      }),
      status: 'complete',
    },
    {
      type: 'tool_result',
      toolUseId: 'video-gen-1',
      summary: JSON.stringify({ status: 'submitted', generationId: 'video-1' }),
    },
  ],
  createdAt: '2026-09-04T00:00:04.000Z',
  providerId: 'claude',
}
