import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'

export const HOST_ACTION_BROWSER_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "browser_tools_list",
    "description": "List WebMCP tools registered by the current secure page. Use this to discover page-provided actions and their input schemas, then call browser_tools_call with a returned name.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_tools_call",
    "description": "Call one WebMCP tool registered by the current secure page. Use browser_tools_list first to get the tool name and input schema. The page is untrusted and the user may need to approve the call.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this page tool call accomplishes, phrased for the end user watching (e.g. 'Add the shirt to the cart', 'Submit the quote request'). Shown in the UI next to the tool name. Write it in the conversation's language.",
          "type": "string"
        },
        "name": {
          "description": "Tool name from browser_tools_list. Required.",
          "type": "string"
        },
        "input": {
          "default": {},
          "description": "Arguments; validated against the page-declared inputSchema at dispatch time.",
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        }
      },
      "required": [
        "input"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_snapshot",
    "description": "Inspect the current page. `include` picks sections: meta, elements (flat interactive + CSS selectors), tree (structure), text, console, screenshot. Default [meta, elements, console] (lean). include:[console] skips the DOM scan. include:[screenshot] saves a PNG and returns path — image is NOT loaded; Read the path if pixels matter. Result is TOON unless a screenshot is requested with other sections (then JSON {screenshot, page}). Prefer this before browser_act. Use browser_query when you already know the target.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "include": {
          "description": "Which sections to return. Default ['meta','elements','console'].",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "meta",
              "elements",
              "tree",
              "text",
              "console",
              "screenshot"
            ]
          }
        },
        "filter": {
          "type": "string"
        },
        "max": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200
        },
        "depth": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "treeMax": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        },
        "textMaxChars": {
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        },
        "selector": {
          "description": "Element to screenshot when include contains screenshot.",
          "type": "string"
        },
        "console": {
          "type": "object",
          "properties": {
            "level": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "log",
                  "info",
                  "warning",
                  "error"
                ]
              }
            },
            "grep": {
              "type": "string"
            },
            "regex": {
              "type": "boolean"
            },
            "ignoreCase": {
              "type": "boolean"
            },
            "invert": {
              "type": "boolean"
            },
            "max": {
              "type": "integer",
              "minimum": 1,
              "maximum": 200
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_query",
    "description": "Find or inspect elements. op=search (default) matches role / text / css / attributes and returns a TOON table of reusable selectors. op=inspect returns detail on one selector (fields: text, html, attributes, value, box, styles, context). Use this instead of snapshot when you already know what you are looking for. Do not use this to click or type (browser_act).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "op": {
          "description": "Default search.",
          "type": "string",
          "enum": [
            "search",
            "inspect"
          ]
        },
        "role": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "selector": {
          "description": "CSS selector. Required for inspect.",
          "type": "string"
        },
        "attributes": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "visible": {
          "type": "boolean"
        },
        "max": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "fields": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "text",
              "html",
              "attributes",
              "value",
              "box",
              "styles",
              "context"
            ]
          }
        },
        "maxChars": {
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_wait_for",
    "description": "Block until the page reaches a desired state. Provide at least one condition; all are AND-combined: a css selector that must be visible, a selector that must be gone, a visible-text substring, and/or a URL substring. Use after browser_act or browser_tabs navigate when the page changes asynchronously. Defaults to 15s, max 60s. Do not sleep+poll with snapshot yourself.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector that must be present and visible.",
          "type": "string"
        },
        "selectorGone": {
          "description": "CSS selector that must be absent or hidden.",
          "type": "string"
        },
        "text": {
          "description": "Substring that must appear in visible document text.",
          "type": "string"
        },
        "urlIncludes": {
          "description": "Substring that must appear in the current URL.",
          "type": "string"
        },
        "timeoutMs": {
          "description": "Maximum wait in milliseconds. Default 15000, max 60000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_evaluate",
    "description": "Evaluate a JavaScript expression in the page and return its serializable result. Prefer snapshot and browser_act; use evaluate only for inspection or interactions those tools cannot express. The expression may mutate page state. A returned Promise is awaited. A large result (>32KB) is spilled to a file as { spilled:true, path, bytes, preview }.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "expression": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64000,
          "description": "JavaScript expression to evaluate in the page."
        }
      },
      "required": [
        "expression"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_tabs",
    "description": "Discover and change browser tabs for this session. action=list (default) returns a TOON table of tab id / url / title / loading. action=open creates or reuses a tab (optional url). action=navigate|back|forward|reload changes that tab's page — pass url, or port (+ optional path) for localhost. action=close discards tabs you opened and are done with — pass one id or an array; it is not undoable, so never close a tab the user is reading. Use the returned tab id as `tab` on other browser tools. Not for clicking or typing (browser_act).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "action": {
          "description": "Default list.",
          "type": "string",
          "enum": [
            "list",
            "open",
            "navigate",
            "back",
            "forward",
            "reload",
            "close"
          ]
        },
        "tab": {
          "description": "Existing tab id to reuse (open) or target (navigate/history/close). An array is only valid with action=close.",
          "anyOf": [
            { "type": "string" },
            { "minItems": 1, "type": "array", "items": { "type": "string" } }
          ]
        },
        "url": {
          "description": "Website URL for open/navigate. Schemeless host gets https; loopback gets http.",
          "type": "string"
        },
        "port": {
          "description": "Localhost port for navigate.",
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        },
        "path": {
          "description": "Optional path/query for the port form.",
          "type": "string"
        },
        "protocol": {
          "description": "Protocol for the port form. Defaults to http.",
          "type": "string",
          "enum": [
            "http",
            "https"
          ]
        },
        "readiness": {
          "description": "'load' waits for loading to stop (default); 'none' returns immediately.",
          "type": "string",
          "enum": [
            "load",
            "none"
          ]
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_act",
    "description": "Act on the page: click, hover, type, press, scroll, drag, select, upload. Send ONE action per call by default. Batch 2–20 only for a sequence you would not stop between (fill a form then submit) — the user sees a batch as one step. Re-read the page between anything else. Prefer a CSS selector from snapshot/query; click/hover also accept text or x/y. engine=auto|cdp|synthetic (default auto). description is shown to the user instead of raw selectors. recording=true saves a video of just this transaction; expect holds it open until a page condition is met. Not for navigation (browser_tabs), waiting (browser_wait_for), or JS (browser_evaluate). Fail-fast: stops at the first error.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
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
                  "click",
                  "hover",
                  "type",
                  "press",
                  "scroll",
                  "drag",
                  "select",
                  "upload"
                ]
              },
              "selector": {
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
              "clear": {
                "type": "boolean"
              },
              "key": {
                "type": "string"
              },
              "modifiers": {
                "type": "array",
                "items": {
                  "type": "string",
                  "enum": [
                    "Alt",
                    "Control",
                    "Meta",
                    "Shift"
                  ]
                }
              },
              "deltaX": {
                "type": "number"
              },
              "deltaY": {
                "type": "number"
              },
              "from": {
                "type": "object",
                "properties": {
                  "selector": {
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
                  }
                },
                "additionalProperties": false
              },
              "to": {
                "type": "object",
                "properties": {
                  "selector": {
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
                  }
                },
                "additionalProperties": false
              },
              "steps": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "holdMs": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "humanize": {
                "type": "boolean"
              },
              "value": {
                "type": "string"
              },
              "label": {
                "type": "string"
              },
              "index": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "checked": {
                "type": "boolean"
              },
              "files": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "engine": {
                "type": "string",
                "enum": [
                  "auto",
                  "cdp",
                  "synthetic"
                ]
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          "description": "Normally one action. Use 2–20 only for a single uninterruptible sequence; they run in order, fail-fast."
        },
        "recording": {
          "description": "Save a video of only this action transaction. Default false.",
          "type": "boolean"
        },
        "expect": {
          "description": "Explicit completion condition checked before recording stops.",
          "type": "object",
          "properties": {
            "selector": {
              "type": "string"
            },
            "selectorGone": {
              "type": "string"
            },
            "text": {
              "type": "string"
            },
            "urlIncludes": {
              "type": "string"
            }
          },
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Maximum wait for expect. Default 15000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "actions"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network",
    "description": "Network, downloads, and page environment. Recording ladder: action=start → do an act/navigate → action=wait or stop (lean manifest) → action=body({requestId}) for one response. action=download fetches a URL through the session; action=downloads lists page-triggered captures. action=cookies|mock|emulate need CDP experimental settings, except emulate with only preset/width/height/reset. Prefer snapshot/query for page content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "action": {
          "type": "string",
          "enum": [
            "start",
            "stop",
            "wait",
            "body",
            "download",
            "downloads",
            "cookies",
            "mock",
            "emulate"
          ],
          "description": "Which network/env operation to run."
        },
        "recordingId": {
          "description": "From action=start. Required for stop/wait/body.",
          "type": "string"
        },
        "requestId": {
          "description": "From a stop/wait manifest. Required for body.",
          "type": "string"
        },
        "match": {
          "type": "string"
        },
        "resourceTypes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "captureBodies": {
          "type": "boolean"
        },
        "max": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "keep": {
          "description": "stop only: peek without tearing down.",
          "type": "boolean"
        },
        "url": {
          "description": "wait: substring to match. download: absolute URL. mock: url substring.",
          "type": "string"
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "filename": {
          "type": "string"
        },
        "dir": {
          "description": "download only: absolute directory to save into. Defaults to the configured download directory, or the session directory on a remote node.",
          "type": "string"
        },
        "state": {
          "type": "string",
          "enum": [
            "all",
            "progressing",
            "completed",
            "failed"
          ]
        },
        "wait": {
          "description": "downloads only: block until captures settle.",
          "type": "boolean"
        },
        "urls": {
          "description": "cookies only.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "status": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "body": {
          "type": "string"
        },
        "contentType": {
          "type": "string"
        },
        "headers": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "clear": {
          "type": "boolean"
        },
        "preset": {
          "description": "emulate: named viewport (no CDP).",
          "type": "string",
          "enum": [
            "mobile",
            "tablet",
            "desktop"
          ]
        },
        "width": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "height": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "reset": {
          "type": "boolean"
        },
        "deviceScaleFactor": {
          "type": "number"
        },
        "mobile": {
          "type": "boolean"
        },
        "userAgent": {
          "type": "string"
        },
        "colorScheme": {
          "type": "string",
          "enum": [
            "light",
            "dark",
            "no-preference"
          ]
        },
        "timezone": {
          "type": "string"
        },
        "locale": {
          "type": "string"
        },
        "latitude": {
          "type": "number"
        },
        "longitude": {
          "type": "number"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_action",
    "description": "Saved semantic browser actions (dynamic catalog — list then do). action=list (optional domain/name; includeArchived to find archived flows). action=read returns one complete definition by domain+name. action=archive hides a flow and prevents execution; archived=false restores it. action=do runs one saved action with input. action=save creates or replaces a named flow (domain+name) — read the manual first. This does not record prior browser calls. Use browser_act for one-off clicks/types.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "includeArchived": { "type": "boolean" },
        "archived": { "type": "boolean" },
        "action": {
          "type": "string",
          "enum": [
            "list",
            "read",
            "save",
            "archive",
            "do"
          ],
          "description": "list / read / save / archive / do."
        },
        "domain": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Semantic domain namespace, normally a hostname such as github.com."
        },
        "name": {
          "type": "string"
        },
        "includeSteps": {
          "type": "boolean"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "parameters": {
          "default": [],
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "pattern": "^[A-Za-z_][A-Za-z0-9_-]{0,63}$",
                "description": "Input name referenced in step templates as ${input.name}."
              },
              "description": {
                "description": "What the caller should provide.",
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "type": {
                "description": "Optional runtime type constraint.",
                "type": "string",
                "enum": [
                  "string",
                  "number",
                  "boolean",
                  "object",
                  "array"
                ]
              },
              "required": {
                "default": true,
                "type": "boolean"
              },
              "default": {}
            },
            "required": [
              "name",
              "required"
            ],
            "additionalProperties": false
          }
        },
        "steps": {
          "description": "save only: 1-50 flow steps, each {kind:\"tool\"|\"action\"|\"set\"|\"if\"|\"forEach\"|\"repeat\"}. Read read_manual({ domain: \"product\", topic: \"browser\" }) for the grammar before writing them.",
          "minItems": 1,
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          }
        },
        "input": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        },
        "tab": {
          "type": "string"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    }
  }
]
