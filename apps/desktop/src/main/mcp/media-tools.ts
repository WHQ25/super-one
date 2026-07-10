import { readFileSync } from 'fs'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { detectImageMime } from '../image-cache'
import { generateAndRecord } from '../media-gen/history'
import { resolveDefaultModel, resolveDefaultProviderId } from '../media-gen/providers'
import { getMediaProviderStatuses } from '../media-gen/settings-service'
import { GENERATE_IMAGE_DESCRIPTION, LIST_MEDIA_PROVIDERS_DESCRIPTION } from './superone-mcp-builtin-defs'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export interface GenerateImageArgs {
  prompt: string
  provider?: string
  model?: string
  aspect_ratio?: string
  size?: string
  reference_image_paths?: string[]
}

function sizingForKind(kind: string): 'size' | 'aspectRatio' {
  return kind === 'google' ? 'aspectRatio' : 'size'
}

export interface ListMediaProvidersArgs {
  category?: string
}

export async function listMediaProvidersHandler(args: ListMediaProvidersArgs = {}) {
  const statuses = await getMediaProviderStatuses()
  const providers = statuses
    .filter((status) => status.hasKey || status.hasEnvKey)
    .filter((status) => !args.category || status.categories.includes(args.category))
    .map((status) => ({
      id: status.id,
      label: status.label,
      provider: status.providerLabel,
      kind: status.kind,
      categories: status.categories,
      sizing: sizingForKind(status.kind),
      supportsMask: status.kind === 'openai',
      defaultModel: status.defaultModel,
      models: status.models.map((model) => ({ id: model.id, label: model.label })),
    }))
  return { content: [{ type: 'text' as const, text: JSON.stringify({ providers }) }] }
}

export async function generateImageToolHandler(args: GenerateImageArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const providerId = args.provider ?? (await resolveDefaultProviderId())
    const model = args.model ?? (await resolveDefaultModel(providerId))

    const referenceImages = (args.reference_image_paths ?? []).map((path) => {
      const data = readFileSync(path)
      return { mediaType: detectImageMime(data) ?? 'image/png', data }
    })

    const result = await generateAndRecord({
      providerId,
      model,
      prompt: args.prompt,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      size: args.size,
      aspectRatio: args.aspect_ratio,
      sessionId: deps.sessionId,
      source: 'agent',
    })

    const summary = {
      status: 'generated',
      generationId: result.generationId,
      provider: providerId,
      model,
      savedPaths: result.images.map((image) => image.path),
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
        },
      ],
      isError: true,
    }
  }
}

export function registerMediaTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  server.registerTool(
    'media_list_providers',
    {
      description: LIST_MEDIA_PROVIDERS_DESCRIPTION,
      inputSchema: {
        category: z.string().optional().describe('Filter by media category, e.g. "image". Omit to list all usable providers.'),
      },
    },
    (args) => listMediaProvidersHandler(args),
  )

  server.registerTool(
    'media_generate_image',
    {
      description: GENERATE_IMAGE_DESCRIPTION,
      inputSchema: {
        prompt: z.string().describe('A detailed description of the image to generate, or the edit to apply when reference images are provided.'),
        provider: z.string().optional().describe('Which configured image provider id to use. Call media_list_providers to discover ids. Defaults to the first usable provider.'),
        model: z.string().optional().describe("Model id override. Defaults to the provider's default model."),
        aspect_ratio: z.string().optional().describe('Aspect ratio like "16:9" or "1:1". Preferred for google models.'),
        size: z.string().optional().describe('Pixel size like "1024x1024". Preferred for openai / openai-compatible models.'),
        reference_image_paths: z
          .array(z.string())
          .optional()
          .describe('Absolute paths to input images for editing / image-to-image / iterating on a prior result. Omit for pure text-to-image.'),
      },
    },
    (args) => generateImageToolHandler(args, deps),
  )
}
