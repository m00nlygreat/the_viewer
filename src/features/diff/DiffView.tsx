import { useState } from 'react'
import { Columns2, Rows2 } from 'lucide-react'
import { matchesDiffSource } from '../../domain/diff/validate'
import type { DiffFileSegment, DiffHunk, DiffLine, DiffModel } from '../../domain/diff/model'
import type { ViewerDocument } from '../../domain/types'
import './diff.css'

type DiffDocument = Extract<ViewerDocument, { format: 'diff' }>
type DiffViewMode = 'unified' | 'split'

function lineText(source: string, line: DiffLine): string { return source.slice(line.contentFrom, line.contentTo) }

type SplitRow = { kind: 'lines'; old: DiffLine | null; current: DiffLine | null } | { kind: 'note'; line: DiffLine }

function splitRows(rows: DiffLine[]): SplitRow[] {
  const result: SplitRow[] = []
  let index = 0
  while (index < rows.length) {
    const line = rows[index]!
    if (line.kind === 'context') {
      result.push({ kind: 'lines', old: line, current: line })
      index += 1
      continue
    }
    if (line.kind === 'no-newline') {
      result.push({ kind: 'note', line })
      index += 1
      continue
    }

    const old: DiffLine[] = [], current: DiffLine[] = [], notes: DiffLine[] = []
    while (index < rows.length && rows[index]!.kind !== 'context') {
      const changed = rows[index++]!
      if (changed.kind === 'deletion') old.push(changed)
      else if (changed.kind === 'addition') current.push(changed)
      else notes.push(changed)
    }
    for (let offset = 0; offset < Math.max(old.length, current.length); offset += 1) {
      result.push({ kind: 'lines', old: old[offset] ?? null, current: current[offset] ?? null })
    }
    result.push(...notes.map((note) => ({ kind: 'note' as const, line: note })))
  }
  return result
}

function DiffSplitCell({ line, source, side }: { line: DiffLine | null; source: string; side: 'old' | 'current' }) {
  if (!line) return <div className="diff-split-cell diff-split-empty" aria-hidden="true" />
  const marker = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '
  const number = side === 'old' ? line.oldLine : line.newLine
  return <div className={`diff-split-cell diff-split-${line.kind}`}>
    <span className="diff-line-number" aria-hidden="true">{number ?? ''}</span>
    <span className="diff-marker" aria-hidden="true">{marker}</span>
    <span className="diff-code">{lineText(source, line)}</span>
  </div>
}

function DiffHunkView({ hunk, source, mode }: { hunk: DiffHunk; source: string; mode: DiffViewMode }) {
  return <section className="diff-hunk" aria-label={`변경 구간 이전 ${hunk.oldStart}, 이후 ${hunk.newStart}`}>
    <div className="diff-hunk-heading">{source.slice(hunk.header.from, hunk.header.to)}</div>
    {mode === 'unified' ? <div className="diff-rows diff-rows-unified">
      {hunk.rows.map((line) => <div className={`diff-row diff-row-${line.kind}`} key={`${line.from}-${line.to}`}>
        <span className="diff-line-number old" aria-hidden="true">{line.oldLine ?? ''}</span>
        <span className="diff-line-number new" aria-hidden="true">{line.newLine ?? ''}</span>
        <span className="diff-marker" aria-hidden="true">{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : line.kind === 'context' ? ' ' : ''}</span>
        <span className="diff-code">{lineText(source, line)}</span>
      </div>)}
    </div> : <div className="diff-rows diff-rows-split">
      {splitRows(hunk.rows).map((row, index) => row.kind === 'note'
        ? <div className="diff-split-row diff-row-no-newline" key={`${row.line.from}-${row.line.to}`}><span>{lineText(source, row.line)}</span></div>
        : <div className="diff-split-row" key={`${row.old?.from ?? 'empty'}-${row.current?.from ?? 'empty'}-${index}`}>
          <DiffSplitCell line={row.old} source={source} side="old" />
          <DiffSplitCell line={row.current} source={source} side="current" />
        </div>)}
    </div>}
  </section>
}

function DiffFile({ segment, source, mode }: { segment: DiffFileSegment; source: string; mode: DiffViewMode }) {
  if (!segment.parsed) return <pre className="diff-raw">{source.slice(segment.from, segment.to)}</pre>
  const firstHunk = segment.hunks[0]
  const lastHunk = segment.hunks.at(-1)
  return <section className="diff-file" aria-label="diff 파일">
    <header className="diff-file-header">
      {segment.header.map((line) => <div className={`diff-header-line ${line.kind}`} key={`${line.from}-${line.to}`}>{source.slice(line.from, line.to)}</div>)}
    </header>
    {segment.hunks.map((hunk) => <DiffHunkView key={hunk.from} hunk={hunk} source={source} mode={mode} />)}
    {lastHunk && segment.to > lastHunk.to && <pre className="diff-file-tail">{source.slice(lastHunk.to, segment.to)}</pre>}
    {!firstHunk && segment.to > (segment.header.at(-1)?.to ?? segment.from) && <pre className="diff-file-tail">{source.slice(segment.header.at(-1)?.to ?? segment.from, segment.to)}</pre>}
  </section>
}

function DiffSegments({ model, source, mode }: { model: DiffModel; source: string; mode: DiffViewMode }) {
  return <>
    {model.segments.map((segment) => segment.kind === 'file'
      ? <DiffFile key={segment.from} segment={segment} source={source} mode={mode} />
      : <pre className="diff-raw" key={segment.from}>{source.slice(segment.from, segment.to)}</pre>)}
  </>
}

export function DiffView({ document, model }: { document: DiffDocument; model: DiffModel }) {
  const [mode, setMode] = useState<DiffViewMode>('split')
  const current = document.parseState === 'ready' && document.modelRevision === document.textRevision && matchesDiffSource(model, document.text)
  return <main className="diff-view" aria-label="Diff 보기">
    <div className="diff-view-fab" role="group" aria-label="Diff 보기 방식">
      <button type="button" className="diff-view-toggle" aria-label="한 줄로 보기" title="한 줄로 보기" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}><Rows2 size={16} aria-hidden="true" /></button>
      <button type="button" className="diff-view-toggle" aria-label="나란히 보기" title="나란히 보기" aria-pressed={mode === 'split'} onClick={() => setMode('split')}><Columns2 size={16} aria-hidden="true" /></button>
    </div>
    <div className="diff-scroll">
      {current ? <DiffSegments model={model} source={document.text} mode={mode} /> : <pre className="diff-raw">{document.text}</pre>}
    </div>
  </main>
}
