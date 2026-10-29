import * as monaco from 'monaco-editor/editor/editor.api.js'
import { createCsvMonacoTokensProvider } from './csvMonacoTokenizer'

const registeredLanguages = new Set<string>()

export function registerCsvMonacoLanguage(delimiter: string): string {
  const separator = [...delimiter][0] ?? ','
  const suffix = [...separator].map((character) => character.codePointAt(0)!.toString(16)).join('-')
  const languageId = `the-viewer-csv-${suffix}`
  if (registeredLanguages.has(languageId)) return languageId

  monaco.languages.register({ id: languageId, aliases: ['CSV'] })
  monaco.languages.setTokensProvider(languageId, createCsvMonacoTokensProvider(separator))
  registeredLanguages.add(languageId)
  return languageId
}
