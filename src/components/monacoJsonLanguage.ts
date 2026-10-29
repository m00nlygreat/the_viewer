import { monaco } from './monacoRuntime'

let registered = false

export function registerMonacoJsonLanguage(): void {
  if (registered) return
  monaco.languages.register({ id: 'json' })
  monaco.languages.setMonarchTokensProvider('json', {
    tokenizer: {
      root: [
        [/[{}\[\]]/u, 'delimiter.bracket'],
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/u, 'string.key'],
        [/"(?:[^"\\]|\\.)*"/u, 'string'],
        [/\b(?:true|false|null)\b/u, 'keyword'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u, 'number'],
        [/\/\*/u, { token: 'comment', next: '@comment' }],
        [/\/\/.*$/u, 'comment'],
        [/:|,/u, 'delimiter']
      ],
      comment: [
        [/[^/*]+/u, 'comment'],
        [/\*\//u, { token: 'comment', next: '@pop' }],
        [/[/*]/u, 'comment']
      ]
    }
  })
  registered = true
}
