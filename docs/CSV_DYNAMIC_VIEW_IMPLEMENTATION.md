# CSV 다이나믹 뷰 구현 지시서

- 작성일: 2026-11-11
- 상태: 구현 전. 이 문서는 작업 지시이며 구현·성능 검증 완료를 뜻하지 않는다.
- 기준 커밋: `0ec7b14`, 작성 브랜치: `codex/csv-dynamic-views`. 작업 시 현재 코드와 차이를 다시 확인한다.
- 목적: [통합 계획](CSV_DYNAMIC_VIEW_PLAN.md)을 파일별 작업·타입 계약·단계별 검증으로 구체화한다.
- 공통 기준: [에이전트 규칙](../AGENTs.md), [컴포넌트 작성 규칙](COMPONENTS.md), [요구사항](../wiki/REQUIREMENT.md), [용어](../wiki/TERMS.md).

## 1. 범위와 작업 원칙

다음 결과를 순서대로 구현한다.

1. CSV별 컬럼 스키마와 여러 사용자 뷰를 JSON으로 구성하고 브라우저에 보관한다.
2. 기존 `보기 / 원본`의 왼쪽에서 사용자 뷰를 열고 추가·수정·복제·삭제·재정렬한다.
3. 컬럼 타입을 표본에서 추천하고 사용자가 지정한다. 원문을 보존하면서 타입에 맞게 조회·표시한다.
4. 작은 CSV는 현재 편집 작업본을 조회하고, 큰 CSV는 File/Blob 참조를 통해 필요한 결과를 조회한다.
5. 표·갤러리를 먼저 연결하고 칸반·캘린더, 반복 분석용 캐시를 확장한다.

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
| `src/domain/csv-views/typing.ts`, `inference.ts` | 타입 해석·정규화·비교와 제한된 표본의 추천 |
| `src/domain/csv-views/query.ts`, `protocol.ts` | 필터 AST·조회 계약·Worker 메시지 검증 |
| `src/domain/csv-views/memoryQuery.worker.ts` | 작은 CSV의 현재 작업본 조회·표본 분석 |
| `src/platform/csv/sourceRegistry.ts`, `fileIdentity.ts`, `openCsv.ts` | 파일 참조 수명·파일 식별·입력 경로 분기 |
| `src/platform/csv/viewStorage.ts`, `opfsCache.ts` | 뷰 저장 트랜잭션과 재생성 가능한 큰 캐시 |
| `src/platform/csv/MemoryCsvDataSource.ts`, `DuckDbCsvDataSource.ts`, `sqlCompiler.ts` | 공통 조회 계약의 메모리·파일 어댑터와 SQL 생성 |
| `src/platform/csv/duckdbRuntime.ts`, `preview.worker.ts` | 엔진 자산·네이티브 Worker 수명과 CSV 부분 표본 읽기 |
| `src/app/csvViewController.ts` | 현재 문서·선택 뷰·스키마·저장·쿼리 상태 조정 |
| `src/features/csv-views/CsvViewHost.tsx`, `CsvViewTabs.tsx` | 결과 화면과 사용자 뷰 탭 |
| `src/features/csv-views/CsvViewBuilder.tsx`, `CsvColumnTypeEditor.tsx`, `CsvViewManager.tsx` | 뷰 조립·타입 지정·관리 |
| `src/features/csv-views/CsvQueryTable.tsx`, `CsvGalleryView.tsx`, `CsvKanbanView.tsx`, `CsvCalendarView.tsx` | 페이지·그룹·기간별 결과 렌더링 |
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
- `grid / gallery / kanban / calendar`만 허용한다. 칸반은 그룹 컬럼, 캘린더는 날짜/날짜·시간 컬럼을 요구한다. 서로 맞지 않는 연결은 저장 전에 설명한다.
- 정수·소수·날짜 등은 판별 공용체로 작성해 타입별로 허용한 `parse`와 `display` 옵션만 받는다. 타입과 관계없는 옵션이나 실행 함수·HTML·모듈 경로를 받아 실행하지 않는다.
- `schemaRevision`은 컬럼 연결·타입·입력 규칙 변경 때 증가한다. `profileRevision`은 뷰 추가·정렬 등 파일 설정 저장마다 증가한다. 표시 형식 변경만으로 원본 revision을 올리지 않는다.
- 한 뷰 다운로드에도 실행에 필요한 컬럼·타입·파싱 설정을 포함한다. 모든 뷰 다운로드는 같은 계약의 `views`와 `viewOrder`를 모두 포함한다.
- 전체 파일의 뷰 백업은 `kind: 'csv-view-backup'`, `schemaVersion: 1`, `profiles` 배열의 봉투로 구분한다. CSV 행·파일 핸들·로컬 경로·인증 정보는 포함하지 않는다.

`validate.ts`에는 `validateColumnDefinition`, `validateViewDefinition`, `validateViewBundle`, `validateBackup`을 둔다. 입력을 `unknown`으로 받고 타입·길이·유한한 수·ID 참조·옵션 조합을 확인한다. 초기 상한은 가져오기 5 MiB, 파일당 뷰 100개, 필터 깊이 8·조건 100개로 시작하고 설정 상수에 모은다. 이는 원본 CSV의 컬럼 수를 100개로 제한한다는 뜻이 아니다. 상한 초과·알 수 없는 버전은 부분 저장 없이 실패시킨다.

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

### 5.3. 표본 추천과 타입 편집

1. 처음 200개 논리 레코드와 최대 8 MiB의 바이트 예산 중 먼저 도달한 범위에서 표본을 만든다. 헤더·빈 값·누락은 타입 일치 비율의 유효 표본에서 구분한다.
2. 원문 예시, 유효 표본 수, 후보별 일치 수, 오류 예시, EOF 도달 여부를 반환한다. 예: `표본 200개 중 198개 일치`. 전체 검증으로 표시하지 않는다.
3. 표본이 부족하거나 혼합 타입이면 텍스트를 기본으로 둔다. 자동 선택의 기본 조건은 유효 표본 20개 이상 또는 EOF 확인, 그리고 해당 입력 규칙에 모두 일치하는 것이다. 이보다 약한 후보는 추천만 한다.
4. 앞자리 0이 있는 정수형 코드, 긴 식별자, 모호한 날짜, 숫자와 불리언 모두 가능한 `0 / 1`은 자동 확정하지 않는다. 헤더명은 보조 근거로만 사용한다.
5. 사용자가 적용한 타입은 `typeSource: 'user'`로 고정한다. 이후 표본 밖의 예외는 실패로 표시하며 타입을 몰래 바꾸지 않는다. 단일/다중 선택지는 제한된 후보만 추천한다.

타입 편집은 초안에서 원문·해석값·실패 예시를 먼저 보여 준다. 적용 시 영향을 받는 뷰를 표시하고 파일 스키마와 revision을 한 트랜잭션으로 저장한다. 저장 성공 뒤 활성 조회를 재실행하며, 실패 시 기존 스키마와 결과를 유지한다. 표본 미리보기·취소는 영속 설정을 바꾸지 않는다.

### 5.4. 비교·필터·집계

- 수치 비교는 정확한 수치로, 날짜 비교는 지정한 날짜 의미로 수행한다. 원문 `2 / 10`을 숫자로 지정한 경우 `2, 10` 순서가 되어야 한다.
- 텍스트 정렬의 초기 공통 기준은 대소문자를 구별하는 Unicode 코드포인트 순서다. 메모리·SQL 어댑터가 서로 다른 로케일 정렬을 사용하지 않게 한다. 기존 편집 표의 정렬 의미는 이번 작업으로 바꾸지 않는다.
- 값 정렬의 오름/내림과 별개로 `value → empty → missing → null-marker → invalid` 순서를 기본으로 사용한다. 동률은 원본 레코드 번호로 정한다.
- 일반 비교에서 비정상·빈 값은 SQL과 같은 미확정 결과로 취급하고, AND/OR/NOT도 같은 3값 논리를 적용한다. 최종 필터는 참인 행만 통과시킨다. 상태 검사 연산자는 명시적인 참/거짓을 반환한다.
- 집계는 정상 해석값만 사용하고 제외 상태별 건수를 반환한다. 건수의 범위를 `sample / loaded / query / file`로 구분하고, 완료하지 않은 파일 전체 검증을 정확한 건수로 표시하지 않는다.

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

기존 파일의 공통 타입과 가져온 타입이 다르면 기존 타입 사용 또는 공통 스키마 변경을 명시적으로 선택하게 한다. 공통 변경은 기존 뷰에도 영향을 준다는 점을 미리 표시한다. 취소·알 수 없는 버전·저장 실패에서는 파일 설정 전체를 유지한다.

## 8. 조회 계약과 상태 관리

### 8.1. 공통 인터페이스

메모리와 파일 어댑터가 같은 계약을 구현한다. 아래는 의미를 고정하는 최소 타입이며, 셀·필터 타입은 앞 절의 스키마로 정의한다.

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

`CsvQueryRow`는 원본 레코드 번호 기반의 `rowId`와 요청 컬럼의 셀만 포함한다. 원본 레코드 번호는 헤더를 제외한 1부터 시작하는 논리 CSV 행 번호다. 물리 줄 번호와 구분한다. 전체 개수와 큰 정수 ID를 UI 편의 때문에 부정확한 Number로 줄이지 않는다.

필터 AST는 AND/OR/NOT, 동등·대소 비교, 문자열 포함·접두어, 선택지 포함, 상태 검사만 허용한다. 연산자는 컬럼 타입별로 제한하고 상수도 같은 해석 규칙으로 검증한다. 쿼리 객체를 SQL 문자열이나 JavaScript 표현식으로 그대로 실행하지 않는다.

### 8.2. 페이지와 cursor

- `queryId`는 한 필터·정렬·범위·dataset 조합의 결과 스트림을 식별한다. 새 조건은 새 queryId를 만든다. 페이지마다 requestId는 새로 발급한다.
- 첫 요청은 cursor가 null이다. 후속 cursor는 dataset·쿼리 서명·엔진 세대와 결합한 불투명 토큰으로 Worker/브로커가 보관한다. 다른 조건에 재사용할 수 없다.
- 초기 기본값은 200행, 다음 페이지 1개 선읽기, 문서당 최대 4페이지 캐시다. 바이트 상한도 별도로 적용하고 하나의 매우 큰 셀은 표시·조회 제한으로 처리한다. 값은 중앙 정책 상수에 둔다.
- 뒤로 이동은 제한된 캐시를 사용한다. 만료되거나 캐시 밖인 위치는 재조회하며, 전체 행 수를 몰라도 다음 결과를 읽을 수 있게 한다. 큰 OFFSET 반복과 파일 크기에 비례하는 전체 결과 ID 배열을 금지한다.
- 표의 row count는 현재 확보한 결과와 추가 로드 자리로 구성한다. 로드 중·오류를 빈 셀의 정상값으로 만들지 않는다. 미확인 전체 개수를 가짜 scrollbar 길이로 사용하지 않는다.
- 화면에 받은 페이지를 다시 정렬·필터하지 않는다. 필터·정렬은 전체 dataset을 대상으로 어댑터가 수행한다. 실패 시 기존 페이지를 새 조건의 결과처럼 표시하지 않는다.

### 8.3. 취소와 오래된 응답

조건 변경은 150–250ms debounce를 적용하되 탭·문서 전환과 닫기는 즉시 취소한다. 응답의 문서·queryId·requestId·원본/스키마 revision·엔진 세대를 controller의 현재 값과 비교하고 모두 맞을 때만 적용한다.

기본적으로 한 DuckDB 엔진에서 활성 데이터 쿼리 하나만 실행한다. 칸반의 그룹별 요청도 우선순위를 두고 직렬화하며, 동시 요청마다 별도의 큰 엔진을 만들지 않는다. 페이지 생산은 소비자가 요청한 범위까지만 진행한다. Arrow 배치 하나와 라이브러리 내부 선읽기까지 포함해 실제 최대 메모리를 계측한다.

취소는 reader 종료·쿼리 취소·연결 해제까지 완료해야 한다. 메시지만 무시하고 계산을 계속 두지 않는다. 엔진이 응답하지 않으면 브로커의 유예 시간 뒤 Worker를 종료해 세대를 바꾸고 관련 cursor를 만료시킨다. 재초기화 시 File 참조를 다시 등록하고, 원본·설정은 유지한다. 유예 시간과 지원 쿼리별 중단 지연은 기술 검증에서 확정한다.

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
| `CsvColumnTypeEditor` | 표본 근거·원문/해석값·실패 예시·타입 규칙, 공통 변경의 영향 표시 |
| `CsvViewManager` | 이름 변경·복제·삭제·재정렬·JSON 이동·파일별 관리 |
| `CsvQueryTable` | Glide 기반 읽기 전용 가상화 표, 제한된 페이지와 실제 확보한 행 수 사용 |

탭은 `[사용자 뷰들] [+ 보기 추가] | [보기] [원본]` 순서로 구성한다. 추가 버튼은 탭이 아닌 동작 버튼으로 두고, 방향키/Home/End는 실제 탭만 이동한다. `aria-selected`, roving tabIndex, 탭과 패널의 ID 연결은 데스크톱·모바일 모두 유지한다. 삭제·재정렬 후 포커스가 사라지지 않게 한다.

기존 작은 CSV에서 기본 `보기`는 계속 편집기다. 파일 기반 CSV에서 기본 `보기`는 같은 조회 계약의 원본 순서 표다. 파일 기반 세션은 Undo·원문 편집·원본 저장을 제공하지 않으며, 공통 헤더의 기능 가능 여부로 제어한다. 원본 File/Blob의 다운로드와 지원되는 환경의 시스템 공유는 전체 복사 없이 별도 처리하고 `buildExportSnapshot()`을 호출하지 않는다. 뷰 선택 중에도 공통 출력 버튼의 대상은 CSV다.

### 10.2. shadcn-data-views 재사용 범위

[조사 기준 소스](https://github.com/lotfibennour/shadcn-data-views/tree/afe67edde5755d28c75d5631db2b8dc9228c3aed)를 고정해 필요한 갤러리·칸반·캘린더 화면과 의존 UI만 재사용한다. 기존 앱에 Next.js 전체를 추가하거나 라이브러리의 전역 CSS·테마·자체 헤더·내부 뷰 탭을 그대로 중첩하지 않는다. 조정한 모듈과 상류 기준점·수정 내역·라이선스를 기록한다.

조회 표는 기존 Glide 기반으로 구현한다. 원래 라이브러리의 전체 배열 필터·정렬은 controller의 전체 dataset 요청으로 바꾼다. 여러 날짜·선택형 컬럼 중 첫 컬럼을 자동 사용하는 도우미 대신 뷰에 저장한 연결 컬럼을 사용한다. 앱의 한국어 표시·테마를 적용하고 불필요한 생성/수정/삭제 버튼과 드래그 변경을 제거한다.

라이브러리 필드 `number`에 큰 정수·정밀 소수를 Number로 바꿔 넘기지 않는다. 정확한 문자열 포매터 또는 전용 셀을 사용한다. read-only 레코드의 생성 시각 등 CSV에 없는 업무 값을 현재 시각으로 꾸며 넣지 말고 화면 어댑터의 선택 메타데이터로 분리한다. 링크·이미지는 기존 외부 자원·정제 정책을 따라 표시한다.

### 10.3. 칸반·캘린더

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
| P1 순수 계약 | JSON 검증·타입 해석·추천·필터 AST·정확 비교·공통 fixture | 원문·정밀도·빈 값/누락/실패·날짜 의미가 검증되고 임의 실행 코드가 없음 |
| P2 영속 설정 | 파일 식별·v4 DB 이행·설정 트랜잭션·JSON 이동 | v1/v2/v3 복구 유지, 파일 재열기와 다중 뷰 백업/복원, 충돌·취소 시 원자성 |
| P3 작은 CSV 뷰 | controller·사용자 탭·타입 편집·표/갤러리·메모리 어댑터 | 미저장 편집·Undo/Redo 반영, 기존 두 탭 회귀 없음, 뷰 변경이 CSV dirty 상태를 바꾸지 않음 |
| P4 대용량 연결 | WorkspaceDocument·공통 입력·파일 어댑터·원본 범위·다운로드·자원 해제 | 선택/드롭/폴더에서 부분 열람, 전체 문자열/행 배열 없음, 원본 미연결 복구와 취소 정상 |
| P5 레이아웃·캐시 | 칸반·캘린더·필요한 OPFS 최적화 | 그룹별/기간별 전체 조건 정확성·동률 행 ID·캐시 변경 감지·정리 |
| P6 출시 검증 | 전체 회귀·실브라우저·오프라인·산출물·지원 한도 기록 | 아래 완료 기준 충족, 검증한 범위만 기능으로 표시 |

각 단계에 실제 구현·검증 상태를 기록한다. 작은 CSV 뷰만 완성한 상태를 대용량 통합 완료로 기록하지 않는다. P0는 기술적 불확실성을 해소하는 작업이며 사용자가 이미 요청한 문서 작성이나 독립적인 계약 구현을 중단시키는 승인 단계로 사용하지 않는다.

## 13. 테스트와 성능 검증 지시

신규 테스트 파일명은 제안이다. 내부 함수 호출 횟수나 구현 내용을 그대로 확인하는 검사보다 입력·결과·회복 가능한 실패를 검증한다.

| 검증 영역 | 추가/확장 대상과 필수 사례 |
| --- | --- |
| 타입 해석 | `tests/csvTyping.test.ts`: `00123`, 38자리 정수·범위 초과, 정밀 소수·scale 초과, 잘못된 천 단위 구분, 통화/퍼센트, 참/거짓 대응표, 모호한 날짜·윤년·오프셋·DST, 다중 선택 |
| 추천·상태 | `tests/csvInference.test.ts`: 빈/누락/결측 표식/실패, 표본 수·바이트 상한·EOF, 뒤에서 나타나는 예외, 사용자 타입 고정 |
| 조회 의미 | `tests/csvQueryConformance.test.ts`: 같은 fixture의 메모리/SQL 결과, 빈 논리 레코드·후행 개행, 3값 논리, 상태 정렬·동률 순서, 필터 전 행 ID, 페이지 중복/누락, 숨은 의존 컬럼 |
| 파일 입력 | [browserFiles](../tests/browserFiles.test.ts), [folderAccess](../tests/folderAccess.test.ts), [inputPolicy](../tests/inputPolicy.test.ts): 참조 획득 전 차단·전체 버퍼 생성 여부·입력 출처별 한도·다른 형식 회귀 |
| 파일 식별·JSON | `tests/csvFileIdentity.test.ts`, `csvViewBundle.test.ts`: 같은 이름의 다른 파일, 모호한 지문, 중복 헤더 매핑, ID 충돌, 타입 충돌, 알 수 없는 버전, 취소·원자성 |
| DB 이행·삭제 | [저장소 이행](../tests/storageIndexedDb.test.ts), [복구 저장](../tests/workspaceStorage.test.ts): v1/v2/v3→신규 버전, 손상 레코드, 프로필 보존 범위, 전체 삭제, 다중 탭 revision 충돌 |
| 세션·저장 | [documentStore](../tests/documentStore.test.ts), [documentSave](../tests/documentSave.test.ts), [session](../tests/session.test.ts): 파일 기반 문서가 본문 저장/Undo로 들어가지 않음, 작은 CSV 미저장 작업본 반영 |
| 뷰 UI | `tests/csvViews.test.tsx`: 탭 순서·키보드·삭제 후 포커스, builder 적용/취소, 타입 변경 영향, 미확인 건수, 로드/빈 결과/실패 구분 |
| 쿼리 수명 | `tests/csvQueryLifecycle.test.ts`: 원본·타입·조건 변경, 빠른 탭 전환, 닫기 중 응답, 만료 cursor, 취소 실패 후 엔진 재시작·세대 검증 |
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

- [ ] CSV 파일마다 여러 뷰를 직접 만들고 기존 탭 왼쪽에서 열 수 있다.
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
