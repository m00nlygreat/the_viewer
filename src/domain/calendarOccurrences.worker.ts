import { expandCalendarEvent } from './formats/calendar'
import type { CalendarEvent, CalendarModel } from './types'

type Request =
  | { type: 'init'; jcal: unknown[] }
  | { type: 'query'; requestId: number; events: CalendarEvent[] }

let model: CalendarModel | null = null
let newestRequest = 0

function eventIdentity(event: CalendarEvent): string {
  return event.componentIndex === undefined ? `new:${event.uid}` : `component:${event.componentIndex}`
}

async function expand(requestId: number, events: CalendarEvent[]): Promise<void> {
  if (!model) return
  const occurrences: Array<{ key: string; starts: string[] }> = []
  for (let start = 0; start < events.length; start += 8) {
    if (requestId !== newestRequest) return
    for (const event of events.slice(start, start + 8)) {
      occurrences.push({ key: eventIdentity(event), starts: expandCalendarEvent(model, event) })
    }
    if (start + 8 < events.length) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  if (requestId === newestRequest) self.postMessage({ requestId, occurrences })
}

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data
  if (request.type === 'init') {
    model = { events: [], jcal: request.jcal, diagnostics: [] }
    return
  }
  newestRequest = request.requestId
  void expand(request.requestId, request.events)
}
