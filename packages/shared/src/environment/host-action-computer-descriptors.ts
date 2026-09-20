import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'

export const HOST_ACTION_COMPUTER_DESCRIPTORS = [
  {
    "name": "computer_apps",
    "description": "Discover and open desktop apps. action=list (default) returns a compact TOON app catalog: one row per app with app, bundleId, running, frontmost, granted, grantScope, pid, windows. Use query to keyword-filter by display name / bundle id / localized aliases (e.g. query=Notes or com.apple.TextEdit). Paginate with offset + limit (default limit 25, max 100); hasMore means call again with offset+=limit. Rows are sorted running/frontmost/granted first. action=focus|launch accepts display name (any locale) or reverse-DNS bundleId; host resolves to a stable bundleId before the permission grant so one allow covers later snapshot/act. Launch/focus returns a slim {target} confirmation. If the user only asks to open an app, launch once and stop when target is returned. For navigation, forms or search, prefer computer_run when Jev is enabled; batch known button sequences with computer_act. Focus only raises the window and leaves the app in the background; pass activate=true only when the app must stay the active app for a sequence of foreground-only steps (menu bar commands and ⌘ shortcuts work in the background; no activation is needed for them).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "action": {
          "description": "Default list",
          "type": "string",
          "enum": [
            "list",
            "focus",
            "launch"
          ]
        },
        "app": {
          "description": "Display name (any locale) or reverse-DNS bundle id for focus/launch. Prefer bundleId from a prior list when known.",
          "type": "string"
        },
        "activate": {
          "description": "focus only: make the app frontmost and keep it there. Leave unset so the user keeps their current app; menu bar commands do not need it.",
          "type": "boolean"
        },
        "query": {
          "description": "list only: keyword filter on app name / bundleId / aliases",
          "type": "string"
        },
        "offset": {
          "description": "list only: pagination offset (default 0)",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "limit": {
          "description": "list only: page size (default 25, max 100)",
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "includeRoots": {
          "description": "list only: also attach discoverable UI roots (@rN). Token-heavy; default false.",
          "type": "boolean"
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_snapshot",
    "description": "Capture an immutable UI snapshot and return stateId (analogous to browser_snapshot for desktop apps). All subsequent query/act/wait_for calls must reference this stateId. mode=visual (and fused) saves the image to a temporary file and returns image.path (not base64). The image is NOT loaded into your context automatically; call Read on image.path if you need to look at pixels, and embed image.path in your reply when it is evidence of the result (read_manual product/show-your-work). mode=semantic returns accessibility outline with @eN refs (no image). mode=fused = screenshot + AX. The outline is a TOON table, not JSON: a header row outline[N]{ref,depth,role,name,value,x,y,w,h,can,state}: followed by one CSV-style row per node, in depth-first reading order. depth is the nesting level (a row is a child of the nearest row above it with a smaller depth). can lists only the supported actions, pipe-joined (press|select|open|setText|typeText|scroll|focus); empty means the node is inert. state lists only non-default flags (disabled|focused). x,y,w,h are the frame in capture space, empty when the node reports none. truncation.nodesOmitted > 0 means the returned outline was folded — reach the rest with computer_query, do not recapture. truncation.sourceTruncated means the native accessibility walk itself hit a limit, so those nodes are missing from the full tree too and computer_query cannot reach them either — narrow the target with capture=window or a specific rootId instead. Use computer_query on the cached outline for search/expand/inspect without recapturing. capture=window (default) captures only the selected window; coordinates are local to that image and remain valid if the window moves. Use capture=display explicitly when the whole display is required. If the window is resized or moves to a different display scale, input fails closed and a successor observation is created.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "root": {
          "description": "Root id from computer_apps / prior snapshot (@rN). Defaults to focused root.",
          "type": "string"
        },
        "mode": {
          "description": "Default fused",
          "type": "string",
          "enum": [
            "visual",
            "semantic",
            "fused"
          ]
        },
        "capture": {
          "description": "Default window; use display for the full target display",
          "type": "string",
          "enum": [
            "window",
            "display"
          ]
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_zoom",
    "description": "Re-sample a region of the last observation at higher detail, preserving its window/display scope. Saves the image to a temporary file and returns image.path (not base64); Read the path if you need pixels. Does NOT create a new coordinate space — click coordinates still use the parent stateId space.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string",
          "description": "Parent observation stateId"
        },
        "region": {
          "type": "array",
          "prefixItems": [
            {
              "type": "number"
            },
            {
              "type": "number"
            },
            {
              "type": "number"
            },
            {
              "type": "number"
            }
          ],
          "description": "[x0, y0, x1, y1] in parent coordinate space"
        }
      },
      "required": [
        "description",
        "stateId",
        "region"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_query",
    "description": "Search / expand / inspect the cached outline for a stateId without recapturing the desktop. Use this for progressive disclosure of deep accessibility trees. expand/inspect return the subtree/element as the same TOON table computer_snapshot uses.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string"
        },
        "op": {
          "type": "string",
          "enum": [
            "search",
            "expand",
            "inspect"
          ]
        },
        "text": {
          "description": "For search",
          "type": "string"
        },
        "ref": {
          "description": "For expand/inspect (@eN)",
          "type": "string"
        },
        "depth": {
          "description": "For expand",
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        }
      },
      "required": [
        "description",
        "stateId",
        "op"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_act",
    "description": "Submit 1–20 related UI actions as a checked transaction against a stateId. Batch a known button sequence here; prefer computer_run when each next target must be found from new UI state and Jev is enabled. Set delivery explicitly when you can; that field describes how the three modes differ. Actions: click, typeText, keypress, scroll(dx,dy[,x,y|ref]), drag(path≥2 points), moveMouse, press/select/open/setText (AX). select chooses a selectable item; open invokes its observed native open action.  scroll: positive dy scrolls content down; aim with x,y (capture space) or ref center; else window/outline center. drag: path is capture-space points; virtual cursor animates along the path. Returns outcome worked|didnt|unknown based on re-observation (not API success codes): worked when AX readback, expect, typed text, or a meaningful successor outline diff confirms effect; unknown only when applied but unprovable; didnt on hard failure or failed expect. When the successor has pixels, successorImage.path contains the fresh screenshot. Set recording=true to save a short video containing only this action transaction. Stale stateId (UI changed since snapshot) is rejected before side effects. delivery=semantic never silently upgrades to app-directed/physical input.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string"
        },
        "actions": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "press",
                  "select",
                  "open",
                  "click",
                  "setText",
                  "typeText",
                  "keypress",
                  "scroll",
                  "drag",
                  "moveMouse"
                ]
              },
              "ref": {
                "type": "string"
              },
              "text": {
                "type": "string"
              },
              "x": {
                "type": "number"
              },
              "y": {
                "type": "number"
              },
              "button": {
                "type": "string",
                "enum": [
                  "left",
                  "right"
                ]
              },
              "keys": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "dx": {
                "type": "number"
              },
              "dy": {
                "type": "number"
              },
              "path": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "x": {
                      "type": "number"
                    },
                    "y": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          }
        },
        "expect": {
          "description": "Postcondition checked after actions",
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains",
                "valueEquals",
                "newRoot"
              ]
            },
            "ref": {
              "description": "Required except for newRoot: the target element ref from the starting snapshot.",
              "type": "string"
            },
            "text": {
              "description": "For textEquals/textContains: element name or value. For newRoot: substring in the new root outline.",
              "type": "string"
            },
            "value": {
              "description": "Required for valueEquals: the exact element value to wait for.",
              "type": "string"
            },
            "title": {
              "description": "newRoot: exact title of a visible window, panel, sheet or menu in the same app that was absent at the starting snapshot.",
              "type": "string"
            },
            "rootKind": {
              "description": "newRoot: optional kind filter. Supply title and/or text; all supplied filters must match.",
              "type": "string",
              "enum": [
                "window",
                "sheet",
                "dialog",
                "menu",
                "popover"
              ]
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Maximum wait for expect before the action is judged. Default 5000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        },
        "recording": {
          "description": "Save a video of only this action transaction. Default false.",
          "type": "boolean"
        },
        "delivery": {
          "description": "semantic — pure AX; prefer it whenever actions use @eN refs and the action is press/select/open/setText/click(ref)/typeText(ref), the most reliable path for labeled controls. app-directed — the default when omitted; for coordinate click/type/scroll/drag/keypress or when no usable AX ref exists. Posts CGEvent to the target app PID in the background without stealing frontmost; a ⌘ shortcut (keys=[\"cmd+s\"]) works there too, the app is made to believe it is active for it. System-wide hotkeys (⌘Space, ⌘Tab, screenshots) need physical. physical — global HID; only when app-directed fails. Requires frontmost and is disruptive.",
          "type": "string",
          "enum": [
            "semantic",
            "app-directed",
            "physical"
          ]
        }
      },
      "required": [
        "description",
        "stateId",
        "actions"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_run",
    "description": "Experimental (Jev setting): pursue desktop UI goals with clicks, typing and scrolling chosen without a model turn per step. Start with app (launched in the background if it is not running) or root, and goal; no computer_apps or computer_snapshot call is needed first. If the exact sequence of buttons is already known, use computer_act with a batch instead. Example: presets=[{key:\"Query\",value:\"cats\",field:\"Search\"}], done_when={kind:\"valueEquals\",ref:\"@e7\",value:\"cats\"}. Native computer_wait_for conditions bind at run start. The loop judges each step's risk and the goal's completion itself; before anything irreversible (save, send, delete, quit, leaving the app) or when unsure it pauses with a question. Resume a pause with runId + answer. Uses existing grants and tiers; skips secure fields. Use computer_act for single steps, drag, shortcuts or pixels.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short, human-friendly explanation of the goal for the user watching, in the conversation's language."
        },
        "goal": {
          "description": "What to achieve on the current page, including when to stop. Required to start a run.",
          "type": "string"
        },
        "presets": {
          "description": "Values the loop may type. Never include passwords.",
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "minLength": 1,
                "description": "Short name, e.g. Title."
              },
              "value": {
                "type": "string",
                "description": "The full text to type."
              },
              "field": {
                "description": "Hint naming the field it belongs in, e.g. \"the title textbox\".",
                "type": "string"
              }
            },
            "required": [
              "key",
              "value"
            ],
            "additionalProperties": false
          }
        },
        "maxSteps": {
          "description": "Default 30.",
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "maxWallMs": {
          "description": "Wall-clock budget per call before pausing. Default 45000.",
          "type": "integer",
          "minimum": 5000,
          "maximum": 300000
        },
        "runId": {
          "description": "From a paused result. Resumes that run with `answer`.",
          "type": "string"
        },
        "answer": {
          "description": "Reply to the pending question when resuming.",
          "type": "object",
          "properties": {
            "questionId": {
              "type": "string"
            },
            "choice": {
              "description": "An option key from the question, or \"abort\".",
              "type": "string"
            },
            "value": {
              "description": "For type=value questions: { text }.",
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "goal": {
              "description": "Optionally revise the goal.",
              "type": "string"
            },
            "abort": {
              "type": "boolean"
            }
          },
          "required": [
            "questionId"
          ],
          "additionalProperties": false
        },
        "app": {
          "description": "App name (any locale) or bundle id. Resolves the app grant and its window; an app that is not running or has no window is launched in the background and its first window awaited. Use app or root, not both.",
          "type": "string"
        },
        "root": {
          "description": "Root id from computer_snapshot/computer_apps. Omit to use the existing target.",
          "type": "string"
        },
        "done_when": {
          "description": "Same conditions as computer_wait_for. Bind ref to an element in the starting snapshot, or use {kind:\"newRoot\",title:\"Fonts\"} for a new same-app window/panel. newRoot needs title and/or text; supplied filters must all match. No future ref is needed.",
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains",
                "valueEquals",
                "newRoot"
              ]
            },
            "ref": {
              "description": "Required except for newRoot: the target element ref from the starting snapshot.",
              "type": "string"
            },
            "text": {
              "description": "For textEquals/textContains: element name or value. For newRoot: substring in the new root outline.",
              "type": "string"
            },
            "value": {
              "description": "Required for valueEquals: the exact element value to wait for.",
              "type": "string"
            },
            "title": {
              "description": "newRoot: exact title of a visible window, panel, sheet or menu in the same app that was absent at the starting snapshot.",
              "type": "string"
            },
            "rootKind": {
              "description": "newRoot: optional kind filter. Supply title and/or text; all supplied filters must match.",
              "type": "string",
              "enum": [
                "window",
                "sheet",
                "dialog",
                "menu",
                "popover"
              ]
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_wait_for",
    "description": "Wait until a UI condition holds. Distinguishes preexisting (already true) from verified (became true); failed means the timeout ran out, and observed then carries what the element read as. Do not sleep+poll with snapshot yourself.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string"
        },
        "condition": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains",
                "valueEquals",
                "newRoot"
              ]
            },
            "ref": {
              "description": "Required except for newRoot: the target element ref from the starting snapshot.",
              "type": "string"
            },
            "text": {
              "description": "For textEquals/textContains: element name or value. For newRoot: substring in the new root outline.",
              "type": "string"
            },
            "value": {
              "description": "Required for valueEquals: the exact element value to wait for.",
              "type": "string"
            },
            "title": {
              "description": "newRoot: exact title of a visible window, panel, sheet or menu in the same app that was absent at the starting snapshot.",
              "type": "string"
            },
            "rootKind": {
              "description": "newRoot: optional kind filter. Supply title and/or text; all supplied filters must match.",
              "type": "string",
              "enum": [
                "window",
                "sheet",
                "dialog",
                "menu",
                "popover"
              ]
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Default 5000",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "description",
        "stateId",
        "condition"
      ],
      "additionalProperties": false
    }
  }
] satisfies HostActionSuperoneToolDescriptor[]
