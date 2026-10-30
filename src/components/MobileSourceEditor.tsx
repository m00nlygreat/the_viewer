import { CodeEditor } from './CodeEditor'
import type { Format } from '../domain/fileFormats'

interface Props {
  documentId: string
  format: Format
  csvDelimiter?: string
  value: string
  diagnostics: unknown[]
  theme: 'light' | 'dark'
  onChange: (value: string) => void
  onUndo: () => void
  onRedo: () => void
  label: string
}

export default function MobileSourceEditor({ documentId, format, csvDelimiter = ',', value, onChange, onUndo, onRedo, label }: Props) {
  return <div className="source-editor-host">
    <CodeEditor stateKey={`source:${documentId}`} value={value} onChange={onChange} markdownMode={format === 'md'} csvMode={format === 'csv'} csvDelimiter={csvDelimiter} label={label} onUndo={onUndo} onRedo={onRedo} />
  </div>
}
