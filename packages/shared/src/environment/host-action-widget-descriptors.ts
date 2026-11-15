import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import { WIDGET_JSON_OBJECT_ARGUMENT, WIDGET_LAYOUT_DESCRIPTION, WIDGET_SAVE_DESCRIPTION, WIDGET_SHOW_DESCRIPTION } from '../generative-ui/widget-tool-descriptions'

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
        description: 'JSON Schema for the data this template expects. Omit for a template that renders without data. ' + WIDGET_JSON_OBJECT_ARGUMENT,
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
    // `layout` stays ahead of `widget_code`. Registrations build their Zod shape
    // from this property order, and the preview starts at the right scale only
    // when layout streams first.
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
          "type": "string",
          "description": "HTML or SVG code to render. For SVG: raw SVG starting with <svg>. For HTML: raw content fragment, no DOCTYPE/<html>/<head>/<body>. Omit when reusing a saved template via the template parameter."
        },
        "template": {
          "type": "string",
          "description": "Id of a saved widget template to render instead of inline code. Call widget_list_templates to discover ids. Mutually exclusive with widget_code. An id starting with @native/ renders a built-in SuperOne surface rather than HTML."
        },
        "data": {
          "type": "object",
          "additionalProperties": true,
          "description": "Values passed to the template, readable inside the widget as window.widget.data. For a @native/ template this is the surface's own input — see widget_list_templates for its shape. " + WIDGET_JSON_OBJECT_ARGUMENT
        },
        "reusable": {
          "type": "object",
          "additionalProperties": false,
          "description": "Only set this when the widget is written to be reused later: it prefills the save dialog. The widget is NOT saved by this call — saving is always the user's action. " + WIDGET_JSON_OBJECT_ARGUMENT,
          "properties": {
            "id": {
              "type": "string",
              "description": "Stable kebab-case id to suggest when the user saves this widget."
            },
            "description": {
              "type": "string",
              "description": "One line describing when to reuse this widget."
            },
            "inputSchema": {
              "type": "object",
              "additionalProperties": true,
              "description": "JSON Schema for the data this widget expects. " + WIDGET_JSON_OBJECT_ARGUMENT
            }
          },
          "required": ["id"]
        },
        "width": {
          "type": "number",
          "description": "Widget width in pixels. Default: 800."
        },
        "height": {
          "type": "number",
          "description": "Widget height in pixels. Default: 600."
        }
      },
      "required": [
        "title"
      ],
      "additionalProperties": false
    }
  }
]
