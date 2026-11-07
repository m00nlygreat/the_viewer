import type { BackgroundSerializationInput } from './serializeQueue'

self.onmessage = async (event: MessageEvent<{ id: string; documentId: string; revision: number } & BackgroundSerializationInput>) => {
  const { id, documentId, revision, format, model } = event.data
  try {
    let text: string
    if (format === 'csv') text = (await import('./formats/csv')).serializeCsv(model)
    else if (format === 'ics') text = (await import('./formats/calendar')).serializeCalendar(model)
    else text = (await import('./vcard')).serializeVCF(model)
    self.postMessage({ id, documentId, revision, ok: true, text })
  } catch (error) {
    self.postMessage({ id, documentId, revision, ok: false, error: error instanceof Error ? error.message : '파일을 직렬화하지 못했습니다.' })
  }
}
