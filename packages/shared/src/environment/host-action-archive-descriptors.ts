import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  RENAME_SESSION_DESCRIPTION,
  SESSION_TAG_DESCRIPTION,
  SESSION_TAG_LIST_DESCRIPTION,
  PROJECT_LIST_DESCRIPTION,
  SESSION_LIST_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_TAGS_FILTER_DESCRIPTION,
  SESSION_TAG_MATCH_DESCRIPTION,
  SESSION_CLEANUP_DESCRIPTION
} from '../superone-tool-descriptions'

export const HOST_ACTION_ARCHIVE_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "session_rename",
    "description": RENAME_SESSION_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "description": "A concise 4-8 word title describing the current conversation topic.",
          "minLength": 1,
          "maxLength": 80
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 8,
          "description": "Replace this session's tags (set). Pass 1–4 short kebab-case labels you choose, plus issue-N / pr-N when the session targets a tracker item. Reuse names from session_tag_list when they fit; invent when they don't. Empty array clears. Applied even when the title is user_locked."
        }
      },
      "required": [
        "title"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_tag",
    "description": SESSION_TAG_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "description": "One session to tag. Default: current. Mutually exclusive with sessionIds."
        },
        "sessionIds": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 50,
          "description": "Bulk target ids (max 50). add required; set/remove not allowed. Mutually exclusive with sessionId."
        },
        "add": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Tags to add (normalized, de-duped). Mutually exclusive with remove/set."
        },
        "remove": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Tags to remove. Mutually exclusive with add/set."
        },
        "set": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Replace all tags. Empty array clears. Mutually exclusive with add/remove."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "session_tag_list",
    "description": SESSION_TAG_LIST_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Case-insensitive substring filter on tag name."
        },
        "kind": {
          "type": "string",
          "enum": ["label", "ref", "all"],
          "description": "label (default) = topic labels; ref = issue-N / pr-N references; all = both."
        },
        "includeHidden": {
          "type": "boolean",
          "description": "Count hidden sessions. Default false."
        },
        "projectId": {
          "type": "string",
          "description": "List tags in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project."
        },
        "allProjects": {
          "type": "boolean",
          "description": "List tags across every SuperOne project. Mutually exclusive with projectId. Default false."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "description": "Max rows. Default 50, max 100."
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "description": "Pagination offset. Default 0."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "project_list",
    "description": PROJECT_LIST_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Case-insensitive substring filter on project name or path."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "description": "Max rows. Default 50, max 100."
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "description": "Pagination offset. Default 0."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "session_list",
    "description": SESSION_LIST_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Case-insensitive title substring filter."
        },
        "harness": {
          "type": "string",
          "enum": [
            "claude",
            "codex",
            "acp",
            "opencode"
          ],
          "description": "Filter by harness."
        },
        "includeHidden": {
          "type": "boolean",
          "description": "Include hidden sessions. Default false."
        },
        "includePinnedOnly": {
          "type": "boolean",
          "description": "Only pinned sessions. Default false."
        },
        "parentOnly": {
          "type": "boolean",
          "description": "Exclude collab child sessions. Default false."
        },
        "olderThan": {
          "type": "string",
          "description": "ISO timestamp — only sessions last active before this."
        },
        "newerThan": {
          "type": "string",
          "description": "ISO timestamp — only sessions last active after this."
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 8,
          "description": SESSION_TAGS_FILTER_DESCRIPTION
        },
        "tagMatch": {
          "type": "string",
          "enum": [
            "any",
            "all"
          ],
          "description": SESSION_TAG_MATCH_DESCRIPTION
        },
        "projectId": {
          "type": "string",
          "description": "List sessions in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project."
        },
        "allProjects": {
          "type": "boolean",
          "description": "List sessions across every SuperOne project. Mutually exclusive with projectId. Default false."
        },
        "order": {
          "type": "string",
          "enum": [
            "last_active_desc",
            "last_active_asc",
            "created_desc",
            "created_asc",
            "message_count_desc",
            "message_count_asc",
            "size_desc",
            "size_asc"
          ],
          "description": "Sort order. Default last_active_desc. last_active_asc = oldest first. created_* by createdAt; message_count_* by message count; size_* ranks by approx transcript size and includes sizeBytes (character length of message JSON, not disk page-file bytes)."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max rows. Default 20, max 50."
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "description": "Pagination offset. Default 0."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "session_search",
    "description": SESSION_SEARCH_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "description": "Search terms (AND). Matches title and message text."
        },
        "harness": {
          "type": "string",
          "enum": [
            "claude",
            "codex",
            "acp",
            "opencode"
          ]
        },
        "sessionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 32,
          "description": "Optional: restrict search to these session ids."
        },
        "role": {
          "type": "string",
          "enum": [
            "user",
            "assistant",
            "any"
          ],
          "description": "Message role filter. Default any."
        },
        "tags": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": SESSION_TAGS_FILTER_DESCRIPTION
        },
        "tagMatch": {
          "type": "string",
          "enum": ["any", "all"],
          "description": SESSION_TAG_MATCH_DESCRIPTION
        },
        "projectId": {
          "type": "string",
          "description": "Search this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project."
        },
        "allProjects": {
          "type": "boolean",
          "description": "Search every SuperOne project. Mutually exclusive with projectId. Default false."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max hits. Default 20, max 50."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_read",
    "description": SESSION_READ_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "minLength": 1,
          "description": "Target SuperOne session id from session_list or session_search (any project). Do not pass the current session."
        },
        "view": {
          "type": "string",
          "enum": [
            "meta",
            "user",
            "assistant",
            "text",
            "tools",
            "tool_detail"
          ],
          "description": "meta=metadata; user=user text only; assistant=assistant text + toolCount; text=both; tools=tool index; tool_detail=one tool (needs toolUseId). Default text."
        },
        "messageId": {
          "type": "string",
          "description": "Anchor page at this message id (from search or a prior read)."
        },
        "around": {
          "type": "integer",
          "minimum": 0,
          "maximum": 50,
          "description": "With messageId: include this many messages before and after on the global timeline."
        },
        "cursor": {
          "type": [
            "integer",
            "null"
          ],
          "description": "Exclusive end index for the next older page (from a prior read). Omit for newest page."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max messages this page. Default 20, max 50."
        },
        "includeThinking": {
          "type": "boolean",
          "description": "Include thinking blocks in text views. Default false."
        },
        "toolUseId": {
          "type": "string",
          "description": "Required for view=tool_detail."
        }
      },
      "required": [
        "sessionId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_cleanup",
    "description": SESSION_CLEANUP_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "hide",
            "unhide",
            "delete"
          ],
          "description": "hide/unhide soft-archive (no confirm). delete permanently removes after user approval dialog."
        },
        "sessionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "maxItems": 50,
          "description": "Session ids from session_list to act on."
        },
        "includePinned": {
          "type": "boolean",
          "description": "Allow acting on pinned sessions. Default false (pinned are skipped)."
        },
        "maxDelete": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Hard cap on sessions acted on. Default 50."
        }
      },
      "required": [
        "action",
        "sessionIds"
      ],
      "additionalProperties": false
    }
  }
]
