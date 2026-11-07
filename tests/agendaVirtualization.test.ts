import { describe, expect, it } from 'vitest'
import { createAgendaVirtualLayout, getAgendaVirtualRange, type AgendaVirtualRow } from '../src/features/calendar/agendaVirtualization'

function rows(count: number): AgendaVirtualRow[] {
  return [
    { type: 'day', key: 'day:2026-11-07', date: '2026-11-07' },
    ...Array.from({ length: count }, (_, index) => ({
      type: 'event' as const,
      key: `event:${index}`,
      date: '2026-11-07',
      event: { uid: `event-${index}`, summary: '', location: '', description: '', start: '', end: '', allDay: false },
      start: '',
      colorIndex: index % 4
    }))
  ]
}

describe('agenda virtualization', () => {
  it('calculates fixed row offsets for date headers and events', () => {
    const layout = createAgendaVirtualLayout(rows(4))
    expect(layout.offsets).toEqual([0, 46, 106, 166, 226, 286])
    expect(layout.totalHeight).toBe(286)
  })

  it('returns the visible range and overscanned spacer sizes', () => {
    const layout = createAgendaVirtualLayout(rows(20))
    const range = getAgendaVirtualRange(layout, 106, 60, 0)
    expect(range).toEqual({ start: 2, end: 4, offset: 106, totalHeight: 60 + 16 * 60 })
  })

  it('keeps the rendered row count bounded for a long agenda', () => {
    const layout = createAgendaVirtualLayout(rows(10_000))
    const range = getAgendaVirtualRange(layout, 300_000, 640)
    expect(range.end - range.start).toBeLessThan(30)
    expect(range.start).toBeGreaterThan(0)
    expect(range.end).toBeLessThan(layout.offsets.length - 1)
  })

  it('keeps a bounded range when the scroll position moves beyond the list', () => {
    const layout = createAgendaVirtualLayout(rows(20))
    const range = getAgendaVirtualRange(layout, 10_000, 600, 2)
    expect(range.start).toBe(layout.offsets.length - 1 - 2)
    expect(range.end).toBe(layout.offsets.length - 1)
    expect(range.offset + layout.offsets[range.end]! - layout.offsets[range.start]! + range.totalHeight).toBe(layout.totalHeight)
  })

  it('returns an empty range for an empty agenda', () => {
    expect(getAgendaVirtualRange(createAgendaVirtualLayout([]), 0, 600)).toEqual({ start: 0, end: 0, offset: 0, totalHeight: 0 })
  })
})
