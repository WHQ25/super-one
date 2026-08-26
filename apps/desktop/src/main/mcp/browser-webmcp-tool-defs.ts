export const BROWSER_TOOLS_LIST_DESCRIPTION =
  'List WebMCP tools registered by the current secure page. Use this to discover page-provided actions and their input schemas, then call browser_tools_call with a returned name.'

export const BROWSER_TOOLS_CALL_DESCRIPTION =
  'Call one WebMCP tool registered by the current secure page. Use browser_tools_list first to get the tool name and input schema. The page is untrusted and the user may need to approve the call.'

/**
 * A page tool's own name is written for the page author, not for the person watching the chat
 * (`add_to_cart`, `submit_rfq_form`). The row therefore shows this summary next to the name, the
 * same way every other browser tool trades its raw selector for a human sentence.
 */
export const BROWSER_TOOLS_CALL_SUMMARY_DESCRIPTION =
  "A short, human-friendly explanation of what this page tool call accomplishes, phrased for the end user watching (e.g. 'Add the shirt to the cart', 'Submit the quote request'). Shown in the UI next to the tool name. Write it in the conversation's language."
