export {
  FORMATS, FORMAT_MIME, FORMAT_MIME_ALIASES, GENERIC_FILE_MIME_TYPES, FORMAT_LABEL, getFormat
} from '../domain/fileFormats'
export type { Format } from '../domain/fileFormats'

export interface PickedFile { name: string; type: string; bytes: Uint8Array }
