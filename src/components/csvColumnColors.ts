export const CSV_COLUMN_COLOR_COUNT = 8

export const CSV_COLUMN_DARK_COLORS = [
  '#93C5FD', '#86EFAC', '#FCA5A5', '#FCD34D',
  '#C4B5FD', '#67E8F9', '#FDA4AF', '#BEF264'
] as const

export const CSV_COLUMN_LIGHT_COLORS = [
  '#1D4ED8', '#15803D', '#B91C1C', '#A16207',
  '#6D28D9', '#0E7490', '#BE185D', '#4D7C0F'
] as const

export function csvColumnColorVariable(index: number): string {
  return `--csv-column-${index}`
}
