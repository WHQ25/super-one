import { assertMcpAppSize, MCP_APP_DATA_MAX_BYTES, MCP_APP_HTML_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES, McpAppsError, mcpAppToolVisible, type McpAppsProvider } from '@superone/shared/mcp-apps'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'

export async function dispatchMcpAppsProviderRequest(input: McpAppsProviderRpcRequest, provider: McpAppsProvider, signal = new AbortController().signal): Promise<McpAppsRpcResult> {
  try {
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
    switch (input.operation) {
      case 'ready': return { ok: true, value: await provider.ready(signal) }
      case 'tools': return { ok: true, value: [...(await provider.tools()).values()] }
      case 'readResource': {
        const value = await provider.readResource({ uri: input.uri ?? '', origin: input.origin, transient: input.transient }, signal)
        assertMcpAppSize(value, input.transient ? MCP_APP_OUTPUT_MAX_BYTES : MCP_APP_HTML_MAX_BYTES + MCP_APP_DATA_MAX_BYTES)
        return { ok: true, value }
      }
      case 'callTool': {
        let tool = (await provider.tools()).get(input.tool ?? '')
        // Codex does not forward tools/list_changed. Give cached providers one
        // bounded refresh on a miss; visibility denials never trigger discovery.
        if (!tool) tool = (await provider.tools({ refresh: true })).get(input.tool ?? '')
        if (!tool || !mcpAppToolVisible(tool)) throw new McpAppsError('denied', 'This tool is not available to the App')
        if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
        assertMcpAppSize(input.args ?? {})
        const value = await provider.callTool({ tool: tool.name, args: input.args ?? {}, origin: input.origin }, signal)
        assertMcpAppSize(value.result, MCP_APP_OUTPUT_MAX_BYTES)
        return { ok: true, value }
      }
      case 'authenticate': {
        if (!provider.authenticate) throw new McpAppsError('invalid', 'This harness cannot start MCP sign-in')
        return { ok: true, value: await provider.authenticate({ redirectUri: input.redirectUri }, signal) }
      }
      case 'submitAuthCallback': {
        if (!provider.submitAuthCallback || !input.callbackUrl) throw new McpAppsError('invalid', 'No MCP sign-in callback to submit')
        await provider.submitAuthCallback({ callbackUrl: input.callbackUrl }, signal)
        return { ok: true, value: null }
      }
      default: throw new McpAppsError('invalid', 'Unknown MCP Apps operation')
    }
  } catch (error) {
    return { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'not_connected', message: error instanceof Error ? error.message : String(error) } }
  } finally { provider.dispose() }
}
