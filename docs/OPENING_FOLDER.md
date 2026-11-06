# 폴더 열기 코드 변경 지침

- 상태: 구현 전. 이 문서는 앞으로 적용할 코드 변경 지시이며 구현 완료 보고가 아니다.
- 기준: 2026-11-05, `opening_folder` 브랜치, 현재 앱 버전 `0.1.3`.
- 명시 요구: 전환 전 모든 문서의 저장 여부 확인, 기존 목록을 폴더 트리로 교체, 하위 폴더 접기·펼치기, 폴더 안의 상대 이미지·Markdown 임베드 표시.
- 나머지 동작은 이 문서의 구현 기본값으로 적용한다. 사용자 추가 요구나 Obsidian 전체 호환을 뜻하지 않는다.
- 공통 기준: [요구사항](../wiki/REQUIREMENT.md), [용어](../wiki/TERMS.md), [컴포넌트 작성 규칙](COMPONENTS.md).

TypeScript 블록은 추가할 자료형과 공개 계약이다. `declare function`으로 적은 항목은 해당 모듈에서 함수 본문을 구현한다.

## 1. 변경할 모듈을 분리한다

[App](../src/app/App.tsx)에 폴더 탐색·저장·Markdown 해석을 모두 추가하지 않는다. 다음 소유권으로 나누고 React 컴포넌트는 props와 콜백으로 연결한다. 아래 신규 파일은 연결한 디렉터리에 만든다.

| 위치 | 파일과 변경 지시 |
| --- | --- |
| [도메인](../src/domain/) | workspace.ts: 폴더·경로·문서 소속 자료형. folderTransition.ts: 전환 상태와 허용 이벤트. folderPaths.ts: 순수 경로 해석. markdownReferences.ts: 참조 수집·Obsidian 해석·제목/블록 범위 선택. 모두 신규다. |
| [문서 자료형](../src/domain/types.ts) | `ViewerDocument.folderRef`를 선택 속성으로 추가한다. 기존 ID·revision·작업본·바이트 기준·이력 계약은 유지한다. |
| [플랫폼](../src/platform/) | folderAccess.ts: 폴더 핸들/input 접근. FolderPicker.tsx: 선택기 어댑터. folderResources.ts: 로컬 이미지 Blob 수명 관리. 모두 신규다. |
| [파일 접근](../src/platform/browserFiles.ts) | 저장 위치 선택과 실제 쓰기를 분리한다. 기존 권한 확인·원본 바이트 비교를 재사용한다. |
| [앱](../src/app/) | documentSave.ts: ID 기반 저장 서비스. useFolderWorkspace.ts: 폴더 상태·전환·조회·입력 대기열 조정. FolderTransitionDialog.tsx, FolderTree.tsx, FolderAssetPreview.tsx를 추가한다. |
| [App](../src/app/App.tsx) | 문서 배열과 활성 문서의 소유자로 남는다. 위 서비스에 최신 문서를 읽고 게시하는 콜백을 주고, 기존 입력 경로를 같은 진입점으로 연결한다. |
| [사이드바](../src/app/WorkspaceSidebar.tsx)·[헤더](../src/app/DocumentHeader.tsx) | 폴더 동작 콜백과 트리 표시를 받는다. 플랫폼 API를 직접 호출하지 않는다. |
| [복구 저장소](../src/platform/storage.ts)·[쓰기 큐](../src/platform/documentWriteQueue.ts) | 문서와 폴더 메타데이터의 일관된 읽기·교체를 추가한다. 공유 티켓을 지우는 기존 삭제 함수를 전환에 사용하지 않는다. |
| [Markdown 렌더러](../src/domain/markdown.ts)·[편집기](../src/features/MarkdownEditor.tsx)·[CodeEditor](../src/components/CodeEditor.tsx) | 선택적인 로컬 참조 컨텍스트를 받는다. 컨텍스트 없는 호출의 기존 동작은 유지한다. |
| [Markdown 기능](../src/features/markdown/) | localReferenceState.ts, LocalReferenceWidget.tsx, MarkdownPreview.tsx를 추가한다. 기존 [preview](../src/features/markdown/preview.ts), [표 상태](../src/features/markdown/tableState.ts), [표 위젯](../src/features/markdown/TableWidget.tsx), [표 보기](../src/features/markdown/TableGrid.tsx)에도 같은 컨텍스트를 전달한다. |
| [문서 자원 정리](../src/app/documentResources.ts) | 로컬 참조 구독·읽기 요청·Blob 자원을 문서 닫기와 전체 교체에 연결한다. |

## 2. 폴더와 문서의 식별 계약을 추가한다

신규 workspace.ts에 다음 자료형을 둔다. `FolderPath`는 URI가 아닌 **디코딩이 끝난 루트 기준 파일 경로**다. 구분자는 `/`, 루트는 빈 문자열이며 앞·뒤 `/`와 `.`·`..` 구간이 없어야 한다.

```ts
export type FolderPath = string

export interface FolderEntry {
  path: FolderPath
  name: string
  kind: 'directory' | 'file'
}

export interface FolderWorkspace {
  id: string
  name: string
  access: 'handle' | 'input'
  expandedPaths: FolderPath[]
  activePath: FolderPath | null
}

export interface FolderDocumentRef {
  folderId: string
  path: FolderPath
}
```

[ViewerDocument](../src/domain/types.ts)에 `folderRef?: FolderDocumentRef`를 추가한다. 기존 `parentId`는 이메일 첨부 관계이므로 폴더 소속으로 재사용하지 않는다.

1. 폴더 선택마다 새 UUID를 만든다. 문서 조회 키는 `JSON.stringify([folderId, path])`로 만든다. 파일명이나 대소문자를 낮춘 경로로 중복을 판단하지 않는다.
2. 폴더 항목 캐시와 문서 배열을 분리한다. `Map<FolderPath, FolderEntry[]>`는 디렉터리별 바로 아래 목록이고 파일 본문이나 `ViewerDocument`를 포함하지 않는다.
3. 같은 키의 파일을 여는 중이면 진행 중 Promise를 공유한다. 완료 시에도 기존 세션을 재확인해 빠른 연속 클릭이 문서를 두 개 만들지 않게 한다.
4. 트리 선택은 기존 세션을 먼저 찾고 없을 때만 바이트를 읽어 `makeFileDocumentFromBytes`를 호출한다. 지원 형식은 기존 파서를 사용하고, 미지원 형식은 텍스트 판별 결과에 따라 원본 편집기 또는 지원 불가 페이지로 연다. 핸들 방식으로 얻은 파일 핸들은 현재 쓰기 권한과 무관하게 `sourceFileHandle`에 보관하고 저장할 때 권한을 확인한다.
5. 임베드 조회도 같은 키로 열린 문서를 먼저 찾는다. 있으면 최신 `text`와 `revision`을 사용한다. 없으면 읽기용 캐시에만 보관하며 편집 세션·Undo 이력·복구 문서를 만들지 않는다.
6. `openFiles()`로 추가된 파일은 `fileHandle`과 현재 핸들 루트가 있으면 `resolveFolderMembership()`으로 소속부터 확인한다. 폴더 안이면 같은 키의 기존 세션을 우선 사용하고 새 세션에는 `folderRef`를 붙인다. 소속이 확인되지 않은 파일·새 문서·이메일 첨부는 `folderRef` 없이 보조 목록인 `추가로 연 파일`에 표시한다. 이 문서들도 다음 전환의 저장 확인 대상이다.
7. 이미지 선택은 `ViewerDocument`를 만들지 않는다. 훅의 `activeAssetPath`로 읽기 전용 미리보기를 열고 `activeId`를 비운다. 문서를 선택하면 `activeAssetPath`를 비운다.

## 3. 폴더 접근 어댑터를 구현한다

신규 folderAccess.ts는 아래 계약을 제공한다. UI에는 `FolderEntry`만 전달하고 `FolderSource`와 `File` 참조는 훅/서비스에 보관한다.

```ts
import type { FolderEntry, FolderPath, FolderWorkspace } from '../domain/workspace'

export type FolderSource =
  | { kind: 'handle'; root: FileSystemDirectoryHandle }
  | { kind: 'input'; files: ReadonlyMap<FolderPath, File> }

export interface PickedFolder {
  workspace: FolderWorkspace
  source: FolderSource
}

export declare function pickLocalFolder(): Promise<PickedFolder | null>
export declare function folderFromInput(files: readonly File[]): PickedFolder
export declare function listFolderChildren(
  source: FolderSource, path: FolderPath, signal: AbortSignal
): Promise<FolderEntry[]>
export declare function readFolderFile(
  source: FolderSource, path: FolderPath, signal: AbortSignal
): Promise<{ file: File; fileHandle?: FileSystemFileHandle }>
export declare function resolveFolderMembership(
  source: FolderSource, handle: FileSystemFileHandle
): Promise<FolderPath | null>
```

- `pickLocalFolder()`는 `showDirectoryPicker({ mode: 'read' })`를 **첫 await 전에** 호출한다. API 미지원은 `null`, 선택 취소는 `AbortError`로 구분한다. 취소·권한 실패를 input 자동 호출로 바꾸지 않는다.
- `listFolderChildren()`는 핸들 경로를 구간별로 따라간 뒤 해당 디렉터리의 항목만 열거한다. 조회 목적으로 `create: true`를 쓰거나 파일 바이트를 읽지 않는다. 폴더 우선, `Intl.Collator('ko', { numeric: true })` 이름순, 동률은 원래 이름순으로 정렬한다.
- `readFolderFile()`는 마지막 구간의 파일만 읽는다. `arrayBuffer()` 전 [입력 크기 정책](../src/domain/inputPolicy.ts)의 `assertInputFileSize`를 적용한다. 경로가 디렉터리이거나 사라졌으면 항목 오류를 반환한다.
- 플랫폼은 모든 반복·await 뒤에 `signal.aborted`를 확인하고 호출한 훅은 폴더 세대를 확인한다. 네이티브 호출 자체를 중단할 수 없어도 취소된 결과는 게시하지 않는다.
- 핸들 소속은 `root.resolve(handle)` 결과로 판단한다. `null`은 폴더 밖이다. 파일명만으로 연결하지 않으며 input 방식에는 소속을 추정하지 않는다.
- FolderPicker.tsx는 기존 [FilePicker](../src/platform/FilePicker.tsx)와 별도로 만든다. `open()`, `onFolder`, `onCancel`, `onError`를 제공하고 숨긴 input에 `webkitdirectory`와 `multiple`을 설정한다. 폴더 input에는 지원 문서 형식으로 제한하는 `accept`를 두지 않는다.
- `open()`은 API 지원 여부를 동기 분기한다. 네이티브 미지원이면 같은 클릭 안에서 input을 연다. `await pickLocalFolder()`의 `null` 결과를 받은 뒤 input을 열지 않는다.
- input 파일의 `webkitRelativePath`에서 공통 최상위 폴더명 한 구간만 제거한다. 나머지 경로로 중간 디렉터리를 합성하고 `File` 참조만 맵에 보관한다. `readDroppedFiles()`처럼 모든 `arrayBuffer()`를 선행 호출하지 않는다.
- input의 `change`와 `cancel`을 처리하고 재선택 전 값을 비운다. 빈 반환 목록으로 폴더 이름을 알아낼 수 없으면 기존 작업을 유지한다. 네이티브 선택은 빈 루트를 지원하지만 input은 반환 목록에 없는 빈 폴더를 복원할 수 없다.
- `새로고침`을 단일 복구 동작으로 둔다. 핸들 방식은 사용자 클릭에서 읽기 권한을 확인한 뒤 현재 경로 목록과 이름 인덱스를 갱신한다. input 방식이나 복구된 폴더 소스가 없는 경우에는 선택기를 열어 현재 폴더를 다시 고르게 하고, 열린 작업본을 유지한다. 새 폴더로 교체하려면 `폴더 열기` 전환 절차를 사용한다.
- [전역 타입](../src/types/global.d.ts)에 `Window.showDirectoryPicker`와 필요한 디렉터리 열거 API 선언을 보완한다. 설치된 TypeScript DOM 선언을 확인하고 같은 선언을 중복 추가하지 않는다.

선택기에는 [MDN의 사용자 활성화 제약](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)을 적용하고, input 경로는 [webkitdirectory 반환 규칙](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory)을 따른다. 두 방식 모두 없으면 `폴더 열기`를 비활성화하고 기존 `파일 열기`를 제공한다.

## 4. 활성 문서와 무관한 저장 함수를 추출한다

[App의 saveCurrent](../src/app/App.tsx)에서 원래 형식 저장 부분을 신규 documentSave.ts로 옮긴다. `activeDocument`와 `structuredFormats`를 서비스 안에서 읽지 말고 최신 문서 조회·대기 직렬화 조회·`publishDocument`·`DocumentController.markSaved`를 주입한다.

```ts
import type { Format } from '../domain/types'
import type { ExportSnapshot } from '../domain/session'

export interface PreparedDocumentSave {
  documentId: string
  name: string
  format: Format
  snapshot: ExportSnapshot
  expectedBytes: Uint8Array
  originalBytes: Uint8Array
  sourceFileHandle?: FileSystemFileHandle
  fileSource?: 'file-url'
}

export type SaveAction = 'grant-write' | 'choose-destination' | 'link-source'
export type DocumentSaveResult =
  | { status: 'saved'; documentId: string; revision: number }
  | { status: 'download-started'; plan: PreparedDocumentSave }
  | { status: 'needs-user-action'; plan: PreparedDocumentSave; action: SaveAction }
  | { status: 'cancelled'; documentId: string }
  | { status: 'failed'; documentId: string; message: string }

export interface DocumentSaveService {
  prepareSourceSave(id: string): Promise<PreparedDocumentSave>
  saveDocumentById(id: string): Promise<DocumentSaveResult>
  continueDocumentSave(plan: PreparedDocumentSave, action: SaveAction): Promise<DocumentSaveResult>
}
```

1. `prepareSourceSave`는 기존 [flushDocument·buildExportSnapshot](../src/domain/session.ts)로 최신 작업본을 구성한다. `expectedBytes`는 마지막 `savedBytes` 복사본, `originalBytes`는 `initialBytes ?? savedBytes` 복사본이다.
2. 폴더 전환 저장에는 `structuredDraft` 또는 `textRevision !== revision`인 문서를 성공으로 처리하지 않는다. 기존 source 모드의 초안 회수 허용을 전체 작업 저장 완료로 사용하지 않는다. 최신 원문이 있는 문법 오류는 저장할 수 있다.
3. `saveDocumentById`는 자동 처리용이다. 이미 쓰기 권한이 있는 핸들에만 직접 기록하고, 권한 요청·저장 위치 선택·원본 연결이 필요하면 `needs-user-action`을 반환한다. 여러 파일에 대한 시스템 선택기를 루프로 열지 않는다.
4. `continueDocumentSave`는 준비된 행 버튼의 클릭에서 호출한다. 문서 ID·revision이 그대로인지 동기 확인하고, 필요한 권한/선택 API를 첫 await 전에 시작한다. 오래된 계획이면 다시 준비해 버튼을 갱신하며 그 클릭에서 선택기를 뒤늦게 열지 않는다.
5. `grant-write`는 `requestLocalFileWritePermission`, `link-source`는 `pickMatchingLocalSourceFile`의 기존 바이트 일치 검사를 사용한다. 원본 연결 성공은 핸들만 게시하고 저장 버튼을 다시 제공한다. 바로 다음 권한 요청을 자동으로 이어 붙이지 않는다.
6. `choose-destination`은 [browserFiles](../src/platform/browserFiles.ts)에 추출할 `pickLocalSaveHandle(name, format)`으로 위치를 먼저 얻고 쓰기를 진행한다. 다운로드 fallback은 별도로 호출해 `download-started`를 반환한다. 선택한 새 위치를 기존 원본으로 자동 재지정하지 않는다.
7. 기존 핸들 쓰기는 `writeLocalFileHandle(handle, snapshot.bytes, true, expectedBytes)`를 사용한다. 외부 수정이나 쓰기 실패 시 저장 기준을 바꾸지 않는다. 성공 후 해당 ID의 현재 문서에 `markSaved(current, snapshot)`을 적용한다.
8. `download-started`는 전환 다이얼로그에 `파일을 확인하고 계속`을 표시한다. 확인한 계획의 revision이 현재와 같을 때만 해당 snapshot을 저장 기준으로 반영한다. 다운로드 시작만으로 문서를 정리하지 않는다.
9. 저장 뒤 `documentIsDirty(current)`를 다시 확인한다. 미연결 구조 블록 등 저장되지 않은 초안이 남으면 행을 완료로 바꾸지 않는다. 일부 파일 저장 뒤 다른 파일이 실패해도 이미 저장한 파일은 저장된 상태로 유지한다.
10. `saveCurrent`의 다른 구조 형식 출력 분기는 그대로 분리한다. 원래 형식 저장은 새 서비스를 호출하고, 일반 단일 저장의 기존 안내와 다운로드 기준 갱신 정책은 래퍼에서 처리한다. 폴더 전환에서는 위의 명시적 다운로드 확인을 적용한다.

## 5. 전환을 준비·확정·취소로 나눈다

신규 folderTransition.ts에 `idle`, `settling`, `confirming`, `saving`, `ready-to-pick`, `picking`, `committing` 상태와 허용 이벤트를 둔다. 신규 useFolderWorkspace.ts가 비동기 작업을 수행하고 결과 이벤트를 전달한다. 상태 변경과 별도로 동기 `transitionRef` 잠금을 두어 같은 프레임의 중복 실행을 막는다.

```text
폴더 열기 클릭 → picking → 후보 준비
  ├ 수정 문서 없음 → committing → idle
  └ 수정 문서 있음 → confirming → saving/저장하지 않고 계속 → committing → idle
폴더 닫기 → settling
  ├ 수정 문서 없음 → committing → idle
  └ 수정 문서 있음 → confirming → saving/저장하지 않고 계속 → committing → idle
실패·취소 → idle (committing의 저장 실패도 포함)
```

폴더 열기는 사용자 클릭 안에서 선택기를 바로 연다. 폴더 후보를 받은 뒤 편집·직렬화를 안정화하고 수정된 문서를 확인한다. `FolderTransitionDialog`는 dirty 문서가 있을 때의 `confirming`·`saving` 상태에서만 표시한다. 수정 문서가 없으면 다이얼로그 없이 폴더를 확정한다. 저장 완료 후 필요한 사용자 동작이 있으면 다이얼로그를 유지하고 해당 행 버튼을 제공한다. 폴더 닫기는 같은 dirty 확인 절차를 쓰며, 수정 문서가 없으면 다이얼로그 없이 폴더 없는 작업 공간으로 확정한다.

### 5.1 현재 편집을 안정화한다

1. 진입 즉시 새 닫기·열기·전환 요청을 막는다. 폴더 선택 뒤 활성 편집기의 마지막 입력을 안정화한다. 활성 필드의 blur/확정과 진행 중 IME 조합이 세션에 반영된 뒤 `editingLocked`를 켠다. 조합 중 DOM 제거·강제 원문 교체나 변경 콜백 차단으로 입력을 잘라내지 않는다.
2. 기존 `pendingSerializations`가 안정될 때까지 기다린 뒤 모든 열린 문서를 다시 읽는다. 직렬화 완료 게시도 이 대기 중에는 허용한다. 활성 문서뿐 아니라 보조 목록·첨부·새 문서를 포함한다.
3. 이 단계에서 모든 문서에 `flushDocument()`를 호출하지 않는다. 출력 불가능한 초안 때문에 `저장하지 않고 계속`까지 막히면 안 된다. 저장 가능성 검사는 저장을 선택한 문서별로 한다.
4. 문서별 `(id, revision)`을 기록하고 `documentIsDirty()`로 수정 문서 목록을 만든다. FolderTransitionDialog.tsx에 이름·경로·개수와 `모두 저장 / 저장하지 않고 계속 / 취소`를 제공한다. 기본 초점은 `모두 저장`, Escape는 취소다.
5. `모두 저장`은 각 ID의 저장 결과를 행으로 보관한다. 모든 수정 문서가 저장되거나 다운로드를 명시적으로 확인하고, 남은 dirty가 없어야 다음 단계로 간다.

### 5.2 후보 폴더를 준비한다

- 폴더 열기 클릭 핸들러에서 잠금과 revision snapshot을 동기적으로 설정한 뒤 같은 호출 안에서 선택기를 연다. Effect나 Promise에서 선택기를 호출하지 않는다.
- 선택 뒤 편집·직렬화를 안정화하고 `listFolderChildren(source, '', signal)`로 루트 항목을 준비한다. 성공 전에는 현재 폴더·문서·활성 선택·URL을 바꾸지 않는다.
- 선택 전에 기록한 revision과 최신 문서를 비교해 dirty 문서를 다시 계산한다. 수정 문서가 있으면 후보를 유지하고 저장 확인을 표시한다. 수정 문서가 없으면 다이얼로그 없이 후보를 확정한다.
- 취소·루트 조회 실패·권한 실패는 후보만 폐기한다. `저장하지 않고 계속`도 이때 실제 문서 삭제를 수행하지 않는다.

### 5.3 복구 저장을 확정한 뒤 화면을 교체한다

1. 복구 debounce를 멈추고 문서·폴더 메타데이터의 새 쓰기 접수를 차단한다. 이미 시작한 입력/닫기/설정 변경 작업도 끝까지 기다리거나 해당 전환을 거절한다.
2. [DocumentWriteQueue.flush](../src/platform/documentWriteQueue.ts)를 기다린다. `flush()`는 호출 시점의 Promise만 기다리므로 쓰기 접수 차단 없이 장벽으로 사용하지 않는다. 큐 실패는 숨기지 않고 전환을 중단한다.
3. 아래 6절의 `replaceWorkspace()`가 성공할 때까지 메모리 상태와 이전 자원을 유지한다. 트랜잭션 중 파일 읽기·권한 요청·파싱을 하지 않는다.
4. 성공 후 이전 세대를 취소하고 `documentsRef.current = []`, `setDocuments([])`, `setActiveId('')`와 새 폴더·루트 캐시 게시를 한 번의 동기 확정 구간에서 수행한다. `structuredFormats`, `activeAssetPath`도 비운다. URL은 `history.replaceState`로 `#/`에 맞춘다.
5. 새 폴더는 루트만 펼치고 파일은 열지 않는다. 본문에는 `폴더에서 파일을 선택하세요`를 표시한다. 폴더가 있는데 문서가 없다는 이유로 기존 시작 명령 메뉴를 자동으로 열지 않게 조건을 바꾼다.
6. 이전 문서의 이력, 파싱 타이머·요청 토큰, 대기 직렬화 참조, 복구 관찰 맵, 편집기 상태, 참조 구독과 이미지 URL을 정리한다. 편집기 unmount가 상태를 다시 저장할 수 있으므로 [기존 자원 정리](../src/app/documentResources.ts)처럼 unmount 후 정리 순서도 지킨다.
7. 트랜잭션 실패 시 이전 메모리를 유지하고 복구 관찰 맵·타이머를 재설정해 저장을 재개한다. 확정과 취소 모두 잠금을 해제한 뒤 외부 입력 대기열을 한 번만 처리한다.

### 5.4 모든 비동기 진입점을 보호한다

- 폴더 `generation`은 확정 시 증가시킨다. 후보 준비에는 별도의 작업 토큰을 쓴다. 취소만으로 현재 폴더의 generation을 바꾸지 않는다.
- 파일 열기·트리 조회·파싱·임베드 요청은 시작 세대와 요청 토큰을 잡고 **각 await 뒤, 상태 게시 직전**에 확인한다. 문서를 추가하는 작업은 전환 잠금도 확인한다. 전환 직전에 시작한 `openFiles`도 포함한다.
- [App](../src/app/App.tsx)의 `changeModel`, `applySourceText`, `undo`, `revertCurrent`, `closeDocument`, `createBlank`, `pickFiles`, 붙여넣기·첨부·드롭과 키보드 명령에 전환 검사를 적용한다. 편집 콜백은 5.1절의 마지막 입력 확정 이후 잠그고 새 명령은 진입 즉시 막는다. 버튼 비활성화만으로 끝내지 않는다.
- OS 실행, 공유 티켓, 확장 수신을 하나의 입력 대기열로 모은다. 기존 `launchedFileQueue`만 확장하고 `runRelay`의 별도 문서 삽입을 그대로 두지 않는다. 이미 진행 중인 수신도 게시 전에 잠금을 재확인해 대기열로 넘긴다.
- 공유·확장 티켓 완료는 실제 문서 반영과 필요한 복구 저장 뒤 수행한다. 대기열에 넣었다는 이유로 `completeShareTicketFile`·`commitExtensionFile`을 먼저 호출하지 않는다. 티켓 ID/파일 인덱스 중복 방지도 유지한다.
- 전환 중 복구 설정 변경·전체 데이터 삭제·업데이트 적용을 막는다. 기존 `resettingData` 잠금과 전환 잠금이 동시에 실행되지 않게 한다.

## 6. 문서와 폴더 복구를 같은 트랜잭션으로 다룬다

[storage](../src/platform/storage.ts)의 기존 `settings` 저장소에 `workspace` 키를 추가한다. 새 object store가 필요하지 않으므로 IndexedDB DB 버전은 올리지 않는다. 선택적인 `folderRef` 추가만으로 문서 `schemaVersion: 3`도 바꾸지 않는다.

```ts
import type { FolderWorkspace } from '../domain/workspace'
import type { ViewerDocument } from '../domain/types'

export interface PersistedFolderWorkspace {
  schemaVersion: 1
  folder: FolderWorkspace
  rootHandle?: FileSystemDirectoryHandle
}

export declare function loadWorkspace(): Promise<{
  documents: ViewerDocument[]
  folder: PersistedFolderWorkspace | null
}>
export declare function replaceWorkspace(
  next: PersistedFolderWorkspace | null, recoveryEnabled: boolean
): Promise<void>
```

1. `loadWorkspace()`는 `documents`와 `settings`의 읽기 트랜잭션에서 함께 읽는다. 기존 `normalizeStoredDocument()`를 사용하고, 폴더 메타데이터가 없으면 일반 파일 모드로 복구한다. 잘못된 폴더 메타데이터 때문에 편집 작업본까지 버리지 않는다. App의 부팅 Effect에서 기존 `loadDocuments()` 호출을 대체하고 활성 경로에 맞는 열린 세션을 우선 선택한다. 없으면 첫 열린 문서 또는 파일 선택 안내를 표시하며 디스크 파일을 자동으로 새로 열지 않는다.
2. `replaceWorkspace()`는 `documents`와 `settings`만 `readwrite`로 연다. 이전 문서를 지우고, 복구가 켜져 있으며 `next`가 있으면 `workspace`를 put한다. 그 외에는 해당 키를 delete한다. `tx.done` 성공만 확정으로 인정한다.
3. `clearDocuments()`는 현재 `shares`도 삭제하므로 전환에서 호출하지 않는다. 공유 티켓·테마·다른 설정을 보존한다.
4. 펼친 경로·활성 경로 저장은 기존 쓰기 큐의 예약 키 `workspace`로 직렬화하고 같은 전환 장벽에 포함한다. 저장 직전 generation과 폴더 ID를 확인해 이전 폴더의 늦은 메타데이터 쓰기가 새 `workspace`를 덮지 못하게 한다. 문서 ID는 UUID이므로 이 예약 키와 구분된다.
5. input의 `File` 맵과 전체 트리·파일 본문 캐시는 저장하지 않는다. 복구 대상은 열린 작업본과 폴더 표시 정보다. input 방식은 재실행 후 재선택을 요구한다.
6. 핸들 복구 시 부팅 Effect는 읽기 권한을 `queryPermission`으로만 확인한다. 사용자 클릭으로 새로고침할 때 `requestPermission`을 요청하고, 자동 Effect에서는 호출하지 않는다.
7. 새로고침에서 소스를 다시 선택할 때 저장된 루트와 `isSameEntry` 등으로 확인하고 문서별 핸들도 검증한다. input 재선택은 현재 루트에 연결한다는 명시 동작과 경로 대조를 사용한다. 열린 작업본과 저장 기준을 새 디스크 내용으로 덮어쓰지 않는다.
8. 복구 끄기는 열린 메모리 작업을 유지하면서 `workspace` 기록도 지우도록 확장한다. `clearAllData()`와 폴더 닫기에도 폴더 메타데이터·관련 메모리 자원 정리를 연결한다.
9. `normalizeStoredDocument()`는 폴더 ID와 비어 있지 않은 정규 파일 경로를 검증한다. 잘못된 `folderRef`만 제거해 일반 문서로 복구하며, 이전 schema 1·2·3 문서의 호환성을 유지한다.

핸들 저장 가능 여부와 권한 재확인은 [Chrome 파일 접근 문서](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)의 절차를 따른다. 복구가 꺼진 전환도 오래된 기록을 남기지 않도록 삭제 트랜잭션을 수행하고, 실패하면 기존 작업을 유지한다.

## 7. 사이드바 트리와 모바일 진입을 연결한다

- [WorkspaceSidebar](../src/app/WorkspaceSidebar.tsx)에 `folder`, 자식 목록/오류/조회 상태, `onOpenFolder`, `onCloseFolder`, `onToggleDirectory`, `onOpenPath`, `onRefreshFolder`를 추가한다. `documents`는 열린 세션 목록으로 유지하고 트리를 만들려고 모든 파일을 세션으로 바꾸지 않는다.
- 신규 FolderTree.tsx는 선택한 루트 이름을 비토글 행으로 표시하고 바로 아래 항목부터 재귀 트리로 나열한다. 사이드바에서 추가로 연 파일이 없으면 트리가 설정 영역 위의 남은 높이를 채우며, 닫기와 새로고침은 트리 제목줄에 나란히 둔다. 루트의 최초 목록은 전환 때 준비하고, 하위 디렉터리는 처음 펼칠 때만 조회·캐시한다. 접었다 다시 펴면 캐시를 쓰고 `새로고침`은 목록 캐시와 이름 인덱스를 무효화한다.
- 숨김 파일과 미지원 파일도 표시한다. 지원 문서는 기존 편집기로, 이미지는 FolderAssetPreview.tsx로 연다. 미지원 파일은 내용을 판별해 텍스트면 Monaco 원본으로 열고, 텍스트가 아니면 지원 불가 안내가 있는 빈 페이지로 연다.
- 파일의 선택·dirty 표시는 `(folderId, path)`로 계산한다. 문서 닫기는 세션만 제거하며 트리 항목을 지우지 않는다. 새로고침에서 사라진 파일도 열린 작업본은 유지하고 항목 오류를 표시한다.
- `tree / treeitem / group`, `aria-expanded`, `aria-selected`, roving `tabIndex`를 제공한다. 위·아래는 보이는 행 이동, 오른쪽은 펼치기/첫 자식, 왼쪽은 접기/부모, Home/End는 처음/마지막, Enter는 파일 열기 또는 폴더 토글이다. 삭제·접기 뒤 초점이 사라지면 가까운 보이는 부모로 옮긴다.
- 기존 [사이드바 스타일](../src/styles/shell.css)의 `button:focus-visible` outline 제거 규칙보다 구체적인 트리 초점 표시를 추가한다. 긴 이름은 말줄임과 전체 경로 레이블을 제공하고 가로 폭을 늘리지 않는다.
- [명령 메뉴](../src/app/App.tsx)에 `open-folder`, `close-folder`, `refresh-folder`, `browse-folder` 항목을 추가한다. 명령 아이콘이 필요하면 [CommandItem](../src/components/CommandMenu.tsx)의 union과 아이콘 맵을 함께 확장한다.
- [반응형 스타일](../src/styles/responsive.css)은 760px 이하에서 사이드바를 숨긴다. [DocumentHeader](../src/app/DocumentHeader.tsx)에 `폴더 탐색` 콜백을 추가해 모바일에서는 FolderTree를 포커스 트랩이 있는 서랍으로 표시한다. 데스크톱 사이드바를 접으면 폴더가 열린 경우 현재 폴더 바로 아래 파일만, 폴더가 없으면 열린 파일 목록을 같은 너비의 배지 레일로 표시한다. 폴더가 열린 상태의 도구는 새로고침만 남기며 폴더 조작은 펼친 뒤 제공한다. 트리 데이터는 복제하지 않고 초점만 표시 표면별로 관리한다.
- 파일 열기에는 진행 다이얼로그나 완료 토스트를 추가하지 않는다. 빈 폴더·읽기 실패·사라진 파일은 해당 영역에 표시하고 실패 항목에만 재시도를 제공한다.

## 8. 로컬 경로와 Markdown 참조를 공통으로 처리한다

### 8.1 경로 해석을 순수 함수로 만든다

신규 folderPaths.ts의 `parseLocalReference(raw, syntax)`와 `resolveFolderPath(ownerPath, reference)`는 브라우저 API나 DOM을 호출하지 않는다. 결과를 `local / same-document / external / blocked / invalid`로 구분하고, 로컬 조회 결과는 `found / missing / ambiguous / incomplete / permission-denied`로 구분한다.

1. URI scheme·실제 `?`·`#` 구분자를 먼저 분리한다. 경로는 `/`로 나눈 뒤 각 구간을 **한 번만** 디코딩한다. 잘못된 퍼센트 인코딩, NUL, 디코딩 뒤 구분자 `/`·`\`가 생기는 구간은 거절한다. 이미 정규화한 경로를 파일 접근에서 다시 디코딩하지 않는다.
2. 일반 Markdown 상대 경로는 소유 문서 디렉터리에 합치고, `/` 한 개로 시작하면 선택 루트 기준으로 합친다. `..`가 루트 위로 올라가면 차단한다. 실제 파일명 대소문자·한글 조합·공백은 보존한다.
3. 드라이브 경로·UNC·`file:`·`javascript:`·원문 `blob:`·`data:`는 로컬 조회로 넘기지 않는다. `http:`·`https:`와 `//host/path`는 외부 링크로 분류해 기존 검증과 새 탭 정책을 적용한다. 허용된 기타 scheme도 기존 링크 검증을 통과해야 한다.
4. query는 별도 필드로 남기고 파일명에 붙이지 않는다. 로컬 파일 조회는 path만 사용하고 fragment는 범위 선택에 전달한다. `%23`·`%3F`는 디코딩된 파일명의 일부로 남는다.
5. 순수 `#fragment`는 현재 문서 안으로 이동한다. 다른 Markdown 파일의 fragment는 그 구간을 펼친다. 찾지 못한 로컬 경로를 상대 `href`로 남겨 PWA 서버에 요청하지 않는다.
6. 일반 Markdown에는 짧은 이름 검색을 적용하지 않는다. Obsidian의 `./`·`../`는 문서 기준, 경로가 명시된 표기는 루트 기준이다. 확장자가 없으면 Markdown의 `.md`를 보완한다.
7. 폴더 경로 없는 Obsidian 짧은 이름은 루트의 동명 파일을 포함해 전체 이름 인덱스를 조회한다. 전체 탐색이 완료됐고 후보가 하나일 때만 선택한다. 여러 후보는 경로 선택 목록, 탐색 중단/권한 오류는 `incomplete`로 반환한다. 정확한 루트 파일만 지정하려면 `/note.md`처럼 경로를 명시한다.
8. 이름 인덱스는 디렉터리·이름만 취소 가능하게 순회한다. 파일 본문은 읽지 않는다. 새로고침·폴더 전환 시 무효화하고, 실제 파일 조회에서는 경로의 모든 구간을 다시 검증한다.

### 8.2 참조 수집과 fragment 범위를 구현한다

신규 markdownReferences.ts에 `collectMarkdownReferences(source)`, `parseObsidianReference(raw)`, `selectMarkdownFragment(source, fragment)`를 둔다. 참조 결과에는 `from`, `to`, 원문 대상, 표기 종류, 표시명, 이미지 크기, fragment를 포함한다. 범위는 전달받은 원문의 `[from, to)` 좌표다.

- 일반 Markdown은 기존 Lezer Markdown 구문 트리의 `Link / Image`에서 수집하고 인라인·전체/축약/단축 참조형을 같은 대상으로 해석한다. `LinkReference` 정의는 전체 문서에서 모으며 표나 부분 렌더에서도 그 문맥을 전달한다. 정의 행 자체는 클릭 요소로 만들지 않고 정의 이름 정규화는 Markdown 규칙을 따른다.
- Obsidian은 코드·이스케이프·frontmatter를 제외한 구간에서 `[[...]]`와 `![[...]]`를 수집한다. 표기를 먼저 판별해 Lezer가 중첩 `Image`나 `Link`로 본 같은 범위를 중복 처리하지 않는다. 전체 HTML에 정규식을 적용해 링크를 바꾸지 않는다.
- `|표시명`과 이미지의 `|폭`·`|폭x높이`, `#제목`, `#^block-id`를 분리한다. 크기는 유한한 양의 정수만 허용하고 컨테이너 폭을 넘기지 않는다. 별칭은 표시명이며 다른 파일을 찾는 키로 사용하지 않는다.
- 제목은 실제 제목 노드의 표시 텍스트와 `markdownHeadingAnchor(text)`의 slug를 인덱싱한다. slug는 양끝 공백 제거·소문자 변환·연속 공백의 `-` 변환을 적용하고 중복에는 `-1`, `-2`를 붙인다. 표시 텍스트로 같은 제목이 여러 개면 원문상 첫 제목을 선택한다. 선택 범위는 해당 제목부터 다음 같은 수준/상위 제목 직전까지다.
- 블록 식별자는 문단/목록 항목 끝의 `^id`와 구조 블록 뒤 별도 행의 `^id`를 처리한다. 코드 안의 표식은 제외하고 문단·목록·인용·표의 실제 구문 범위를 사용한다. 표시에서 식별자를 숨겨도 원문을 바꾸지 않는다.
- fragment 없음과 찾기 실패를 다른 결과로 반환한다. 실패를 전체 문서 표시로 대체하지 않는다. 지원하지 않는 Obsidian 표기도 조용히 잘못 해석하지 말고 해당 위치에 안내한다.

표기 기준은 [Obsidian 내부 링크](https://obsidian.md/help/links)와 [임베드 문법](https://obsidian.md/help/embeds)이다. 아래 클릭 동작과 중첩 한도는 이 앱의 구현 기준이다.

| 원문 예시 | 구현할 표시 |
| --- | --- |
| `[문서](../guide/start.md)`, `[[guide/start]]` | 링크 버튼. 클릭하면 해당 파일을 앱에서 연다. |
| `![설명](../images/map.png)`, `![[images/map.png\|300]]` | 로컬 이미지를 바로 표시한다. 이미지 크기 표기는 Obsidian 파서가 처리한다. |
| `![문서](../guide/start.md)`, `![[guide/start.md]]` | Markdown 본문을 해당 위치에 임베드한다. 접으면 임베드 본문을 다시 숨길 수 있다. |
| `![[start#제목]]`, `![[start#^block-id]]` | 지정한 제목 구간/블록만 해당 위치에 임베드한다. |
| 로컬 비 Markdown 첨부 링크 | 클릭하면 해당 파일을 앱에서 연다. |
| 로컬 비 Markdown 첨부 임베드 | 파일 정보와 지원 뷰어 열기 또는 다운로드를 임베드 영역에 표시한다. |

### 8.3 편집기·표·읽기 미리보기에 같은 컨텍스트를 전달한다

- 앱 훅이 `MarkdownReferenceContext`를 만든다. 폴더 ID·generation·소유 경로, 대상 조회, 열린 작업본 구독, 이미지 획득/해제, 파일 열기 콜백을 포함한다. 실제 파일 접근은 서비스가 수행한다.
- 전달 경로는 `App.renderDocument → MarkdownEditor → CodeEditor → markdownLivePreview`다. CodeEditor에 선택적 `markdownContext` prop을 추가한다. 문서 내용이나 임베드 갱신마다 EditorView를 재생성하지 않도록 안정된 서비스 참조와 `Compartment`/상태 Effect로 갱신한다.
- 기존 [markdownLinkAttributes](../src/domain/markdown.ts)는 외부 링크에 사용한다. 로컬 참조는 `href` 탐색 대신 opaque reference ID를 가진 버튼/위젯으로 렌더링한다. [renderMarkdown·renderMarkdownMarkup](../src/domain/markdown.ts)에 선택적 렌더 문맥을 추가하고 토큰 단계에서 동일 참조 수집 결과와 연결한다. 컨텍스트 없는 기존 호출도 동작하게 한다.
- 신규 MarkdownPreview.tsx는 정제한 본문과 참조 자리표시자를 렌더링한다. Markdown·Obsidian 임베드는 본문에 표시하고, 로컬 Markdown 링크는 대상 파일을 앱에서 연다. localReferenceState.ts가 임베드별 접힘·오류·읽기 상태를 소유하고 LocalReferenceWidget.tsx가 기존 [React 위젯 루트](../src/components/reactWidgetRoot.ts)를 사용해 표시한다. 임베드 본문은 편집 입력을 받지 않는다.
- Markdown 문서 임베드는 약한 검정 알파 배경으로 본문 영역을 구분한다. 임베드 시작에는 양쪽으로 이어지는 수평선과 가운데 작은 파일명 버튼을 두고, 버튼은 키보드 접근이 가능한 펼치기/접기 토글이다. 이미지 임베드와 일반 로컬 링크에는 문서 임베드 전용 헤더를 붙이지 않는다.
- 라이브 편집에서 문서 임베드 본문은 더블클릭하면 **현재 문서의 임베드 문법이 적힌 원문 행**을 바로 활성화한다. 파일명 버튼에서 `Shift+Enter` 또는 `F2`로도 같은 동작을 제공한다. 임베드 대상 문서를 편집 대상으로 바꾸지 않고, 진입을 위한 빈 줄을 추가하지 않는다.
- 임베드 접힘 상태는 대상 경로 하나가 아니라 **부모 표시 인스턴스 + 원문 출현 범위**로 구분한다. 같은 문서 임베드 두 개와 서로 다른 임베드 안의 같은 링크가 독립적으로 동작해야 한다. CodeMirror 변경 시 범위를 `ChangeDesc.mapPos`로 이동하고 해당 참조가 삭제/교체됐으면 상태를 버린다.
- [preview](../src/features/markdown/preview.ts)의 `ImagePreviewWidget`과 `Link` 처리에 위 해석을 적용한다. 줄 높이를 바꾸는 펼친 본문·이미지 블록은 `StateField`가 직접 제공하는 Decoration으로 만든다. 기존 ViewPlugin의 viewport 기반 Decoration에 여러 줄 블록 위젯을 추가하지 않는다.
- [tableState](../src/features/markdown/tableState.ts)와 [TableWidget](../src/features/markdown/TableWidget.tsx)에 컨텍스트·전체 문서 참조 정의·표의 원문 시작 위치를 전달한다. [RenderedMarkdownTable](../src/features/markdown/TableGrid.tsx)의 `renderMarkdownTable()`도 같은 렌더 문맥과 자리표시자를 사용한다. 표 셀 링크가 로컬 경로를 서버로 열지 않게 한다.
- 이미 열린 대상 문서의 revision 변경을 구독해 펼친 본문을 갱신한다. 중첩 본문의 소유 경로는 대상 문서 경로로 바꾼다. disk 재조회로 작업본을 교체하지 않는다.
- 조상 목록에 `(folderId, path, fragment)`를 전달하고 같은 대상이 다시 나오면 순환 안내를 표시한다. 최대 임베드 깊이는 8, 9단계 진입은 안내만 표시한다. 화면 전체의 방문 집합으로 정상적인 형제 임베드까지 막지 않는다.
- 활성 물리 행·선택·IME에는 기존 원문 편집 규칙을 유지한다. 위젯 버튼 이벤트는 편집기 커서 이동과 분리하고 키보드로 접고 펼칠 수 있게 한다. `aria-expanded`, 대상 경로 레이블과 초점 복귀를 제공한다.
- 이미지 load/error, 본문 갱신·펼치기·접기 뒤 `requestMeasure()`를 요청한다. 위젯 destroy에서 React 루트·구독·읽기 요청·이미지 참조를 해제한다.

### 8.4 로컬 이미지 자원을 제한해서 허용한다

신규 folderResources.ts는 `(generation, path)`별로 Blob URL을 재사용하고 참조 횟수로 해제한다. 위젯은 가시 영역 진입 시 이미지를 요청하고 제거 시 반환한다.

1. 읽기 전 크기 정책을 적용하고 허용 이미지 형식·MIME을 검사한다. 확장자만 바꾼 HTML을 이미지로 전달하지 않는다.
2. 기존 Markdown의 `html: false`와 DOMPurify 정화를 유지한다. 렌더러는 안전한 자리표시자까지만 만들고, 정화 후 앱이 생성한 `<img>`에 자원 관리자가 발급한 URL만 지정한다. 원문의 `src`·`srcset`·외부 이미지 URL을 일괄 허용하지 않는다.
3. SVG는 DOMPurify의 SVG 프로필로 정제한 뒤 script·foreignObject·이벤트 속성·외부 참조와 CSS URL을 제거하고 별도 Blob으로 표시한다. 원본 SVG를 `innerHTML`, iframe, object에 삽입하지 않는다.
4. 폴더 전환은 모든 URL을 revoke하고, 문서 닫기/접기는 해당 참조만 해제한다. 참조 횟수가 0인 뒤 도착한 읽기 결과는 URL을 게시하지 않는다.
5. [Markdown 스타일](../src/styles/markdown.css)에 이미지 최대 폭·오류 표시·펼친 본문·긴 경로 줄바꿈을 추가한다. 새 UI가 본문 폭·전역 가로 스크롤을 늘리지 않게 한다.

## 9. 단계별 구현과 검증을 연결한다

각 단계는 아래 실패 조건까지 확인한 뒤 다음 단계로 진행한다. 신규 테스트 파일은 [tests](../tests/)에 추가하며 새 코드의 의미 있는 실패·경합을 검증한다.

| 순서 | 코드 변경 | 자동 검증 |
| --- | --- | --- |
| 1 | workspace 자료형, folderAccess·FolderPicker, 순수 경로 해석 | folderAccess.test.ts, folderPaths.test.ts: 루트/하위 조회, 취소, 읽기 권한, input 공통 루트 제거, 본문 선행 읽기 없음, 경로 탈출·인코딩 경계 |
| 2 | ID 기반 저장 추출과 전환 상태 | documentSave.test.ts, folderTransition.test.ts: 비활성/새/첨부 문서, 다른 출력 탭, 일부 저장 후 실패, 초안 저장 차단과 버리기 허용, 사용자 동작·다운로드 확인, revision 변경 |
| 3 | 복구 트랜잭션과 App 입력 연결 | 기존 [저장 스키마 검사](../tests/storageSchema.test.ts)·[쓰기 큐 검사](../tests/documentWriteQueue.test.ts) 보강, workspaceStorage.test.ts·folderWorkspace.test.ts: 트랜잭션 실패 시 보존, shares 유지, 복구 꺼짐, 늦은 쓰기·파일 열기·수신의 재삽입 방지 |
| 4 | 트리·보조 목록·모바일 서랍·이미지 보기 | folderTree.test.tsx: 항목별 펼치기, 중복 세션 방지, 키보드/초점, 문서 닫은 뒤 트리 유지, 새로고침 시 작업본 보존 |
| 5 | 참조·제목/블록·위젯·표·이미지 자원 | markdownReferences.test.ts·folderResources.test.ts와 기존 [Markdown 검사](../tests/markdownPreview.test.ts): 참조형/코드 제외, 범위 매핑, 작업본 구독, 중첩 경로·순환·깊이, URL 해제, 외부 요청 차단 |

경로 검사는 최소한 다음 입력과 결과를 고정한다. 예시 소유 문서는 `notes/sub/a.md`다.

| 입력 | 기대 결과 |
| --- | --- |
| `../b.md#제목` | 파일 `notes/b.md`, fragment `제목` |
| `/guide/시작%20안내.md` | 루트의 `guide/시작 안내.md` |
| `./a%23b%3Fc.md#부분` | 파일 `notes/sub/a#b?c.md`, fragment `부분` |
| `./a%2523b.md` | 파일 `notes/sub/a%23b.md`; 이중 디코딩 금지 |
| `../../../outside.md`, `%2Fetc/passwd`, `file:///C:/a.md` | 로컬 접근 차단 |
| `missing.md`, 불완전한 이름 인덱스의 `[[note]]` | 각각 missing / incomplete; 서버 요청이나 임의 후보 선택 금지 |

브라우저에서 직접 확인할 항목은 네이티브 권한·선택기 취소, 저장 후 새 클릭의 폴더 선택, input 취소·재연결, 빈 폴더, 트리 포인터/키보드, 모바일·다크 화면, CodeMirror 높이와 한글 IME다. 자동 검사 통과를 이 항목의 확인으로 기록하지 않는다.

신규 플랫폼 모듈을 [앱 타입 검사](../tsconfig.app.json)의 include와 [lint:app](../package.json)의 명시 목록에 추가한다. 각 단계에서 영향받는 Vitest와 앱 린트·타입 검사를 실행한다. 통합 시 아래 PWA 검사와 두 배포 base 검사를 수행한다.

```powershell
npm run lint:app
npm run typecheck:app
npm run typecheck:tests
npm run test:app
$env:BASE_PATH = '/'
npm run build:app
npm run verify:pwa-build -- /
$env:BASE_PATH = '/the_viewer/'
npm run build:app
npm run verify:pwa-build -- /the_viewer/
Remove-Item Env:BASE_PATH
```

기존 `BASE_PATH`가 있다면 검사 뒤 원래 값으로 복원한다. 공유 자료형이나 전역 선언이 확장에 영향을 주면 해당 타입 검사도 수행한다. 이 작업에서 확장 설치·배포를 자동 수행하지 않는다.

기능 구현을 커밋하기 전 [package.json](../package.json)의 실제 최신 버전을 기준으로 SemVer MINOR를 올린다. 기준 버전 `0.1.3`에서 구현하면 `0.2.0`이다. [잠금 파일](../package-lock.json)의 최상위 버전과 루트 패키지 버전, [공개 버전](../public/version.json)을 맞추고 `__APP_VERSION__`을 유지한다. Vite 생성 manifest/version 파일은 직접 고치지 않는다. 문서만 변경하는 이번 작업에서는 제품 버전을 올리지 않는다.
