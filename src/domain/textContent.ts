export interface DecodedTextContent {
  text: string
  encoding: string
  bom: boolean
}

/** Decode unknown files only when their bytes have a credible text encoding. */
export function decodeTextContent(bytes: Uint8Array): DecodedTextContent | null {
  if (isKnownBinarySignature(bytes)) return null
  if (bytes.byteLength === 0) return { text: '', encoding: 'UTF-8', bom: false }

  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return decodeCandidate(bytes.subarray(3), 'UTF-8', true)
  if (startsWith(bytes, [0xff, 0xfe])) return decodeCandidate(bytes.subarray(2), 'UTF-16LE', true)
  if (startsWith(bytes, [0xfe, 0xff])) return decodeCandidate(bytes.subarray(2), 'UTF-16BE', true)

  const utf16Encoding = detectUtf16ByteOrder(bytes)
  if (utf16Encoding) {
    const decoded = decodeCandidate(bytes, utf16Encoding, false)
    if (decoded) return decoded
  }

  return decodeCandidate(bytes, 'UTF-8', false) ?? decodeCandidate(bytes, 'EUC-KR', false)
}

function decodeCandidate(bytes: Uint8Array, encoding: string, bom: boolean): DecodedTextContent | null {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    return isTextPayload(text) ? { text, encoding, bom } : null
  } catch {
    return null
  }
}

function isTextPayload(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (code === 0xfffd || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)) return false
  }
  return true
}

function detectUtf16ByteOrder(bytes: Uint8Array): 'UTF-16LE' | 'UTF-16BE' | null {
  const sampleLength = Math.min(bytes.byteLength, 4096) & ~1
  if (sampleLength < 8) return null
  let evenNulls = 0
  let oddNulls = 0
  for (let index = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) evenNulls += 1
    if (bytes[index + 1] === 0) oddNulls += 1
  }
  const pairs = sampleLength / 2
  if (oddNulls >= pairs * 0.25 && oddNulls >= evenNulls * 3) return 'UTF-16LE'
  if (evenNulls >= pairs * 0.25 && evenNulls >= oddNulls * 3) return 'UTF-16BE'
  return null
}

function isKnownBinarySignature(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) || // PDF
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) || // GIF
    startsWith(bytes, [0x42, 0x4d]) || // BMP
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) || // TIFF
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]) || // ZIP
    startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || // OLE compound document
    startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) || // RAR
    startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) || // 7-Zip
    startsWith(bytes, [0x1f, 0x8b]) || // gzip
    startsWith(bytes, [0x42, 0x5a, 0x68]) || // bzip2
    startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) || // xz
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(bytes, [0x4d, 0x5a]) || // Windows executable
    startsWith(bytes, [0x49, 0x44, 0x33]) || // MP3
    startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]) || // Ogg
    startsWith(bytes, [0x66, 0x4c, 0x61, 0x43]) || // FLAC
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) || // RIFF media
    startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) || // ICO
    startsWith(bytes, [0x00, 0x00, 0x02, 0x00]) || // CUR
    (bytes.byteLength >= 8 && startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70]) ) // ISO base media (MP4, HEIC, etc.)
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.byteLength >= prefix.length && prefix.every((byte, index) => bytes[index] === byte)
}
