export interface MarkdownCodeLanguage {
  highlight: string
  monaco: string
}

const languageAliases: Record<string, MarkdownCodeLanguage> = {
  bash: { highlight: 'bash', monaco: 'shell' },
  c: { highlight: 'c', monaco: 'cpp' },
  'c++': { highlight: 'cpp', monaco: 'cpp' },
  cc: { highlight: 'cpp', monaco: 'cpp' },
  cpp: { highlight: 'cpp', monaco: 'cpp' },
  csharp: { highlight: 'csharp', monaco: 'csharp' },
  cs: { highlight: 'csharp', monaco: 'csharp' },
  css: { highlight: 'css', monaco: 'css' },
  diff: { highlight: 'diff', monaco: 'plaintext' },
  docker: { highlight: 'dockerfile', monaco: 'dockerfile' },
  dockerfile: { highlight: 'dockerfile', monaco: 'dockerfile' },
  go: { highlight: 'go', monaco: 'go' },
  golang: { highlight: 'go', monaco: 'go' },
  h: { highlight: 'c', monaco: 'cpp' },
  hpp: { highlight: 'cpp', monaco: 'cpp' },
  html: { highlight: 'xml', monaco: 'html' },
  ini: { highlight: 'ini', monaco: 'ini' },
  java: { highlight: 'java', monaco: 'java' },
  js: { highlight: 'javascript', monaco: 'javascript' },
  jsx: { highlight: 'javascript', monaco: 'javascript' },
  javascript: { highlight: 'javascript', monaco: 'javascript' },
  json: { highlight: 'json', monaco: 'json' },
  kt: { highlight: 'kotlin', monaco: 'kotlin' },
  kotlin: { highlight: 'kotlin', monaco: 'kotlin' },
  md: { highlight: 'markdown', monaco: 'markdown' },
  markdown: { highlight: 'markdown', monaco: 'markdown' },
  mjs: { highlight: 'javascript', monaco: 'javascript' },
  php: { highlight: 'php', monaco: 'php' },
  ps1: { highlight: 'powershell', monaco: 'powershell' },
  powershell: { highlight: 'powershell', monaco: 'powershell' },
  py: { highlight: 'python', monaco: 'python' },
  python: { highlight: 'python', monaco: 'python' },
  rb: { highlight: 'ruby', monaco: 'ruby' },
  ruby: { highlight: 'ruby', monaco: 'ruby' },
  rs: { highlight: 'rust', monaco: 'rust' },
  rust: { highlight: 'rust', monaco: 'rust' },
  scss: { highlight: 'scss', monaco: 'scss' },
  sh: { highlight: 'bash', monaco: 'shell' },
  shell: { highlight: 'bash', monaco: 'shell' },
  sql: { highlight: 'sql', monaco: 'sql' },
  ts: { highlight: 'typescript', monaco: 'typescript' },
  tsx: { highlight: 'typescript', monaco: 'typescript' },
  typescript: { highlight: 'typescript', monaco: 'typescript' },
  xml: { highlight: 'xml', monaco: 'xml' },
  yaml: { highlight: 'yaml', monaco: 'yaml' },
  yml: { highlight: 'yaml', monaco: 'yaml' },
  zsh: { highlight: 'bash', monaco: 'shell' }
}

export function markdownCodeLanguage(info: string): MarkdownCodeLanguage | null {
  const token = languageToken(info)?.toLowerCase()
  return token ? languageAliases[token] ?? null : null
}

export function markdownCodeLanguageLabel(info: string): string {
  return languageToken(info) ?? '코드'
}

function languageToken(info: string): string | null {
  const token = info.trim().replace(/^\{|\}$/gu, '').split(/[\s,]/u, 1)[0]?.replace(/^(?:language-|\.)/iu, '')
  return token || null
}
