import { useMemo, useState } from 'react'
import { CalendarDays, MapPin, Plus, Repeat2, Trash2, Pencil } from 'lucide-react'
import type { CalendarEvent, CalendarModel, ViewerDocument } from '../domain/types'
import { expandCalendarEvent } from '../domain/formats/calendar'

interface Props { document: ViewerDocument; model: CalendarModel; onChange: (model: CalendarModel, group?: 'typing' | 'command') => void }

function toLocalInput(value: string): string {
  return value.slice(0, 16)
}
function newEvent(): CalendarEvent {
  const start = new Date()
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0)
  const end = new Date(start.getTime() + 60 * 60_000)
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  return { uid: crypto.randomUUID(), summary: '', location: '', description: '', start: local(start), end: local(end), allDay: false }
}

function displayDate(value: string): Date {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? new Date(0) : date
}

function eventIdentity(event: CalendarEvent): string { return event.componentIndex === undefined ? `new:${event.uid}` : `component:${event.componentIndex}` }

export function CalendarEditor({ document, model, onChange }: Props) {
  const [selected, setSelected] = useState(model.events[0] ? eventIdentity(model.events[0]) : '')
  const [selectedStart, setSelectedStart] = useState(model.events[0]?.start ?? '')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const canEdit = document.parseState === 'ready' && document.modelRevision === document.revision
  const events = model.events
  const visible = useMemo(() => events.filter((event) => !query || `${event.summary} ${event.location} ${event.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => a.start.localeCompare(b.start)), [events, query])
  const current = events.find((event) => eventIdentity(event) === selected) ?? events[0] ?? null
  const { grouped, occurrences } = useMemo(() => {
    const grouped = new Map<string, Array<{ event: CalendarEvent; start: string }>>()
    const occurrences = new Map<string, string[]>()
    for (const event of visible) {
      const starts = expandCalendarEvent(model, event)
      occurrences.set(eventIdentity(event), starts)
      for (const start of starts) {
        const date = start ? start.slice(0, 10) : '날짜 미정'
        const items = grouped.get(date)
        const entry = { event, start }
        if (items) items.push(entry)
        else grouped.set(date, [entry])
      }
    }
    for (const items of grouped.values()) items.sort((first, second) => first.start.localeCompare(second.start))
    return { grouped, occurrences }
  }, [model, visible])
  const currentOccurrences = current ? occurrences.get(eventIdentity(current)) ?? [] : []
  const update = (uid: string, change: Partial<CalendarEvent>) => { if (canEdit) onChange({ ...model, events: events.map((event) => eventIdentity(event) === uid ? { ...event, ...change } : event) }, 'typing') }
  const add = () => { if (!canEdit) return; const event = newEvent(); onChange({ ...model, events: [...events, event] }); setSelected(eventIdentity(event)); setSelectedStart(event.start); setEditing(true) }
  const remove = () => { if (!current || !canEdit) return; const next = events.filter((event) => eventIdentity(event) !== eventIdentity(current)); onChange({ ...model, events: next }); setSelected(next[0] ? eventIdentity(next[0]) : ''); setSelectedStart(next[0]?.start ?? ''); setEditing(false) }
  const week = useMemo(() => new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }), [])

  return <section className={`calendar-layout${editing ? ' editing' : ''}`}>
    <div className="calendar-agenda">
      <div className="agenda-toolbar"><label className="search-box"><CalendarDays size={14} /><input placeholder="일정 검색" aria-label="일정 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="toolbar-button" disabled={!canEdit} onClick={add}><Plus size={14} /> 일정 추가</button></div>
      {model.diagnostics.length > 0 && <div className="inline-warning">{model.diagnostics[0]}</div>}
      {visible.length === 0 ? <div className="empty-state compact"><CalendarDays size={20} /><strong>표시할 일정이 없습니다.</strong><span>일정을 추가하거나 검색어를 바꿔 보세요.</span></div> : [...grouped].sort(([first], [second]) => first.localeCompare(second)).map(([date, items]) => {
        const day = new Date(`${date}T12:00:00`)
        return <section className="agenda-day" key={date}>
          <h2><strong>{day.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</strong><span>{week.format(day)}</span></h2>
          {items.map(({ event, start }) => <button key={`${eventIdentity(event)}-${start}`} className={`agenda-event${selected === eventIdentity(event) && selectedStart === start ? ' selected' : ''}`} onClick={() => { setSelected(eventIdentity(event)); setSelectedStart(start); setEditing(false) }}>
            <span className="event-dot" /><span className="event-time">{event.allDay ? '종일' : start ? displayDate(start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <span className="event-copy"><strong>{event.summary || '(제목 없음)'}</strong>{event.location && <span><MapPin size={12} />{event.location}</span>}</span>{event.recurrence && <Repeat2 size={13} className="event-repeat" />}
          </button>)}
        </section>
      })}
    </div>
    {current && <aside className="event-detail">
      {editing && canEdit ? <>
        <div className="detail-heading"><h2>일정 편집</h2><button className="icon-button danger-hover" aria-label="일정 삭제" onClick={remove}><Trash2 size={15} /></button><button className="icon-button" aria-label="편집 닫기" onClick={() => setEditing(false)}>×</button></div>
        <label className="form-field"><span>제목</span><input autoFocus value={current.summary} onChange={(event) => update(eventIdentity(current), { summary: event.target.value })} /></label>
        <label className="form-field"><span>시작</span><input type={current.allDay ? 'date' : 'datetime-local'} value={toLocalInput(current.start)} onChange={(event) => update(eventIdentity(current), { start: event.target.value })} /></label>
        <label className="form-field"><span>종료</span><input type={current.allDay ? 'date' : 'datetime-local'} value={toLocalInput(current.end)} onChange={(event) => update(eventIdentity(current), { end: event.target.value })} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={current.allDay} onChange={(event) => onChange({ ...model, events: events.map((item) => eventIdentity(item) === eventIdentity(current) ? { ...item, allDay: event.target.checked, start: event.target.checked ? item.start.slice(0, 10) : `${item.start.slice(0, 10)}T00:00`, end: event.target.checked ? item.end.slice(0, 10) : `${item.end.slice(0, 10)}T00:00` } : item) }, 'command')} /> 종일 일정</label>
        {!current.allDay && <label className="form-field"><span>시간대</span><input value={current.timezone ?? ''} placeholder="예: Asia/Seoul · 비우면 현지 시각" onChange={(event) => update(eventIdentity(current), { timezone: event.target.value.trim() || undefined })} /></label>}
        <label className="form-field"><span>장소</span><input value={current.location} onChange={(event) => update(eventIdentity(current), { location: event.target.value })} /></label>
        <label className="form-field"><span>설명</span><textarea rows={7} value={current.description} onChange={(event) => update(eventIdentity(current), { description: event.target.value })} /></label>
        <label className="form-field"><span>반복 규칙</span><input value={current.recurrence ?? ''} placeholder="예: FREQ=WEEKLY;BYDAY=MO" onChange={(event) => update(eventIdentity(current), { recurrence: event.target.value || undefined })} /><small>복잡한 반복 예외는 원본의 해당 일정으로 이동해 편집하세요.</small></label>
      </> : <>
        <div className="detail-heading"><h2>일정</h2>{canEdit && <button className="subtle-button" onClick={() => setEditing(true)}><Pencil size={13} /> 편집</button>}</div><h1>{current.summary || '(제목 없음)'}</h1>
        <p className="event-detail-time">{displayDate(currentOccurrences.includes(selectedStart) ? selectedStart : current.start).toLocaleString('ko-KR')}{current.allDay ? ' · 종일' : ''}</p>
        {current.end && <p className="event-detail-time">종료 · {displayDate(current.end).toLocaleString('ko-KR')}</p>}
        {current.timezone && <p className="event-detail-time">시간대 · {current.timezone}</p>}
        {current.location && <p className="event-detail-place"><MapPin size={14} />{current.location}</p>}
        {current.recurrence && <p className="event-repeat-label"><Repeat2 size={14} />반복 일정</p>}
        {current.description && <p className="event-description">{current.description}</p>}
      </>}
    </aside>}
  </section>
}
