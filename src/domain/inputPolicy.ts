export const DESKTOP_FILE_LIMIT = 50 * 1024 * 1024
export const MOBILE_FILE_LIMIT = 20 * 1024 * 1024

export function maxInputFileBytes(userAgent: string): number {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? MOBILE_FILE_LIMIT : DESKTOP_FILE_LIMIT
}

export function assertInputFileSize(name: string, size: number, userAgent: string): void {
  const maximum = maxInputFileBytes(userAgent)
  if (size > maximum) throw new Error(`“${name}” 파일 크기 제한은 ${Math.round(maximum / 1024 / 1024)} MiB입니다.`)
}
