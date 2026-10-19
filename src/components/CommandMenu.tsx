import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, FilePlus2, FileUp, Search, Settings2, ClipboardPaste, Palette } from 'lucide-react'
import { useFocusTrap } from './useFocusTrap'

export interface CommandItem { id: string; title: string; detail?: string; section: string; icon: 'open' | 'new' | 'settings' | 'paste' | 'theme'; run: () => void }
interface Props { commands: CommandItem[]; onClose: () => void; platform: 'pwa' | 'extension' }
const icons = { open: FileUp, new: FilePlus2, settings: Settings2, paste: ClipboardPaste, theme: Palette }

export function CommandMenu({ commands, onClose, platform }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useFocusTrap<HTMLElement>()
  const filtered = useMemo(() => commands.filter((item) => `${item.title} ${item.detail ?? ''} ${item.section}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [commands, query])
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setActive(0) }, [query])
  const execute = (index: number) => { const item = filtered[index]; if (!item) return; item.run(); onClose() }
  const groups = [...new Set(filtered.map((item) => item.section))]

  return <div className="overlay command-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="command-menu" role="dialog" aria-modal="true" aria-label="명령 메뉴">
      <div className="command-search"><Search size={17} /><input ref={input} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filtered[active] ? `command-${filtered[active].id}` : undefined} placeholder="파일 열기 또는 명령 검색…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose() }
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(filtered.length - 1, index + 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
        if (event.key === 'Enter') { event.preventDefault(); execute(active) }
      }} />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results" id="command-results" role="listbox" aria-label="명령">
        {groups.map((group) => <div className="command-group" key={group}><div className="command-group-label">{group}</div>
          {filtered.map((item, index) => item.section === group ? (() => {
            const Icon = icons[item.icon]
            return <button className={`command-item${index === active ? ' active' : ''}`} id={`command-${item.id}`} role="option" aria-selected={index === active} key={item.id} onMouseEnter={() => setActive(index)} onClick={() => execute(index)}>
              <span className="command-icon"><Icon size={15} /></span><span className="command-copy"><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.id === 'open' && <kbd>{platform === 'pwa' && navigator.platform.includes('Mac') ? '⌘ O' : 'Ctrl O'}</kbd>}
            </button>
          })() : null)}
        </div>)}
        {!filtered.length && <div className="command-no-results">일치하는 명령이 없습니다.</div>}
      </div>
      <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>↵</kbd> 선택</span><span><kbd>ESC</kbd> 닫기</span><div className="toolbar-spacer" /><span className="small-muted"><Command size={12} /> 명령 메뉴</span></footer>
    </section>
  </div>
}
