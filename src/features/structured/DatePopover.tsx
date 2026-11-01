import { useState } from 'react'
import { isoDateKind } from '../../domain/structured/output'

export function DatePopover({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const match = value.match(/^(?:(\d{4}-\d\d-\d\d))?(?:[Tt ]?(\d\d:\d\d(?::\d\d(?:\.\d+)?)?))?([Zz]|[+-]\d\d:\d\d)?$/)
  const [dateOn, setDateOn] = useState(Boolean(match?.[1]))
  const [timeOn, setTimeOn] = useState(Boolean(match?.[2]))
  const [zoneOn, setZoneOn] = useState(Boolean(match?.[3]))
  const [date, setDate] = useState(match?.[1] ?? '2026-10-29')
  const [time, setTime] = useState(match?.[2] ?? '09:00:00')
  const [zone, setZone] = useState(match?.[3] ?? '+09:00')
  const [invalid, setInvalid] = useState(false)
  const change = (d: boolean, t: boolean, z: boolean, dv: string, tv: string, zv: string) => {
    if (!d && !t) return
    const next = `${d ? dv : ''}${d && t ? 'T' : ''}${t ? tv : ''}${t && z ? zv : ''}`
    const valid = Boolean(isoDateKind(next))
    setInvalid(!valid)
    if (valid) onChange(next)
  }
  return <div className="sd-popover sd-date-popover" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose() } }}>
    <div className="sd-date-row"><label><input type="checkbox" checked={dateOn} onChange={(event) => { const checked = event.target.checked; if (!checked && !timeOn) return; setDateOn(checked); change(checked, timeOn, zoneOn, date, time, zone) }} />날짜</label><input aria-label="날짜 값" disabled={!dateOn} value={date} aria-invalid={invalid && dateOn} onChange={(event) => { setDate(event.target.value); change(dateOn, timeOn, zoneOn, event.target.value, time, zone) }} /></div>
    <div className="sd-date-row"><label><input type="checkbox" checked={timeOn} onChange={(event) => { const checked = event.target.checked; if (!checked && !dateOn) return; setTimeOn(checked); change(dateOn, checked, zoneOn, date, time, zone) }} />시간</label><input aria-label="시간 값" disabled={!timeOn} value={time} aria-invalid={invalid && timeOn} onChange={(event) => { setTime(event.target.value); change(dateOn, timeOn, zoneOn, date, event.target.value, zone) }} /></div>
    <div className="sd-date-row"><label><input type="checkbox" checked={zoneOn && timeOn} disabled={!timeOn} onChange={(event) => { setZoneOn(event.target.checked); change(dateOn, timeOn, event.target.checked, date, time, zone) }} />시간대</label><input aria-label="시간대 값" disabled={!timeOn || !zoneOn} value={zone} aria-invalid={invalid && timeOn && zoneOn} onChange={(event) => { setZone(event.target.value); change(dateOn, timeOn, zoneOn, date, time, event.target.value) }} /></div>
    <div className="sd-date-result"><small>저장되는 값 · ISO 8601</small><code>{value}</code></div>
  </div>
}
