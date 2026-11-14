const status = document.querySelector('#status')
const hint = document.querySelector('#hint')
const share = document.querySelector('#share')
hint.textContent = chrome.i18n.getMessage('hint')

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'popup-status' })
  status.textContent = state.connected
    ? chrome.runtime.getManifest().name
    : chrome.i18n.getMessage('disconnected')
  if (state.kind === 'agent') {
    share.textContent = chrome.i18n.getMessage('agentOnly')
    share.disabled = true
    return
  }
  share.disabled = false
  share.textContent = chrome.i18n.getMessage(state.shared ? 'unshare' : 'share')
  share.dataset.shared = state.shared ? '1' : '0'
}

share.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: share.dataset.shared === '1' ? 'unshare' : 'share' })
  await refresh()
})

refresh()
