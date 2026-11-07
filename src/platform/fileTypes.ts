export {
  FORMATS, FORMAT_MIME, FORMAT_MIME_ALIASES, GENERIC_FILE_MIME_TYPES, FORMAT_LABEL, getFormat, matchesFormatName
} from '../domain/fileFormats'
export type { Format } from '../domain/fileFormats'

export interface PickedFileMetadata { name: string; type: string; fileHandle?: FileSystemFileHandle }
export type PickedBytesFile = PickedFileMetadata & { bytes: Uint8Array }
export type PickedFile = PickedBytesFile | (PickedFileMetadata & { file: Blob })
