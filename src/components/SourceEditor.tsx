import { CodeEditor } from './CodeEditor'

interface Props { value: string; onChange: (value: string) => void; markdownMode: boolean; label: string }
export default function SourceEditor(props: Props) { return <CodeEditor {...props} /> }
