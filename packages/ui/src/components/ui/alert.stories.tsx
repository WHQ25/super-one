import type { Meta, StoryObj } from '@storybook/react-vite'
import { Alert, AlertDescription, AlertTitle } from './alert'
export default { title: 'UI/Alert', component: Alert } satisfies Meta<typeof Alert>
export const Default: StoryObj<typeof Alert> = { render: () => <Alert><AlertTitle>Account Status</AlertTitle><AlertDescription>Your account is ready.</AlertDescription></Alert> }
export const Error: StoryObj<typeof Alert> = { render: () => <Alert variant="destructive"><AlertDescription>Could not connect. Try again.</AlertDescription></Alert> }
