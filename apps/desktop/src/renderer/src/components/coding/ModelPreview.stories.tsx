import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import boxUrl from './__fixtures__/Box.glb?url'
import usdUrl from './__fixtures__/triangle.usda?url'
import usdzUrl from './__fixtures__/triangle.usdz?url'
import variantCardUrl from './__fixtures__/variant-card.usdz?url'
import cardClosedUrl from './__fixtures__/variant-card-closed.usdz?url'
import cardOpenUrl from './__fixtures__/variant-card-open.usdz?url'
import { ModelPreview } from './ModelPreview'

const glassDecorator: Decorator = (Story) => (
  <div className="liquid-glass dark h-[520px] bg-[linear-gradient(135deg,#315070,#7a4d73)] p-5">
    <div className="size-full overflow-hidden rounded-xl border border-white/20 bg-card backdrop-blur-xl"><Story /></div>
  </div>
)

const meta = {
  title: 'Coding/ModelPreview',
  component: ModelPreview,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: 520 }}><Story /></div>],
  args: { src: boxUrl, name: 'Box.glb' },
} satisfies Meta<typeof ModelPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Orbit: Story = {}
export const PassiveCard: Story = { args: { interactive: false } }
export const Usda: Story = { args: { src: usdUrl, name: 'triangle.usda' } }
export const Usdz: Story = {
  args: { src: usdzUrl, name: 'triangle.usdz' },
  decorators: [glassDecorator],
}
export const Invalid: Story = { args: { src: 'data:model/gltf-binary;base64,YmFk', name: 'bad.glb' } }
/** The canvas must leave the glass panel visible behind the model. */
export const Glass: Story = {
  decorators: [glassDecorator],
}

async function archived(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  return new Uint8Array(await response.arrayBuffer())
}

export const VariantControls: Story = {
  args: {
    src: variantCardUrl,
    name: 'variant-card.usdz',
    composeUsdz: async (_bytes, selections) => {
      const selected = selections.Pose === 'Open' ? 'Open' : 'Closed'
      return {
        archive: await archived(selected === 'Open' ? cardOpenUrl : cardClosedUrl),
        variants: [{ name: 'Pose', options: ['Closed', 'Open'], selected }],
      }
    },
  },
  decorators: [glassDecorator],
}
