import * as monaco from 'monaco-editor/editor/editor.api.js'

const registeredLanguages = new Set<string>()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function registerCsvMonacoLanguage(delimiter: string): string {
  const separator = [...delimiter][0] ?? ','
  const suffix = [...separator].map((character) => character.codePointAt(0)!.toString(16)).join('-')
  const languageId = `the-viewer-csv-${suffix}`
  const unquotedField = new RegExp(`(?:(?!${escapeRegExp(separator)}|")[^\\r\\n])+`, 'u')
  if (registeredLanguages.has(languageId)) return languageId

  monaco.languages.register({ id: languageId, aliases: ['CSV'] })
  monaco.languages.setMonarchTokensProvider(languageId, {
    defaultToken: '',
    tokenPostfix: '.csv',
    tokenizer: {
      root: [
        [new RegExp(escapeRegExp(separator), 'u'), 'separator'],
        [/"/, { token: 'string.quote', next: '@quoted' }],
        [unquotedField, '']
      ],
      quoted: [
        [/""/, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
        [/[^"]+/, 'string']
      ]
    }
  })
  registeredLanguages.add(languageId)
  return languageId
}
