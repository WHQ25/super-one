import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton } from './skeleton'
export default { title: 'UI/Skeleton', component: Skeleton } satisfies Meta<typeof Skeleton>
export const Loading: StoryObj<typeof Skeleton> = { args: { className: 'h-16 w-full' } }
