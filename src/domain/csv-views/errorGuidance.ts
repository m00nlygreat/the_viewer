import type { CsvQueryError } from './model'

export function csvQueryNextStep(error: CsvQueryError): string {
  if (error.code === 'budget-exceeded') return '표시 컬럼 수를 줄이거나 필터를 추가해 범위를 좁혀 보세요.'
  if (error.code === 'cursor-expired') return '이전 조회 위치가 만료됐습니다. 현재 조건으로 처음부터 다시 조회하세요.'
  if (error.code === 'source-unavailable') return '원본 파일을 다시 연결해 주세요.'
  if (error.code === 'stale-dataset') return '원본이나 컬럼 설정이 바뀌었습니다. 조건을 다시 조회하세요.'
  if (error.code === 'engine-restarted') return '조회 엔진이 다시 시작됐습니다. 현재 조건으로 다시 조회하세요.'
  return '조건을 단순하게 바꾸거나 범위를 좁혀 보세요.'
}
