import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'

export const HOST_ACTION_DEVICE_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "device_list",
    "description": "Browse the devices this machine can offer, one tier at a time. No arguments: what is running, what this project used before, and which kinds exist. kind: its models. model: its devices, one per runtime, with ids. Prefer a running or recent one — attaching is instant, a cold boot costs ~20s. Free: it grants nothing and boots nothing.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "kind": {
          "description": "Narrow to one family: \"iphone\", \"ipad\", \"watch\", \"tv\", \"vision\". Returns its models.",
          "type": "string"
        },
        "model": {
          "description": "A model name from the kind tier (\"iPhone 17 Pro Max\"). Returns one entry per runtime, with ids.",
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "device_boot",
    "description": "Start a device and grant nothing. Needs no approval, so call it as soon as you know which device you want — a cold boot costs ~20s and this pays it while you keep working. Returns once it is running; a device already up returns immediately. It does NOT let you drive it: device_snapshot and device_act still fail with NO_DEVICE until device_request_control succeeds. Real phones cannot be started this way. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "type": "string",
          "description": "The id from device_list. A name is matched loosely as a fallback."
        }
      },
      "required": [
        "description",
        "device"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_request_control",
    "description": "Ask the user to let this session control one device, and wait for their answer. Every other device_* tool fails with NO_DEVICE until this succeeds — call it first, not after a failure. Boot it with device_boot first so the wait is not spent on a cold start. Pick the device from device_list yourself; a decline carries feedback that often names a different one. The user may approve it standing for this project, in which case later calls return with no prompt. Returns it bound and booted. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "type": "string",
          "description": "The id from device_list. A name is matched loosely as a fallback, but the id is what makes the approved device the one you meant."
        }
      },
      "required": [
        "description",
        "device"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_snapshot",
    "description": "Capture the screen and return a stateId later calls must quote. Waits for animation to stop. mode=semantic (default) returns the accessibility tree with @eN refs — prefer it: refs survive animation and rotation, coordinates do not. mode=visual saves a PNG and returns image.path (not pixels); Read it to look. fused returns both. Regions with no tree (WebView, canvas) are read from pixels and marked (ocr): tap those, never press. Re-snapshot after anything that changes the screen — refs are positional and device_act rejects a stale stateId. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "mode": {
          "description": "Default semantic",
          "type": "string",
          "enum": [
            "semantic",
            "visual",
            "fused"
          ]
        },
        "maxNodes": {
          "description": "Ceiling on tree size. Default 500; truncated=true means the screen has more.",
          "type": "integer",
          "minimum": 1,
          "maximum": 2000
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_query",
    "description": "Search or inspect an existing snapshot without re-capturing the device. Prefer it over another snapshot when you only need to find an element or read its details: no device round trip, and it cannot race an animation. op=search matches labels, values and identifiers; op=inspect returns one element and its children.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "stateId": {
          "type": "string",
          "description": "From a prior device_snapshot."
        },
        "op": {
          "type": "string",
          "enum": [
            "search",
            "inspect"
          ]
        },
        "text": {
          "description": "For search.",
          "type": "string"
        },
        "ref": {
          "description": "For inspect, e.g. \"@e12\".",
          "type": "string"
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
    "name": "device_act",
    "description": "Run 1-10 touch actions against a snapshot, then re-observe to judge if they worked. Prefer refs; press survives animation, but use tap for source=ocr and raw x/y only as a last resort. The batch and a stale stateId are validated before any side effect. rotate must be last, then re-snapshot. Returns worked|didnt|unknown; pass expect to define success. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "stateId": {
          "type": "string"
        },
        "actions": {
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "tap",
                  "doubleTap",
                  "longPress",
                  "swipe",
                  "pinch",
                  "press",
                  "type",
                  "setText",
                  "key",
                  "rotate",
                  "keyboard"
                ]
              },
              "ref": {
                "description": "Element ref from the snapshot, e.g. \"@e12\". Preferred over coordinates.",
                "type": "string"
              },
              "x": {
                "description": "Horizontal position as a fraction of the screen (0-1). Only when no ref fits.",
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "y": {
                "description": "Vertical position as a fraction of the screen (0-1).",
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "direction": {
                "description": "swipe: which way the finger travels. Content moves the opposite way, so \"up\" scrolls down a list.",
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "left",
                  "right"
                ]
              },
              "distance": {
                "description": "swipe: travel as a fraction of the screen. Default 0.6.",
                "type": "number",
                "minimum": 0.05,
                "maximum": 1
              },
              "toX": {
                "description": "swipe: explicit destination instead of direction.",
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "toY": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "scale": {
                "description": "pinch: final separation factor. Below 1 pinches in (zoom out), above 1 spreads.",
                "type": "number",
                "minimum": 0.1,
                "maximum": 5
              },
              "durationMs": {
                "description": "How long the gesture takes. Short swipes flick and coast; long ones drag and stop.",
                "type": "integer",
                "minimum": 16,
                "maximum": 10000
              },
              "text": {
                "description": "type: text to insert at the cursor, in a field something has already focused. setText: the field's entire new value, replacing whatever is there; pass \"\" to clear it. Prefer setText when you mean \"make this field say X\" — type appends.",
                "type": "string"
              },
              "button": {
                "description": "key: a hardware button. `back` and `app-switch` are Android-only and are refused elsewhere.",
                "type": "string",
                "enum": [
                  "home",
                  "lock",
                  "side",
                  "volume-up",
                  "volume-down",
                  "back",
                  "app-switch"
                ]
              },
              "orientation": {
                "type": "string",
                "enum": [
                  "portrait",
                  "landscape-left",
                  "portrait-upside-down",
                  "landscape-right"
                ]
              },
              "connected": {
                "description": "keyboard: attach or detach the hardware keyboard. Detach it to make the on-screen keyboard appear.",
                "type": "boolean"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          }
        },
        "expect": {
          "description": "Postcondition checked after the actions run.",
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains"
              ]
            },
            "ref": {
              "description": "Only valid within the snapshot it came from; prefer label or identifier when waiting.",
              "type": "string"
            },
            "label": {
              "description": "Visible name of the element.",
              "type": "string"
            },
            "identifier": {
              "description": "Developer-assigned id. Survives copy changes and translation — the most durable target.",
              "type": "string"
            },
            "text": {
              "description": "The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.",
              "type": "string",
              "minLength": 1
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
          "description": "Save a video of this transaction: 1s of the starting screen, the actions, its own settle/expect wait, then 1s more. Put the whole gesture you want on film in this one batch. Not available on iPhone Mirroring. Default false.",
          "type": "boolean"
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
    "name": "device_run",
    "description": "Experimental (Jev setting): pursue a multi-step touch-device goal with taps, typing and scrolling chosen without a model turn per step. Requires existing device_request_control approval; never requests control inside the loop. Start with goal and optional device, presets and done_when; the loop judges risk and completion itself. Example: done_when={kind:\"exists\",label:\"About\"}; use device_wait_for conditions with label or identifier. Risky or uncertain controls pause; resume with runId + answer. Missing accessibility trees pause for inspection. Use device_act for known action sequences, single steps, gestures or pixels.",
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
        "device": {
          "description": "A device already controlled by this session. Required when starting with more than one held device. A resumed run keeps its original device.",
          "type": "string"
        },
        "done_when": {
          "description": "Same vocabulary as device_wait_for. label matches the entire accessibility name, which may combine a title and value; prefer an observed identifier. Refs are positional. Example: {kind:\"exists\",identifier:\"details-page\"}.",
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains"
              ]
            },
            "ref": {
              "description": "Only valid within the snapshot it came from; prefer label or identifier when waiting.",
              "type": "string"
            },
            "label": {
              "description": "Visible name of the element.",
              "type": "string"
            },
            "identifier": {
              "description": "Developer-assigned id. Survives copy changes and translation — the most durable target.",
              "type": "string"
            },
            "text": {
              "description": "The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.",
              "type": "string",
              "minLength": 1
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
    "name": "device_wait_for",
    "description": "Wait until the screen satisfies a condition, instead of snapshotting in a loop. Target the element by label or identifier, never by ref: refs belong to one snapshot and what you are waiting for usually does not exist yet — text only says what to compare, it never selects. Returns a fresh settled stateId and tree, and reports preexisting vs verified.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
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
                "textContains"
              ]
            },
            "ref": {
              "description": "Only valid within the snapshot it came from; prefer label or identifier when waiting.",
              "type": "string"
            },
            "label": {
              "description": "Visible name of the element.",
              "type": "string"
            },
            "identifier": {
              "description": "Developer-assigned id. Survives copy changes and translation — the most durable target.",
              "type": "string"
            },
            "text": {
              "description": "The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.",
              "type": "string",
              "minLength": 1
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
        "condition"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_release",
    "description": "Let go of a device this session controls, once you are done with it — the close-tab of device_request_control. Call it at the end of every device task rather than leaving a simulator running. Default puts the device back the way it was found: a simulator or emulator SuperOne started is shut down, one the user already had running is left running and only unbound, a real phone is only ever disconnected. shutdown=true stops any device that can stop. Afterwards the other device_* tools fail with NO_DEVICE for it until device_request_control grants it again.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "shutdown": {
          "description": "Stop the device even if it was already running before this session found it. Default false. Has no effect on a real phone.",
          "type": "boolean"
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  }
]
