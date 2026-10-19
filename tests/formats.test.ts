import { describe, expect, it } from 'vitest'
import { decodeBytes } from '../src/domain/formatParsing'
import { parseCsv, serializeCsv } from '../src/domain/formats/csv'
import { parseEmail, serializeEmail } from '../src/domain/formats/email'
import { expandCalendarEvent, parseCalendar, serializeCalendar } from '../src/domain/formats/calendar'
import { parseVCF, serializeVCF, updateContact } from '../src/domain/vcard'
import { renderMarkdownMarkup } from '../src/domain/markdown'

describe('CSV', () => {
  it('keeps duplicate headers, quoted commas, newlines, and Korean text after round trip', () => {
    const source = '이름,이름,메모\r\n홍길동,00123,"첫 줄, 쉼표\r\n둘째 줄"\r\n'
    const parsed = parseCsv(source, 'UTF-8', false, '\r\n')
    expect(parsed.headers).toEqual(['이름', '이름', '메모'])
    expect(parsed.rows).toEqual([['홍길동', '00123', '첫 줄, 쉼표\r\n둘째 줄']])
    const reopened = parseCsv(serializeCsv(parsed), 'UTF-8', false, '\r\n')
    expect(reopened.headers).toEqual(parsed.headers)
    expect(reopened.rows).toEqual(parsed.rows)
  })

  it('detects tab-delimited files without converting numeric-looking values', () => {
    const parsed = parseCsv('코드\t값\n0007\tfalse', 'UTF-8', false, '\n')
    expect(parsed.delimiter).toBe('\t')
    expect(parsed.rows[0]).toEqual(['0007', 'false'])
  })

  it('treats an empty new file as no header and no rows', () => {
    const parsed = parseCsv('', 'UTF-8', false, '\n')
    expect(parsed.hasHeader).toBe(false)
    expect(parsed.rows).toEqual([])
    expect(parsed.errors).toEqual([])
    expect(serializeCsv(parsed)).toBe('')
  })
})

describe('Markdown', () => {
  it('renders GFM task markers without adding active form controls', () => {
    const html = renderMarkdownMarkup('- [x] 완료\n- [ ] 남음')
    expect(html).toContain('☑ 완료')
    expect(html).toContain('☐ 남음')
    expect(html).not.toContain('<input')
  })
})

describe('EML', () => {
  it('serializes edited headers and multipart content with attachment bytes intact', async () => {
    const source = new TextEncoder().encode([
      'From: Viewer <sender@example.com>', 'To: reader@example.com', 'Subject: =?UTF-8?B?7ZWc6riA?=',
      'X-Trace: keep-this-header', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="source-boundary"', '',
      '--source-boundary', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', '본문',
      '--source-boundary', 'Content-Type: application/octet-stream; name="raw.bin"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="raw.bin"', '', '/wAB', '--source-boundary--', ''
    ].join('\r\n'))
    const parsed = await parseEmail(source)
    parsed.subject = '수정한 메일'
    const output = serializeEmail(parsed)
    expect(output).toContain('X-Trace: keep-this-header')
    const reopened = await parseEmail(new TextEncoder().encode(output))
    expect(reopened.subject).toBe('수정한 메일')
    expect(reopened.text).toBe(parsed.text)
    expect(reopened.attachments[0]?.content).toEqual([255, 0, 1])
  })
})

describe('ICS', () => {
  it('retains timezone wall time, recurrence, all-day dates, and unknown event properties', () => {
    const source = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'BEGIN:VEVENT', 'UID:repeat-1', 'SUMMARY:주간 회의',
      'DTSTART;TZID=Asia/Seoul:20261020T093000', 'DTEND;TZID=Asia/Seoul:20261020T103000', 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4',
      'X-KEEP:custom', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:all-day-1', 'SUMMARY:휴일', 'DTSTART;VALUE=DATE:20261021', 'DTEND;VALUE=DATE:20261022',
      'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n')
    const parsed = parseCalendar(source)
    expect(parsed.events[0]?.start).toBe('2026-10-20T09:30:00')
    expect(parsed.events[0]?.timezone).toBe('Asia/Seoul')
    expect(parsed.events[1]?.start).toBe('2026-10-21')
    const dates = expandCalendarEvent(parsed, parsed.events[0]!)
    expect(dates).toEqual(['2026-10-20T09:30:00', '2026-10-27T09:30:00', '2026-11-03T09:30:00', '2026-11-10T09:30:00'])
    const output = serializeCalendar(parsed)
    const reopened = parseCalendar(output)
    expect(reopened.events.map((event) => [event.start, event.end, event.recurrence])).toEqual(parsed.events.map((event) => [event.start, event.end, event.recurrence]))
    expect(output).toContain('TZID=Asia/Seoul')
    expect(output).toContain('X-KEEP:custom')
    expect(output).toContain('DTSTART;VALUE=DATE:20261021')

    const changedTimezone = {
      ...parsed,
      events: parsed.events.map((event, index) => index === 0 ? { ...event, timezone: 'America/New_York' } : event)
    }
    const timezoneOutput = serializeCalendar(changedTimezone)
    const timezoneEvent = parseCalendar(timezoneOutput).events[0]
    expect(timezoneOutput).toContain('TZID=America/New_York')
    expect(timezoneEvent?.start).toBe('2026-10-20T09:30:00')
    expect(expandCalendarEvent(changedTimezone, changedTimezone.events[0]!)).toEqual(dates)
  })
})

describe('vCard', () => {
  it('keeps repeated fields and unedited extensions when updating a contact', () => {
    const source = [
      'BEGIN:VCARD', 'VERSION:3.0', 'UID:person-1', 'FN:홍길동', 'N:홍;길동;;;', 'TEL;TYPE=WORK:010-1111',
      'TEL;TYPE=CELL:010-2222', 'EMAIL;TYPE=HOME:home@example.com', 'X-KEEP;PREF=1:vendor-value', 'END:VCARD', ''
    ].join('\r\n')
    const parsed = parseVCF(source)
    const changed = updateContact(parsed, 'person-1', { organization: '예시 회사' })
    const output = serializeVCF(changed)
    const reopened = parseVCF(output)
    expect(reopened.cards[0]?.phones.map((item) => item.value)).toEqual(['010-1111', '010-2222'])
    expect(reopened.cards[0]?.organization).toBe('예시 회사')
    expect(output).toContain('X-KEEP;PREF=1:vendor-value')
  })
})

describe('text decoding', () => {
  it('detects and strips a UTF-16LE byte-order mark', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0, 0x42, 0])
    expect(decodeBytes(bytes)).toEqual({ text: 'AB', encoding: 'UTF-16LE', bom: true })
  })
})
