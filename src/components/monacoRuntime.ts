import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import { CSV_COLUMN_DARK_COLORS, CSV_COLUMN_LIGHT_COLORS } from './csvColumnColors'
import { normalizeMonacoThemeColor } from './monacoThemeColors'

let workerConfigured = false

export function configureMonacoWorker(): void {
  if (workerConfigured) return
  ;(globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment = {
    getWorker: () => new EditorWorker()
  }
  workerConfigured = true
}

export function defineViewerMonacoThemes(): void {
  monaco.editor.defineTheme('the-viewer-dark', {
    base: 'vs-dark', inherit: true, rules: [
      ...CSV_COLUMN_DARK_COLORS.map((color, index) => ({ token: `column${index}.csv`, foreground: color.slice(1) })),
      { token: 'separator.csv', foreground: 'A4AAF7' },
      { token: 'string.csv', foreground: 'CE9178' },
      { token: 'string.quote.csv', foreground: 'E0A33A' },
      { token: 'string.escape.csv', foreground: 'E0A33A' }
    ], colors: {
      'editor.background': cssColor('--panel', '#0B0B0C'),
      'editor.foreground': cssColor('--text', '#E6E6E8'),
      'editorLineNumber.foreground': cssColor('--text-weak', '#777980'),
      'editorLineNumber.activeForeground': cssColor('--text-strong', '#F2F2F3'),
      'editorCursor.foreground': cssColor('--accent', '#A4AAF7'),
      'editor.selectionBackground': cssColor('--selection', '#353859')
    }
  })
  monaco.editor.defineTheme('the-viewer-light', {
    base: 'vs', inherit: true, rules: [
      ...CSV_COLUMN_LIGHT_COLORS.map((color, index) => ({ token: `column${index}.csv`, foreground: color.slice(1) })),
      { token: 'separator.csv', foreground: '4A52C4' },
      { token: 'string.csv', foreground: '287A46' },
      { token: 'string.quote.csv', foreground: 'A0650F' },
      { token: 'string.escape.csv', foreground: 'A0650F' }
    ], colors: {
      'editor.background': cssColor('--panel', '#FCFCFD'),
      'editor.foreground': cssColor('--text', '#1C1D21'),
      'editorLineNumber.foreground': cssColor('--text-weak', '#8A8B91'),
      'editorLineNumber.activeForeground': cssColor('--text-strong', '#111216'),
      'editorCursor.foreground': cssColor('--accent', '#4A52C4'),
      'editor.selectionBackground': cssColor('--selection', '#D9DBF7')
    }
  })
}

function cssColor(name: string, fallback: string): string {
  const value = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name)
  return normalizeMonacoThemeColor(value, fallback)
}

export { monaco }
