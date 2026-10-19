import ICAL from 'ical.js'
import type { CalendarEvent, CalendarModel } from '../types'

export function parseCalendar(text: string): CalendarModel {
  const diagnostics: string[] = []
  try {
    const jcal = ICAL.parse(text)
    const root = new ICAL.Component(jcal)
    const events: CalendarEvent[] = root.getAllSubcomponents('vevent').map((component, index) => {
      const event = new ICAL.Event(component)
      const start = event.startDate
      const end = event.endDate
      const startValue = start ? localCalendarValue(start) : ''
      const endValue = end ? localCalendarValue(end) : ''
      const recurrence = component.hasProperty('rrule') ? component.getFirstPropertyValue('rrule')?.toString?.() ?? String(component.getFirstPropertyValue('rrule')) : undefined
      const timezone = component.getFirstProperty('dtstart')?.getParameter('tzid')
      return {
        uid: String(event.uid || `event-${index + 1}`), summary: String(event.summary || ''), location: String(event.location || ''), description: String(event.description || ''),
        start: startValue, end: endValue, allDay: Boolean(start?.isDate), timezone: typeof timezone === 'string' ? timezone : Array.isArray(timezone) ? String(timezone[0] ?? '') || undefined : undefined, recurrence,
        originalStart: startValue, originalEnd: endValue, originalAllDay: Boolean(start?.isDate), originalRecurrence: recurrence,
        originalTimezone: typeof timezone === 'string' ? timezone : Array.isArray(timezone) ? String(timezone[0] ?? '') || undefined : undefined, componentIndex: index
      }
    })
    return { events, jcal, diagnostics }
  } catch (error) {
    return { events: [], jcal: [], diagnostics: [`일정 형식을 해석하지 못했습니다: ${error instanceof Error ? error.message : '잘못된 구조'}`] }
  }
}

function pad(value: number): string { return String(value).padStart(2, '0') }
function localCalendarValue(time: ICAL.Time): string {
  const date = `${String(time.year).padStart(4, '0')}-${pad(time.month)}-${pad(time.day)}`
  return time.isDate ? date : `${date}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`
}

export function expandCalendarEvent(model: CalendarModel, event: CalendarEvent): string[] {
  if (!event.recurrence || !event.start) return event.start ? [event.start] : []
  const data = JSON.parse(JSON.stringify(model.jcal)) as ConstructorParameters<typeof ICAL.Component>[0]
  const root = new ICAL.Component(data)
  const component = event.componentIndex === undefined ? undefined : root.getAllSubcomponents('vevent')[event.componentIndex]
  const target = component ?? new ICAL.Component('vevent')
  if (!component) {
    target.addPropertyWithValue('uid', event.uid)
    target.addPropertyWithValue('dtstart', eventTime(event.start, event.allDay))
    if (event.end) target.addPropertyWithValue('dtend', eventTime(event.end, event.allDay))
  } else {
    if (event.start !== event.originalStart || event.allDay !== event.originalAllDay) updateEventTime(target, 'dtstart', event.start, event.allDay)
    if (event.end !== event.originalEnd || event.allDay !== event.originalAllDay) updateEventTime(target, 'dtend', event.end, event.allDay)
    if (event.timezone !== event.originalTimezone || event.allDay !== event.originalAllDay) updateEventTimezone(target, event.timezone, event.allDay)
    if (event.recurrence !== event.originalRecurrence) target.updatePropertyWithValue('rrule', ICAL.Recur.fromString(event.recurrence))
  }
  const iterator = new ICAL.Event(target).iterator()
  const from = Date.now() - 90 * 86_400_000
  const through = Date.now() + 365 * 86_400_000
  const dates: string[] = []
  for (let count = 0; count < 10_000; count += 1) {
    const occurrence = iterator.next()
    if (!occurrence) break
    const timestamp = occurrence.toJSDate().getTime()
    if (timestamp > through) break
    if (timestamp >= from) dates.push(localCalendarValue(occurrence))
  }
  return dates.length ? dates : [event.start]
}

function eventTime(value: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(value.slice(0, 10))
  const dateTime = value.length === 16 ? `${value}:00` : value
  return ICAL.Time.fromDateTimeString(dateTime)
}
function updateEventTime(component: ICAL.Component, name: 'dtstart' | 'dtend', value: string, allDay: boolean): void {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return
  const property = component.getFirstProperty(name)
  if (property) {
    property.setValue(eventTime(value, allDay))
    if (allDay) { property.setParameter('value', 'DATE'); property.removeParameter('tzid') }
    else property.removeParameter('value')
  } else {
    const created = new ICAL.Property(name)
    if (allDay) created.setParameter('value', 'DATE')
    created.setValue(eventTime(value, allDay))
    component.addProperty(created)
  }
}

function updateEventTimezone(component: ICAL.Component, timezone: string | undefined, allDay: boolean): void {
  for (const propertyName of ['dtstart', 'dtend']) {
    const property = component.getFirstProperty(propertyName)
    if (!property) continue
    if (allDay || !timezone) property.removeParameter('tzid')
    else property.setParameter('tzid', timezone)
  }
}

export function serializeCalendar(model: CalendarModel): string {
  const root = new ICAL.Component(model.jcal as ConstructorParameters<typeof ICAL.Component>[0])
  const original = root.getAllSubcomponents('vevent')
  const updated = new Map<string, CalendarEvent[]>()
  for (const event of model.events) updated.set(event.uid, [...(updated.get(event.uid) ?? []), event])
  for (const component of original) {
    const uid = String(component.getFirstPropertyValue('uid') ?? '')
    const event = updated.get(uid)?.shift()
    if (!event) { root.removeSubcomponent(component); continue }
    component.updatePropertyWithValue('summary', event.summary)
    component.updatePropertyWithValue('location', event.location)
    component.updatePropertyWithValue('description', event.description)
    if (event.start !== event.originalStart || event.allDay !== event.originalAllDay) updateEventTime(component, 'dtstart', event.start, event.allDay)
    if (event.end !== event.originalEnd || event.allDay !== event.originalAllDay) updateEventTime(component, 'dtend', event.end, event.allDay)
    if (event.timezone !== event.originalTimezone || event.allDay !== event.originalAllDay) updateEventTimezone(component, event.timezone, event.allDay)
    if (event.recurrence !== event.originalRecurrence) {
      if (event.recurrence) component.updatePropertyWithValue('rrule', ICAL.Recur.fromString(event.recurrence))
      else if (component.hasProperty('rrule')) component.removeProperty('rrule')
    }
  }
  for (const events of updated.values()) for (const event of events) {
    const component = new ICAL.Component('vevent')
    component.addPropertyWithValue('uid', event.uid || crypto.randomUUID())
    component.addPropertyWithValue('summary', event.summary)
    component.addPropertyWithValue('location', event.location)
    component.addPropertyWithValue('description', event.description)
    if (event.start) component.addPropertyWithValue('dtstart', eventTime(event.start, event.allDay))
    if (event.end) component.addPropertyWithValue('dtend', eventTime(event.end, event.allDay))
    if (event.timezone && !event.allDay) {
      component.getFirstProperty('dtstart')?.setParameter('tzid', event.timezone)
      component.getFirstProperty('dtend')?.setParameter('tzid', event.timezone)
    }
    if (event.recurrence) component.addPropertyWithValue('rrule', ICAL.Recur.fromString(event.recurrence))
    root.addSubcomponent(component)
  }
  return root.toString().replace(/\r?\n/g, '\r\n').replace(/\r\n?$/, '\r\n')
}
