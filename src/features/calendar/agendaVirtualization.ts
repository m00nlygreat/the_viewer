import type { CalendarEvent } from '../../domain/types'

export type AgendaVirtualRow =
  | { type: 'day'; key: string; date: string }
  | { type: 'event'; key: string; date: string; event: CalendarEvent; start: string; colorIndex: number }

export interface AgendaVirtualLayout {
  offsets: number[]
  totalHeight: number
}

export interface AgendaVirtualRange {
  start: number
  end: number
  offset: number
  totalHeight: number
}

export const AGENDA_DAY_ROW_HEIGHT = 46
export const AGENDA_EVENT_ROW_HEIGHT = 60

export function createAgendaVirtualLayout(rows: readonly AgendaVirtualRow[]): AgendaVirtualLayout {
  const offsets = new Array<number>(rows.length + 1)
  offsets[0] = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    offsets[index + 1] = offsets[index]! + (row.type === 'day' ? AGENDA_DAY_ROW_HEIGHT : AGENDA_EVENT_ROW_HEIGHT)
  }
  return { offsets, totalHeight: offsets[rows.length]! }
}

export function getAgendaVirtualRange(layout: AgendaVirtualLayout, scrollTop: number, viewportHeight: number, overscan = 8): AgendaVirtualRange {
  const rowCount = layout.offsets.length - 1
  if (rowCount <= 0) return { start: 0, end: 0, offset: 0, totalHeight: layout.totalHeight }
  const firstVisible = findRow(layout.offsets, Math.max(0, scrollTop))
  const firstAfterViewport = findRow(layout.offsets, Math.max(0, scrollTop + Math.max(0, viewportHeight)))
  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(rowCount, Math.max(firstVisible + 1, firstAfterViewport + 1) + overscan)
  return { start, end, offset: layout.offsets[start]!, totalHeight: layout.totalHeight - layout.offsets[end]! }
}

function findRow(offsets: readonly number[], position: number): number {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1]! <= position) low = middle + 1
    else high = middle
  }
  return low
}
