export const CSV_POLICY = {
  sampleRecords: 200,
  sampleBytes: 8 * 1024 * 1024,
  sampleMinimumValid: 20,
  sampleFirstChunkBytes: 1024 * 1024,
  maxDigits: 38,
  maxDateTimeFractionDigits: 6,
  maxImportBytes: 5 * 1024 * 1024,
  maxViewsPerFile: 100,
  maxFilterDepth: 8,
  maxFilterConditions: 100,
  pageSize: 200,
  prefetchPages: 1,
  pageCachePages: 4,
  queryDebounceMs: 200,
  maxConcurrentQueries: 1,
  desktopMemoryBytes: 50 * 1024 * 1024,
  mobileMemoryBytes: 20 * 1024 * 1024,
  // 임시값: P0 기술 검증 없이 선택한 파일 기반 CSV 절대 상한. 개발 기능에서만 사용한다.
  maxFileBackedCsvBytes: 512 * 1024 * 1024,
  // 임시값: P0 검증 전 기본 엔진 취소 유예 시간.
  cancelGraceMs: 1500,
  // 임시값: P5에서 실측 후 확정할 OPFS 재생성 캐시 상한.
  opfsCacheBytes: 256 * 1024 * 1024,
  maxGroupCount: 100,
  maxGroupsPerRequest: 8,
  maxCalendarRowsPerDay: 200
} as const

export function maxMemoryCsvBytes(userAgent: string): number {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent)
    ? CSV_POLICY.mobileMemoryBytes
    : CSV_POLICY.desktopMemoryBytes
}
