import { Node, mergeAttributes, nodePasteRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state'
import { MermaidView } from './mermaid-view'

export interface MermaidDictionary {
  placeholder: string
  hint: string
  error: string
  loading: string
  fullscreen: string
  fullscreenDescription: string
  doubleClickToEdit: string
  zoom: string
  move: string
  reset: string
  exit: string
}

export interface MermaidOptions {
  HTMLAttributes: Record<string, unknown>
  dictionary: MermaidDictionary
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      insertMermaid: (attributes?: { syntax?: string }) => ReturnType
    }
  }
}

export const MermaidNode = Node.create<MermaidOptions>({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      dictionary: {
        placeholder: 'Enter Mermaid diagram syntax…',
        hint: 'Press Esc to exit',
        error: 'Mermaid render error:',
        loading: 'Rendering diagram…',
        fullscreen: 'Fullscreen',
        fullscreenDescription: 'Fullscreen mermaid diagram',
        doubleClickToEdit: 'Double-click to edit',
        zoom: 'zoom',
        move: 'move',
        reset: 'reset',
        exit: 'exit',
      },
    }
  },

  addAttributes() {
    return {
      syntax: {
        default: 'graph TD\n  A[Start] --> B[End]',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-syntax'),
        renderHTML: (attributes: { syntax: string }) => ({ 'data-syntax': attributes.syntax }),
      },
      isEditing: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-is-editing') === 'true',
        renderHTML: (attributes: { isEditing: boolean }) => ({
          'data-is-editing': attributes.isEditing ? 'true' : 'false',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      insertMermaid:
        (attributes?: { syntax?: string }) =>
        ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection
        const text = $from.parent.textContent
        if (text === '```mermaid') {
          editor
            .chain()
            .deleteRange({ from: $from.start(), to: $from.end() })
            .insertContent({ type: this.name, attrs: { syntax: '', isEditing: true } })
            .run()
          return true
        }
        return false
      },
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
          if (!selection.node.attrs.isEditing) return editor.commands.deleteSelection()
        }
        return false
      },
      Delete: ({ editor }) => {
        const { selection } = editor.state
        if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
          if (!selection.node.attrs.isEditing) return editor.commands.deleteSelection()
        }
        return false
      },
    }
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: /```mermaid\s*\n([\s\S]*?)\n```/g,
        type: this.type,
        getAttributes: (match) => ({ syntax: match[1]?.trim() || '', isEditing: false }),
      }),
    ]
  },

  addProseMirrorPlugins() {
    const nodeType = this.type
    return [
      new Plugin({
        key: new PluginKey('mermaidCodeBlockConverter'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null
          const tr = newState.tr
          const targets: Array<{ pos: number; code: string; size: number }> = []
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'codeBlock' && node.attrs.language === 'mermaid') {
              targets.push({ pos, code: node.textContent, size: node.nodeSize })
              return false
            }
            return undefined
          })
          if (targets.length === 0) return null
          for (let i = targets.length - 1; i >= 0; i--) {
            const { pos, code, size } = targets[i]
            const syntax = code
              .replace(/^```mermaid\s*\n?/i, '')
              .replace(/\n?```\s*$/, '')
              .trim()
            tr.replaceWith(pos, pos + size, nodeType.create({ syntax, isEditing: false }))
          }
          return tr
        },
      }),
    ]
  },
})
