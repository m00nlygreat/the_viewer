import { describe, expect, it } from 'vitest'
import { decodeBytes } from '../src/domain/formatParsing'
import { parseCsv, serializeCsv } from '../src/domain/formats/csv'
import { isEditableEmailMime, parseEmail, serializeEmail, serializeEmailPreserving } from '../src/domain/formats/email'
import { expandCalendarEvent, parseCalendar, serializeCalendar } from '../src/domain/formats/calendar'
import { parseVCF, serializeVCF, setContactItems, updateContact } from '../src/domain/vcard'
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

  it('keeps the selected no-header interpretation when reparsing source text', () => {
    const parsed = parseCsv('코드,값\n0007,false', 'UTF-8', false, '\n', false)
    expect(parsed.hasHeader).toBe(false)
    expect(parsed.headers).toEqual([])
    expect(parsed.rows).toEqual([['코드', '값'], ['0007', 'false']])
  })
})

describe('Markdown', () => {
  it('renders GFM task markers without adding active form controls', () => {
    const html = renderMarkdownMarkup('- [x] 완료\n- [ ] 남음')
    expect(html).toContain('☑ 완료')
    expect(html).toContain('☐ 남음')
    expect(html).not.toContain('<input')
  })

  it('wraps rendered tables in a layout container', () => {
    const html = renderMarkdownMarkup('| 항목 | 값 |\n| --- | --- |\n| 이름 | 예시 |')
    expect(html).toContain('<div class="markdown-table-scroll"><table>')
    expect(html).toContain('</table></div>')
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

  it('patches a simple message without rebuilding unchanged headers or body', async () => {
    const source = [
      'From: Viewer <sender@example.com>', 'To: reader@example.com', 'Subject: Original',
      'X-Trace: keep-this-header', 'Content-Type: text/plain; charset=UTF-8', '', 'first line', 'second line', ''
    ].join('\r\n')
    const model = await parseEmail(new TextEncoder().encode(source))
    model.subject = 'Updated'
    expect(isEditableEmailMime(source)).toBe(true)
    const output = await serializeEmailPreserving(model, source)
    const sourceBody = source.slice(source.indexOf('\r\n\r\n') + 4)
    const outputBody = output.slice(output.indexOf('\r\n\r\n') + 4)
    expect(output).toContain('X-Trace: keep-this-header')
    expect(outputBody).toBe(sourceBody)
    expect((await parseEmail(new TextEncoder().encode(output))).subject).toBe('Updated')
  })

  it('encodes a changed body and wraps new attachments while keeping attachment bytes', async () => {
    const source = ['Subject: Original', 'X-Trace: keep-this-header', 'Content-Type: text/plain; charset=UTF-8', '', 'Original body', ''].join('\r\n')
    const model = await parseEmail(new TextEncoder().encode(source))
    model.text = '바뀐 본문'
    model.attachments.push({ filename: 'data.bin', mimeType: 'application/octet-stream', content: [255, 0, 1] })
    const output = await serializeEmailPreserving(model, source)
    expect(output).toContain('X-Trace: keep-this-header')
    expect(output).toContain('Content-Type: multipart/mixed; boundary="viewer-')
    expect(isEditableEmailMime(output)).toBe(true)
    const reopened = await parseEmail(new TextEncoder().encode(output))
    expect(reopened.text).toBe('바뀐 본문')
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

  it('updates only the selected duplicate UID and preserves compound name, organization, and property parameters', () => {
    const source = [
      'BEGIN:VCARD', 'VERSION:4.0', 'UID:duplicate', 'item1.FN;LANGUAGE=en:First', 'N:Old;Given;Middle;Dr.;Jr.',
      'ORG:Old Company;Research', 'item1.TEL;TYPE=WORK;PREF=1:tel:+82-10-1111', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:4.0', 'UID:duplicate', 'FN:Second', 'N:Last;Second;;;', 'END:VCARD', ''
    ].join('\r\n')
    const parsed = parseVCF(source)
    const first = parsed.cards[0]!
    const changed = updateContact(parsed, first.recordId, { fullName: 'Updated First', givenName: 'New Given', organization: 'New Company' })
    const withPhone = setContactItems(changed, first.recordId, 'phones', [{ value: '+82-10-2222', label: 'WORK' }])
    const output = serializeVCF(withPhone)
    const reopened = parseVCF(output)
    expect(reopened.cards[0]?.fullName).toBe('Updated First')
    expect(reopened.cards[0]?.givenName).toBe('New Given')
    expect(reopened.cards[0]?.properties.find((property) => property.name === 'N')?.value).toBe('Old;New Given;Middle;Dr.;Jr.')
    expect(reopened.cards[0]?.properties.find((property) => property.name === 'ORG')?.value).toBe('New Company;Research')
    expect(reopened.cards[0]?.properties.find((property) => property.name === 'TEL')?.raw).toBe('item1.TEL;TYPE=WORK;PREF=1:tel:+82-10-2222')
    expect(reopened.cards[1]?.fullName).toBe('Second')
  })
})

describe('text decoding', () => {
  it('detects and strips a UTF-16LE byte-order mark', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0, 0x42, 0])
    expect(decodeBytes(bytes)).toEqual({ text: 'AB', encoding: 'UTF-16LE', bom: true })
  })
})
