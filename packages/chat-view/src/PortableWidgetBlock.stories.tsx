import type { Meta, StoryObj } from '@storybook/react-vite'
import { PortableWidgetBlock } from './PortableWidgetBlock'
import { PortableTurnContext } from './portable-turn-context'
import type { WidgetData } from '@superone/shared/generative-ui/types'

/**
 * The phone's widget frame. Stories render the real component with real agent-shaped
 * HTML — the iframe boots, reports its height, and resizes itself here exactly as it
 * does in the WebView, so a widget that collapses to `min-height` shows up as one.
 */
function widget(overrides: Partial<WidgetData> = {}): WidgetData {
  return {
    title: 'mobile_composer_options',
    widget_code: '<div style="padding:16px;font:14px system-ui;color:var(--color-text-primary)">Hello from a widget</div>',
    width: 800,
    height: 240,
    isSVG: false,
    ...overrides,
  }
}

const meta = {
  title: 'Chat/SuperOne/Portable widget',
  component: PortableWidgetBlock,
  parameters: { layout: 'padded' },
  // The phone frame is narrow; a widget that only looks right at desktop width is a bug.
  // `projectPath` is a story parameter because it is what decides whether the save form
  // may offer the project scope at all.
  decorators: [(Story, context) => (
    <PortableTurnContext.Provider
      value={{
        scheme: context.globals.theme === 'light' ? 'light' : 'dark',
        pendingPermission: null,
        projectPath: (context.parameters.projectPath as string | null | undefined) ?? null,
      }}
    >
      {/* The phone's chat document stamps `color-scheme` from the host theme, and an
          iframe only stays see-through while its scheme matches the element embedding
          it. Without this the stories would show a transparent widget the phone never
          gets. */}
      <div className="w-[390px]" style={{ colorScheme: context.globals.theme === 'light' ? 'light' : 'dark' }}><Story /></div>
    </PortableTurnContext.Provider>
  )],
  args: { data: widget() },
} satisfies Meta<typeof PortableWidgetBlock>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  name: 'HTML widget · auto-height',
}

export const Tall: Story = {
  name: 'Tall content · frame grows to fit',
  args: {
    data: widget({
      height: 200,
      widget_code: `<div style="padding:16px;font:14px system-ui;color:var(--color-text-primary)">
        ${Array.from({ length: 14 }, (_, i) => `<p>Row ${i + 1} of a widget taller than its declared height.</p>`).join('')}
      </div>`,
    }),
  },
}

export const Interactive: Story = {
  name: 'Interactive · controls keep their own touches',
  args: {
    data: widget({
      height: 160,
      widget_code: `<div style="padding:16px;font:14px system-ui;color:var(--color-text-primary)">
        <label style="display:block;margin-bottom:8px">Years <span id="out">20</span></label>
        <input id="r" type="range" min="1" max="40" value="20" style="width:100%" />
        <script>r.addEventListener('input',function(){out.textContent=r.value})</script>
      </div>`,
    }),
  },
}

export const SurfaceTokens: Story = {
  name: 'Surface tokens · cards on the chat background',
  args: {
    data: widget({
      height: 190,
      widget_code: `<div style="padding:12px 0">
        <div style="background:var(--color-background-secondary);border-radius:var(--border-radius-lg);padding:12px;margin-bottom:10px">
          <div style="font:500 14px system-ui;color:var(--color-text-primary);margin-bottom:4px">Option A</div>
          <div style="font:12px system-ui;color:var(--color-text-secondary)">Buttons move inside the input pill.</div>
        </div>
        <div style="background:var(--color-background-secondary);border-radius:var(--border-radius-lg);padding:12px">
          <div style="font:500 14px system-ui;color:var(--color-text-primary);margin-bottom:4px">Option B</div>
          <div style="font:12px system-ui;color:var(--color-text-secondary)">Input takes a row of its own.</div>
        </div>
      </div>`,
    }),
  },
}

export const Svg: Story = {
  name: 'SVG widget · centred body',
  args: {
    data: widget({
      isSVG: true,
      height: 160,
      widget_code: '<svg viewBox="0 0 120 60" width="120" height="60"><rect class="c-teal" x="4" y="4" width="112" height="52" rx="4"/><text class="t" x="60" y="34" text-anchor="middle">chart</text></svg>',
    }),
  },
}

export const Empty: Story = {
  name: 'Empty body · falls back to the minimum height',
  args: { data: widget({ widget_code: '<div></div>', height: 0 }) },
}

export const LongTitle: Story = {
  name: 'Long title · truncates beside the save action',
  args: { data: widget({ title: 'mobile_composer_attachment_and_send_button_layout_options' }) },
}

export const SaveForm: Story = {
  name: 'Save form · no project, personal scope only',
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save as template' }))
  },
}

export const SaveFormWithProject: Story = {
  name: 'Save form · project scope available',
  parameters: { projectPath: '/Users/me/Developer/super-one' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save as template' }))
  },
}

export const AlreadyATemplate: Story = {
  name: 'Already a template · filled bookmark, update wording',
  args: {
    data: widget({
      templateId: 'composer-options',
      reusable: { id: 'composer-options', description: 'Compare composer layouts' },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Update template' }))
  },
}

export const Blended: Story = {
  name: 'Transparent body · frame disappears into the transcript',
  // Nothing here paints a background, so the whole frame is the chat surface showing
  // through. A widget that reads as a pale slab instead means the frame stopped being
  // composited transparently.
  args: {
    data: widget({
      height: 120,
      widget_code: `<div style="padding:16px;font:13px system-ui;color:var(--color-text-primary)">
        <p style="margin:0 0 8px">No background of its own.</p>
        <p style="margin:0;color:var(--color-text-secondary)">Only the transcript behind it.</p>
      </div>`,
    }),
  },
}
