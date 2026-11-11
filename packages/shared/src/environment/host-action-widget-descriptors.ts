import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import { WIDGET_LAYOUT_DESCRIPTION, WIDGET_SAVE_DESCRIPTION, WIDGET_SHOW_DESCRIPTION } from '../generative-ui/widget-tool-descriptions'

export const WIDGET_SAVE_DESCRIPTOR: HostActionSuperoneToolDescriptor = {
  name: 'widget_save',
  description: WIDGET_SAVE_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Existing template id to update, or a short kebab-case name for a new one (a unique suffix is appended so distinct saves never collide).',
      },
      title: {
        type: 'string',
        description: 'Human-readable name shown in the template list.',
      },
      code: {
        type: 'string',
        description: 'The widget HTML or SVG to store, exactly as it should be re-rendered.',
      },
      description: {
        type: 'string',
        description: 'One line telling a future agent when to reuse this template.',
      },
      inputSchema: {
        type: 'object',
        additionalProperties: true,
        description: 'JSON Schema for the data this template expects. Omit for a template that renders without data.',
      },
      layout: {
        type: 'string',
        enum: ['fluid', 'fixed'],
        description: WIDGET_LAYOUT_DESCRIPTION,
      },
      scope: {
        type: 'string',
        enum: ['project', 'user'],
        description: 'project (default) stores it under the project so it can be shared through git; user makes it available everywhere.',
      },
    },
    required: ['id', 'title', 'code'],
    additionalProperties: false,
  },
}

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
