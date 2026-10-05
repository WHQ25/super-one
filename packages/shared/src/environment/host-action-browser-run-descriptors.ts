import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'

export const HOST_ACTION_BROWSER_RUN_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "browser_run",
    "description": "Experimental (requires the Jev fast loop setting): delegate a multi-step page goal — clicks, typing, scrolling — to a fast model that chooses each step and judges completion itself, so you do not pay a turn per click. Start with goal; add presets for values it may type (never passwords) and, optionally, done_when when the finish is machine-checkable. Before anything irreversible (submit, pay, delete, send, leaving the site) or when unsure, the call returns status=paused with a question; answer it by calling again with runId + answer. Every result carries the final snapshot: verify it. Use for click/fill-heavy tasks on one tab; use browser_act for single steps, drag, keys, uploads.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "goal": {
          "description": "What to achieve, said as what the page shows when it is done: the loop judges completion from the page text, so name the visible end state, not the steps. \"Report.txt is listed inside Archive\" rather than \"drag Report.txt onto Archive\"; \"no sheet is open over the document window\" rather than \"press Escape\". When a native condition can say it, pass done_when as well. Required to start a run.",
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
              "description": "For type=value questions: { text }; for reason=capability: { actions?: <this platform's *_act actions, run on snapshot.stateId>, presets?: [{ key, value, field? }] }.",
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
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view.",
          "type": "string"
        },
        "done_when": {
          "description": "Optional machine-checkable finish (AND-combined, same vocabulary as browser_wait_for). The loop judges completion itself; give this when a URL or element defines it exactly.",
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
            },
            "urlMatches": {
              "description": "JavaScript regex source matched against the page URL.",
              "type": "string"
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false,
      "required": [
        "description"
      ]
    }
  }
]
