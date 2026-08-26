import { ipcRenderer } from 'electron'

interface PageTool {
  name?: unknown
  description?: unknown
  inputSchema?: unknown
}

interface ModelContext {
  getTools(): Promise<PageTool[]>
  executeTool(tool: PageTool, inputJson: string): Promise<unknown>
  addEventListener?: (type: string, listener: () => void) => void
  ontoolchange?: (() => void) | null
}

const MAX_TOOLS = 64
const MAX_SCHEMA_BYTES = 8 * 1024
const FALLBACK_SCHEMA = '{"type":"object"}'

function initialize(): void {
  const candidate = (document as Document & { modelContext?: unknown }).modelContext
  if (typeof candidate !== 'object' || !candidate) return
  const mc = candidate as ModelContext
  const encoder = new TextEncoder()

  async function sync(): Promise<void> {
    try {
      const pageTools = Array.from(await mc.getTools())
      const tools = pageTools.slice(0, MAX_TOOLS).map((tool) => {
        let inputSchema: string
        let truncated = false
        try {
          const serialized = JSON.stringify(tool.inputSchema)
          if (typeof serialized !== 'string' || encoder.encode(serialized).byteLength > MAX_SCHEMA_BYTES) {
            inputSchema = FALLBACK_SCHEMA
            truncated = true
          } else {
            inputSchema = serialized
          }
        } catch {
          inputSchema = FALLBACK_SCHEMA
          truncated = true
        }
        return {
          name: tool.name,
          description: tool.description,
          inputSchema,
          ...(truncated ? { truncated: true } : {}),
        }
      })
      ipcRenderer.send('webmcp:sync', {
        tools,
        href: location.href,
        ...(pageTools.length > MAX_TOOLS ? { overflow: true } : {}),
      })
    } catch {
      // WebMCP may disappear during navigation; the next document syncs itself.
    }
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  const debouncedSync = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void sync()
    }, 100)
  }

  if (typeof mc.addEventListener === 'function') {
    mc.addEventListener('toolchange', debouncedSync)
  } else {
    mc.ontoolchange = debouncedSync
  }

  ipcRenderer.on('webmcp:invoke', async (_event, payload: unknown) => {
    const request = payload as { invocationId?: unknown; toolName?: unknown; inputJson?: unknown }
    const invocationId = request?.invocationId
    if (typeof invocationId !== 'string') return
    try {
      const pageTools = Array.from(await mc.getTools())
      const tool = pageTools.find((entry) => entry.name === request.toolName)
      if (!tool) {
        ipcRenderer.send('webmcp:result', { invocationId, ok: false, error: 'tool not found' })
        return
      }
      const raw = await mc.executeTool(tool, request.inputJson as string)
      ipcRenderer.send('webmcp:result', {
        invocationId,
        ok: true,
        outputJson: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null),
      })
    } catch (error) {
      ipcRenderer.send('webmcp:result', {
        invocationId,
        ok: false,
        error: String((error as { message?: unknown })?.message ?? error),
      })
    }
  })

  void sync()
  document.addEventListener('DOMContentLoaded', () => { void sync() }, { once: true })
}

initialize()
