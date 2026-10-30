export function normalizeEmailAttachmentBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value)
  }
  throw new Error('저장된 이메일 첨부 바이트 형식이 올바르지 않습니다.')
}
