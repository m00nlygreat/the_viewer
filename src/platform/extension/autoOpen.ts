import { FORMAT_MIME_ALIASES, FORMATS, GENERIC_FILE_MIME_TYPES } from '../fileTypes'

const AUTO_OPEN_TOKEN_KEY = 'auto-open-token'
const AUTO_OPEN_RULE_IDS = [73101, 73102, 73103, 73104, 73105]
let ruleSetup: Promise<void> | null = null

function createAutoOpenRules(token: string): chrome.declarativeNetRequest.Rule[] {
  const extensionPage = `chrome-extension://${chrome.runtime.id}/extension.html`
  const condition: chrome.declarativeNetRequest.RuleCondition = {
    regexFilter: '^(https?://.*)$',
    resourceTypes: ['main_frame'],
    requestMethods: ['get']
  }
  const redirect = {
    regexSubstitution: `${extensionPage}#auto/${token}/\\0`
  }
  const supportedPath = `[^?]*\\.(${FORMATS.join('|')})(\\?.*)?$`
  const mimePatterns = (types: readonly string[]) => types.flatMap((type) => [type, `${type};*`, `${type} ;*`])
  const supportedMimeValues = mimePatterns(FORMATS.flatMap((format) => FORMAT_MIME_ALIASES[format]))
  const genericMimeValues = mimePatterns(GENERIC_FILE_MIME_TYPES)
  return [
    {
      id: AUTO_OPEN_RULE_IDS[0],
      priority: 1,
      action: { type: 'redirect', redirect },
      condition: {
        ...condition,
        responseHeaders: [{ header: 'content-type', values: supportedMimeValues }]
      }
    },
    {
      id: AUTO_OPEN_RULE_IDS[1],
      priority: 1,
      action: { type: 'redirect', redirect },
      condition: {
        ...condition,
        regexFilter: `^https?://${supportedPath}`,
        responseHeaders: [{ header: 'content-type', values: genericMimeValues }]
      }
    },
    {
      id: AUTO_OPEN_RULE_IDS[2],
      priority: 1,
      action: { type: 'redirect', redirect },
      condition: {
        regexFilter: `^file://${supportedPath}`,
        resourceTypes: ['main_frame']
      }
    },
    {
      id: AUTO_OPEN_RULE_IDS[3],
      priority: 1,
      action: { type: 'redirect', redirect },
      condition: {
        ...condition,
        regexFilter: `^https?://${supportedPath}`,
        excludedResponseHeaders: [{ header: 'content-type' }]
      }
    },
    {
      id: AUTO_OPEN_RULE_IDS[4],
      priority: 1,
      action: { type: 'redirect', redirect },
      condition: {
        ...condition,
        responseHeaders: [{ header: 'content-disposition', values: FORMATS.flatMap((format) => [
          `*filename=*.${format}`, `*filename=*.${format};*`, `*filename="*.${format}"*`,
          `*filename*=UTF-8''*.${format}`, `*filename*=UTF-8''*.${format};*`
        ]) }],
        excludedResponseHeaders: [{ header: 'content-type', excludedValues: [...supportedMimeValues, ...genericMimeValues] }]
      }
    }
  ]
}

export async function ensureAutoOpenRules(): Promise<void> {
  if (ruleSetup) return ruleSetup
  ruleSetup = installAutoOpenRules().finally(() => { ruleSetup = null })
  return ruleSetup
}

async function installAutoOpenRules(): Promise<void> {
  const stored = await chrome.storage.local.get(AUTO_OPEN_TOKEN_KEY)
  const token = typeof stored[AUTO_OPEN_TOKEN_KEY] === 'string' ? stored[AUTO_OPEN_TOKEN_KEY] as string : crypto.randomUUID()
  await chrome.storage.local.set({ [AUTO_OPEN_TOKEN_KEY]: token })
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: AUTO_OPEN_RULE_IDS,
    addRules: createAutoOpenRules(token)
  })
}

export async function isAutoOpenTokenValid(token: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTO_OPEN_TOKEN_KEY)
  return stored[AUTO_OPEN_TOKEN_KEY] === token
}

export function isLocalFileAccessAllowed(): Promise<boolean> {
  return chrome.extension.isAllowedFileSchemeAccess()
}

export async function openExtensionDetails(): Promise<void> {
  await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
}
