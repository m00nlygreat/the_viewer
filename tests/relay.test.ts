import { describe, expect, it } from 'vitest'
import {
  base64ToBytes, bytesToBase64, CHUNK_BYTES, DESKTOP_FILE_LIMIT, expectedChunkCount,
  isRelayMessage, isSupportedProtocolVersion, isTicketId, isTrustedPwaSender, maxFileBytes, PROTOCOL_VERSION,
  WORKSPACE_SNAPSHOT_LIMIT
} from '../src/platform/relay/protocol'
import { restoreLegacySnapshot } from '../src/platform/pwa/extensionRelay'
import type { EmailModel } from '../src/domain/types'

const ticketId = '123e4567-e89b-42d3-a456-426614174000'
const pwaSender = {
  origin: 'https://m00nlygreat.github.io',
  url: 'https://m00nlygreat.github.io/the_viewer/#/relay/example',
  frameId: 0,
  tabId: 42
}

describe('extension relay protocol', () => {
  it('uses bounded 192 KiB chunks and retains the desktop/mobile file limits', () => {
    expect(CHUNK_BYTES).toBe(192 * 1024)
    expect(DESKTOP_FILE_LIMIT).toBe(50 * 1024 * 1024)
    expect(maxFileBytes('Chrome Desktop')).toBe(50 * 1024 * 1024)
    expect(maxFileBytes('Mozilla/5.0 (Android 14; Mobile)')).toBe(20 * 1024 * 1024)
    expect(maxFileBytes('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(20 * 1024 * 1024)
    expect(expectedChunkCount(0)).toBe(0)
    expect(expectedChunkCount(50 * 1024 * 1024)).toBe(267)
    expect(WORKSPACE_SNAPSHOT_LIMIT).toBeGreaterThan(DESKTOP_FILE_LIMIT)
  })

  it('validates protocol messages, IDs, chunk counts, and Base64 fields', () => {
    expect(isTicketId(ticketId)).toBe(true)
    expect(isTicketId('ticket-1')).toBe(false)
    expect(isRelayMessage({ type: 'HELLO', version: PROTOCOL_VERSION, ticketId })).toBe(true)
    expect(isRelayMessage({ type: 'HELLO', version: 2, ticketId })).toBe(true)
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true)
    expect(isSupportedProtocolVersion(2)).toBe(false)
    expect(isRelayMessage({ type: 'READ', ticketId, sequence: 0 })).toBe(true)
    expect(isRelayMessage({ type: 'READ', ticketId, sequence: -1 })).toBe(false)
    expect(isRelayMessage({ type: 'CHUNK', ticketId, sequence: 0, base64: 'AA==' })).toBe(true)
    expect(isRelayMessage({ type: 'CHUNK', ticketId, sequence: 0, base64: 'A===' })).toBe(false)
    expect(isRelayMessage({ type: 'META', version: 1, ticketId, kind: 'csv', name: 'data.csv', mimeType: 'text/csv', byteLength: CHUNK_BYTES + 1, chunkCount: 1 })).toBe(false)
    expect(isRelayMessage({ type: 'META', version: 1, ticketId, kind: 'csv', name: 'data.csv', mimeType: 'text/csv', byteLength: CHUNK_BYTES + 1, chunkCount: 2 })).toBe(true)
    expect(isRelayMessage({ type: 'COMMIT', ticketId })).toBe(true)
  })

  it('accepts messages only from the exact PWA origin, path, frame, and ticket tab', () => {
    expect(isTrustedPwaSender(pwaSender, 42)).toBe(true)
    expect(isTrustedPwaSender({ ...pwaSender, origin: 'https://evil.example' }, 42)).toBe(false)
    expect(isTrustedPwaSender({ ...pwaSender, url: 'https://m00nlygreat.github.io.evil.example/the_viewer/' }, 42)).toBe(false)
    expect(isTrustedPwaSender({ ...pwaSender, url: 'https://m00nlygreat.github.io/other/' }, 42)).toBe(false)
    expect(isTrustedPwaSender({ ...pwaSender, frameId: 3 }, 42)).toBe(false)
    expect(isTrustedPwaSender(pwaSender, 43)).toBe(false)
  })

  it('migrates legacy email attachment arrays into typed byte storage', () => {
    const source = new TextEncoder().encode('Subject: Legacy\r\n\r\nbody')
    const text = new TextDecoder().decode(source)
    const snapshot = {
      schemaVersion: 1,
      document: {
        id: 'legacy-email', name: 'legacy.eml', format: 'eml', mimeType: 'message/rfc822', size: source.byteLength,
        sourceText: text, text, savedText: text, mode: 'view', revision: 0, isDirty: false,
        openedAt: 1, lastEditedAt: 1, sourceBytesBase64: bytesToBase64(source),
        model: {
          subject: 'Legacy', from: [], to: [], cc: [], date: '', text: 'body', html: '', headers: [],
          attachments: [{ filename: 'raw.bin', mimeType: 'application/octet-stream', content: [0, 127, 255] }]
        }
      }
    }

    const restored = restoreLegacySnapshot(new TextEncoder().encode(JSON.stringify(snapshot)))
    expect((restored.model as EmailModel).attachments[0]?.content).toEqual(new Uint8Array([0, 127, 255]))
  })

  it('round-trips a 50 MiB file through bounded Base64 chunks byte-for-byte', { timeout: 30_000 }, () => {
    const source = new Uint8Array(DESKTOP_FILE_LIMIT)
    for (let index = 0; index < source.length; index += 1) source[index] = (index * 31 + 17) & 0xff
    let restoredLength = 0
    for (let offset = 0; offset < source.length; offset += CHUNK_BYTES) {
      const piece = source.subarray(offset, Math.min(offset + CHUNK_BYTES, source.length))
      const base64 = bytesToBase64(piece)
      expect(base64.length).toBeLessThanOrEqual(256 * 1024)
      const restoredChunk = base64ToBytes(base64)
      expect(restoredChunk.byteLength).toBe(piece.byteLength)
      for (let index = 0; index < piece.length; index += 1) {
        if (restoredChunk[index] !== piece[index]) throw new Error(`Byte mismatch at offset ${offset + index}.`)
      }
      restoredLength += restoredChunk.byteLength
    }
    expect(restoredLength).toBe(DESKTOP_FILE_LIMIT)
  })
})
