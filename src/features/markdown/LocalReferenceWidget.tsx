import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import { Download, ExternalLink, FileText } from 'lucide-react'
import { markdownLinkAttributes } from '../../domain/markdown'
import { selectMarkdownFragment, type MarkdownReference } from '../../domain/markdownReferences'
import { getFormat } from '../../domain/fileFormats'
import type { MarkdownReferenceContext, MarkdownReferenceResolution } from './localReferenceState'
import { MarkdownPreview } from './MarkdownPreview'
import { renderWidgetRoot, unmountWidgetRoot } from '../../components/reactWidgetRoot'
import type { RefObject } from 'react'
import { markdownReferenceKey } from './localReferenceState'

export interface Props { reference: MarkdownReference; context: MarkdownReferenceContext; onMeasure?: () => void; onEditSource?: () => void }

export class LocalReferenceWidget extends WidgetType {
  constructor(private readonly reference: MarkdownReference, private readonly context: RefObject<MarkdownReferenceContext | null>) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof LocalReferenceWidget && other.reference.raw === this.reference.raw && other.reference.kind === this.reference.kind && other.reference.from === this.reference.from && other.reference.to === this.reference.to && other.context === this.context
  }

  toDOM(view: EditorView): HTMLElement {
    const block = this.reference.kind === 'image' || this.reference.kind === 'obsidian-embed'
    const element = document.createElement('div')
    element.className = `cm-md-local-reference${block ? ' cm-md-local-reference-block' : ''}`
    element.contentEditable = 'false'
    this.render(element, view)
    return element
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean { this.render(element, view); return true }
  ignoreEvent(): boolean { return true }
  destroy(element: HTMLElement): void { unmountWidgetRoot(element) }

  private render(element: HTMLElement, view: EditorView): void {
    const context = this.context.current
    if (!context) return
    renderWidgetRoot(element, <LocalReferenceWidgetView reference={this.reference} context={context} onMeasure={() => view.requestMeasure()} onEditSource={() => {
      const position = Math.min(this.reference.from, view.state.doc.length)
      view.focus()
      view.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true })
    }} />)
  }
}

export function LocalReferenceWidgetView({ reference, context, onMeasure, onEditSource }: Props) {
  const [resolution, setResolution] = useState<MarkdownReferenceResolution | null>(null)
  const occurrenceKey = markdownReferenceKey(context.instanceId, reference)
  const isEmbed = reference.kind === 'image' || reference.kind === 'obsidian-embed'
  const isFileLink = reference.kind === 'link' || reference.kind === 'obsidian-link'
  const targetPath = reference.target.split(/[?#]/u, 1)[0] ?? reference.target
  const isMarkdownEmbed = isEmbed && (resolution?.status === 'markdown' || getFormat(targetPath) === 'md')
  const embedFileName = markdownEmbedFileName(reference, resolution)
  const [expanded, setExpanded] = useState(() => context.referenceState.isExpanded(occurrenceKey, isEmbed))
  const [openRequested, setOpenRequested] = useState(false)
  const toggleButton = useRef<HTMLButtonElement>(null)
  const previousExpanded = useRef(expanded)
  const [imageUrl, setImageUrl] = useState('')
  const [imageError, setImageError] = useState('')
  const preload = isEmbed && getFormat(targetPath) !== 'md'
  const syntax = reference.kind.startsWith('obsidian') ? 'obsidian' : 'markdown'
  const label = reference.label || reference.target
  const cycle = resolution?.status === 'markdown' && Boolean(context.folderId) && context.ancestors.some((item) => item.folderId === context.folderId && item.path === resolution.path && item.fragment === (resolution.fragment ?? ''))
  const resolutionPath = resolution && 'path' in resolution ? resolution.path : ''

  useEffect(() => {
    const shouldResolve = preload || expanded || openRequested
    const services = context.services
    if (!shouldResolve || !services) return
    const controller = new AbortController()
    void services.resolveReference(context.ownerPath, context.ownerText, reference.target, syntax, context.generation, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setResolution(result)
        if (openRequested) {
          if (result.status === 'markdown' || result.status === 'image' || result.status === 'file') services.openFile(result.path)
          setOpenRequested(false)
        }
        onMeasure?.()
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setResolution({ status: 'error', kind: 'missing', message: error instanceof Error ? error.message : '참조를 읽지 못했습니다.' })
        if (openRequested) setOpenRequested(false)
      }
    })
    return () => controller.abort()
  }, [context.generation, context.ownerPath, context.ownerText, context.services, expanded, onMeasure, openRequested, preload, reference.target, syntax])

  useEffect(() => {
    let resolvedPath: string | null = null
    if (resolution && (resolution.status === 'markdown' || resolution.status === 'file')) resolvedPath = resolution.path
    if (!resolvedPath || !context.folderId || !context.services) return
    let controller: AbortController | null = null
    const unsubscribe = context.services.subscribeDocument(context.folderId, resolvedPath, () => {
      controller?.abort()
      controller = new AbortController()
      void context.services!.resolveReference(context.ownerPath, context.ownerText, reference.target, syntax, context.generation, controller.signal).then((latest) => {
        if (!controller?.signal.aborted) { setResolution(latest); onMeasure?.() }
      }).catch(() => undefined)
    })
    return () => { unsubscribe(); controller?.abort() }
  }, [context.folderId, context.generation, context.ownerPath, context.ownerText, context.services, onMeasure, reference.target, resolution, resolutionPath, resolution?.status, syntax])

  useEffect(() => {
    if (resolution?.status !== 'image' || !preload || !context.services) return
    const controller = new AbortController()
    let release: (() => void) | undefined
    void context.services.acquireImage(resolution.path, context.generation, controller.signal).then((resource) => {
      if (controller.signal.aborted) { resource.release(); return }
      release = resource.release
      setImageUrl(resource.url)
      onMeasure?.()
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : '이미지를 불러오지 못했습니다.')
    })
    return () => { controller.abort(); release?.() }
  }, [context.generation, context.services, onMeasure, preload, resolution])

  useEffect(() => { setResolution(null); setImageUrl(''); setImageError(''); setOpenRequested(false) }, [reference.raw, context.ownerPath])

  const toggle = () => { setExpanded(context.referenceState.toggle(context.instanceId, reference, isEmbed)); onMeasure?.() }
  const editSource = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onEditSource) return
    const targetEmbed = event.target instanceof Element ? event.target.closest('.local-reference-markdown-embed') : null
    if (targetEmbed !== event.currentTarget) return
    event.preventDefault()
    onEditSource()
  }
  const editSourceFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onEditSource || !((event.key === 'Enter' && event.shiftKey) || event.key === 'F2')) return
    event.preventDefault()
    event.stopPropagation()
    onEditSource()
  }
  const openLinkedFile = () => {
    if (resolution && (resolution.status === 'markdown' || resolution.status === 'image' || resolution.status === 'file')) {
      context.services?.openFile(resolution.path)
      return
    }
    setOpenRequested(true)
  }
  useLayoutEffect(() => {
    if (previousExpanded.current !== expanded) toggleButton.current?.focus({ preventScroll: true })
    previousExpanded.current = expanded
  }, [expanded])

  if (resolution?.status === 'external') {
    if (reference.kind === 'image' || reference.kind === 'obsidian-embed') return <span className="blocked-image">외부 이미지 차단</span>
    const attrs = markdownLinkAttributes(resolution.href)
    return attrs ? <a className="local-reference-external" href={attrs.href} target={attrs.target} rel={attrs.rel}><ExternalLink size={12} />{label}</a> : <span>{label}</span>
  }
  if (preload && resolution?.status === 'image') return imageUrl
    ? <figure className="local-reference-image"><img src={imageUrl} alt={label} style={{ width: reference.width ? `min(${reference.width}px, 100%)` : undefined, maxHeight: reference.height ? `${reference.height}px` : undefined }} onLoad={onMeasure} onError={() => setImageError('이미지를 표시하지 못했습니다.')} />{imageError && <figcaption role="alert">{imageError}</figcaption>}</figure>
    : <span className="local-reference-loading" role="status">{imageError || '이미지를 불러오는 중…'}</span>

  if (isFileLink) return <span className="local-reference-open"><button ref={toggleButton} type="button" className="local-reference-link" aria-label={`${label} 파일 열기`} title={reference.target} disabled={openRequested} onMouseDown={(event) => event.preventDefault()} onClick={openLinkedFile}>{label}</button>{openRequested && <span className="local-reference-loading" role="status">파일을 찾는 중…</span>}{resolution?.status === 'error' && <span className="local-reference-message" role="alert">{resolution.message}{resolution.choices?.map((path) => <button key={path} type="button" onClick={() => context.services?.openFile(path)}>{path}</button>)}</span>}</span>

  if (!expanded) {
    if (isMarkdownEmbed) return <div className="local-reference-markdown-embed local-reference-markdown-embed-collapsed" onDoubleClick={onEditSource ? editSource : undefined}><button ref={toggleButton} type="button" className="local-reference-embed-toggle" aria-expanded="false" aria-label={`${embedFileName} 펼치기`} aria-keyshortcuts={onEditSource ? 'Shift+Enter F2' : undefined} title={onEditSource ? `${reference.target} · 두 번 클릭 또는 Shift+Enter로 현재 문서 원문 편집` : reference.target} onKeyDown={editSourceFromKeyboard} onMouseDown={(event) => event.preventDefault()} onClick={toggle}><span className="local-reference-embed-filename">{embedFileName}</span></button></div>
    return <button ref={toggleButton} type="button" className="local-reference-link" aria-expanded="false" aria-label={`${label} · ${reference.target} 펼치기`} title={reference.target} onMouseDown={(event) => event.preventDefault()} onClick={toggle}>{label}</button>
  }

  let body: React.ReactNode
  if (cycle) body = <p className="local-reference-message">순환 임베드입니다: {reference.target}</p>
  else if (context.depth >= 8) body = <p className="local-reference-message">임베드 깊이 제한에 도달했습니다.</p>
  else if (!resolution) body = <p className="local-reference-message" role="status">참조를 읽고 있습니다…</p>
  else if (resolution.status === 'error') body = <div className="local-reference-message" role="alert">{resolution.message}{resolution.choices?.map((path) => <button key={path} type="button" onClick={() => context.services?.openFile(path)}>{path}</button>)}</div>
  else if (resolution.status === 'markdown') {
    const selected = resolution.fragment ? selectMarkdownFragment(resolution.text, resolution.fragment) : { from: 0, to: resolution.text.length, kind: 'heading' as const }
    if (!selected) body = <p className="local-reference-message" role="alert">참조한 제목 또는 블록을 찾지 못했습니다.</p>
    else {
      const nextAncestors = [...context.ancestors, { folderId: context.folderId ?? '', path: resolution.path, fragment: resolution.fragment ?? '' }]
      body = <MarkdownPreview source={resolution.text.slice(selected.from, selected.to)} context={{ ...context, instanceId: `${context.instanceId}/${reference.from}:${reference.to}`, ownerPath: resolution.path, ownerText: resolution.text, ancestors: nextAncestors, depth: context.depth + 1 }} ancestors={nextAncestors} depth={context.depth + 1} />
    }
  } else if (resolution.status === 'image') body = <p className="local-reference-message">이미지: {resolution.path} <button type="button" className="subtle-button" onClick={() => context.services?.downloadFile(resolution.path)}><Download size={12} /> 다운로드</button></p>
  else body = <div className="local-reference-file"><FileText size={15} /><span><strong>{resolution.name}</strong><small>{resolution.mimeType || '파일'} · {resolution.size.toLocaleString()}바이트</small></span>{resolution.supported && <button type="button" className="secondary-button" onClick={() => context.services?.openFile(resolution.path)}>뷰어에서 열기</button>}<button type="button" className="icon-button" aria-label="다운로드" onClick={() => context.services?.downloadFile(resolution.path)}><Download size={13} /></button></div>

  return <div className={`local-reference-expanded${isMarkdownEmbed ? ' local-reference-markdown-embed' : ''}`} onDoubleClick={isMarkdownEmbed && onEditSource ? editSource : undefined}><button ref={toggleButton} type="button" className={isMarkdownEmbed ? 'local-reference-embed-toggle' : 'local-reference-collapse'} aria-expanded="true" aria-label={`${isMarkdownEmbed ? embedFileName : label} 접기`} aria-keyshortcuts={isMarkdownEmbed && onEditSource ? 'Shift+Enter F2' : undefined} title={isMarkdownEmbed && onEditSource ? `${reference.target} · 두 번 클릭 또는 Shift+Enter로 현재 문서 원문 편집` : isMarkdownEmbed ? reference.target : `${label} 접기`} onKeyDown={editSourceFromKeyboard} onMouseDown={(event) => event.preventDefault()} onClick={toggle}>{isMarkdownEmbed ? <span className="local-reference-embed-filename">{embedFileName}</span> : `${label} 접기`}</button><div className="local-reference-body">{body}</div></div>
}

function markdownEmbedFileName(reference: MarkdownReference, resolution: MarkdownReferenceResolution | null): string {
  const path = resolution?.status === 'markdown' ? resolution.path : reference.target.split(/[?#]/u, 1)[0] ?? reference.target
  const encodedName = path.split('/').filter(Boolean).pop()
  if (!encodedName) return reference.label || 'Markdown'
  try { return decodeURIComponent(encodedName) } catch { return encodedName }
}
