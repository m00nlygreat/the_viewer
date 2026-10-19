import { useMemo, useState } from 'react'
import { CalendarDays, MapPin, Plus, Repeat2, Trash2 } from 'lucide-react'
import type { CalendarEvent, CalendarModel, ViewerDocument } from '../domain/types'
import { expandCalendarEvent } from '../domain/formats/calendar'

interface Props { document: ViewerDocument; model: CalendarModel; onChange: (model: CalendarModel) => void }

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

export function CalendarEditor({ document, model, onChange }: Props) {
  const [selected, setSelected] = useState(model.events[0]?.uid ?? '')
  const [selectedStart, setSelectedStart] = useState(model.events[0]?.start ?? '')
  const [query, setQuery] = useState('')
  const events = model.events
  const visible = useMemo(() => events.filter((event) => !query || `${event.summary} ${event.location} ${event.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => a.start.localeCompare(b.start)), [events, query])
  const current = events.find((event) => event.uid === selected) ?? null
  const update = (uid: string, change: Partial<CalendarEvent>) => onChange({ ...model, events: events.map((event) => event.uid === uid ? { ...event, ...change } : event) })
  const add = () => { const event = newEvent(); onChange({ ...model, events: [...events, event] }); setSelected(event.uid); setSelectedStart(event.start) }
  const remove = () => { if (!current) return; const next = events.filter((event) => event.uid !== current.uid); onChange({ ...model, events: next }); setSelected(next[0]?.uid ?? ''); setSelectedStart(next[0]?.start ?? '') }
  const grouped = new Map<string, Array<{ event: CalendarEvent; start: string }>>()
  for (const event of visible) {
    for (const start of expandCalendarEvent(model, event)) {
      const date = start ? start.slice(0, 10) : '날짜 미정'
      grouped.set(date, [...(grouped.get(date) ?? []), { event, start }])
    }
  }
  for (const items of grouped.values()) items.sort((first, second) => first.start.localeCompare(second.start))
  const week = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' })

  return <section className={`calendar-layout${document.mode === 'edit' ? ' editing' : ''}`}>
    <div className="calendar-agenda">
      <div className="agenda-toolbar"><label className="search-box"><CalendarDays size={14} /><input placeholder="일정 검색" aria-label="일정 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="toolbar-button" onClick={add}><Plus size={14} /> 일정 추가</button></div>
      {model.diagnostics.length > 0 && <div className="inline-warning">{model.diagnostics[0]}</div>}
      {visible.length === 0 ? <div className="empty-state compact"><CalendarDays size={20} /><strong>표시할 일정이 없습니다.</strong><span>일정을 추가하거나 검색어를 바꿔 보세요.</span></div> : [...grouped].sort(([first], [second]) => first.localeCompare(second)).map(([date, items]) => {
        const day = new Date(`${date}T12:00:00`)
        return <section className="agenda-day" key={date}>
          <h2><strong>{day.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</strong><span>{week.format(day)}</span></h2>
          {items.map(({ event, start }) => <button key={`${event.uid}-${start}`} className={`agenda-event${selected === event.uid && selectedStart === start ? ' selected' : ''}`} onClick={() => { setSelected(event.uid); setSelectedStart(start) }}>
            <span className="event-dot" /><span className="event-time">{event.allDay ? '종일' : start ? displayDate(start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <span className="event-copy"><strong>{event.summary || '(제목 없음)'}</strong>{event.location && <span><MapPin size={12} />{event.location}</span>}</span>{event.recurrence && <Repeat2 size={13} className="event-repeat" />}
          </button>)}
        </section>
      })}
    </div>
    {current && <aside className="event-detail">
      {document.mode === 'edit' ? <>
        <div className="detail-heading"><h2>일정 편집</h2><button className="icon-button danger-hover" aria-label="일정 삭제" onClick={remove}><Trash2 size={15} /></button></div>
        <label className="form-field"><span>제목</span><input autoFocus value={current.summary} onChange={(event) => update(current.uid, { summary: event.target.value })} /></label>
        <label className="form-field"><span>시작</span><input type={current.allDay ? 'date' : 'datetime-local'} value={toLocalInput(current.start)} onChange={(event) => update(current.uid, { start: event.target.value })} /></label>
        <label className="form-field"><span>종료</span><input type={current.allDay ? 'date' : 'datetime-local'} value={toLocalInput(current.end)} onChange={(event) => update(current.uid, { end: event.target.value })} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={current.allDay} onChange={(event) => update(current.uid, { allDay: event.target.checked, start: event.target.checked ? current.start.slice(0, 10) : `${current.start.slice(0, 10)}T00:00`, end: event.target.checked ? current.end.slice(0, 10) : `${current.end.slice(0, 10)}T00:00` })} /> 종일 일정</label>
        {!current.allDay && <label className="form-field"><span>시간대</span><input value={current.timezone ?? ''} placeholder="예: Asia/Seoul · 비우면 현지 시각" onChange={(event) => update(current.uid, { timezone: event.target.value.trim() || undefined })} /></label>}
        <label className="form-field"><span>장소</span><input value={current.location} onChange={(event) => update(current.uid, { location: event.target.value })} /></label>
        <label className="form-field"><span>설명</span><textarea rows={7} value={current.description} onChange={(event) => update(current.uid, { description: event.target.value })} /></label>
        <label className="form-field"><span>반복 규칙</span><input value={current.recurrence ?? ''} placeholder="예: FREQ=WEEKLY;BYDAY=MO" onChange={(event) => update(current.uid, { recurrence: event.target.value || undefined })} /><small>기존 반복 규칙을 유지하며 원본에서 편집합니다.</small></label>
      </> : <>
        <div className="detail-heading"><h2>일정</h2></div><h1>{current.summary || '(제목 없음)'}</h1>
        <p className="event-detail-time">{displayDate(expandCalendarEvent(model, current).includes(selectedStart) ? selectedStart : current.start).toLocaleString('ko-KR')}{current.allDay ? ' · 종일' : ''}</p>
        {current.end && <p className="event-detail-time">종료 · {displayDate(current.end).toLocaleString('ko-KR')}</p>}
        {current.timezone && <p className="event-detail-time">시간대 · {current.timezone}</p>}
        {current.location && <p className="event-detail-place"><MapPin size={14} />{current.location}</p>}
        {current.recurrence && <p className="event-repeat-label"><Repeat2 size={14} />반복 일정</p>}
        {current.description && <p className="event-description">{current.description}</p>}
      </>}
    </aside>}
  </section>
}
