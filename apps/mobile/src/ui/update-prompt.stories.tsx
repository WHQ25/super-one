import { MobileThemeProvider } from '../theme/context'
import { UpdatePromptGallery } from '../preview/UpdatePromptGallery'

export default {
  title: 'Mobile/UpdatePrompt',
  component: UpdatePromptGallery,
  render: () => (
    <MobileThemeProvider>
      <UpdatePromptGallery />
    </MobileThemeProvider>
  ),
}

export const Optional = {
  name: 'Optional update · sheet offers Update now and Later',
}

export const Downloading = {
  name: 'Downloading · progress, percent, and a Cancel that replaces Update',
}

export const UnknownTotal = {
  name: 'Downloading with no Content-Length · percent falls back to the manifest size',
}

export const DownloadFailed = {
  name: 'Network and checksum failures · Update now becomes Try again',
}

export const InstallerBlocked = {
  name: 'Installer blocked · adds Allow installs beside the retry',
}

export const Required = {
  name: 'Required update · full-screen gate with no Later and no dismiss',
}

export const RequiredDownloading = {
  name: 'Required while downloading · Cancel is the only control, gate stays up',
}

export const IosTestFlight = {
  name: 'iOS · no self-install, so the action opens TestFlight',
}
