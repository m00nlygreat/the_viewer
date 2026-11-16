# CSV 다이나믹 뷰 구현 지시서

- 작성일: 2026-11-11, 개정: 2026-11-16 (리스트 레이아웃, v1 스키마 타입, 타입 기본 해석 규칙, 연산자·정렬 의미, 정책 상수·미결정 사항 부록, P1~P3 구현 계약: 입력 규칙·표시 타입, 저장 레코드·JSON 봉투, 순수 함수 API, 저장소 API, 메모리 Worker 프로토콜, controller 상태, 컴포넌트 props)
- 상태: 구현 전. 이 문서는 작업 지시이며 구현·성능 검증 완료를 뜻하지 않는다.
- 화면 설계: [HTML 목업](../mockup/csv-dynamic-views.html). 목업과 이 문서가 다르면 이 문서를 따르고 차이를 기록한다.
- 기준 커밋: `0ec7b14`, 작성 브랜치: `codex/csv-dynamic-views`. 작업 시 현재 코드와 차이를 다시 확인한다.
- 목적: [통합 계획](CSV_DYNAMIC_VIEW_PLAN.md)을 파일별 작업·타입 계약·단계별 검증으로 구체화한다.
- 공통 기준: [에이전트 규칙](../AGENTs.md), [컴포넌트 작성 규칙](COMPONENTS.md), [요구사항](../wiki/REQUIREMENT.md), [용어](../wiki/TERMS.md).

## 1. 범위와 작업 원칙

다음 결과를 순서대로 구현한다.

1. CSV별 컬럼 스키마와 여러 사용자 뷰를 JSON으로 구성하고 브라우저에 보관한다.
2. 기존 `보기 / 원본`의 왼쪽에서 사용자 뷰를 열고 추가·수정·복제·삭제·재정렬한다.
3. 컬럼 타입을 표본에서 추천하고 사용자가 지정한다. 원문을 보존하면서 타입에 맞게 조회·표시한다.
4. 작은 CSV는 현재 편집 작업본을 조회하고, 큰 CSV는 File/Blob 참조를 통해 필요한 결과를 조회한다.
5. 표·리스트·갤러리를 먼저 연결하고 칸반·캘린더, 반복 분석용 캐시를 확장한다.

초기 사용자 뷰는 조회용이다. 기존 CSV 편집·원본·저장·Undo는 유지한다. 대용량 읽기 전용 세션과 원본 범위 읽기는 [계획의 추가 제안](CSV_DYNAMIC_VIEW_PLAN.md)을 구체화한 범위이며, 기존 지원 파일의 편집 기능을 축소하는 근거로 쓰지 않는다. Form 뷰·칸반 드래그에 의한 데이터 수정·대용량 쓰기·확장의 대용량 중계는 후속 범위다.

작업 시작 시 `git status --short --branch`와 관련 테스트의 기준 결과를 기록한다. 기존 사용자 변경을 보존하고, 단계마다 타입 검사 가능한 상태를 유지한다. 문서의 행 번호 대신 아래 함수와 호출처를 현재 코드에서 다시 찾는다. 원본 자료와 생성된 배포 산출물을 직접 수정하지 않는다.

## 2. 현재 코드의 변경 지점

| 기존 파일·함수 | 구현 지시 |
| --- | --- |
| [문서 타입](../src/domain/types.ts) | 전체 본문을 가진 `ViewerDocument`와 파일 기반 CSV를 구분하는 작업 공간 문서 타입을 추가한다. 기존 `CsvModel.rows`의 의미를 바꾸지 않는다 |
| [문서 저장소](../src/app/documentStore.ts) | 작업 공간 문서 공용체를 보관하고 가벼운 목록 snapshot·문서별 구독을 유지한다 |
| [App](../src/app/App.tsx)의 `processOpenFiles`, `openFiles` | 전체 바이트 읽기 전에 입력 정책으로 분기한다. 파일 기반 CSV를 기존 파서·직렬화·저장 서비스로 보내지 않는다 |
| [폴더 작업 공간](../src/app/useFolderWorkspace.ts)의 `openPath` | 파일 선택과 같은 입력 서비스를 사용한다. 폴더 소속·중복 열기·전환 잠금·취소를 유지한다 |
| [입력 큐](../src/app/workspaceInputQueue.ts), [전환 조정](../src/app/workspaceOperationCoordinator.ts) | 열기 결과 타입을 확장하고 FIFO·전환 중 보류·중복 중계 억제를 유지한다 |
| [파일 입력](../src/platform/browserFiles.ts), [폴더 접근](../src/platform/folderAccess.ts), [입력 정책](../src/domain/inputPolicy.ts) | 참조를 얻을 때의 검사와 전체 버퍼를 만들 때의 검사를 분리한다. CSV용 새 경로를 선택하기 전에 기존 크기 검사로 차단하지 않게 한다 |
| [DocumentHeader](../src/app/DocumentHeader.tsx)의 `DocumentModeTabs`, `DocumentActionBar` | 공통 문서 요약·기능 가능 여부를 받고 사용자 뷰 탭을 연결한다. 데스크톱·모바일이 같은 선택 상태를 사용한다 |
| [CSV 편집기](../src/features/CsvEditor.tsx), [그리드 테마](../src/features/gridTheme.ts) | 기존 편집 표를 유지한다. 조회 표의 가상화·테마·셀 표시에서 공통으로 쓸 수 있는 부분만 추출한다 |
| [기존 CSV 조회 Worker](../src/domain/csvView.worker.ts) | 기존 편집 표의 검색 경로다. 이를 파일 부분 읽기 엔진으로 간주하거나 대용량 행 배열을 전달하지 않는다 |
| [문서 세션](../src/domain/session.ts), [컨트롤러](../src/domain/documentController.ts), [문서 저장](../src/app/documentSave.ts) | 본문이 있는 문서만 받는 경계를 유지한다. 호출자가 타입 가드로 파일 기반 CSV를 먼저 구분한다 |
| [IndexedDB](../src/platform/storage.ts) | v3에서 추가 저장소를 만드는 이행을 구현하고, 복구·문서 삭제·전체 삭제의 범위를 구분한다 |
| [문서 자원 해제](../src/app/documentResources.ts) | 쿼리·cursor·Worker 참조·Blob URL의 해제를 연결한다. 영속적인 뷰 설정은 삭제하지 않는다 |
| [설정](../src/components/SettingsDialog.tsx) | 전체 뷰 백업과 캐시 사용량·정리를 연결한다. 기존 전체 데이터 삭제에 새 저장소도 포함한다 |
| [런타임 자산](../src/platform/pwa/runtimeAssets.ts), [자산 다이얼로그](../src/components/RuntimeAssetDialog.tsx), [서비스 워커](../src/platform/pwa/sw.ts) | 데이터 조회 엔진의 지연 로드·캐시·오프라인 실패 처리를 확장한다 |
| [Vite 설정](../vite.config.ts), [자산 준비](../scripts/prepare-build-assets.mjs), [PWA 검증](../scripts/verify-pwa-build.mjs), [산출물 검증](../scripts/verify-build.mjs) | Wasm·Worker·필요한 확장과 라이선스의 버전·경로·배포 경계를 확인한다 |

신설 모듈은 다음 책임으로 나눈다. 아래 코드 경로는 구현할 파일의 제안이며 아직 존재하지 않는다. 인접한 작은 책임을 합칠 수 있지만 UI·순수 규칙·브라우저 접근의 경계는 유지한다.

| 신설 경로 | 책임 |
| --- | --- |
| `src/domain/csv-views/model.ts`, `validate.ts` | 컬럼·뷰·내보내기 스키마와 런타임 검증 |
| `src/domain/csv-views/typing.ts`, `format.ts`, `inference.ts` | 타입 해석·정규화·표시 문자열과 제한된 표본의 추천 ([§5.6](#56-순수-함수-api)) |
| `src/domain/csv-views/query.ts`, `protocol.ts` | 필터 AST·조회 계약·Worker 메시지 검증 |
| `src/domain/csv-views/memoryQuery.worker.ts` | 작은 CSV의 현재 작업본 조회·표본 분석 |
| `src/platform/csv/sourceRegistry.ts`, `fileIdentity.ts`, `openCsv.ts` | 파일 참조 수명·파일 식별·입력 경로 분기 |
| `src/platform/csv/viewStorage.ts`, `opfsCache.ts` | 뷰 저장 트랜잭션과 재생성 가능한 큰 캐시 |
| `src/platform/csv/MemoryCsvDataSource.ts`, `DuckDbCsvDataSource.ts`, `sqlCompiler.ts` | 공통 조회 계약의 메모리·파일 어댑터와 SQL 생성 |
| `src/platform/csv/duckdbRuntime.ts`, `preview.worker.ts` | 엔진 자산·네이티브 Worker 수명과 CSV 부분 표본 읽기 |
| `src/app/csvViewController.ts` | 현재 문서·선택 뷰·스키마·저장·쿼리 상태 조정 |
| `src/features/csv-views/CsvViewHost.tsx`, `CsvViewTabs.tsx` | 결과 화면과 사용자 뷰 탭 |
| `src/features/csv-views/CsvViewBuilder.tsx`, `CsvColumnTypeEditor.tsx`, `CsvViewManager.tsx` | 뷰 조립·타입 지정·관리 |
| `src/features/csv-views/CsvQueryTable.tsx`, `CsvListView.tsx`, `CsvGalleryView.tsx`, `CsvKanbanView.tsx`, `CsvCalendarView.tsx` | 페이지·그룹·기간별 결과 렌더링 |
| `src/features/csv-views/CsvSourceRangeView.tsx`, `csv-views.css` | 큰 원본의 범위 읽기와 기능 영역 스타일 |

## 3. 문서와 선택 상태 계약

### 3.1. 파일 기반 CSV를 별도 문서로 표현

작업 공간의 공용 타입을 `WorkspaceDocument = ViewerDocument | FileBackedCsvDocument`로 둔다. 새 문서는 필수 판별자 `storageKind: 'file-csv'`를 갖는다. 기존 문서는 `storageKind`가 없는 상태도 메모리 문서로 판별할 수 있어야 하며, 기존 저장 레코드에 불필요한 전체 재쓰기를 요구하지 않는다.

`FileBackedCsvDocument`의 필수 필드는 다음과 같다.

| 필드 | 계약 |
| --- | --- |
| `id`, `name`, `format: 'csv'`, `mimeType`, `size` | 목록·탭·파일 동작의 공통 정보 |
| `storageKind: 'file-csv'`, `fileId`, `sourceRevision` | 파일 기반임을 구분하고 원본 세대를 지정 |
| `mode: 'view' \| 'source'`, `openedAt`, `lastEditedAt`, `folderRef?` | 기본 탭·목록·폴더 연결 |
| `isDirty: false`, `capabilities` | 초기에는 데이터 수정·원본 덮어쓰기·Undo 불가. 열람·원본 다운로드 가능 여부는 명시 |
| `sourceState` | `ready / needs-file / error`. 원본 재선택이 필요한 상태와 빈 파일을 구분 |

이 문서에 `text`, `sourceText`, `savedText`, `savedBytes`, `model.rows`를 빈 값으로 채우지 않는다. 원본 File/Blob, 활성 엔진·연결·cursor는 별도 런타임 등록소에 두며 React 상태나 문서 복구 payload에 넣지 않는다. 데이터가 비어 있는 파일로 오인해 다운로드하는 경로를 타입 수준에서 막는다.

헤더·사이드바는 필요한 공통 필드만 받고, 모델 편집·Undo·직렬화·내보내기 snapshot 생성 전에는 `isFileBackedCsvDocument` 또는 메모리 문서 가드를 통과한다. `as ViewerDocument` 단언으로 새 문서를 기존 경로에 통과시키지 않는다. [폴더 전환](../src/domain/folderTransition.ts)의 수정 여부 검사도 공통 요약 또는 편집 가능한 문서로 한정한다.

App의 `hydrateDocumentPayload`, `parseNow`, 편집·직렬화 callback, 복구 변경 감시도 가드 대상이다. 파일 기반 문서는 전용 세션 복원·저장으로 보내고, `createDocumentSaveService`와 기존 컨트롤러의 `getDocument` 어댑터는 메모리 문서만 반환하게 한다. 공통 목록·헤더용 view model을 따로 만들어 새 문서에 불필요한 본문 필드나 첨부 전용 필드를 추가하지 않는다.

### 3.2. 사용자 뷰 선택

`EditorMode`는 `view / source` 두 값으로 유지하고, CSV 선택 상태를 별도로 정의한다.

```ts
type CsvViewSelection =
  | { kind: 'builtin'; mode: 'view' | 'source' }
  | { kind: 'custom'; viewId: string }
```

문서별 controller를 선택 상태의 단일 소유자로 둔다. 기본 탭을 선택하면 `document.mode`와도 동기화한다. 사용자 뷰 선택은 마지막 기본 모드를 덮어쓰지 않는다. 기존 저장 모드에서 복원할 때는 해당 기본 탭을 초기값으로 사용하고, 삭제되거나 연결이 깨진 사용자 뷰의 복원은 `보기`로 대체한다.

문서 라우팅은 `파일 기반 CSV 여부 → CSV 사용자 뷰 여부 → 기존 원본/형식별 편집기` 순으로 분기한다. 현재 App의 `document.mode === 'source'` 우선 분기보다 앞에서 처리해, 마지막 기본 모드가 원본인 사용자 뷰도 올바르게 렌더링한다.

## 4. JSON·컬럼·뷰 스키마

### 4.1. 객체와 규칙

라이브러리 타입을 영속 스키마로 직접 사용하지 않는다. 앱이 소유하는 v1 계약을 만들고 라이브러리 화면에는 어댑터로 전달한다. [계획의 JSON 예시](CSV_DYNAMIC_VIEW_PLAN.md#3-json에는-무엇을-저장하는가)는 축약본이며 아래 계약으로 검증한다.

| 객체 | 필수 내용 |
| --- | --- |
| 파일 설정 | `schemaVersion: 1`, `fileId`, `parser`, `columns`, `schemaRevision`, `profileRevision`, `viewOrder` |
| 파싱 설정 | 인코딩·BOM·헤더 유무·구분자·인용·이스케이프·개행. 물리 CSV 파싱과 컬럼 값 해석을 분리 |
| 컬럼 | 영속 ID, 0부터 시작하는 원래 위치, 원래 헤더, 표시명, 타입, `typeSource: inferred / user`, 타입별 입력 규칙, 기본 표시 설정 |
| 선택형 컬럼 | 선택지 ID·원문 대응값·레이블·색. 다중 선택이면 별도 목록 구분 규칙 |
| 뷰 | ID·이름·레이아웃·표시 컬럼 순서·필터 AST·정렬·레이아웃 연결·표시 형식 재정의·수정 시각 |

다음 규칙을 적용한다.

- 파일 내 컬럼·뷰 ID는 중복되지 않는다. 헤더를 ID로 사용하지 않는다. 헤더 없음·중복·빈 헤더에서도 위치가 식별 기준에 포함된다.
- 뷰는 파일 스키마의 컬럼 ID만 참조한다. 화면에 숨긴 필터·정렬·그룹·제목·날짜 컬럼도 참조 검증과 조회에 포함한다.
- `grid / list / gallery / kanban / calendar`만 허용한다. 리스트는 제목 컬럼을 요구하고 보조 정보·오른쪽 값·색 표시·묶음 컬럼은 선택이다. 칸반은 그룹 컬럼, 캘린더는 날짜/날짜·시간 컬럼을 요구한다. 서로 맞지 않는 연결은 저장 전에 설명한다.
- 정수·소수·날짜 등은 판별 공용체로 작성해 타입별로 허용한 `parse`와 `display` 옵션만 받는다. 타입과 관계없는 옵션이나 실행 함수·HTML·모듈 경로를 받아 실행하지 않는다.
- `schemaRevision`은 컬럼 연결·타입·입력 규칙 변경 때 증가한다. `profileRevision`은 뷰 추가·정렬 등 파일 설정 저장마다 증가한다. 표시 형식만 바꾸면 `profileRevision`만 올리고 `schemaRevision`과 원본 세대는 바꾸지 않는다.
- 한 뷰 다운로드에도 실행에 필요한 컬럼·타입·파싱 설정을 포함한다. 모든 뷰 다운로드는 같은 계약의 `views`와 `viewOrder`를 모두 포함한다.
- 전체 파일의 뷰 백업은 `kind: 'csv-view-backup'`, `schemaVersion: 1`, `profiles` 배열의 봉투로 구분한다. CSV 행·파일 핸들·로컬 경로·인증 정보는 포함하지 않는다.

### 4.2. v1 타입 정의

아래 타입은 `model.ts`에 둘 영속 계약의 기준이다. 필드 이름은 바꿀 수 있지만 판별자·필수 여부·값 표현은 유지한다. 모든 시각은 오프셋을 포함한 ISO 문자열이다. 셀 값과 비교 상수의 수치는 10진 문자열이고, revision·위치·상한 같은 메타데이터는 JavaScript 정수다.

```ts
type CsvColumnType =
  | 'text' | 'integer' | 'decimal' | 'boolean'
  | 'date' | 'datetime' | 'select' | 'multiSelect'

interface CsvColumnBase {
  id: string
  sourceIndex: number            // 0부터 시작하는 원래 위치
  sourceHeader: string | null    // 헤더 없음이면 null
  label: string
  typeSource: 'inferred' | 'user'
  nullMarkers: string[]          // 결측 표식. 정확히 일치할 때만 적용
  allowSurroundingSpace: boolean // text 외 타입에서 앞뒤 공백 허용
}

type CsvColumnDefinition = CsvColumnBase & (
  | { type: 'text'; parse: Record<string, never>; display: CsvTextDisplay }
  | { type: 'integer'; parse: CsvIntegerParse; display: CsvNumberDisplay }
  | { type: 'decimal'; parse: CsvDecimalParse; display: CsvNumberDisplay }
  | { type: 'boolean'; parse: CsvBooleanParse; display: CsvBooleanDisplay }
  | { type: 'date'; parse: CsvDateParse; display: CsvDateDisplay }
  | { type: 'datetime'; parse: CsvDateTimeParse; display: CsvDateTimeDisplay }
  | { type: 'select'; parse: CsvSelectParse; display: CsvSelectDisplay }
  | { type: 'multiSelect'; parse: CsvMultiSelectParse; display: CsvSelectDisplay }
)

interface CsvSelectOption { id: string; raw: string; label: string; color: CsvOptionColor }

type CsvLayout =
  | { kind: 'grid' }
  | { kind: 'list'; titleColumnId: string; subtitleColumnId: string | null;
      trailingColumnId: string | null; colorColumnId: string | null; groupColumnId: string | null }
  | { kind: 'gallery'; titleColumnId: string; coverColumnId: string | null }
  | { kind: 'kanban'; groupColumnId: string; hiddenGroupKeys: string[] }
  | { kind: 'calendar'; dateColumnId: string }

interface CsvViewDefinition {
  id: string
  name: string
  layout: CsvLayout
  columnIds: string[]                         // 표시 순서
  filter: CsvFilter | null
  sort: CsvSort[]
  displayOverrides: Record<string, CsvDisplayOverride>  // 키는 컬럼 ID
  updatedAt: string
}

type CsvFilter =
  | { op: 'and' | 'or'; children: CsvFilter[] }
  | { op: 'not'; child: CsvFilter }
  | { op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'; columnId: string; value: string }
  | { op: 'contains' | 'startsWith'; columnId: string; value: string; ignoreCase: 'none' | 'ascii' }
  | { op: 'in' | 'notIn' | 'hasAny' | 'hasAll'; columnId: string; optionIds: string[] }
  | { op: 'is' | 'isNot'; columnId: string; state: CsvCellState }

interface CsvSort { columnId: string; direction: 'asc' | 'desc' }

type CsvCellState = 'value' | 'empty' | 'missing' | 'null-marker' | 'invalid'

type CsvCell =
  | { state: 'value'; raw: string; value: string | boolean | string[] }
  | { state: 'empty' }
  | { state: 'missing' }
  | { state: 'null-marker'; raw: string }
  | { state: 'invalid'; raw: string; code: CsvInvalidCode }
```

입력 규칙·표시 타입은 다음과 같다. 필드는 [§5.3](#53-기본-타입과-기본-해석-규칙) 표의 항목과 1:1이고, 모든 필드를 필수로 저장한다. 주석의 값이 기본값이다.

```ts
type CsvThousandsSeparator = ',' | '.' | ' ' | "'"

interface CsvIntegerParse {
  allowPlusSign: boolean                         // false
  thousandsSeparator: CsvThousandsSeparator | null  // null
  allowFullWidthDigits: boolean                  // false
  allowExponent: boolean                         // false. 결과가 정수가 아니면 syntax 실패
}

interface CsvDecimalParse {
  precision: number                              // 38
  scale: number                                  // 표본 정상 값의 최대 소수 자릿수
  decimalSeparator: '.' | ','                    // '.'
  thousandsSeparator: CsvThousandsSeparator | null  // null. decimalSeparator와 같으면 검증 실패
  currencySymbols: string[]                      // []. 앞 또는 뒤의 한 기호만 제거
  percentInput: 'reject' | 'strip-sign' | 'divide-by-100'  // 'reject'
  allowBareFraction: boolean                     // false. `.5`, `5.`
  allowExponent: boolean                         // false
}

interface CsvBooleanParse {
  trueValues: string[]                           // ['true']
  falseValues: string[]                          // ['false']. 두 목록은 비어 있지 않고 서로소
  ignoreCase: 'none' | 'ascii'                   // 'ascii'
}

type CsvDateFormat =
  | 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'YYYY.MM.DD' | 'YYYYMMDD'
  | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD.MM.YYYY'

interface CsvDateParse {
  formats: CsvDateFormat[]                       // ['YYYY-MM-DD']. DD/MM과 MM/DD를 함께 둘 수 없음
}

interface CsvDateTimeParse {
  offset: { kind: 'require' } | { kind: 'assume'; timeZone: string }  // require. timeZone은 IANA 이름
  allowTwelveHour: boolean                       // false
  allowDateOnly: boolean                         // false. true면 offset이 assume이어야 하고 00:00으로 해석
}

interface CsvSelectParse {
  options: CsvSelectOption[]                     // 표본 등장 순서
  matching: 'exact' | 'ascii-case-trim'          // 'exact'
  closed: boolean                                // false
}

interface CsvMultiSelectParse extends CsvSelectParse {
  separator: string                              // 기본값 없음. 비어 있지 않은 문자열 필수
  duplicates: 'keep' | 'collapse'                // 'keep'
}

type CsvOptionColor =
  | 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
  // 이름만 저장하고 실제 색은 앱 테마 토큰으로 정한다

interface CsvTextDisplay { as: 'plain' | 'link' | 'image' }   // 'plain'. 링크·이미지는 기존 외부 자원 정책을 따름

interface CsvNumberDisplay {
  grouping: boolean                              // true
  fractionDigits: 'scale' | number               // 'scale'. 정수는 0으로 저장
  style: { kind: 'plain' } | { kind: 'currency'; symbol: string; position: 'prefix' | 'suffix' } | { kind: 'percent' }
                                                 // plain. percent는 저장값 뒤에 %만 붙이고 100을 곱하지 않음
  negative: 'minus' | 'parentheses'              // 'minus'
}

interface CsvBooleanDisplay { as: 'check' | 'text'; trueLabel: string; falseLabel: string }  // check, '참', '거짓'
interface CsvDateDisplay { pattern: 'iso' | 'ko-long' | 'ko-short' }  // 'iso'. ko-long `2026년 11월 16일`, ko-short `11월 16일`
interface CsvDateTimeDisplay { zone: { kind: 'source' } | { kind: 'utc' } | { kind: 'fixed'; timeZone: string }; seconds: boolean }
                                                 // source, true
interface CsvSelectDisplay { as: 'chip' | 'text' }  // 'chip'

type CsvColumnDisplay = CsvColumnDefinition['display']

interface CsvDisplayOverride {
  label: string | null                           // 뷰에서만 쓰는 표시명
  display: CsvColumnDisplay | null               // null이면 파일 기본값. 컬럼 타입과 같은 모양이어야 함
  stateText: Partial<Record<'empty' | 'missing' | 'null-marker', string>>  // 표시 전용
}

type CsvInvalidCode =
  | 'syntax' | 'whitespace' | 'range' | 'scale' | 'thousands'
  | 'date' | 'offset-required' | 'dst-gap' | 'dst-overlap'
  | 'closed-option' | 'empty-item'
```

- `integer`의 최대 자릿수와 `datetime` 소수 초 자릿수는 [부록 A](#부록-a-정책-상수)의 상수이며 컬럼에 저장하지 않는다.
- 레이아웃이 참조하는 컬럼은 `columnIds`에 없어도 된다. 조회 프로젝션은 표시·필터·정렬·레이아웃 참조의 합집합이다.
- 리스트의 `groupColumnId`가 있으면 저장된 `sort` 앞에 그 컬럼의 오름차순을 암묵적으로 붙인다. 같은 컬럼이 `sort`에 있으면 그 방향을 사용한다.
- `CsvCell.value`는 정수·소수·날짜·날짜·시간이면 정규화한 문자열, boolean이면 boolean, select면 옵션 ID 또는 미등록 원문, multiSelect면 그 배열이다.
- `CsvInvalidCode`는 위 고정 목록이고, 화면 문구는 코드에서 만든다. `whitespace`는 앞뒤 공백을 허용하지 않은 컬럼의 공백, `dst-gap / dst-overlap`은 `assume` 시간대에서 존재하지 않거나 두 번 나오는 시각이다.

### 4.3. 검증

`validate.ts`에는 `validateColumnDefinition`, `validateViewDefinition`, `validateViewBundle`, `validateBackup`을 둔다. 입력을 `unknown`으로 받고 타입·길이·유한한 수·ID 참조·옵션 조합을 확인한다. 상한은 [부록 A](#부록-a-정책-상수)에 모은다. 파일당 뷰 상한은 원본 CSV의 컬럼 수를 제한한다는 뜻이 아니다. 상한 초과·알 수 없는 버전은 부분 저장 없이 실패시킨다.

```ts
type CsvValidationResult<T> =
  | { ok: true; value: T; filledDefaults: CsvFilledDefault[] }
  | { ok: false; issues: CsvValidationIssue[] }

interface CsvFilledDefault { path: string }      // JSON Pointer. 가져오기 미리보기에 표시
interface CsvValidationIssue { path: string; code: CsvValidationCode; detail: string | null }

type CsvValidationCode =
  | 'type' | 'required' | 'unknown-version' | 'limit'
  | 'duplicate-id' | 'unknown-column' | 'layout-column-type'
  | 'operator-not-allowed' | 'constant-invalid' | 'option-conflict' | 'sort-not-allowed'
```

- 검증은 처음 실패에서 멈추지 않고 모든 문제를 모아 반환한다. 단, 상한 초과는 그 아래를 더 읽지 않는다.
- `filledDefaults`는 선택 필드를 채웠을 때만 생긴다. 앱 안에서 만든 설정을 저장할 때는 항상 빈 배열이어야 하며, 테스트로 확인한다.
- `layout-column-type`은 레이아웃 연결 규칙(리스트 색은 select·boolean, 칸반은 select·boolean, 캘린더는 date·datetime, 갤러리 표지는 `as: 'image'`인 text)을 어겼을 때다.
- `sort-not-allowed`는 multiSelect를 정렬 키로 쓴 경우다. 리스트 묶음 컬럼으로 multiSelect를 고른 경우도 같은 코드로 거부한다.

### 4.4. 저장 레코드와 JSON 봉투

파일 설정과 뷰는 `model.ts`의 아래 타입으로 저장·내보낸다. IndexedDB 레코드는 [§7.1](#71-저장소-이행)의 저장소와 1:1이다.

```ts
interface CsvParserSettings {
  encoding: string                               // WHATWG 인코딩 이름. 'utf-8'
  bom: 'auto' | 'present' | 'absent'
  hasHeader: boolean
  delimiter: string                              // 한 글자
  quote: '"' | "'" | null
  escape: 'double-quote' | 'backslash'
  newline: 'auto' | 'lf' | 'crlf' | 'cr'
}

interface CsvFileProfile {
  schemaVersion: 1
  fileId: string
  parser: CsvParserSettings
  columns: CsvColumnDefinition[]                 // sourceIndex 오름차순, 원본 컬럼 수와 같은 길이
  schemaRevision: number
  profileRevision: number
  viewOrder: string[]
  updatedAt: string
}

interface CsvFileIdentity {
  name: string
  size: number
  lastModified: number
  headerDigest: string | null                    // 헤더 원문 SHA-256 hex
  sampleDigest: { algorithm: 'SHA-256'; offset: number; length: number; digest: string } | null
  folder: { rootId: string; relativePath: string } | null
}

// IndexedDB 레코드
interface CsvFileRecord {                        // csvFiles, key: fileId
  fileId: string
  profile: CsvFileProfile
  identity: CsvFileIdentity
  handle: FileSystemFileHandle | null
  createdAt: string
  lastOpenedAt: string
}

interface CsvViewRecord {                        // csvViews, key: [fileId, viewId], index by-file: fileId
  fileId: string
  viewId: string
  view: CsvViewDefinition
}

interface CsvViewSelectionRecord {               // csvViewSelections, key: documentId
  documentId: string
  fileId: string
  selection: CsvViewSelection
  updatedAt: string
}

interface CsvSessionRecord {                     // csvSessions, key: documentId. P4에서 사용
  documentId: string
  fileId: string
  sourceRevision: string
  name: string
  mimeType: string
  size: number
  mode: 'view' | 'source'
  openedAt: string
  lastEditedAt: string
  folderRef: { rootId: string; relativePath: string } | null
}

// 내보내기 JSON
interface CsvViewBundle {                        // 뷰 다운로드. 한 뷰 또는 파일의 모든 뷰
  kind: 'csv-view-bundle'
  schemaVersion: 1
  exportedAt: string
  appVersion: string                             // __APP_VERSION__
  source: { fileName: string; headers: (string | null)[]; columnCount: number }
  profile: Omit<CsvFileProfile, 'viewOrder'>
  viewOrder: string[]                            // views의 ID와 같은 집합
  views: CsvViewDefinition[]
}

interface CsvViewBackup {                        // 설정 화면의 전체 백업
  kind: 'csv-view-backup'
  schemaVersion: 1
  exportedAt: string
  appVersion: string
  profiles: Omit<CsvViewBundle, 'kind' | 'schemaVersion' | 'exportedAt' | 'appVersion'>[]
}
```

- 뷰 순서의 기준은 `CsvFileRecord.profile.viewOrder`다. `csvViews`에만 있고 순서에 없는 뷰는 손상으로 보고 순서 끝에 붙인 뒤 진단을 남긴다. 순서에만 있고 뷰가 없는 ID는 제거한다.
- 한 뷰 다운로드는 `views`와 `viewOrder`에 그 뷰 하나만 넣고, 실행에 필요한 `profile` 전체를 포함한다.
- 내보낸 `profile.fileId`는 참고값이다. 가져오기에서는 [§7.3](#73-다운로드가져오기)의 매핑을 거쳐 로컬 `fileId`로 바꾼다.
- 핸들은 IndexedDB에만 두고 JSON에 넣지 않는다. `CsvFileIdentity`도 JSON에 넣지 않는다.
- revision 계산은 `model.ts`의 `nextRevisions(prev, change)`가 맡는다. 컬럼 연결·타입·입력 규칙이 바뀌면 `schemaRevision`과 `profileRevision`을, 그 밖의 저장은 `profileRevision`만 1 올린다.

## 5. 컬럼 타이핑 구현

### 5.1. 원문과 해석 결과

여기서 셀 원문은 CSV 인용·이스케이프를 해제한 뒤 타입 변환 전의 문자열이다. 파일의 따옴표·BOM·개행까지 포함한 원본 바이트는 File/Blob 또는 기존 문서의 원문에 별도로 보존한다.

페이지에 포함한 셀에 대해서만 다음 상태를 만든다. 전체 파일의 모든 셀을 이 객체 형태로 미리 만들지 않는다.

| 상태 | 내용 |
| --- | --- |
| `value` | 원문과 타입에 맞게 정규화한 값 |
| `empty` | 실제로 존재하는 빈 문자열 |
| `missing` | 해당 레코드에 컬럼 자리가 없음 |
| `null-marker` | 사용자가 지정한 결측 표식과 일치. 원문은 유지 |
| `invalid` | 원문·오류 코드·실패 이유. `0 / false / empty`로 변환하지 않음 |

정수·소수의 교환 값은 정규화된 10진 문자열로, 날짜는 `YYYY-MM-DD`, 날짜·시간은 오프셋을 확정한 ISO 문자열로 표현한다. JavaScript Number나 Date 객체로 강제 변환해 JSON·Arrow 왕복 중 정밀도·날짜가 달라지게 하지 않는다.

### 5.2. 타입별 규칙

| 타입 | 구현 규칙 |
| --- | --- |
| `text` | 원래 문자열 보존. trim·대소문자 변경·Unicode 정규화를 기본 동작으로 넣지 않음 |
| `integer` | 부호 있는 10진 정수 문법을 검사. 공통 정확도 범위는 최대 38자리로 두고 SQL의 정확한 정수/DECIMAL 표현과 맞춤. 초과는 실패로 표시하고 텍스트 타입 선택 가능 |
| `decimal` | 소수점·천 단위 구분자의 위치까지 검증한 뒤 해석. `precision / scale`을 명시하고 범위를 넘는 자릿수를 자동 반올림하지 않음. 메모리 비교도 정수 계수와 scale 또는 검증한 정확 소수 연산을 사용 |
| `boolean` | 명시한 참/거짓 원문 대응표 사용. `Boolean('false')` 같은 진리값 변환 금지 |
| `date` | 지원하는 입력 형식을 화이트리스트로 정하고 윤년·실제 날짜 검증. 브라우저 로컬 시간대로 바꾸지 않음 |
| `datetime` | 오프셋이 있는 입력을 우선 지원. 오프셋 없는 입력은 명시한 시간대 규칙으로만 해석. DST의 존재하지 않거나 중복되는 시각은 자동 선택하지 않음 |
| `select` | 원문 대응값으로 옵션 연결. 표본에 없던 정상 값은 기본적으로 원문 레이블로 표시하며 조회에서 누락하지 않음. 폐쇄형 선택지를 지정한 경우만 미등록 값을 실패로 처리 |
| `multiSelect` | CSV 필드 해제 후 별도 목록 구분 규칙 적용. 규칙이 없으면 쉼표를 자동 분해하지 않음. 같은 옵션의 반복 처리도 명시 |

정확한 정수·소수 처리와 날짜 형식·시간대 해석은 두 어댑터에 같은 의미를 제공해야 한다. SQL의 `TRY_CAST`만으로 입력 문법 검사를 대신하지 않는다. 소수 반올림·공백 허용·날짜 보정 등 엔진의 관대한 해석을 앞단 검사로 차단한다. `NaN / Infinity`는 기본 숫자 값으로 허용하지 않는다.

천 단위 구분자는 무조건 삭제하지 않고 배치를 검사한다. 통화·퍼센트 표시와 통화 기호 제거·100분율 변환은 서로 다른 설정이다. 퍼센트 표시만 선택해 저장값을 100으로 나누지 않는다. 표시 설정은 파일 기본값 위에 뷰별로 재정의할 수 있지만 타입과 입력 해석은 파일 공통으로 유지한다.

### 5.3. 기본 타입과 기본 해석 규칙

타입을 정하지 않았거나 사용자가 타입만 고르고 입력 규칙을 건드리지 않았을 때의 동작을 고정한다. 기본값은 관대하게 받아들이는 쪽이 아니라 **틀리게 해석할 수 없는 가장 좁은 규칙**으로 둔다. 넓은 형식은 표본 추천에서 후보로 제시하고 사용자가 명시적으로 켠다.

**기본 타입**

- 스키마에 없는 컬럼, 추천이 자동 선택 조건(§5.4)을 만족하지 못한 컬럼, 헤더만 있고 표본이 없는 컬럼은 `text`, `typeSource: 'inferred'`다.
- 짧은 레코드로 생긴 자리는 타입과 관계없이 `missing`이고, 실제 빈 필드는 `empty`다. 두 상태는 어떤 기본 규칙으로도 값으로 바뀌지 않는다.

**타입별 기본 입력 규칙**

| 타입 | 기본으로 받는 원문 | 기본으로 받지 않는 원문 (사용자가 켤 수 있음) |
| --- | --- | --- |
| 공통 | 원문 그대로. 결측 표식 없음 | 앞뒤 공백(`allowSurroundingSpace`), `NULL`·`N/A`·`-` 등 결측 표식 |
| `text` | 모든 문자열. trim·대소문자·Unicode 정규화 없음 | 해당 없음 |
| `integer` | `-`가 붙을 수 있는 ASCII 숫자, 최대 38자리. 앞자리 0 허용 | `+` 부호, 천 단위 구분자, 전각 숫자, 지수 표기 |
| `decimal` | `-`, 정수부, `.`, 소수부. 정밀도 38, scale은 아래 규칙 | `,` 소수점, 천 단위 구분자, 통화 기호 제거, 퍼센트 입력 변환, `.5`·`5.` 형태, 지수 표기 |
| `boolean` | `true` / `false`, ASCII 대소문자 무시 | `1/0`, `Y/N`, `yes/no`, `예/아니오` 등 다른 대응표 |
| `date` | `YYYY-MM-DD` | `YYYY/MM/DD`, `YYYY.MM.DD`, `YYYYMMDD`, 일·월 순서가 모호한 형식 |
| `datetime` | RFC 3339 날짜·시간, 구분자 `T` 또는 공백, 오프셋 `Z` 또는 `±HH:MM` 필수, 초·소수 초 최대 6자리 선택 | 오프셋 없는 입력(시간대 지정 필요), 12시간제, 날짜만 있는 값 |
| `select` | 선택지 `raw`와 정확히 일치. 미등록 값은 원문 레이블의 정상 값 | 대소문자·공백 무시 대응, 폐쇄형 선택지 |
| `multiSelect` | 기본 구분자 없음. 구분자를 지정해야 타입을 적용할 수 있음 | 해당 없음 |

- `decimal`의 scale을 사용자가 지정하지 않으면 표본 정상 값의 최대 소수 자릿수를 사용한다. 이후 그보다 긴 소수부는 반올림하지 않고 `scale` 실패로 표시한다.
- `integer` 앞자리 0은 받아들이되 정규화 값에서는 제거한다. 원문은 유지하며, 타입 편집 미리보기에서 앞자리 0이 사라지는 행 수를 경고한다. `-0`은 `0`으로 정규화한다.
- `multiSelect` 구분자를 지정하면 각 항목은 trim하지 않고 비교한다. 빈 항목(`a;;b`)은 `empty-item` 실패이고, 같은 항목의 반복은 기본으로 유지해 표시하며 `hasAny / hasAll` 비교에서는 한 번으로 센다.
- `select` 선택지 색은 표본 등장 순서로 앱 팔레트를 순환해 배정한다. 이후 등장 순서가 바뀌어도 저장된 색을 다시 배정하지 않는다.

**기본 표시**

| 타입 | 기본 표시 |
| --- | --- |
| `integer`·`decimal` | 정규화 값의 천 단위 쉼표. scale만큼 소수부 유지. 통화·퍼센트 기호 없음. 오른쪽 정렬 |
| `boolean` | 체크 표시. 텍스트 표시를 선택하면 `참 / 거짓` |
| `date` | `YYYY-MM-DD` |
| `datetime` | 원문 오프셋 그대로. 브라우저 로컬 시간대로 바꾸지 않음 |
| `select`·`multiSelect` | 선택지 레이블 칩. 미등록 값은 점선 칩 |
| 상태 | `빈 값`·`누락`·결측 표식 원문·해석 실패 원문을 서로 다른 모양으로 표시 |

**기본값의 저장과 변경**

- 컬럼 설정을 저장할 때 위 기본값을 포함한 모든 입력 규칙 필드를 JSON에 명시적으로 기록한다. 코드의 암묵적 기본값에 기대어 생략하지 않는다.
- 앱의 기본 규칙이 나중에 바뀌어도 이미 저장한 설정에는 소급하지 않는다. 기본값 변경은 새로 만드는 컬럼 설정에만 적용한다.
- 가져온 v1 JSON에 선택 필드가 빠져 있으면 이 표의 기본값으로 채우되, 가져오기 미리보기에서 `기본값으로 채움`을 필드별로 표시한다. 필수 필드가 빠지면 실패시킨다.
- 추천으로 정한 타입도 저장한 뒤에는 자동으로 다시 추론하지 않는다. 원본 세대가 바뀌면 `다시 추천`을 제안만 하며, 사용자가 적용해야 바뀐다.

**빈 값 대체값**

- v1은 빈 값·누락·결측 표식을 다른 값으로 채우는 컬럼 기본값을 지원하지 않는다. 필터·정렬·집계는 항상 원래 상태로 처리한다.
- 뷰의 `displayOverrides`에 빈 상태용 표시 문자열을 둘 수 있다. 이는 화면 표시만 바꾸며, 조회 결과·내보내기·CSV 원문에는 영향을 주지 않는다.

### 5.4. 표본 추천과 타입 편집

1. 처음 200개 논리 레코드와 최대 8 MiB의 바이트 예산 중 먼저 도달한 범위에서 표본을 만든다. 헤더·빈 값·누락은 타입 일치 비율의 유효 표본에서 구분한다.
2. 원문 예시, 유효 표본 수, 후보별 일치 수, 오류 예시, EOF 도달 여부를 반환한다. 예: `표본 200개 중 198개 일치`. 전체 검증으로 표시하지 않는다.
3. 표본이 부족하거나 혼합 타입이면 텍스트를 기본으로 둔다. 자동 선택의 기본 조건은 유효 표본 20개 이상 또는 EOF 확인, 그리고 해당 입력 규칙에 모두 일치하는 것이다. 이보다 약한 후보는 추천만 한다.
4. 앞자리 0이 있는 정수형 코드, 긴 식별자, 모호한 날짜, 숫자와 불리언 모두 가능한 `0 / 1`은 자동 확정하지 않는다. 헤더명은 보조 근거로만 사용한다.
5. 사용자가 적용한 타입은 `typeSource: 'user'`로 고정한다. 이후 표본 밖의 예외는 실패로 표시하며 타입을 몰래 바꾸지 않는다. 단일/다중 선택지는 제한된 후보만 추천한다.

타입 편집은 초안에서 원문·해석값·실패 예시를 먼저 보여 준다. 적용 시 영향을 받는 뷰를 표시하고 파일 스키마와 revision을 한 트랜잭션으로 저장한다. 저장 성공 뒤 활성 조회를 재실행하며, 실패 시 기존 스키마와 결과를 유지한다. 표본 미리보기·취소는 영속 설정을 바꾸지 않는다.

### 5.5. 비교·필터·집계

타입별로 허용하는 필터 연산자는 다음과 같다. 목록에 없는 조합은 검증에서 거부한다. 비교 상수는 해당 컬럼의 입력 규칙으로 해석하며, 해석에 실패한 상수는 조건 저장을 막는다.

| 타입 | 허용 연산자 | 정렬 의미 |
| --- | --- | --- |
| `text` | `eq neq contains startsWith lt lte gt gte is isNot` | Unicode 코드포인트, 대소문자 구분 |
| `integer`·`decimal` | `eq neq lt lte gt gte is isNot` | 정확한 수치 |
| `boolean` | `eq neq is isNot` | `false` → `true` |
| `date` | `eq neq lt lte gt gte is isNot` | 달력 순서 |
| `datetime` | `eq neq lt lte gt gte is isNot` | UTC 순간 기준. 같은 순간은 레코드 번호 |
| `select` | `in notIn is isNot` | 선택지 순서, 그 뒤 미등록 값의 코드포인트 순서 |
| `multiSelect` | `hasAny hasAll is isNot` | v1에서는 정렬 키로 사용할 수 없음 |

- `ignoreCase: 'ascii'`는 A–Z만 접는다. 로케일 대소문자 변환은 어댑터 사이에서 결과가 달라지므로 사용하지 않는다.
- `neq`·`notIn`도 3값 논리를 따른다. 빈 값·실패 행은 `상태 ≠ 완료`에서 제외되며, 포함하려면 `is` 조건을 `or`로 붙인다. 빌더는 이 차이를 조건 옆에 설명한다.

- 수치 비교는 정확한 수치로, 날짜 비교는 지정한 날짜 의미로 수행한다. 원문 `2 / 10`을 숫자로 지정한 경우 `2, 10` 순서가 되어야 한다.
- 텍스트 정렬의 초기 공통 기준은 대소문자를 구별하는 Unicode 코드포인트 순서다. 메모리·SQL 어댑터가 서로 다른 로케일 정렬을 사용하지 않게 한다. 기존 편집 표의 정렬 의미는 이번 작업으로 바꾸지 않는다.
- 값 정렬의 오름/내림과 별개로 `value → empty → missing → null-marker → invalid` 순서를 기본으로 사용한다. 동률은 원본 레코드 번호로 정한다.
- 일반 비교에서 비정상·빈 값은 SQL과 같은 미확정 결과로 취급하고, AND/OR/NOT도 같은 3값 논리를 적용한다. 최종 필터는 참인 행만 통과시킨다. 상태 검사 연산자는 명시적인 참/거짓을 반환한다.
- 집계는 정상 해석값만 사용하고 제외 상태별 건수를 반환한다. 건수의 범위를 `sample / loaded / query / file`로 구분하고, 완료하지 않은 파일 전체 검증을 정확한 건수로 표시하지 않는다.

### 5.6. 순수 함수 API

P1에서 구현할 순수 함수다. 브라우저 API·IndexedDB·Worker에 의존하지 않고, 같은 입력에 같은 결과를 낸다. 메모리 어댑터·SQL 생성·화면이 모두 이 함수를 의미의 기준으로 삼는다.

```ts
// typing.ts
function createDefaultColumn(
  type: CsvColumnType, base: CsvColumnBase, sample: CsvColumnSample | null,
): CsvColumnDefinition                           // §5.3 기본값으로 모든 필드를 채움. multiSelect는 separator를 받아야 하므로 오류
function parseCell(column: CsvColumnDefinition, raw: string | undefined): CsvCell
                                                 // undefined는 짧은 레코드의 누락
function parseConstant(column: CsvColumnDefinition, value: string): CsvCell
                                                 // 필터 상수. value 상태가 아니면 constant-invalid

// format.ts
interface CsvFormattedCell {
  text: string
  tone: 'value' | 'unmatched' | 'empty' | 'missing' | 'null-marker' | 'invalid'
  align: 'start' | 'end'
  optionColor: CsvOptionColor | null
  chips: { text: string; color: CsvOptionColor | null; unmatched: boolean }[] | null
}
function resolveDisplay(column: CsvColumnDefinition, override: CsvDisplayOverride | undefined): CsvColumnDisplay
function formatCell(column: CsvColumnDefinition, display: CsvColumnDisplay, cell: CsvCell,
  stateText: CsvDisplayOverride['stateText']): CsvFormattedCell

// query.ts
function compareForSort(column: CsvColumnDefinition, direction: 'asc' | 'desc', a: CsvCell, b: CsvCell): -1 | 0 | 1
function effectiveSort(view: CsvViewDefinition): CsvSort[]   // 리스트 묶음 컬럼을 앞에 붙인 정렬
function evaluateFilter(filter: CsvFilter, columns: ReadonlyMap<string, CsvColumnDefinition>,
  cellOf: (columnId: string) => CsvCell): boolean
function projectColumns(view: CsvViewDefinition): string[]  // 표시·필터·정렬·레이아웃 참조의 합집합, 표시 순서 우선

// inference.ts
interface CsvSample {
  header: (string | null)[]
  records: string[][]                            // 해제한 셀 원문. 짧은 레코드는 짧은 배열
  firstRecordNo: 1
  reachedEof: boolean
  bytesRead: number
  stoppedBy: 'records' | 'bytes' | 'eof'
}
type CsvColumnSample = { sourceIndex: number; raws: (string | undefined)[] }  // 표본에서 한 컬럼만 뽑은 것
function recommendColumns(sample: CsvSample, existing: CsvColumnDefinition[] | null): CsvColumnRecommendation[]
function previewColumn(sample: CsvSample, draft: CsvColumnDefinition): CsvTypePreview

interface CsvColumnRecommendation {
  sourceIndex: number
  counts: Record<CsvCellState, number>           // text 기준 상태 건수
  candidates: CsvTypeCandidate[]                 // 추천순
  selected: CsvColumnDefinition                  // 자동 선택 조건을 못 넘으면 text
}

interface CsvTypeCandidate {
  column: CsvColumnDefinition                    // 제안 입력 규칙까지 채운 설정
  matched: number
  failed: number
  failures: { recordNo: number; raw: string; code: CsvInvalidCode }[]  // 최대 5개
  autoSelectable: boolean
  warnings: CsvInferenceWarning[]
}

type CsvInferenceWarning = 'leading-zero' | 'ambiguous-date' | 'zero-one' | 'long-identifier' | 'few-samples'

interface CsvTypePreview {
  rows: { recordNo: number; raw: string | undefined; cell: CsvCell }[]   // 실패 행 우선, 최대 50개
  counts: Record<CsvCellState, number>
  leadingZeroLoss: number                        // 정규화로 앞자리 0이 사라지는 행 수
  scaleUsed: number | null                       // decimal에서 scale을 표본으로 정했을 때
}

// validate.ts
function findAffectedViews(profile: CsvFileProfile, views: CsvViewDefinition[],
  draft: CsvColumnDefinition): { viewId: string; reasons: CsvValidationCode[] }[]
```

`parseCell`은 다음 순서로 판정한다. 순서를 바꾸면 결측 표식과 공백 처리가 어댑터마다 달라지므로 SQL 생성도 같은 순서를 따른다.

1. `raw === undefined`이면 `missing`.
2. `raw === ''`이면 `empty`. 결측 표식에 빈 문자열은 넣을 수 없다.
3. `raw`가 `nullMarkers` 중 하나와 정확히 같으면 `null-marker`. 공백을 다듬기 전에 비교한다.
4. text가 아니고 `allowSurroundingSpace`가 false인데 앞뒤 공백이 있으면 `invalid / whitespace`. true면 ASCII 공백과 탭만 다듬는다.
5. 타입별 입력 규칙으로 해석한다. 다듬은 결과가 빈 문자열이면 `invalid / syntax`다.

- `compareForSort`는 정상 값끼리만 방향을 적용한다. 정상 값이 아닌 셀은 방향과 관계없이 §5.5의 상태 순서로 뒤에 둔다. 같은 상태끼리는 0을 반환하고, 동률은 호출자가 레코드 번호로 정한다.
- `evaluateFilter`의 내부 결과는 `true / false / unknown`의 3값이고, 최상위에서 `true`만 통과시킨다.
- `formatCell`은 HTML을 만들지 않는다. 화면 컴포넌트가 `tone`·`chips`로 모양을 정한다.
- 이 함수들의 공통 fixture는 `tests/fixtures/csv-views/`에 두고, P4의 SQL 어댑터도 같은 fixture로 검증한다.

## 6. 파일 식별·수명·입력 경로

### 6.1. 영속 ID와 원본 세대

`documentId`는 열린 세션, `fileId`는 영속적인 파일 연결에 사용한다. 동일 파일을 여러 세션에서 열어도 뷰 설정은 공유하고, 현재 선택·미저장 작업본·쿼리는 세션별로 분리한다.

1. 접근 가능한 파일 핸들 후보에는 `isSameEntry()`를 사용한다. 폴더 파일은 저장한 루트 식별자와 상대 경로도 확인한다. 경로만으로 바뀐 파일 내용을 같다고 판단하지 않는다.
2. 핸들이 없으면 이름·크기·수정 시각·헤더와 제한된 바이트의 SHA-256 지문으로 후보를 찾는다. 서명 방식과 표본 위치·길이를 함께 저장한다.
3. 같은 지문은 후보 근거다. 충돌·여러 후보·근거 부족 시 연결 대상을 선택하거나 새 `fileId`를 생성한다. 이름 하나만으로 자동 연결하거나 전체 파일 해시를 선행하지 않는다.
4. 원본 세대는 문자열 토큰으로 둔다. 메모리 작업본은 `documentId + document.revision`, 파일 기반은 원본 연결 세대·검사한 파일 정보로 구분한다. 서로 다른 미저장 세션의 revision 숫자가 같아도 캐시가 섞이지 않아야 한다.

File/Blob은 열린 세션의 일관된 snapshot으로 사용한다. 핸들에서 새 파일을 얻어 갱신할 때 크기·수정 시각·부분 지문을 다시 확인한다. 같은 파일 객체를 유지한 채 내용이 바뀌어 읽기 오류가 나면 최신 파일로 자동 혼합하지 말고 재열기를 안내한다. 일부 지문만으로 파일 전체의 불변성을 증명했다고 표시하지 않는다.

### 6.2. 전체 읽기 전 분기

`openCsv.ts`에 공통 입력 서비스를 만들고 다음 순서를 따른다.

```text
PickedFile/폴더 파일 참조
  → 형식 후보·입력 출처·크기·현재 기능 가능 여부 판정
  → 기존 한도 안의 메모리 경로 또는 검증된 파일 기반 CSV 경로
  → 파일 ID 연결·표본/스키마 준비
  → WorkspaceDocument 등록
```

파일 선택·드롭·폴더 열기·OS 파일 실행이 같은 서비스로 들어오게 한다. 기존 CSV 판별과 MIME 우선 정책을 재사용하고, 이름만 CSV인 바이너리를 큰 CSV로 받아들이지 않는다. 표본만으로 파일 끝까지 정상임을 보장하지 않는다.

[입력 정책](../src/domain/inputPolicy.ts)의 현재 데스크톱 50 MiB·모바일 20 MiB는 메모리 경로의 상한으로 유지한다. 파일 참조를 받는 [browserFiles](../src/platform/browserFiles.ts)의 `readFileReference`와 [folderAccess](../src/platform/folderAccess.ts)의 `readFolderFile`도 새 정책을 사용할 수 있도록 호출 목적을 명시한다. 이미지·Markdown 참조·일반 파일 등 다른 소비자의 한도를 CSV 때문에 풀지 않는다. `readPickedFileBytes`와 메모리 문서 생성 직전에는 기존 한도를 다시 검사한다.

기술 검증 전에는 새 경로를 개발용 기능 설정으로 두고 전역 한도를 올리지 않는다. 검증 후 기기별 `maxFileBackedCsvBytes`와 조회 예산을 상수로 정한다. 시험한 1 GiB를 자동으로 지원 한도로 간주하지 않는다. 전체 버퍼가 이미 만들어진 확장·첨부·공유 입력을 큰 파일 부분 읽기 지원으로 표시하지 않는다.

### 6.3. 부분 표본과 원본 범위 읽기

- 1 MiB 청크부터 읽고 표본·진단에 필요한 범위에서 최대 8 MiB까지 확장한다. 청크 끝의 미완성 레코드는 다음 청크로 이어 처리한다.
- 줄바꿈 문자로 직접 나누지 않는다. 인용 필드 내부 개행·이스케이프 따옴표·청크 경계의 디코더 상태를 보존한다. Papa Parse의 문자열 cursor를 그대로 Blob의 바이트 오프셋으로 사용하지 않는다.
- 바이트 예산보다 큰 단일 레코드·셀은 명시적인 제한 오류로 처리한다. 무한 버퍼 확장이나 잘린 행의 정상 표시를 금지한다.
- UTF-8 직접 조회를 먼저 검증하고 기존 지원 인코딩도 유지한다. 직접 조회가 어려운 인코딩은 스트리밍 디코딩과 UTF-8 OPFS 임시 파일로 연결한다. 이 변환에 전체 읽기가 필요하면 표본 표시와 구분하고 준비 전 결과를 완전한 조회로 표시하지 않는다.
- 파일 기반 `원본`은 읽은 바이트 범위를 표시하는 전용 가상화 읽기 화면이다. 인코딩의 문자 경계와 재시작 위치를 관리하고 전체 Monaco 모델을 만들지 않는다. 임의 위치 이동도 인코딩 경계에서 재개한다.

## 7. IndexedDB·OPFS·JSON 이동

### 7.1. 저장소 이행

현재 IndexedDB v3에 다음 저장소를 추가해 v4로 올린다. 구현 시작 시 이미 더 높은 버전이면 당시 버전을 기준으로 추가한다. 기존 문서 레코드의 `schemaVersion: 3`은 별개이며 신규 저장소 추가만으로 기존 payload를 재직렬화하지 않는다.

| 저장소 | 키·내용 |
| --- | --- |
| `csvFiles` | `fileId`. 원본 후보 정보·허용된 핸들·파싱/컬럼 스키마·schema/profile revision·뷰 순서 |
| `csvViews` | `[fileId, viewId]`, `by-file` 인덱스. 개별 뷰 설정 |
| `csvSessions` | `documentId`. 파일 기반 CSV의 작은 복구 요약·원본 연결 참조. 본문과 행 배열 없음 |
| `csvViewSelections` | `documentId`. 선택 상태. 세션 삭제 때 정리 |

DB 열기와 upgrade는 [기존 저장소](../src/platform/storage.ts)가 소유한다. 신규 접근 모듈마다 다른 버전으로 같은 DB를 열지 않는다. `viewStorage.ts`는 동일한 DB 접근 계층을 사용한다.

파일 스키마·뷰·순서 변경은 관련 저장소를 묶은 한 트랜잭션으로 처리한다. 저장 직전 같은 트랜잭션에서 `profileRevision`을 비교해 다른 탭의 변경을 덮어쓰지 않는다. 충돌 시 현재 저장본과 편집 초안을 보존하고 다시 읽어 조정하게 한다. IndexedDB 트랜잭션 안에서 파일 읽기·네트워크·해시 계산을 기다리지 않는다.

`loadWorkspace()`는 기존 문서 요약과 `csvSessions` 요약을 읽고, 활성 파일 기반 CSV에서만 원본 연결을 복원한다. 복구 레코드마다 검증하고 한 파일의 실패로 나머지 복구를 멈추지 않는다. 핸들 재권한 요청은 사용자 동작에서 수행하고, 임시 Blob만 있었던 세션은 `needs-file`로 복원한다.

레코드 타입은 [§4.4](#44-저장-레코드와-json-봉투)를 따른다. `viewStorage.ts`와 `fileIdentity.ts`의 API는 다음과 같다.

```ts
interface CsvStoredProfile { record: CsvFileRecord; views: CsvViewDefinition[] }  // views는 viewOrder 순서

interface CsvProfileChange {
  profile: CsvFileProfile                        // nextRevisions로 계산한 새 revision 포함
  putViews: CsvViewDefinition[]
  deleteViewIds: string[]
}

type CsvSaveResult =
  | { ok: true; profileRevision: number; schemaRevision: number }
  | { ok: false; reason: 'conflict'; current: CsvStoredProfile }
  | { ok: false; reason: 'invalid'; issues: CsvValidationIssue[] }
  | { ok: false; reason: 'storage'; error: CsvStorageError }

interface CsvStorageError { code: 'quota' | 'blocked' | 'corrupt' | 'unavailable' | 'unknown'; message: string }

interface CsvViewStorage {
  loadProfile(fileId: string): Promise<CsvStoredProfile | null>
  listIdentities(): Promise<{ fileId: string; identity: CsvFileIdentity; handle: FileSystemFileHandle | null }[]>
  createProfile(record: CsvFileRecord, views: CsvViewDefinition[]): Promise<CsvSaveResult>
  commit(fileId: string, expectedProfileRevision: number, change: CsvProfileChange): Promise<CsvSaveResult>
  touch(fileId: string, identity: CsvFileIdentity, handle: FileSystemFileHandle | null): Promise<void>
  deleteProfile(fileId: string): Promise<void>
  loadSelection(documentId: string): Promise<CsvViewSelectionRecord | null>
  saveSelection(record: CsvViewSelectionRecord): Promise<void>
  deleteSelection(documentId: string): Promise<void>
  exportBackup(): Promise<CsvViewBackup>
}

// fileIdentity.ts
type CsvIdentityMatch =
  | { kind: 'same'; fileId: string; basis: 'handle' | 'folder-path' | 'digest' }
  | { kind: 'ambiguous'; candidates: { fileId: string; basis: 'digest' | 'name-size' }[] }
  | { kind: 'new' }

function readIdentity(file: Blob & { name: string; lastModified: number }, header: string | null,
  folder: CsvFileIdentity['folder']): Promise<CsvFileIdentity>
function matchIdentity(target: CsvFileIdentity, targetHandle: FileSystemFileHandle | null,
  known: Awaited<ReturnType<CsvViewStorage['listIdentities']>>): Promise<CsvIdentityMatch>
```

- `commit`은 한 readwrite 트랜잭션에서 저장된 `profileRevision`을 읽어 `expectedProfileRevision`과 비교한다. 다르면 아무것도 쓰지 않고 `conflict`와 현재 저장본을 돌려준다.
- `commit`은 쓰기 전에 `validate.ts`로 변경 결과 전체를 검증한다. 실패하면 `invalid`를 돌려주고 쓰지 않는다.
- `touch`는 `lastOpenedAt`·식별 정보·핸들만 바꾸며 revision을 올리지 않는다.
- `matchIdentity`가 `same`을 돌려주는 경우는 `isSameEntry()`가 참이거나, 폴더 루트·상대 경로·크기·수정 시각이 모두 같거나, 헤더와 표본 지문이 모두 같은 후보가 정확히 하나일 때다. 이름·크기만 같은 후보는 `ambiguous`로 돌려준다.
- 지문 계산(`readIdentity`)은 트랜잭션 밖에서 끝낸 뒤 결과만 저장한다.

### 7.2. 삭제 범위와 복구 설정

| 동작 | 삭제·보존 범위 |
| --- | --- |
| 문서 닫기·폴더 전환 | 해당 세션 요약·선택·실행 자원 정리. `csvFiles / csvViews` 보존 |
| `removeDocument`, `replaceWorkspace`, `clearDocuments` | 기존 문서와 새 세션을 목적에 맞게 정리. 파일별 뷰 설정은 보존 |
| 복구 비활성화 | 세션 복구 저장 중단·기존 세션 기록 제거. 별도 기능인 뷰 설정 보관은 유지하며 설정 화면에서 차이를 설명 |
| 뷰 삭제 | 해당 뷰와 순서 항목을 원자적으로 제거. 활성 뷰면 `보기`로 이동 |
| 캐시 정리 | 실행 중 작업을 먼저 중단하고 재생성 가능한 캐시만 제거. 원본과 뷰 설정 보존 |
| 기존 `clearAllData` | 새 IndexedDB 저장소와 해당 앱의 CSV OPFS 영역도 삭제. 남은 캐시가 있으면 실패를 숨기지 않음 |

일반 복구 쓰기는 [문서 쓰기 큐](../src/platform/documentWriteQueue.ts)에 맞춰 순서를 보장한다. 설정 쓰기도 파일별로 직렬화하되 다른 파일의 저장까지 막지 않는다. 복구가 꺼진 상태에서 큰 원본의 자동 영속 복사·분석 캐시를 만들지 않는다. 임시 변환 파일이 필요하면 수명을 세션으로 제한하고 중단·닫기·재시작 시 고아 파일을 정리한다.

OPFS 키는 앱 base·캐시 형식 버전·fileId·sourceRevision·파싱 서명·필요 시 schemaRevision을 포함한다. 원시 파싱 캐시와 타입 해석 캐시의 의존성을 구분한다. 임시 이름으로 생성한 뒤 성공한 파일만 manifest에 등록하고, 중단된 부분 파일은 정상 캐시로 재사용하지 않는다. 다른 탭의 배타 핸들 충돌은 캐시 없는 조회 또는 재시도로 처리한다.

저장 공간은 `navigator.storage.estimate()`로 확인한다. 자체 LRU는 재생성 가능한 캐시에만 적용하고 사용자 뷰를 자동 삭제하지 않는다. OPFS 미지원·용량 부족이면 설정 관리와 메모리 경로는 유지한다. 캐시가 꼭 필요한 조회만 구체적인 실패로 처리하며, 전체 원본을 메모리로 복사하는 대체 경로를 만들지 않는다.

### 7.3. 다운로드·가져오기

`뷰 다운로드`는 JSON 설정, 공통 헤더의 `다운로드`는 CSV 원본 또는 현재 작업본이다. 두 경로의 파일명·내용·동작을 분리한다. 권장 설정 파일명은 `원래이름.views.json`이며 일반 JSON 열기와 별도로 `뷰 가져오기`에서 처리한다.

가져오기는 `전체 검증 → 원본/컬럼 연결 미리보기 → 충돌 조정 → 한 트랜잭션 적용` 순서다. 내보낸 `fileId`를 신뢰해 다른 로컬 파일에 바로 연결하지 않는다. 고유 헤더와 예상 위치로 후보를 제시하고, 중복·불일치 컬럼은 사용자 매핑을 요구한다. ID 충돌의 기본 동작은 새 뷰 복제다.

가져온 설정의 빠진 선택 필드는 [§5.3](#53-기본-타입과-기본-해석-규칙)의 기본값으로 채우고 미리보기에 표시한다. 기존 파일의 공통 타입과 가져온 타입이 다르면 기존 타입 사용 또는 공통 스키마 변경을 명시적으로 선택하게 한다. 공통 변경은 기존 뷰에도 영향을 준다는 점을 미리 표시한다. 취소·알 수 없는 버전·저장 실패에서는 파일 설정 전체를 유지한다.

```ts
interface CsvImportPreview {
  bundle: CsvViewBundle                          // 검증과 기본값 채움을 마친 값
  filledDefaults: CsvFilledDefault[]
  columnMatches: {
    importedColumnId: string
    sourceIndex: number | null                   // 현재 파일에서 제안한 위치
    basis: 'header-and-position' | 'header' | 'position' | 'none'
  }[]
  typeConflicts: { columnId: string; existing: CsvColumnType; imported: CsvColumnType }[]
  idConflicts: string[]                          // 이미 있는 뷰 ID
}

interface CsvImportDecisions {
  columnMap: Record<string, number | 'skip'>     // 키는 importedColumnId
  typeResolution: Record<string, 'keep-existing' | 'use-imported'>
  viewIds: string[]                              // 가져올 뷰. 건너뛴 컬럼을 참조하는 뷰는 고를 수 없음
}
```

- `basis`가 `header-and-position`이고 같은 헤더가 하나뿐일 때만 미리 선택한다. 나머지는 사용자가 확인해야 적용 버튼이 켜진다.
- ID가 겹친 뷰는 새 ID로 복제해 가져온다. v1에는 덮어쓰기 선택이 없다.
- 적용은 `CsvImportDecisions`로 만든 `CsvProfileChange` 하나를 `commit`으로 저장한다.

## 8. 조회 계약과 상태 관리

### 8.1. 공통 인터페이스

메모리와 파일 어댑터가 같은 계약을 구현한다. 아래는 의미를 고정하는 최소 타입이며, `CsvFilter`·`CsvSort`·`CsvCell`은 [§4.2](#42-v1-타입-정의)의 정의를 사용한다.

```ts
interface CsvDatasetToken {
  documentId: string
  fileId: string
  sourceRevision: string
  schemaRevision: number
}

interface CsvQueryRequest {
  dataset: CsvDatasetToken
  requestId: string
  queryId: string
  columnIds: string[]
  filter: CsvFilter | null
  sort: CsvSort[]
  scope: CsvQueryScope
  cursor: string | null
  limit: number
  maxResultBytes: number
}

type CsvQueryScope =
  | { kind: 'rows' }
  | { kind: 'group'; columnId: string; key: string }
  | { kind: 'calendar'; columnId: string; start: string; end: string }

type CsvTotal =
  | { status: 'unknown' }
  | { status: 'estimated'; value: string; basis: 'sample' }
  | { status: 'exact'; value: string; scope: 'query' | 'file' }

interface CsvQueryPage {
  dataset: CsvDatasetToken
  requestId: string
  queryId: string
  engineGeneration: number
  rows: CsvQueryRow[]
  nextCursor: string | null
  hasMore: boolean
  total: CsvTotal
  diagnostics: CsvQueryDiagnostic[]
}

interface CsvDataSource {
  query(request: CsvQueryRequest, signal: AbortSignal): Promise<CsvQueryPage>
  cancel(queryId: string): Promise<void>
  dispose(): Promise<void>
}
```

```ts
interface CsvQueryRow {
  rowId: string                                  // `${sourceRevision}:${recordNo}`
  recordNo: string                               // 10진 문자열
  cells: Record<string, CsvCell>                 // 키는 요청 컬럼 ID. 모든 요청 컬럼을 포함
}

interface CsvQueryDiagnostic {
  code: 'record-too-wide' | 'record-too-short' | 'quote-error' | 'cell-too-large'
      | 'result-bytes-exceeded' | 'source-changed' | 'parse-incomplete'
  severity: 'info' | 'warning' | 'error'
  recordNo: string | null
  columnId: string | null
  count: string | null                           // 같은 진단을 묶은 건수
}

class CsvQueryError extends Error {
  code: 'cancelled' | 'stale-dataset' | 'cursor-expired' | 'budget-exceeded'
      | 'invalid-request' | 'source-unavailable' | 'engine-restarted' | 'internal'
}
```

`CsvQueryRow`는 원본 레코드 번호 기반의 `rowId`와 요청 컬럼의 `CsvCell`만 포함한다. 원본 레코드 번호는 헤더를 제외한 1부터 시작하는 논리 CSV 행 번호다. 물리 줄 번호와 구분한다. 전체 개수와 큰 정수 ID를 UI 편의 때문에 부정확한 Number로 줄이지 않는다.

- `query`는 실패하면 `CsvQueryError`로 거부한다. `signal`이 중단되면 `cancelled`로 거부하며, 이 경우 controller는 오류를 표시하지 않는다.
- `record-too-short`는 정보 진단이다. 해당 셀은 이미 `missing`으로 표시되므로 오류로 올리지 않는다.
- cursor는 어댑터만 해석하는 불투명 문자열이다. 화면과 controller는 저장·비교·분해하지 않는다. 메모리 어댑터는 메모리 경로의 크기 상한 안에서 쿼리별 정렬 순열(`Uint32Array`)과 위치를 cursor로 쓸 수 있다. 파일 어댑터는 P4에서 마지막 정렬 키와 레코드 번호를 쓰는 keyset 방식을 검증한다.

필터 AST는 AND/OR/NOT, 동등·대소 비교, 문자열 포함·접두어, 선택지 포함, 상태 검사만 허용한다. 연산자는 컬럼 타입별로 제한하고 상수도 같은 해석 규칙으로 검증한다. 쿼리 객체를 SQL 문자열이나 JavaScript 표현식으로 그대로 실행하지 않는다.

### 8.2. 페이지와 cursor

- `queryId`는 한 필터·정렬·범위·dataset 조합의 결과 스트림을 식별한다. 새 조건은 새 queryId를 만든다. 페이지마다 requestId는 새로 발급한다.
- 첫 요청은 cursor가 null이다. 후속 cursor는 dataset·쿼리 서명·엔진 세대와 결합한 불투명 토큰으로 Worker/브로커가 보관한다. 다른 조건에 재사용할 수 없다.
- 초기 기본값은 200행, 다음 페이지 1개 선읽기, 문서당 최대 4페이지 캐시다. 바이트 상한도 별도로 적용하고 하나의 매우 큰 셀은 표시·조회 제한으로 처리한다. 값은 [부록 A](#부록-a-정책-상수)의 정책 상수에 둔다.
- 뒤로 이동은 제한된 캐시를 사용한다. 만료되거나 캐시 밖인 위치는 재조회하며, 전체 행 수를 몰라도 다음 결과를 읽을 수 있게 한다. 큰 OFFSET 반복과 파일 크기에 비례하는 전체 결과 ID 배열을 금지한다.
- 표의 row count는 현재 확보한 결과와 추가 로드 자리로 구성한다. 로드 중·오류를 빈 셀의 정상값으로 만들지 않는다. 미확인 전체 개수를 가짜 scrollbar 길이로 사용하지 않는다.
- 화면에 받은 페이지를 다시 정렬·필터하지 않는다. 필터·정렬은 전체 dataset을 대상으로 어댑터가 수행한다. 실패 시 기존 페이지를 새 조건의 결과처럼 표시하지 않는다.

### 8.3. 취소와 오래된 응답

조건 변경은 150–250ms debounce를 적용하되 탭·문서 전환과 닫기는 즉시 취소한다. 응답의 문서·queryId·requestId·원본/스키마 revision·엔진 세대를 controller의 현재 값과 비교하고 모두 맞을 때만 적용한다.

기본적으로 한 DuckDB 엔진에서 활성 데이터 쿼리 하나만 실행한다. 칸반의 그룹별 요청도 우선순위를 두고 직렬화하며, 동시 요청마다 별도의 큰 엔진을 만들지 않는다. 페이지 생산은 소비자가 요청한 범위까지만 진행한다. Arrow 배치 하나와 라이브러리 내부 선읽기까지 포함해 실제 최대 메모리를 계측한다.

취소는 reader 종료·쿼리 취소·연결 해제까지 완료해야 한다. 메시지만 무시하고 계산을 계속 두지 않는다. 엔진이 응답하지 않으면 브로커의 유예 시간 뒤 Worker를 종료해 세대를 바꾸고 관련 cursor를 만료시킨다. 재초기화 시 File 참조를 다시 등록하고, 원본·설정은 유지한다. 유예 시간과 지원 쿼리별 중단 지연은 기술 검증에서 확정한다.

### 8.4. 메모리 Worker 프로토콜

P3의 `memoryQuery.worker.ts`와 `MemoryCsvDataSource` 사이의 메시지다. `protocol.ts`의 `parseWorkerRequest(data: unknown)`·`parseWorkerResponse(data: unknown)`로 양쪽에서 검증하고, 형태가 맞지 않는 메시지는 버리고 진단을 남긴다. P4의 파일 Worker는 같은 봉투와 `query / cancel / dispose`를 재사용하고 등록 메시지만 따로 둔다.

```ts
interface CsvWorkerEnvelope { protocol: 1; messageId: string }

type CsvWorkerRequest = CsvWorkerEnvelope & (
  | { type: 'register-snapshot'; documentId: string; sourceRevision: string;
      header: (string | null)[]; records: string[][] }
  | { type: 'set-schema'; documentId: string; schemaRevision: number; columns: CsvColumnDefinition[] }
  | { type: 'query'; request: CsvQueryRequest }
  | { type: 'cancel'; queryId: string }
  | { type: 'sample'; documentId: string; sourceRevision: string; maxRecords: number }
  | { type: 'release'; documentId: string }
  | { type: 'dispose' }
)

type CsvWorkerResponse = CsvWorkerEnvelope & { inReplyTo: string } & (
  | { type: 'registered'; documentId: string; sourceRevision: string; recordCount: number }
  | { type: 'schema-set'; documentId: string; schemaRevision: number }
  | { type: 'page'; page: CsvQueryPage }
  | { type: 'sample'; sample: CsvSample }
  | { type: 'released' | 'disposed' }
  | { type: 'error'; code: CsvQueryError['code']; message: string }
)
```

- 문서마다 snapshot은 하나다. 새 `register-snapshot`을 받으면 그 문서의 이전 snapshot·정렬 순열·cursor를 버리고, 이전 revision을 가리키는 `query`는 `stale-dataset`으로 거부한다.
- `register-snapshot`은 원본 revision이 바뀔 때만 보낸다. 필터·정렬·뷰 전환에서는 보내지 않는다. 문자열 배열은 전송 가능 객체가 아니므로 복사 비용을 P3에서 측정해 기록한다.
- `set-schema` 없이 받은 `query`는 `invalid-request`다. 스키마가 바뀌면 그 문서의 cursor를 모두 만료시킨다.
- Worker는 페이지에 들어갈 셀만 `CsvCell`로 만든다. 필터·정렬에 필요한 해석값은 쿼리 동안만 캐시한다.
- `cancel`은 진행 중인 계산을 다음 청크 경계에서 멈춘다. 긴 정렬도 청크 단위로 양보해 취소 메시지를 처리한다.

### 8.5. controller 상태

`csvViewController.ts`는 문서마다 하나 만들고 [§3.2](#32-사용자-뷰-선택)의 선택 상태, 파일 설정, 조회, 저장을 소유한다. React는 `useSyncExternalStore`로 구독하며, 상태 객체는 불변으로 교체한다.

```ts
interface CsvViewControllerState {
  documentId: string
  selection: CsvViewSelection
  link:
    | { status: 'resolving' }
    | { status: 'linked'; fileId: string }
    | { status: 'choose'; candidates: { fileId: string; basis: 'digest' | 'name-size' }[] }
    | { status: 'error'; error: CsvStorageError }
  profile:
    | { status: 'loading' }
    | { status: 'ready'; stored: CsvStoredProfile }
    | { status: 'error'; error: CsvStorageError }
  sample: { status: 'idle' | 'loading' } | { status: 'ready'; sample: CsvSample } | { status: 'error'; error: CsvQueryError }
  query: CsvQueryState
  save:
    | { status: 'idle' }
    | { status: 'saving' }
    | { status: 'conflict'; current: CsvStoredProfile }
    | { status: 'error'; error: CsvStorageError; issues: CsvValidationIssue[] }
}

type CsvQueryState =
  | { status: 'idle' }                           // 기본 탭 선택 중
  | { status: 'loading'; queryId: string }
  | { status: 'ready'; queryId: string; rows: CsvQueryRow[]; nextCursor: string | null;
      hasMore: boolean; total: CsvTotal; diagnostics: CsvQueryDiagnostic[];
      loadingMore: boolean; loadMoreError: CsvQueryError | null }
  | { status: 'error'; queryId: string; error: CsvQueryError }

interface CsvViewController {
  getState(): CsvViewControllerState
  subscribe(listener: () => void): () => void
  select(selection: CsvViewSelection): void
  chooseLink(choice: { fileId: string } | 'new'): Promise<void>
  loadMore(): void
  retry(): void
  previewDraft(draft: CsvViewDefinition): void   // 빌더 미리보기. 저장하지 않고 query만 바꿈
  endPreview(): void
  saveView(draft: CsvViewDefinition): Promise<CsvSaveResult>
  duplicateView(viewId: string): Promise<CsvSaveResult>
  deleteView(viewId: string): Promise<CsvSaveResult>
  reorderViews(viewOrder: string[]): Promise<CsvSaveResult>
  applyColumns(columns: CsvColumnDefinition[]): Promise<CsvSaveResult>
  exportViews(viewIds: string[] | 'all'): CsvViewBundle
  previewImport(json: unknown): Promise<CsvValidationResult<CsvImportPreview>>
  applyImport(preview: CsvImportPreview, decisions: CsvImportDecisions): Promise<CsvSaveResult>
  dispose(): void
}
```

상태 전이 규칙은 다음과 같다.

| 사건 | 전이 |
| --- | --- |
| 사용자 뷰 선택, 조건·스키마·원본 revision 변경 | 새 `queryId`로 `loading`. 이전 `rows`는 버리고 이전 쿼리를 취소 |
| 첫 페이지 도착 | 응답 검사([§8.3](#83-취소와-오래된-응답))를 통과하면 `ready` |
| `loadMore` | `ready`에서 `loadingMore: true`. 실패하면 행을 유지하고 `loadMoreError`만 채움 |
| 첫 페이지 실패 | `error`. `retry`는 같은 조건으로 새 `queryId`를 만듦 |
| 기본 탭 선택 | 활성 쿼리를 취소하고 `idle` |
| 저장 성공 | `profile.stored` 교체. 활성 뷰에 영향이 있으면 쿼리를 다시 시작 |
| 저장 충돌 | `save.conflict`. 편집 초안은 호출한 컴포넌트가 그대로 가지고 있음 |
| `dispose` | 쿼리 취소, 어댑터 참조 반환, 구독 해제. 이후 도착한 응답은 무시 |

- 작은 CSV는 문서를 열 때 `link`를 결정한다. `choose`인 동안 사용자 뷰 탭은 `보기 추가`만 막고 기본 탭은 그대로 쓴다.
- `previewDraft`는 debounce를 적용하고, `endPreview`나 빌더 닫기에서 저장된 뷰의 쿼리로 돌아간다.
- 선택 상태는 바뀔 때마다 `saveSelection`으로 저장하되 실패해도 화면 전환을 막지 않는다.

## 9. 메모리·DuckDB 어댑터 구현

### 9.1. 현재 작업본 어댑터

`MemoryCsvDataSource`는 해당 `ViewerDocument`의 최신 유효 모델을 조회한다. 디스크 원본을 다시 읽어 미저장 편집을 잃지 않는다. revision별 최신 snapshot 한 개만 Worker에 등록하고, 필터 변경마다 전체 행을 다시 전송하지 않는다. 새 모델은 최신 요청으로 합치며 이전 snapshot·검색 캐시를 해제한다.

원본 입력이 파싱 중이거나 오류이면 기존 세션 정책에 맞춰 마지막 유효 snapshot과 현재 원문을 구분한다. 이전 결과를 최신 revision으로 포장하지 않는다. 사용자 뷰에서 데이터 편집 콜백은 연결하지 않는다. 기존 `보기`의 변경·Undo·Redo가 새 revision으로 들어오면 쿼리·cursor를 갱신한다.

### 9.2. 파일 등록과 CSV 읽기

`DuckDbCsvDataSource`는 원본 File/Blob을 `registerFileHandle`과 브라우저 파일 읽기 프로토콜로 등록하는 경로를 우선 사용한다. 대용량에 `file.text()`, 전체 `arrayBuffer()`, `registerFileText`, `registerFileBuffer`를 사용하지 않는다. 등록 이름은 앱이 생성한 내부 이름으로 하고 파일명을 SQL 식별자로 직접 사용하지 않는다.

원시 읽기는 모든 컬럼을 VARCHAR로 고정한다. 앱의 고유 내부 컬럼명과 파싱 설정을 명시하고 전체 파일 자동 타입 추론을 끈다. 빈 문자열·문자열 `NULL`을 보존하며, 짧은 레코드의 누락과 실제 빈 필드를 구별한다. `null_padding`, `force_not_null` 등은 선정한 버전에서 이 구분이 유지되는지 검증한 뒤 사용한다.

기존 파서가 유지하는 빈 논리 레코드, 인용된 빈 문자열, 끝의 개행 처리도 conformance fixture에 넣는다. 새 reader가 빈 레코드를 건너뛰어 레코드 번호·개수·누락 상태를 바꾸지 않는지 P0에서 확인하고, 해결되지 않은 차이를 정상 동작으로 받아들이지 않는다.

표본 뒤에서 더 넓은 행·잘못된 인용이 나오면 진단으로 처리한다. `ignore_errors`로 누락한 결과를 정상 전체 결과로 내보내지 않는다. 파싱 오류가 있는 새 대용량 경로는 원본 범위 읽기·다운로드를 유지하고, 불완전한 조회의 완료·정확한 건수를 표시하지 않는다. 기존 메모리 경로의 관대한 CSV 표시를 변경하지 않는다.

### 9.3. 안정적인 행 ID와 SQL 생성

필터·정렬 전에 원본 순서를 번호로 만든다. CSV reader의 순서 보존을 켜고 단일 파일·필요 시 `parallel = false`로 동작을 고정한다. 다음 형태를 기준으로 기술 검증한다.

```sql
WITH raw_rows AS (
  SELECT row_number() OVER () AS __record_no, *
  FROM read_csv(/* 앱이 확정한 파일·컬럼·파싱 옵션 */)
)
SELECT /* 요청 컬럼과 상태·해석값 */
FROM raw_rows
WHERE /* 검증한 타입별 조건과 바인딩 값 */
ORDER BY /* 상태 순서, 타입별 값 */, __record_no
```

이 예시는 SQL 생성 구조이며 그대로 실행할 코드는 아니다. 원본 순서 그대로 읽는 요청에는 불필요한 전역 ORDER BY를 추가하지 않는다. 정렬을 요청한 경우에만 정렬 키 뒤에 레코드 번호를 넣는다. 필터 전 번호 부여와 조기 페이지 표시가 함께 유지되는지 실행 계획·읽은 바이트·메모리로 검증한다. `rowId`는 원본 세대와 이 레코드 번호를 조합하며 SQL 결과의 현재 순서로 새로 만들지 않는다.

`sqlCompiler.ts`는 SQL과 바인딩 값을 별도로 반환한다. 컬럼·옵션은 내부 ID와 화이트리스트로 생성하고 사용자 입력값은 매개변수로 바인딩한다. 프로젝션에는 필터·정렬·상태·레이아웃용 숨은 의존 컬럼도 포함한다. SQL 타입 변환과 메모리 함수의 의미는 공통 conformance fixture로 검증한다.

### 9.4. 스트리밍·준비문·취소 검증

결과를 배치로 받는 API만 사용했다고 엔진의 전체 결과 생성이 사라졌다고 판단하지 않는다. 조사한 [비동기 연결 소스](https://github.com/duckdb/duckdb-wasm/blob/main/packages/duckdb-wasm/src/parallel/async_connection.ts)는 `send(sql, allowStreamResult)`와 `cancelSent()`를 제공하며, `allowStreamResult`의 기본값은 false다. [네이티브 구현](https://github.com/duckdb/duckdb-wasm/blob/main/lib/src/webdb.cc)의 준비문 실행·스트리밍·취소 경로도 확인해야 한다.

- 바인딩이 필요한 기본 경로는 준비문의 `send(...params)`로 검증한다. 준비문 실행 자체의 중단 가능 여부와 첫 배치 이전의 계산 비용도 측정한다.
- 일반 `send`를 사용하는 경로는 선정 버전의 스트리밍 옵션을 명시한다. 단순 반환 타입만 보고 모든 연산이 스트리밍된다고 가정하지 않는다.
- 전체 결과의 `toArray()`·JSON 배열화를 금지한다. 현재 페이지와 제한된 다음 배치만 UI 표현으로 변환한다.
- COUNT·DISTINCT·전체 정렬·집계는 기본 열람에서 자동 실행하지 않는다. 이 연산은 전체 스캔·큰 작업 메모리가 필요한 별도 쿼리다.
- 취소 API가 pending 쿼리·준비문·결과 소비 단계 모두를 중단하는지 각각 확인한다. 실패 시 앞 절의 Worker 재시작 경로가 실제로 동작해야 한다.

엔진·Arrow의 정확한 버전과 자산 목록은 기술 검증 단계에서 잠금 파일에 고정한다. 문서의 main 소스와 실제 설치 버전이 같다고 가정하지 않는다. 초기 단순 열람이 전체 결과를 먼저 만드는 버전·설정은 대용량 지원 경로로 출시하지 않는다.

## 10. 화면과 라이브러리 연결

### 10.1. 화면 소유권

파일 데이터·쿼리·브라우저 저장은 controller와 어댑터가 소유한다. 컴포넌트는 설정·페이지·진단·테마를 props로 받고 `onSelectionChange`, `onApply`, `onLoadMore`, `onRetry` 등으로 요청한다. JSX 안에서 파일 읽기·SQL 생성·IndexedDB 접근을 수행하지 않는다.

| 컴포넌트 | 책임·필수 상태 |
| --- | --- |
| `CsvViewHost` | 선택한 뷰 렌더링, 로드/실패/빈 결과 구분, 이전 조건 결과의 잘못된 표시 방지 |
| `CsvViewTabs` | 사용자 뷰 순서와 기존 탭 연결, 활성 탭·삭제 후 포커스, 모바일 표시 |
| `CsvViewBuilder` | 레이아웃·컬럼·타입·연결·필터·정렬 초안과 제한된 미리보기. 취소는 저장하지 않음 |
| `CsvColumnTypeEditor` | 표본 근거·원문/해석값·실패 예시·타입 규칙, 기본 규칙에서 바꾼 항목 표시, 앞자리 0 제거 등 정규화 경고, 공통 변경의 영향 표시 |
| `CsvViewManager` | 이름 변경·복제·삭제·재정렬·JSON 이동·파일별 관리 |
| `CsvQueryTable` | Glide 기반 읽기 전용 가상화 표, 제한된 페이지와 실제 확보한 행 수 사용 |
| `CsvListView` | 한 행을 한 항목으로 보여 주는 가상화 목록. 묶음 머리글·확보한 행 기준 건수·추가 로드 자리 |

탭은 `[사용자 뷰들] [+ 보기 추가] | [보기] [원본]` 순서로 구성한다. 추가 버튼은 탭이 아닌 동작 버튼으로 두고, 방향키/Home/End는 실제 탭만 이동한다. `aria-selected`, roving tabIndex, 탭과 패널의 ID 연결은 데스크톱·모바일 모두 유지한다. 삭제·재정렬 후 포커스가 사라지지 않게 한다.

기존 작은 CSV에서 기본 `보기`는 계속 편집기다. 파일 기반 CSV에서 기본 `보기`는 같은 조회 계약의 원본 순서 표다. 파일 기반 세션은 Undo·원문 편집·원본 저장을 제공하지 않으며, 공통 헤더의 기능 가능 여부로 제어한다. 원본 File/Blob의 다운로드와 지원되는 환경의 시스템 공유는 전체 복사 없이 별도 처리하고 `buildExportSnapshot()`을 호출하지 않는다. 뷰 선택 중에도 공통 출력 버튼의 대상은 CSV다.

### 10.2. shadcn-data-views 재사용 범위

[조사 기준 소스](https://github.com/lotfibennour/shadcn-data-views/tree/afe67edde5755d28c75d5631db2b8dc9228c3aed)를 고정해 필요한 갤러리·칸반·캘린더 화면과 의존 UI만 재사용한다. 기존 앱에 Next.js 전체를 추가하거나 라이브러리의 전역 CSS·테마·자체 헤더·내부 뷰 탭을 그대로 중첩하지 않는다. 조정한 모듈과 상류 기준점·수정 내역·라이선스를 기록한다.

조회 표는 기존 Glide 기반으로 구현한다. 원래 라이브러리의 전체 배열 필터·정렬은 controller의 전체 dataset 요청으로 바꾼다. 여러 날짜·선택형 컬럼 중 첫 컬럼을 자동 사용하는 도우미 대신 뷰에 저장한 연결 컬럼을 사용한다. 앱의 한국어 표시·테마를 적용하고 불필요한 생성/수정/삭제 버튼과 드래그 변경을 제거한다.

라이브러리 필드 `number`에 큰 정수·정밀 소수를 Number로 바꿔 넘기지 않는다. 정확한 문자열 포매터 또는 전용 셀을 사용한다. read-only 레코드의 생성 시각 등 CSV에 없는 업무 값을 현재 시각으로 꾸며 넣지 말고 화면 어댑터의 선택 메타데이터로 분리한다. 링크·이미지는 기존 외부 자원·정제 정책을 따라 표시한다.

### 10.3. 리스트

- 리스트는 한 줄에 제목·보조 정보와 오른쪽 값을, 둘째 줄에 표시 컬럼을 칩으로 나열한다. 색 표시는 단일 선택·참/거짓 컬럼의 선택지 색을 사용한다.
- 묶음 컬럼을 지정하면 그 컬럼을 첫 정렬 키로 강제하고, 같은 `rows` 범위의 한 결과 스트림에서 값이 바뀌는 지점에 머리글을 넣는다. 칸반처럼 그룹별 cursor를 두지 않는다.
- 묶음 건수는 확보한 행 기준으로 표시하고, 다음 페이지가 남은 마지막 묶음은 `N+`처럼 미확정임을 나타낸다. 정확한 묶음별 건수는 별도 집계 요청으로만 얻는다.
- 빈 값·누락·결측 표식·해석 실패 행은 상태 정렬 순서에 따라 정상 묶음 뒤의 상태별 묶음으로 표시하며 누락하지 않는다. 해석 실패 셀은 항목 안에서 원문과 경고 표시를 유지한다.
- 모바일에서도 같은 항목 구성을 사용한다. 행 높이를 고정 또는 측정 캐시로 관리해 가상화 스크롤 위치가 페이지 추가로 흔들리지 않게 한다.

### 10.4. P3 컴포넌트 props

[컴포넌트 작성 규칙](COMPONENTS.md)에 따라 데이터는 props로 받고 변경은 콜백으로 요청한다. 컴포넌트는 [§5.6](#56-순수-함수-api)의 순수 함수(`resolveDisplay`, `formatCell`, `previewColumn`, `findAffectedViews`)를 렌더링 중에 호출할 수 있지만, controller·저장소·Worker를 직접 참조하지 않는다.

```ts
interface CsvViewTabsProps {
  views: { id: string; name: string; layout: CsvLayout['kind'] }[]   // viewOrder 순서
  selection: CsvViewSelection
  canAddView: boolean                            // link가 linked일 때만 true
  onSelect(selection: CsvViewSelection): void
  onAddView(): void
  onManageViews(): void
}

interface CsvViewHostProps {
  view: CsvViewDefinition
  columns: CsvColumnDefinition[]
  query: CsvQueryState
  onLoadMore(): void
  onRetry(): void
  onEditView(): void
}

interface CsvResultViewProps<L extends CsvLayout> {   // 표·리스트·갤러리 공통
  layout: L
  columns: ReadonlyMap<string, CsvColumnDefinition>
  columnIds: string[]
  displayOverrides: Record<string, CsvDisplayOverride>
  rows: CsvQueryRow[]
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: CsvQueryError | null
  onLoadMore(): void
  onRetryLoadMore(): void
}
// CsvQueryTable: CsvResultViewProps<{ kind: 'grid' }>
// CsvListView: CsvResultViewProps<Extract<CsvLayout, { kind: 'list' }>>
// CsvGalleryView: CsvResultViewProps<Extract<CsvLayout, { kind: 'gallery' }>>

interface CsvViewBuilderProps {
  profile: CsvFileProfile
  initial: CsvViewDefinition                     // 새 뷰는 controller가 만든 초안
  preview: CsvQueryState
  onDraftChange(draft: CsvViewDefinition): void  // controller.previewDraft로 연결
  onApply(draft: CsvViewDefinition): Promise<CsvSaveResult>
  onCancel(): void
  onEditColumnType(columnId: string): void
}

interface CsvColumnTypeEditorProps {
  column: CsvColumnDefinition
  profile: CsvFileProfile
  views: CsvViewDefinition[]
  sample: CsvSample | null                       // null이면 표본 준비 중
  onApply(draft: CsvColumnDefinition): Promise<CsvSaveResult>
  onCancel(): void
}

interface CsvViewManagerProps {
  views: CsvViewDefinition[]                     // viewOrder 순서
  onRename(viewId: string, name: string): Promise<CsvSaveResult>
  onDuplicate(viewId: string): Promise<CsvSaveResult>
  onDelete(viewId: string): Promise<CsvSaveResult>
  onReorder(viewOrder: string[]): Promise<CsvSaveResult>
  onExport(viewIds: string[] | 'all'): void
  onImport(file: File): void                     // 읽기·검증은 controller가 처리
}
```

- 편집 초안(`CsvViewBuilder`, `CsvColumnTypeEditor`)은 컴포넌트 안의 상태다. 콜백이 `conflict`를 돌려주면 초안을 유지한 채 현재 저장본과의 차이를 보여 주고, 다시 적용할지 사용자가 고른다.
- 결과 컴포넌트는 `rows`를 다시 정렬하거나 거르지 않는다. 행 키는 `rowId`를 쓴다.
- `loadingMore`·`loadMoreError`는 목록 끝의 추가 로드 자리에만 표시하고, 이미 받은 행은 그대로 둔다.
- 다이얼로그 열림 상태와 어떤 컬럼을 편집하는지는 `CsvViewHost`를 감싸는 화면 컴포넌트가 가진다. controller 상태에 넣지 않는다.

### 10.5. 칸반·캘린더

- 칸반은 그룹별 cursor·로드 상태·추가 조회를 둔다. 전체 첫 200개를 나눠 모든 그룹의 결과로 표시하지 않는다. 그룹 목록도 표본 후보와 정확한 전체 목록을 구분하며, 고유값 전체 집계를 렌더마다 요청하지 않는다.
- 선택지 밖 정상 값, 빈 값, 실패한 값을 누락하지 않는다. 그룹 수·동시 로드 예산을 두고 추가 그룹을 명시적으로 조회한다.
- 캘린더는 현재 화면에 필요한 날짜 범위만 요청한다. 구간은 시작 포함·끝 제외로 통일하고, 월간 화면의 앞뒤 주도 포함한다. 날짜 전용 값에는 시간대 이동을 적용하지 않는다.
- 한 날짜의 많은 항목은 추가 조회로 펼친다. 같은 기간을 다시 열면 제한된 캐시를 사용하고, 기간 밖 데이터를 전부 React 요소로 만들지 않는다.

## 11. 캐시·자산·실패 처리

### 11.1. 캐시와 자원 해제

쿼리 캐시 키에는 documentId·fileId·sourceRevision·schemaRevision·정규화한 조건·정렬·범위·컬럼·엔진 세대를 포함한다. 미저장 작업본을 공유 파일 ID만으로 캐시하지 않는다. 페이지 예산과 엔진 작업 메모리 예산은 따로 관리한다.

반복 분석용 Parquet 변환·인덱스 구성은 사용자가 요청한 최적화 단계로 둔다. 최초 열기의 전제 조건으로 전체 파일을 변환하지 않는다. 원본 순서 번호를 캐시에도 보관하고 캐시 생성 시 한 번 전체 스캔이 필요함을 조회 계약에 반영한다. 선택한 날짜·그룹·필터 컬럼의 캐시도 실제 사용과 측정 근거가 있을 때 추가한다.

문서 닫기는 해당 쿼리·cursor·포매터 캐시·원본 참조를 해제한다. 뷰 전환은 활성 쿼리와 결과 스트림을 해제한다. 공용 엔진은 참조 수를 관리하고 유휴 시 연결·등록 파일·Worker를 정리한다. 앱 전체 정리에서는 종료 세대를 먼저 바꿔 늦은 응답이 상태를 되살리지 못하게 한다.

### 11.2. 엔진 자산과 오프라인

조회 엔진의 JS·Worker·Wasm·필요한 확장만 같은 출처의 버전 고정 자산으로 제공한다. Vite base를 따르고 Worker가 기대하는 classic/module 형식을 실제 산출물에서 확인한다. 중첩 Worker를 필수로 만들지 않고 일반 브로커와 네이티브 Worker 경로를 먼저 사용한다.

`RuntimeAssetGroup`에 예를 들어 `csv-query`를 추가하고 manifest·파서·다이얼로그·서비스 워커 경로를 함께 확장한다. 설치 사전 캐시에 큰 엔진을 일괄 추가하지 않는다. 글꼴·Monaco와 같은 첫 기능 자산 준비에만 진행 다이얼로그를 사용하고, CSV 파일 열기·표본 파싱 자체의 별도 진행 다이얼로그는 추가하지 않는다.

자산 준비 실패의 `계속` 동작은 큰 CSV를 메모리 경로로 강제 전환하는 뜻이 아니다. 기존 작은 파일 기능과 원본 회수는 유지하고 해당 쿼리 기능에서 재시도를 제공한다. 첫 준비 전 오프라인과 준비 후 오프라인을 각각 검증한다. 단일 스레드에서 기본 기능이 동작해야 하며 COOP/COEP·SharedArrayBuffer를 필수 조건으로 두지 않는다.

라이선스 자동 생성은 npm 의존성만 찾으므로 소스 재사용 부분의 고지도 [자산 준비 스크립트](../scripts/prepare-build-assets.mjs)에 보존·포함되는지 확인한다. 확장 빌드는 중계 전용으로 유지하며 React·뷰·DuckDB 자산이 확장 실행 번들에 들어가지 않게 검사한다.

### 11.3. 오류 복구

| 오류 | 처리 |
| --- | --- |
| 원본 재접근 불가 | 뷰 설정을 보존하고 파일 재선택. 빈 파일로 대체하지 않음 |
| 파일·헤더 변경 | 원본 세대·조회 캐시 갱신. 컬럼 연결이 깨지면 재매핑 전 실행 중단 |
| 셀 타입 실패 | 해당 셀 원문·이유·범위별 건수 표시. 파일 전체의 파싱 오류와 구분 |
| CSV 구조 오류 | 논리 레코드·가능한 바이트 범위와 진단. 정확한 전체 결과 표시 중단, 원본 회수 유지 |
| 쿼리 취소·cursor 만료 | 정상 취소와 실패 알림 구분. 현재 조건으로 처음부터 재조회 가능 |
| 메모리·작업 예산 초과 | 명시적인 조회 실패. 필터 축소·캐시 최적화 등 가능한 다음 동작 제공 |
| IndexedDB·OPFS 실패 | 기존 설정과 편집 초안 보존. 저장 성공·전체 삭제 완료를 허위 표시하지 않음 |
| 손상된 저장 설정 | 다른 파일 복구 계속. 해당 설정의 원시 JSON 회수·재가져오기 제공 |

## 12. 구현 순서와 단계별 산출물

| 단계 | 작업·산출물 | 통과 조건 |
| --- | --- | --- |
| P0 기술 검증 | 작은 기능 검증 코드, 엔진/소스 버전 기록, 측정 보고서. 표본·파일 등록·준비문·취소·행 번호·테마 확인 | 큰 기본 열람이 전체 버퍼·전체 결과를 선행하지 않음. 실패하면 재사용/조회 설계를 수정하고 한도를 올리지 않음 |
| P1 순수 계약 | JSON 검증·타입 해석·추천·필터 AST·정확 비교·공통 fixture. 계약: [§4.2](#42-v1-타입-정의)–[§4.4](#44-저장-레코드와-json-봉투), [§5.6](#56-순수-함수-api) | 원문·정밀도·빈 값/누락/실패·날짜 의미가 검증되고 임의 실행 코드가 없음 |
| P2 영속 설정 | 파일 식별·v4 DB 이행·설정 트랜잭션·JSON 이동. 계약: [§7.1](#71-저장소-이행), [§7.3](#73-다운로드가져오기) | v1/v2/v3 복구 유지, 파일 재열기와 다중 뷰 백업/복원, 충돌·취소 시 원자성 |
| P3 작은 CSV 뷰 | controller·사용자 탭·타입 편집·표/리스트/갤러리·메모리 어댑터. 계약: [§8.1](#81-공통-인터페이스), [§8.4](#84-메모리-worker-프로토콜), [§8.5](#85-controller-상태), [§10.4](#104-p3-컴포넌트-props) | 미저장 편집·Undo/Redo 반영, 기존 두 탭 회귀 없음, 뷰 변경이 CSV dirty 상태를 바꾸지 않음 |
| P4 대용량 연결 | WorkspaceDocument·공통 입력·파일 어댑터·원본 범위·다운로드·자원 해제 | 선택/드롭/폴더에서 부분 열람, 전체 문자열/행 배열 없음, 원본 미연결 복구와 취소 정상 |
| P5 레이아웃·캐시 | 칸반·캘린더·필요한 OPFS 최적화 | 그룹별/기간별 전체 조건 정확성·동률 행 ID·캐시 변경 감지·정리 |
| P6 출시 검증 | 전체 회귀·실브라우저·오프라인·산출물·지원 한도 기록 | 아래 완료 기준 충족, 검증한 범위만 기능으로 표시 |

각 단계에 실제 구현·검증 상태를 기록한다. 작은 CSV 뷰만 완성한 상태를 대용량 통합 완료로 기록하지 않는다. P0는 기술적 불확실성을 해소하는 작업이며 사용자가 이미 요청한 문서 작성이나 독립적인 계약 구현을 중단시키는 승인 단계로 사용하지 않는다.

## 13. 테스트와 성능 검증 지시

신규 테스트 파일명은 제안이다. 내부 함수 호출 횟수나 구현 내용을 그대로 확인하는 검사보다 입력·결과·회복 가능한 실패를 검증한다.

| 검증 영역 | 추가/확장 대상과 필수 사례 |
| --- | --- |
| 타입 해석 | `tests/csvTyping.test.ts`: 타입별 기본 입력 규칙의 수락·거부 경계(§5.3 표), 기본값 명시 저장과 누락 필드 채움, `00123`, 38자리 정수·범위 초과, 정밀 소수·scale 초과, 잘못된 천 단위 구분, 통화/퍼센트, 참/거짓 대응표, 모호한 날짜·윤년·오프셋·DST, 다중 선택 |
| 추천·상태 | `tests/csvInference.test.ts`: 빈/누락/결측 표식/실패, `parseCell` 판정 순서, 표본 수·바이트 상한·EOF, 뒤에서 나타나는 예외, 사용자 타입 고정, 미리보기의 앞자리 0 손실 건수 |
| 검증·레코드 | `tests/csvViewValidate.test.ts`: 레이아웃 연결 타입, 정렬 불가 컬럼, 앱에서 만든 설정의 `filledDefaults`가 비어 있음, 뷰 순서 손상 복구, revision 계산 |
| Worker 프로토콜 | `tests/csvWorkerProtocol.test.ts`: 잘못된 메시지 거부, 새 snapshot 뒤 이전 revision 쿼리의 `stale-dataset`, 스키마 변경 시 cursor 만료, 취소 응답 |
| 조회 의미 | `tests/csvQueryConformance.test.ts`: 같은 fixture의 메모리/SQL 결과, 타입별 연산자 허용표·ASCII 대소문자 무시·select 선택지 순서 정렬·리스트 묶음의 암묵 정렬, 빈 논리 레코드·후행 개행, 3값 논리, 상태 정렬·동률 순서, 필터 전 행 ID, 페이지 중복/누락, 숨은 의존 컬럼 |
| 파일 입력 | [browserFiles](../tests/browserFiles.test.ts), [folderAccess](../tests/folderAccess.test.ts), [inputPolicy](../tests/inputPolicy.test.ts): 참조 획득 전 차단·전체 버퍼 생성 여부·입력 출처별 한도·다른 형식 회귀 |
| 파일 식별·JSON | `tests/csvFileIdentity.test.ts`, `csvViewBundle.test.ts`: 같은 이름의 다른 파일, 모호한 지문, 중복 헤더 매핑, ID 충돌, 타입 충돌, 알 수 없는 버전, 취소·원자성 |
| DB 이행·삭제 | [저장소 이행](../tests/storageIndexedDb.test.ts), [복구 저장](../tests/workspaceStorage.test.ts): v1/v2/v3→신규 버전, 손상 레코드, 프로필 보존 범위, 전체 삭제, 다중 탭 revision 충돌 |
| 세션·저장 | [documentStore](../tests/documentStore.test.ts), [documentSave](../tests/documentSave.test.ts), [session](../tests/session.test.ts): 파일 기반 문서가 본문 저장/Undo로 들어가지 않음, 작은 CSV 미저장 작업본 반영 |
| 뷰 UI | `tests/csvViews.test.tsx`: 탭 순서·키보드·삭제 후 포커스, builder 적용/취소, 타입 변경 영향, 미확인 건수, 로드/빈 결과/실패 구분 |
| 쿼리 수명 | `tests/csvQueryLifecycle.test.ts`: §8.5 상태 전이표의 모든 행, 원본·타입·조건 변경, 빠른 탭 전환, 닫기 중 응답, 만료 cursor, 취소 실패 후 엔진 재시작·세대 검증 |
| 실브라우저 | Worker/Wasm·준비문 취소·File 읽기·Arrow/OPFS·가상화 스크롤·원본 다운로드. mock/fake-indexeddb 결과로 실제 브라우저 동작을 대체하지 않음 |

P0 측정 보고서는 `docs/CSV_QUERY_SPIKE.md`를 신설해 다음을 기록한다.

- 테스트 기기·브라우저·앱/엔진/Arrow 버전·커밋과 표본 생성 방식.
- 데스크톱 10/50/250 MiB·1 GiB, 모바일 5/20 MiB와 추가 실험 파일. 좁은 행·넓은 행·큰 셀·한글·여러 줄 인용·다른 인코딩을 구분한다.
- 첫 유효 화면까지의 시간, 처음 읽은 바이트/요청 범위, UI 스레드의 긴 작업, JS/Wasm 최고 메모리, 취소 요청부터 자원 해제까지의 시간.
- 조건 없는 첫 페이지·연속 페이지·드문/없는 필터·전체 정렬·정확 집계·그룹/기간 조회를 각각 측정한다. 엔진 초기 자산 준비와 준비 완료 후 조회 시간을 분리한다.
- 동일 환경에서 반복 측정해 중앙값·범위 또는 p95와 반복 수를 적는다. 단일 측정을 달성 성능으로 일반화하지 않는다.

부분 읽기 검증은 앱이 전체 `arrayBuffer()`를 호출하지 않았다는 검사와 실제 읽은 범위 계측을 함께 사용한다. 전역 정렬 없이 첫 페이지를 읽을 때 파일 크기에 비례해 메모리가 증가하면 출시 조건을 충족하지 못한 것으로 처리한다. 큰 정렬·집계의 작업 메모리는 별도 한도로 기록한다.

제품 구현 단계의 기본 검사는 다음과 같다. 이 문서 작성 단계에서는 제품 검사를 실행하거나 통과로 기록할 필요가 없다.

```text
npm run lint
npm run typecheck:app
npm run typecheck:sw
npm run typecheck:extension
npm run typecheck:tools
npm run typecheck:tests
npm run test
npm run build
npm run verify:build
npm run verify:pwa-build
```

개별 단계에서는 관련 검사를 수행하고 출시 전 `npm run check`와 산출물 검증을 완료한다. `/`와 `/the_viewer/`로 각각 빌드·검증하며 설치 후 오프라인·실제 파일 선택·확장 중계의 기존 동작을 확인한다. 기존 자동 검사에 새 Wasm·Worker가 포함되는지도 확인한다.

## 14. 완료 기준과 버전·문서 관리

- [ ] CSV 파일마다 표·리스트·갤러리·칸반·캘린더 뷰를 직접 만들고 기존 탭 왼쪽에서 열 수 있다.
- [ ] 파일 재열기·브라우저 재시작·JSON 다운로드/가져오기에서 뷰·타입·입력 규칙·순서를 복원한다.
- [ ] 작은 CSV의 미저장 편집·Undo/Redo를 반영하고 CSV 저장과 뷰 설정 저장을 분리한다.
- [ ] 큰 CSV는 기존 전체 본문 문서와 구분되며 기본 열람 전에 전체 문자열·행 배열·결과 ID 배열을 만들지 않는다.
- [ ] 타입·필터·정렬·상태 처리와 행 ID가 메모리/파일 어댑터에서 일치한다.
- [ ] 그룹·기간 조회와 전체 정렬·집계의 비용을 구분하고 부분 결과를 전체 결과로 표시하지 않는다.
- [ ] 원본·스키마·조건 변경, 취소·닫기·엔진 재시작에서 오래된 응답·cursor·캐시가 적용되지 않는다.
- [ ] 기존 문서 복구·폴더 전환·전체 삭제와 오프라인 자산 준비가 새 저장소·엔진까지 처리한다.
- [ ] 지원 기기별 파일·조회 한도와 실측 결과, 남은 제한을 기록한다.

제품 코드나 배포 설정을 커밋하기 전 기능 추가에 맞춰 당시 최신 버전에서 MINOR를 올린다. [package.json](../package.json)·[package-lock.json](../package-lock.json)의 루트 버전·[공개 버전](../public/version.json)을 맞추고 앱 표시·확장 manifest는 기존 자동 주입을 사용한다. 이번처럼 지시서만 작성하는 변경은 제품 버전을 올리지 않는다.

구현한 범위에 맞춰 [통합 계획](CSV_DYNAMIC_VIEW_PLAN.md), [요구사항](../wiki/REQUIREMENT.md), [용어](../wiki/TERMS.md), [로그](../wiki/LOG.md)를 함께 갱신한다. 구현 완료·자동 검사·실브라우저·성능 실측·미완료를 구분해 기록한다.

## 15. 확인한 외부 계약

- [shadcn-data-views 클라이언트](https://github.com/lotfibennour/shadcn-data-views/blob/afe67edde5755d28c75d5631db2b8dc9228c3aed/src/lib/client.ts), [필드 스키마](https://github.com/lotfibennour/shadcn-data-views/blob/afe67edde5755d28c75d5631db2b8dc9228c3aed/src/lib/schema.ts): 전체 배열·기본 필드 타입과 재사용 기준.
- [Papa Parse](https://www.papaparse.com/docs): 파일·청크·표본 파싱. 바이트 예산과 레코드 경계 관리는 별도로 검증한다.
- [DuckDB-Wasm 조회](https://duckdb.org/docs/2.0/clients/wasm/query), [비동기 연결](https://github.com/duckdb/duckdb-wasm/blob/main/packages/duckdb-wasm/src/parallel/async_connection.ts), [네이티브 실행](https://github.com/duckdb/duckdb-wasm/blob/main/lib/src/webdb.cc): 배치·준비문·취소의 확인 지점. 설치 버전에서 다시 확인한다.
- [순서 보존](https://duckdb.org/docs/2.0/sql/dialect/order_preservation): 필터 전 레코드 번호와 동률 정렬의 근거. 조기 결과 표시 성능은 별도 검증 대상이다.
- [파일 등록](https://duckdb.org/docs/2.0/clients/wasm/data_ingestion), [CSV 옵션](https://duckdb.org/docs/2.0/data/csv/overview), [엔진·OPFS 초기화](https://duckdb.org/docs/2.0/clients/wasm/instantiation): 직접 파일 조회·문자열 보존·런타임 자산과 저장 조건.

## 부록 A. 정책 상수

본문에 흩어진 초기값을 모은다. 구현은 이 값을 `src/domain/csv-views/` 아래 한 정책 모듈에 두고, 테스트는 상수를 참조한다. P0 측정으로 바꾸면 이 표와 [로그](../wiki/LOG.md)를 함께 갱신한다.

| 상수 | 초기값 | 근거 절 |
| --- | --- | --- |
| 표본 레코드 수 / 바이트 예산 | 200개 / 8 MiB 중 먼저 도달한 쪽 | §5.4, §6.3 |
| 자동 타입 선택 최소 유효 표본 | 20개 또는 EOF 확인 | §5.4 |
| 표본 읽기 첫 청크 | 1 MiB | §6.3 |
| 정수·소수 최대 자릿수 | 38 | §5.2, §5.3 |
| `datetime` 소수 초 최대 자릿수 | 6 | §5.3 |
| 뷰 가져오기 파일 크기 | 5 MiB | §4.3 |
| 파일당 뷰 수 | 100 | §4.3 |
| 필터 깊이 / 조건 수 | 8 / 100 | §4.3 |
| 페이지 크기 / 선읽기 / 문서당 페이지 캐시 | 200행 / 1페이지 / 4페이지 | §8.2 |
| 조건 변경 debounce | 150–250ms 범위에서 하나로 확정 | §8.3 |
| 엔진당 동시 데이터 쿼리 | 1 | §8.3 |
| 메모리 경로 파일 상한 | 데스크톱 50 MiB, 모바일 20 MiB (기존 값 유지) | §6.2 |

## 부록 B. 미결정 사항

아래 항목은 구현 전 또는 P0에서 확정한다. 확정 전에는 임의 값으로 출시하지 않는다.

| 항목 | 정할 내용 | 확정 시점 |
| --- | --- | --- |
| 엔진 버전 | DuckDB-Wasm·Arrow 정확한 버전과 자산 목록 | P0 |
| 파일 기반 CSV 상한 | 기기별 `maxFileBackedCsvBytes`와 조회 예산 | P0 측정 후 |
| 취소 유예 시간 | Worker 강제 종료까지의 대기, 쿼리 종류별 중단 지연 | P0 |
| 누락/빈 값 구분 옵션 | `null_padding`·`force_not_null` 등 선정 버전에서의 실제 동작 | P0 |
| UTF-8 외 인코딩 | 직접 조회 가능 여부와 OPFS 변환 경로의 필요성 | P0 |
| 캐시 용량 정책 | OPFS 캐시 LRU 상한과 정리 시점 | P5 |
| 다중 선택 정렬 | v1 이후 정렬 키 허용 여부와 의미 | P3 이후 |
| 빈 값 대체값 | 표시 전용 범위를 넘는 컬럼 기본값 도입 여부 | v1 이후 |
