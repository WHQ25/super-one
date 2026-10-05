import { ipcRenderer } from 'electron'
import { MediaComposerChannels as channels, type MediaComposerAPI } from '@superone/shared/media-composer'

export const mediaComposerAPI: MediaComposerAPI = {
  mediaModels: kind => ipcRenderer.invoke(channels.models, kind),
  mediaGenerate: request => ipcRenderer.invoke(channels.generate, request),
  mediaCancel: id => ipcRenderer.invoke(channels.cancel, id),
  mediaVideoStatus: (target, id) => ipcRenderer.invoke(channels.videoStatus, target, id),
  mediaPendingVideos: target => ipcRenderer.invoke(channels.pendingVideos, target),
}
