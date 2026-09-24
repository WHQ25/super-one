import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import { WIDGET_LAYOUT_DESCRIPTION, WIDGET_SHOW_DESCRIPTION } from '../generative-ui/widget-tool-descriptions'

export const HOST_ACTION_WIDGET_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "widget_list_templates",
    "description": "List reusable widget templates saved in the current project or user scope. Call this when considering template reuse; pass a returned id to widget_show.template.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "widget_show",
    "description": WIDGET_SHOW_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "description": "Short snake_case identifier for this widget."
        },
        "layout": {
          "type": "string",
          "enum": ["fluid", "fixed"],
          "description": WIDGET_LAYOUT_DESCRIPTION
        },
        "widget_code": {
          "type": "string"
        },
        "template": {
          "type": "string"
        },
        "data": {
          "type": "object",
          "additionalProperties": true
        },
        "reusable": {
          "type": "object",
          "additionalProperties": true
        },
        "width": {
          "type": "number"
        },
        "height": {
          "type": "number"
        }
      },
      "required": [
        "title"
      ],
      "additionalProperties": false
    }
  }
]
