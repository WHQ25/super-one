import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'

export const HOST_ACTION_BROWSER_PERF_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "browser_perf",
    "description": "Profile what a page (or SuperOne itself) burns CPU on: hotspot functions by self time, plus layout/style/heap deltas. Pass `action` to measure ONE interaction: the window opens and closes around it, and a ~1s ambient baseline is subtracted. Omit `action` to profile steady state for `sampleMs` (no baseline; the only mode for target='app'). The reply flags a truncated window or a non-script bottleneck when either applies.",
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
        "target": {
          "description": "'tab' (default) = a browser view. 'app' = SuperOne's own renderer; sample mode only.",
          "type": "string",
          "enum": [
            "tab",
            "app"
          ]
        },
        "action": {
          "description": "Action mode: the action runs inside the profiling window. Omit for sample mode.",
          "type": "object",
          "properties": {
            "tool": {
              "type": "string",
              "description": "Browser primitive to measure, e.g. 'browser_click', 'browser_navigate', 'browser_scroll'."
            },
            "args": {
              "description": "Arguments for that tool, as you would pass them directly.",
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "required": [
            "tool"
          ],
          "additionalProperties": false
        },
        "sampleMs": {
          "description": "Sample mode: how long to profile steady-state load. Default 3000.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "until": {
          "description": "Action mode: explicit completion signal for an exact window.",
          "type": "object",
          "properties": {
            "urlContains": {
              "type": "string"
            },
            "selector": {
              "type": "string"
            }
          },
          "additionalProperties": false
        },
        "maxWaitMs": {
          "description": "Action mode: upper bound on the wait. Default 10000.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "baselineMs": {
          "description": "Action mode: ambient-load sample length. Default 1000.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        }
      },
      "additionalProperties": false
    }
  }
]
