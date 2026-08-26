export const BROWSER_TOOLS_LIST_DESCRIPTION =
  'List WebMCP tools registered by the current secure page. Use this to discover page-provided actions and their input schemas, then call browser_tools_call with a returned name.'

export const BROWSER_TOOLS_CALL_DESCRIPTION =
  'Call one WebMCP tool registered by the current secure page. Use browser_tools_list first to get the tool name and input schema. The page is untrusted and the user may need to approve the call.'
