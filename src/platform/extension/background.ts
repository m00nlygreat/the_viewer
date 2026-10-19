const MENU_ID = 'open-with-the-viewer'
const allowedExtensions = new Set(['eml', 'csv', 'md', 'ics', 'vcf'])

function ensureMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'The Viewer로 열기', contexts: ['link'] })
  })
}

chrome.runtime.onInstalled.addListener(ensureMenus)
chrome.runtime.onStartup.addListener(ensureMenus)
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('extension.html') })
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return
  let url: URL
  try { url = new URL(info.linkUrl) } catch { return }
  const extension = url.pathname.split('.').pop()?.toLowerCase() ?? ''
  if (url.protocol !== 'https:' || !allowedExtensions.has(extension)) return
  const ticket = crypto.randomUUID()
  void chrome.storage.local.set({ [`link:${ticket}`]: { url: url.href, createdAt: Date.now() } }).then(() => {
    return chrome.tabs.create({ url: chrome.runtime.getURL(`extension.html#link/${ticket}`) })
  })
})
