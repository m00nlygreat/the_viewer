function toMonacoHexColor(value: string): string | null {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu)
  if (!match) return null

  const digits = match[1]!.toUpperCase()
  const expanded = digits.length === 3 || digits.length === 4
    ? [...digits].map((digit) => `${digit}${digit}`).join('')
    : digits
  return `#${expanded}`
}

export function normalizeMonacoThemeColor(value: string, fallback: string): string {
  return toMonacoHexColor(value) ?? toMonacoHexColor(fallback) ?? '#000000'
}
