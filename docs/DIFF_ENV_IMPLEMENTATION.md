# .diff/.patch·.env 구현 지시서

- 작성일: 2026-11-07
- 상태: 제품 구현 완료, 자동 검증 통과. 실제 브라우저 수동 검증은 미완료.
- 목적: 이 문서를 기준으로 파일별 작업·검증을 진행할 수 있도록 [지원 계획](DIFF_ENV_PLAN.md)을 구체화한다.
- 기준: [에이전트 규칙](../AGENTs.md), [컴포넌트 작성 규칙](COMPONENTS.md), [요구사항](../wiki/REQUIREMENT.md), [용어](../wiki/TERMS.md).

## 1. 작업 범위와 시작 조건

다음 동작을 구현한다.

1. `.diff`와 `.patch`를 내부 형식 `diff` 하나로 처리한다. 저장된 diff를 고정폭 글꼴로 렌더링하고 원본 탭에서 편집한다. 나란히 보기를 기본으로 하며 긴 줄은 자동 줄바꿈한다. `한 줄로 보기`로 전환할 수 있다.
2. `.env`를 내부 형식 `env`로 추가한다. JSON/YAML/TOML과 레이아웃·캔버스·프로퍼티 행·값 칩·조작 로직을 공유하고, 팔레트는 프로퍼티·값 두 항목으로 구성한다.
3. 새 형식을 기존 파일 열기·폴더·첨부·원본 편집·공통 이력·저장·다운로드·복구·PWA/확장 중계에 연결한다.

기존 형식의 요구사항·화면 표시명·목업 수치·파일 제한·권한 정책은 유지한다. diff 적용·생성, `.env` 실행·변수 치환, JSON/YAML/TOML과 ENV 사이의 변환은 이번 작업에 추가하지 않는다.

구현 시작 전에 다음을 확인한다.

- `git branch --show-current`와 `git status --short`를 확인한다. 작성 시점 브랜치는 `codex/sidebar-folder-close-shortcut-spacing`이며 이미 많은 변경이 있다. 기존 변경·삭제·미추적 파일을 작업 기준으로 보존한다.
- 문서에 적힌 행 번호 대신 현재 함수와 호출처를 다시 찾는다. 삭제 상태인 원본 자료를 복원하거나 수정하지 않는다.
- 관련 기존 테스트의 기준 결과를 기록한다. 기존 실패와 새 실패를 구분하고, 실제로 실행하지 않은 검사를 통과로 기록하지 않는다.
- 단계마다 앱·확장 타입 검사가 가능한 상태를 유지한다. 새 `Format`을 등록하는 단계에서 파서·빈 모델·검증·출력 분기를 함께 연결한다.

## 2. 형식 등록과 파일명 계약

[형식 등록](../src/domain/fileFormats.ts)을 형식 ID·확장자 별칭·파일명 규칙의 단일 기준으로 사용한다.

| 항목 | 구현 지시 |
| --- | --- |
| `FORMATS` | `diff`, `env`를 추가한다. `patch`는 별도 형식으로 추가하지 않는다 |
| `FORMAT_EXTENSIONS.diff` | `['diff', 'patch']`를 사용한다 |
| `FORMAT_EXTENSIONS.env` | `['env']`를 사용한다. `local`, `production` 같은 변형 이름의 마지막 부분을 전역 확장자로 등록하지 않는다 |
| MIME | diff 출력은 `text/x-diff`, 인식 별칭은 `text/x-diff`·`text/x-patch`로 정의한다. env 출력은 `text/plain`을 사용하되 인식용 MIME 별칭은 빈 목록으로 둔다 |
| `getFormatByName(name)` | 경로의 마지막 파일명을 대상으로 대소문자를 구분하지 않고 별칭·파일명 규칙을 검사하는 순수 함수를 추가한다 |
| `matchesFormatName(name, format)` | 해당 형식의 모든 별칭과 파일명 규칙을 검사한다. 저장·다운로드 이름 보정에서도 사용한다 |
| `getFormat(name, mimeType)` | 기존의 구체적 MIME 우선 처리를 유지한 뒤 `getFormatByName`으로 판별한다. `FORMATS.includes(마지막 확장자)`와 YAML 전용 별칭 분기를 대체한다 |

ENV 파일명 규칙은 `.env`, `이름.env`, `.env.` 뒤에 비어 있지 않은 접미사가 있는 파일을 허용한다. 예: `.env.local`, `.env.production.local`, `.env.example`. `.env.`, `.environment`, `config.local`, `config.env.local`은 이 규칙으로 인식하지 않는다.

URL은 [확장 URL 처리](../src/platform/extension/links.ts)에서 `URL`로 쿼리를 분리하고 디코딩한 파일명을 전달한다. 공통 파일명 함수에서 임의로 `#` 이후를 제거하지 않는다.

현재 `ensureFormatExtension`은 형식 ID와 다른 확장자를 다시 붙인다. `matchesFormatName`이 참이면 원래 이름을 그대로 반환하도록 고친다. `change.patch`를 `change.diff`로, `.env.production`을 다른 이름으로 바꾸면 안 된다. 새 문서의 기본 이름은 기존 방식인 `Untitled.diff`, `Untitled.env`를 사용한다.

## 3. 공통 블록 편집기 추출

### 3.1. 디렉터리와 책임

공통 UI는 `src/features/block-editor/`, 순수 정책·명령 보조 함수는 `src/domain/block-editor/`에 둔다. 기존 [StructuredDataEditor](../src/features/structured/StructuredDataEditor.tsx)를 얇은 어댑터로 남긴다.

| 새 파일 | 옮기거나 구현할 책임 |
| --- | --- |
| `features/block-editor/BlockEditor.tsx` | 공통 Provider·훅·레이아웃·캔버스를 조합하는 진입 컴포넌트 |
| `BlockEditorLayout.tsx` | 팔레트/캔버스/출력 슬롯과 양쪽 폭 조절·출력 접힘·반응형 배치 |
| `BlockCanvas.tsx` | 격자·world 변환·루트/미연결 블록·고스트·맞춤/확대 도구 |
| `BlockPalette.tsx` | 항목 정의를 받아 같은 포인터/키보드 추가 동작을 제공. 스키마 영역은 별도 슬롯 |
| `BlockPropertyRow.tsx` | 회색 행·이름 입력·빈 소켓·행 드래그. 자식 렌더링은 주입받음 |
| `BlockValueChip.tsx` | 값 선택·드래그·텍스트 입력·긴 값 펼침의 공통 표면. 표시·보조 UI는 주입받음 |
| `BlockOutputPanel.tsx` | 출력 코드·점검·복사·접힘 UI. 형식 선택 영역과 코드 렌더러는 주입받음 |
| `BlockContext.ts` | 기존 `BlockContext`·`useBlocks`와 선택/편집 상태 계약을 공통 위치로 이동 |
| `useBlockEditor.ts` | 선택·편집·접힘·드래그·키보드 명령과 불변 모델 변경 요청 |
| `useCanvasViewport.ts` | 팬·휠·핀치·줌·맞춤·좌표 변환·이벤트 정리 |
| `domain/block-editor/policy.ts` | 허용 그래프와 드롭 정책의 타입. React·브라우저 API에 의존하지 않음 |
| `domain/block-editor/commands.ts` | 기존 그래프 연산에 정책 검증을 적용하는 공통 명령 경계 |

기존 `sd-*` 선택자와 수치를 유지하면서 공통 스타일을 `features/block-editor/block-editor.css`로 옮긴다. JSON/YAML/TOML 전용 스타일·날짜/색 UI는 기존 structured 영역에 남긴다. 복제한 CSS나 형식마다 독립된 캔버스를 만들지 않는다.

### 3.2. 타입과 의존 방향

공통 그래프는 기존 [StructuredModel](../src/domain/structured/model.ts)을 재사용한다. `StructuredFormat`·`StructuredScalar.sourceFormat`·구조 데이터 `SourceRange.format`은 JSON/YAML/TOML 전용으로 유지한다.

핵심 계약은 다음 형태로 정의한다. 코드는 책임을 나타내는 타입 골격이며 필요한 import와 세부 표시 타입을 해당 모듈에 작성한다.

```ts
interface BlockPaletteItem {
  id: string
  label: string
  kind: 'container' | 'property' | 'value'
  createPayload: () => Payload
}

interface BlockEditorPolicy {
  canDrop(model: StructuredModel, source: DragSource, target: DropTarget): boolean
  acceptsGraph(model: StructuredModel): boolean
}

interface BlockEditorProps {
  documentId: string
  model: StructuredModel
  readonly: boolean
  policy: BlockEditorPolicy
  onChange: (model: StructuredModel, group?: 'typing' | 'command') => void
  // 팔레트·루트/자식 노드·값 보조 UI·출력은 React 렌더링 슬롯으로 전달한다.
}
```

위 골격의 렌더링 슬롯은 `palette`, `renderRoot`, `renderNode`, `renderValueExtras`, `renderOutput`처럼 역할이 구분되는 props로 정의한다. `.env` 때문에 공통 컴포넌트 내부에 `format === 'env'` 분기를 반복하지 않는다.

- `StructuredDataEditor`는 기존 팔레트 항목·추론 스키마·`NodeBlock`·날짜/색·타입 메뉴·출력 형식 선택을 연결한다.
- `EnvEditor`는 평면 루트 렌더러와 문자열 값 표시, env 출력만 연결한다.
- `BlockPropertyRow`는 주입된 `renderNode`를 사용하여 중첩 structured 노드와 env 문자열을 같은 행 표면에서 표시한다.
- `BlockValueChip`은 기본 텍스트 조작을 공유한다. structured 어댑터가 타입별 표시·팝오버를 붙이고 env 어댑터는 문자열 표시를 사용한다.
- 팔레트 payload는 드래그/키보드 추가를 시작할 때마다 새 ID로 생성한다. 이동할 때는 기존 ID를 유지한다.
- 팔레트는 제목과 항목 목록을 가진 section 배열을 받는다. structured 어댑터는 기존 section과 카드 표시를 전달하고 env 어댑터는 프로퍼티/값 section만 전달한다.
- 공통 UI는 모델을 별도 상태로 복사하지 않고 props와 `onChange`를 사용한다. 선택·뷰포트·패널 폭 상태는 편집기 인스턴스에 한 번만 둔다.
- 패널 폭·출력 접힘은 `BlockEditor`, 선택·드래그는 `useBlockEditor`, 팬/줌은 `useCanvasViewport`가 각각 소유한다. `BlockEditorLayout`은 상태와 콜백을 props로 받아 배치만 담당한다.
- 파싱·직렬화·클립보드·파일/Chrome API는 어댑터나 platform 콜백으로 연결한다. 공통 레이아웃은 해당 API를 직접 호출하지 않는다.

### 3.3. 명령 정책과 기존 동작

포인터 드롭·키보드 드롭·Delete/Backspace·인라인 입력은 공통 명령 경계를 거친다. 드롭 가능 여부는 원본 분리 전에 확인하고, 변경 결과의 허용 그래프도 검사한 뒤 `onChange`한다. 거부한 동작은 원문·모델·이력을 바꾸지 않는다.

구조적으로 금지된 노드와 출력할 수 없는 초안을 구분한다. env의 객체/배열 값은 금지하지만 이름 미입력·잘못된 이름·빈 소켓은 수정 가능한 초안으로 허용한다. 출력 유효성은 env 직렬화 단계에서 판단한다.

기존 4px 드래그 기준, 클릭 오프셋, 고스트·소켓/삽입선, 빈 캔버스 미연결 블록, 행/값 분리, 25–300% 확대, 패널 키보드 조절, 날짜·색 연속 편집 이력을 유지한다. pointercancel·blur·문서 전환·unmount에서 포인터·키보드·RAF 작업을 정리한다. IME 조합과 입력 요소의 키/휠 조작을 캔버스 명령으로 처리하지 않는다.

출력 패널이 접혔을 때 출력·점검 컴포넌트를 마운트하지 않는다. 접힌 상태의 복사는 클릭 시 최신 모델로 계산한다. 스키마 추론은 structured 팔레트에서만 실행한다.

## 4. ENV 도메인 구현

### 4.1. 모델·파일·함수

`src/domain/env/`에 `model.ts`, `parse.ts`, `validate.ts`, `sourcePatch.ts`, `output.ts`를 만든다.

```ts
interface EnvModel {
  blocks: StructuredModel
  syntax: EnvSyntax | null
  detached: EnvDetachedAssignment[]
}

interface EnvSyntax {
  sourceLength: number
  sourceFingerprint: number
  newline: '\n' | '\r\n'
  records: EnvRecord[]
}

type EnvCompileResult =
  | { kind: 'ready'; model: EnvModel; text: string }
  | { kind: 'draft'; model: EnvModel; preview: string; issues: string[] }
```

`EnvRecord`는 `assignment`, `comment`, `blank` 판별 공용체다. 모든 범위는 BOM을 제외한 `document.text`에 대한 0부터 시작하는 UTF-16 offset이며 끝은 포함하지 않는다.

- assignment는 슬롯 ID, 기준 키·논리 값, 선언 전체 범위, 키 범위, 값 토큰 범위, 인용 방식(`none`/`single`/`double`/`backtick`)을 가진다. 전체 범위에는 들여쓰기·`export`·행내 주석·끝 개행도 포함한다.
- comment/blank는 원문 범위를 가진다. 레코드는 원문 전체를 순서대로 덮고, 레코드 사이의 문자도 누락하지 않는다.
- 기준 키·값은 원문에 대한 정보다. 초안에서 슬롯을 삭제·이동해도 직렬화 비교에 사용할 수 있도록 유지한다.
- 빈 파일은 빈 object 루트와 유효한 빈 syntax를 가진다. `syntax: null`은 파싱 실패의 대체 모델에 사용한다.
- `detached`는 캔버스로 분리한 프로퍼티의 슬롯 ID, 선언 원문 조각, 조각 기준 키/값 범위·기준 값·인용 방식을 가진다. 파일에서 제거한 뒤에도 `export`·인용·행내 주석을 재연결할 수 있게 보관한다. 초기값은 빈 배열이다.
- env scalar에는 `sourceFormat: 'env'`나 기존 구조용 `sourceRange`를 넣지 않는다. env 원문 정보는 전용 syntax로 관리한다.

다음 공개 함수를 제공한다.

| 함수 | 계약 |
| --- | --- |
| `parseEnv(text): EnvModel` | 키 순서·중복과 구문 범위를 보존하여 파싱. 잘못된 문법은 `from`, `to`, `line`, `column`이 있는 `EnvParseError`를 throw |
| `hasEnvModelEnvelope(value)` | UI 명령 경계의 얕은 외곽 검사 |
| `isEnvModel(value)` | 저장·중계 입력의 깊은 검사. 그래프 제약·ID·유한 좌표·구문 범위·분리 선언 조각·참조 형식 검사 |
| `inspectEnv(model)` | 빈 자리·잘못된 이름·중복 키·미연결 블록을 분리해 점검 결과 제공 |
| `withEnvBlocks(model, blocks)` | syntax·detached를 보존하면서 새 그래프를 연결하는 불변 함수 |
| `compileEnv(previous, nextBlocks, source): EnvCompileResult` | 기준 원문과 syntax를 검증하고 편집 결과를 생성. 실패하면 원문을 대체할 text를 반환하지 않음 |
| `outputEnv(model, source)` | 공통 출력 패널이 사용할 `preview`, `text: string \| null`, `issues`, `omissions` 결과 제공 |

저장 검증에서 syntax의 모든 슬롯이 현재 그래프에도 있어야 한다고 가정하지 않는다. 미완성 초안에는 이미 제거한 기준 슬롯 정보가 남을 수 있다. 원본 오류 중에는 마지막 유효 모델의 범위가 현재 입력 원문과 다를 수도 있으므로 범위의 내부 유효성과 현재 원문에 적용 가능한지를 분리해 검사한다.

### 4.2. 문법과 문자열 의미

[Node.js DotEnv 문서](https://nodejs.org/api/environment_variables.html#dotenv)를 기본 문법으로 사용한다. 키는 `^[A-Za-z_][A-Za-z0-9_]*$`, 값은 모두 문자열이다. 인용된 여러 줄, 빈 값, 앞뒤 공백, 주석, `export`를 처리한다. 원문 키의 대소문자를 자동 변경하지 않는다.

인용·이스케이프 처리는 JSON 디코더를 사용하지 않는다. [Node.js 26.4.0 구현](https://github.com/nodejs/node/blob/v26.4.0/src/node_dotenv.cc)을 참조하고 아래 유효 구문 fixture의 기대값을 고정한다. 이 구현에서 백틱 인용도 지원하며 큰따옴표 안의 `\n`을 실제 LF로 처리한다. 일반 `\t`·역슬래시를 JSON 규칙으로 추가 변환하지 않는다.

작성 시점 로컬 Node.js `v26.4.0`의 `util.parseEnv`로 아래 문자열 의미를 확인했다. 이 함수는 개발용 비교 기준으로만 사용하고 브라우저 번들에 Node API를 넣지 않는다.

| 원문 사례 | 기대값 |
| --- | --- |
| `A=0`, `B=true`, `C=null` | 각각 문자열 `0`, `true`, `null` |
| `A=`, `A=""` | 빈 문자열 |
| `A= a # note` | 문자열 `a`; 주석과 공백은 syntax에 보존 |
| `A="a#b=c"` | 문자열 `a#b=c` |
| `A="line\nnext"` | `line`, LF, `next` |
| `A='line\nnext'` | 역슬래시와 `n`이 들어 있는 문자열 |
| 큰따옴표 안의 `tab\tX` | 역슬래시와 `t` 유지 |
| 백틱으로 감싼 `abc` | 문자열 `abc` |
| `A=${OTHER}` | 문자열 `${OTHER}` 유지 |
| `A=first` 다음 `A=second` | 두 슬롯을 순서대로 유지하고 중복 경고. 출력은 허용 |

Node 파서의 중복 키 덮어쓰기·잘못된 구문 건너뛰기는 편집기 동작으로 복제하지 않는다. 닫히지 않은 인용, 잘못된 키, `=` 없는 선언은 원본 오류로 처리한다. 주석·빈 줄을 제외한 알 수 없는 행을 버린 채 일부만 저장하지 않는다.

### 4.3. 변경과 직렬화 절차

1. 현재 문서의 ID·revision·parseState·modelRevision을 검증한다. syntax의 길이·fingerprint가 기준 원문과 일치하는지도 확인한다.
2. 루트가 object이고 연결된 값·미연결 값이 문자열 scalar인지 검사한다. 객체/배열·숫자·boolean·null 값은 명령을 거부한다. 빈 소켓·잘못된 키는 초안으로 유지한다.
3. 변경 없는 루트는 기준 원문을 반환한다. 미연결 블록만 바뀐 경우 파일 내용은 유지한다.
4. 키/값만 바뀌었으면 해당 토큰 범위만 교체한다. 여러 교체는 겹치지 않는지 확인하고 뒤 offset부터 적용한다. 다른 공백·주석·접두어·개행을 다시 쓰지 않는다.
5. 값 토큰은 기존 인용 방식을 우선한다. 같은 논리 값을 보장할 수 없으면 다른 인용 또는 비인용 방식을 선택한다. 인코딩 후보를 다시 파싱해 정확한 문자열을 얻는지 확인하며, 가능한 표현이 없으면 초안으로 남긴다. `JSON.stringify` 결과를 그대로 env 값으로 쓰지 않는다.
6. 추가·삭제·재정렬은 선언 레코드 단위로 처리한다. 이동 선언에는 행내 주석이 따라간다. 독립 주석·빈 줄의 순서는 유지한다. 삭제는 해당 선언만 제거한다. 재정렬은 남아 있는 선언 위치에 대상 순서의 선언을 배치하고 독립 주석을 함께 이동시키지 않는다.
   - 프로퍼티를 미연결 블록으로 분리하면 해당 선언 조각을 `detached`에 보관하고 파일에서는 제외한다. 재연결할 때 조각의 범위를 사용해 이름·값 변경만 반영하고 나머지 구문을 되살린다. 실제 삭제된 블록의 조각은 정리한다.
7. 새 선언은 대상 순서의 다음 기존 선언 앞, 맨 끝 추가는 마지막 선언 뒤·후행 독립 주석 앞에 삽입한다. 기존 선언이 없는 파일은 보존한 주석·빈 줄 뒤에 추가한다. 필요한 행 구분만 보완하며 기존 마지막 개행 유무를 유지한다.
8. 결과를 다시 파싱해 키·값·순서·중복 개수가 목표 그래프와 같은지 확인한다. 순서대로 원래 슬롯·값 ID를 다시 연결하고 미연결 블록도 유지한다. 새 syntax 범위를 반환한다.
9. 유효하면 새 모델·text를 함께 적용한다. 미완성이면 그래프만 반영하고 마지막 유효 text·syntax를 유지한다. 빈 자리 표식은 미리보기에만 표시하며 파일·클립보드 출력에는 사용하지 않는다.

중복 키의 두 번째 행만 수정했을 때 첫 번째 행까지 바뀌지 않아야 한다. ID를 키 문자열이나 객체 프로퍼티로 대체하지 않는다.

파일 출력의 빈 자리·잘못된 이름 검사는 루트에 연결된 선언만 대상으로 한다. 미연결 프로퍼티의 빈 소켓은 파일 출력에 포함하지 않으며 dirty·이력·복구에 보존한다. 같은 revision에서 사용하는 컴파일 결과는 재사용하여 패널 표시와 점검이 각각 전체 직렬화를 반복하지 않게 한다.

### 4.4. EnvEditor

`src/features/env/EnvEditor.tsx`, `EnvRootBlock.tsx`, `envPolicy.ts`를 추가한다.

- `EnvEditor`는 `EnvModel.blocks`를 공통 `BlockEditor`에 넘기고, 변경은 `withEnvBlocks`를 통해 상위 `onChange`로 전달한다.
- 프로퍼티 payload는 기존 방식의 `slot('key', null)`, 값 payload는 `scalar('string', '')`를 사용한다. 추가 시마다 새 ID를 만든다.
- `EnvRootBlock`은 고정 object의 항목을 공통 `BlockPropertyRow`로 표시한다. 컨테이너를 새로 만들거나 루트를 분리하는 동작은 제공하지 않는다.
- 날짜·색 자동 추론과 타입 변경 메뉴를 연결하지 않는다. 날짜·HEX·URL처럼 보이는 내용도 같은 문자열 입력으로 다룬다.
- 원문 오류·재파싱 대기 중에는 마지막 유효 캔버스를 잠근다. 이때 현재 원문과 다른 syntax로 출력·복사를 계산하지 않는다.
- 오른쪽 패널은 env 출력·점검과 기존 복사/접힘 UI를 사용한다. 기존 JSON/YAML/TOML 변환 탭은 세 형식에서 유지한다.

## 5. DIFF/PATCH 도메인과 보기

### 5.1. 모델과 파서

`src/domain/diff/model.ts`, `parse.ts`, `validate.ts`를 만든다. `DiffModel`에는 `sourceLength`, `sourceFingerprint`, 순서 있는 `segments`, 경고 문자열 목록인 `diagnostics`를 둔다. 세그먼트는 원문 구간 또는 파일 구간이며 파일 구간은 헤더·hunk·기타 원문 구간을 포함한다.

hunk는 이전/이후 시작 행·행 수, 헤더 범위, 행 목록을 가진다. 행은 `context`·`addition`·`deletion`·`no-newline` 종류, 원문/본문 범위, 이전/이후 행 번호를 가진다. 원문 문자열을 각 단계에서 중복 저장하지 않는다. 모든 범위는 env와 같은 UTF-16·끝 제외 규칙을 따른다.

`parseDiff(text): DiffModel`, `hasDiffModelEnvelope(value)`, `isDiffModel(value)`를 제공한다. 깊은 검증은 종류·행 번호·범위의 포함 관계·구간 순서·hunk 개수를 검사한다.

파서는 [Git patch 형식](https://git-scm.com/docs/diff-format#_generating_patch_text_with_p)을 참고한 상태 기계로 작성한다.

1. Git `diff --git` 헤더와 일반 unified `---`/`+++` 파일 헤더를 인식한다. 인용 경로·공백 경로는 원문을 보존한다.
2. `@@ -old[,count] +new[,count] @@`의 생략된 count는 1로 처리하고 0도 허용한다.
3. hunk 안에서는 첫 문자로 행 종류를 구분한다. 삭제는 이전 행, 추가는 이후 행, 문맥은 두 행 번호를 증가시킨다. 없는 쪽 번호는 비워 둔다.
4. 마지막 개행 없음 표식은 어느 쪽 행 번호도 증가시키지 않는다. hunk 안의 `---`/`+++` 텍스트를 파일 헤더로 다시 해석하지 않는다.
5. 생성/삭제·이름 변경·모드·index 헤더와 메일 patch의 설명·통계를 보존한다. 헤더만 있고 hunk가 없는 변경도 표시한다.
6. binary·combined/context/normal diff와 깨진 구간은 원문 세그먼트로 남긴다. 가능한 다음 파일 구간에서 해석을 재개한다. 해석 경고를 문서 전체의 치명적 오류로 처리하지 않는다.
7. 빈 파일과 diff 구문이 없는 파일도 원문 보기로 표시할 수 있는 유효 모델을 반환한다. 모든 원문을 어떤 세그먼트에도 넣지 않고 누락하는 경우가 없어야 한다.

### 5.2. 렌더러와 원본

[DiffView](../src/features/diff/DiffView.tsx)와 [diff.css](../src/features/diff/diff.css)에서 diff 보기 렌더러와 스타일을 구현한다.

- 읽기용 이전/이후 나란히 보기를 기본으로 하고 통합 한 열 보기도 제공한다. 우측 플로팅 버튼 셋에서 전환하며, 나란히 보기에서는 한 변경 묶음의 삭제·추가 행을 좌우로 정렬한다.
- 파일·hunk 헤더, 이전/이후 행 번호, `+`/`-` 표식, 추가/삭제 배경을 제공한다. 헤더·본문·행 번호에 기존 `--font-mono`를 사용하고 탭·공백을 보존한다. 긴 줄은 보기 너비에 맞춰 자동 줄바꿈하며 상위 앱 전체 폭을 늘리지 않는다.
- 밝은/어두운 테마에서 배경과 글자 대비를 확인한다. 행 번호가 본문 선택·복사에 섞이지 않게 한다.
- HTML을 해석하지 않고 React 텍스트 노드로 표시한다. diff에 들어 있는 경로로 실제 파일에 접근하지 않는다.
- `modelRevision !== textRevision`이거나 fingerprint가 다르면 이전 범위로 새 원문을 자르지 않는다. 최신 원문을 고정폭으로 표시하고 새 파싱 결과가 오면 구조 보기로 갱신한다.
- 원본 탭은 기존 `SourceEditor`를 사용한다. 새 언어 토큰화를 필수 조건으로 추가하지 않는다. 렌더링 때문에 원문을 정렬·공백 제거·개행 변환하지 않는다.
- [직렬화](../src/domain/serialize.ts)의 diff 분기는 `document.text`를 반환한다. 파싱 모델에서 patch를 재생성하지 않는다.
- 같은 revision의 파싱·행 목록을 렌더마다 다시 만들지 않는다. 큰 입력은 10,000행·100,000행으로 파싱/DOM 비용을 측정하고, 추가 가상화가 필요하면 측정값과 잔여 범위를 기록한다.

## 6. 문서 세션·저장·복구 연결

다음 파일은 새 형식의 UI와 같은 단계에서 함께 연결한다.

| 기존 파일 | 구체적 변경 |
| --- | --- |
| [types](../src/domain/types.ts) | `DocumentModelByFormat.diff = DiffModel`, `.env = EnvModel` 추가. 형식-모델 판별 공용체 유지 |
| [formatParsing](../src/domain/formatParsing.ts) | 두 파서 동적 import, env 파싱 오류 대체 모델과 진단 연결. 마지막 VCF 대체 분기를 명시적 분기로 바꿈 |
| [parseDiagnostics](../src/domain/parseDiagnostics.ts) | diff 경고는 비치명적, env syntax 파싱 실패는 치명적으로 구분. 중복 키 경고로 env 캔버스를 잠그지 않음 |
| [documentModel](../src/domain/documentModel.ts) | 두 외곽 가드와 형식-모델 쌍 추가. env와 structured 모델을 잘못 짝지은 명령을 거부 |
| 새 `domain/blockDocuments.ts` | `isBlockEditorFormat`은 JSON/YAML/TOML/ENV, `getEditableBlocks(model)`는 structured 모델 또는 `EnvModel.blocks`를 반환. 기존 `isStructuredFormat`·`isStructuredViewerDocument`는 세 형식 전용으로 유지 |
| [documentController](../src/domain/documentController.ts) | env 명령도 공통 이력을 기록한 뒤 optimistic 그래프와 비동기 직렬화 결과를 분리. env만의 UI 이력 스택을 만들지 않음 |
| [session](../src/domain/session.ts) | `applyEnvViewCommand`를 추가해 `compileEnv` 적용. dirty·미연결 블록·초안 복구 판정에 공통 그래프 헬퍼 사용. 원본 오류·Undo/Redo·내보내기 기준 유지 |
| [serialize](../src/domain/serialize.ts) | env 출력은 전용 컴파일/출력 함수, diff는 현재 원문. 표현 불가 env를 빈 문자열이나 이전 원문으로 성공 처리하지 않음 |
| [App](../src/app/App.tsx) | 두 렌더러 lazy import, 새 문서 빈 템플릿, 보기 분기, env 어댑터 추가. ENV는 자체 캔버스이므로 `ViewerZoom` 제외. 구조 형식 변환 상태는 기존 세 형식에만 사용 |
| [documentSave](../src/app/documentSave.ts) | 새 형식에도 기존 flush·원본 핸들·취소·dirty 기준 적용. 미완성 env 보기에서 저장·공유·복사를 우회해 이전 text를 출력하지 못하게 검증 |
| [storage](../src/platform/storage.ts) | 빈 모델·정규화·깊은 검증에 두 모델 추가. 요약/payload/blob 분리를 유지하고 기존 schema v1/v2/v3 문서 복구를 보존 |
| [PWA 중계](../src/platform/pwa/extensionRelay.ts) | 새 모델의 외부 입력 검증 추가. 다른 복구 문서는 계속 읽고 손상 문서만 격리 |

ENV 명령 이후의 상태는 다음 기준으로 검증한다.

| 상태 | text·revision·출력 기준 |
| --- | --- |
| 유효한 캔버스 변경 | 새 모델·syntax·text를 함께 반영. `modelRevision`과 `textRevision`을 새 `revision`에 맞추고 `structuredDraft=false` |
| 빈 소켓·잘못된 키 등 초안 | 그래프와 `modelRevision`만 전진. text·syntax·`textRevision`은 마지막 유효 기준 유지. `structuredDraft=true`; 보기의 파일·복사 출력 차단 |
| 미연결 블록만 변경 | 파일 text는 같고 현재 모델 revision은 유효하게 반영. 미연결 블록 때문에 dirty로 판정하고 로컬 복구에 보존 |
| 원본 입력 | 최신 text와 `textRevision` 반영, 기존과 같이 재파싱 대기. 오류 시 마지막 유효 그래프를 잠그고 입력 원문 유지 |
| 오래된 비동기 결과 | 문서 ID·revision·명령 입력 모델이 최신 optimistic 모델과 같은지 확인한 뒤 적용. 정규화된 최종 모델과 입력 모델의 참조를 비교해 정상 응답을 버리지 않도록 주의 |

재파싱 성공 시 env의 미연결 블록과 해당 `detached` 조각도 유지한다. 저장 데이터에는 그래프·syntax·분리 선언 조각·미완성 초안·현재 원문을 함께 보존한다. 새 형식 추가만으로 DB object store나 버전을 변경하지 않는다.

## 7. 파일 입출력·확장·배포 연결

- [FilePicker](../src/platform/FilePicker.tsx)·[browserFiles](../src/platform/browserFiles.ts)의 열기/저장 필터에 별칭을 적용한다. `.patch` 원본 재연결도 허용한다. `.env.local` 같은 변형 이름의 새 위치 저장은 필요하면 확장자 제한 없는 picker를 사용하여 이름 끝에 `.env`가 덧붙지 않게 한다.
- 일반 파일 열기는 모든 파일을 선택할 수 있게 유지한다. `text/plain`만으로 ENV를 추론하지 않는다. 미지원 텍스트의 TXT 경로도 유지한다.
- 폴더·드롭·지원 첨부·붙여넣기·명령 메뉴는 같은 등록 정보를 사용한다. `.patch` 전용 중복 새 문서 명령을 만들지 않는다.
- [자동 열기](../src/platform/extension/autoOpen.ts)는 확장자 별칭과 ENV basename 규칙을 모두 반영한다. HTTP(S)·`file://`·Content-Disposition 경로를 검사한다. `.env.*` 규칙이 경로 구분자·쿼리까지 삼키지 않게 한다.
- [relay 프로토콜](../src/platform/relay/protocol.ts)의 `Format` 기반 검증과 기존 작업 이전 검증에 새 형식을 반영한다. 프로토콜 v1·192 KiB 조각·티켓 만료 정책은 유지한다.
- [Vite 설정](../vite.config.ts)에서 생성하는 PWA 파일 연결에는 `.diff`, `.patch`, `.env`를 넣는다. 확장자만 선언 가능한 OS 연결에 `.env.*`를 억지로 와일드카드 등록하지 않는다. 이 파일들은 일반 파일 선택·폴더·지원 URL 경로에서 열 수 있어야 한다.
- 확장 번들에는 새 파서·렌더러·React 의존성을 넣지 않는다. 두 형식의 기능 자산은 PWA의 기존 지연 로딩·오프라인 캐시 규칙을 따른다.
- 제품 코드 커밋 전에 현재 버전에서 MINOR를 올린다. 작성 시점 `0.2.0`이면 다음 기능 버전은 `0.3.0`이다. [package.json](../package.json), [package-lock.json](../package-lock.json)의 루트 버전, [public/version.json](../public/version.json)을 맞추고 `__APP_VERSION__`을 유지한다.

## 8. 테스트 작성 지시

정상 결과만 확인하지 말고 원문 손실·형식 혼동·초안 유실을 검증한다. DOM 클래스 이름이나 내부 함수 호출 횟수를 그대로 되풀이하는 테스트는 추가하지 않는다.

| 테스트 위치 | 필수 검증 |
| --- | --- |
| 새 `tests/fileFormats.test.ts` | `.diff`/`.patch`/대문자 별칭, `.env`/`*.env`/`.env.*`와 비대상 이름, MIME 우선순위, 일반 `text/plain`의 ENV 오분류 방지 |
| 새 `tests/diff.test.ts` | 다중 파일/hunk·0행/count 생략·행 번호·본문 `---`/`+++`·개행 없음·Git 메타/메일 patch·미해석 구간·원문 전체 범위 |
| 새 `tests/env.test.ts` | 4.2의 문자열 의미, CRLF·한글·주석·인용·중복 키, 잘못된 문법 진단, 값/키 단독 패치의 미편집 문자 보존 |
| env 직렬화 사례 | 중복 키 두 번째 항목만 변경, 선언 삭제 시 독립 주석 유지, 인라인 주석을 포함한 이동·분리/재연결, 새 선언 위치, 마지막 개행, 인용 선택 후 재파싱 동등성·표현 불가 초안 |
| 새 `tests/blockEditor.test.tsx` | 실제 포인터/키보드 추가·분리/재연결·삭제·거부된 드롭 무변경, env의 두 항목·문자열 제약, 인스턴스 상태 분리 |
| [structured 테스트](../tests/structured.test.ts) | 기존 타입·큰 수·날짜·출력 변환·원문 패치와 미완성 초안 회귀 유지 |
| [session](../tests/session.test.ts)·[controller](../tests/documentController.test.ts) | ENV 초안→유효→Undo/Redo, 원문 오류→회복, 미연결 dirty·복구, 잘못된 형식-모델 명령 거부, 비동기 응답 순서 |
| [documentSave](../tests/documentSave.test.ts)·[browserFiles](../tests/browserFiles.test.ts) | `.patch`/변형 env 이름 보존, 출력 직전 flush, 미완성 보기 출력 차단, 원본 오류 원문의 회수, 미변경 savedBytes 재사용·BOM |
| [storageSchema](../tests/storageSchema.test.ts)·[storageIndexedDb](../tests/storageIndexedDb.test.ts) | 두 새 모델·syntax·초안의 실제 저장/복구, 잘못된 범위/ID/값 타입 격리, 기존 버전 업그레이드 유지 |
| [worker](../tests/workerClient.test.ts)·[relay](../tests/relay.test.ts) | 새 형식 Worker/대체 경로, 오래된 결과 폐기, 티켓 kind·파일명·바이트 보존 |
| 새 확장 파일명/규칙 테스트 | 원격 `.patch` 이름, `.env.production` 이름, 일반 MIME·Content-Disposition, URL query/인코딩과 `file://` 자동 열기 |

fixture는 `tests/fixtures/diff/`, `tests/fixtures/env/`에 새로 만든다. 기존 원본 자료 폴더를 테스트 데이터로 수정하지 않는다. `util.parseEnv` 비교는 유효한 단일 선언의 값 의미를 확인하는 테스트에 한정하고, Node 버전의 관대한 오류 처리나 중복 키 손실을 기대값으로 사용하지 않는다.

UI 테스트는 기존 React `act`·jsdom 방식을 따른다. 실제 레이아웃·포인터 hit test·핀치·IME·오프라인은 브라우저에서 별도로 확인한다. jsdom 결과를 브라우저 검증 완료로 표현하지 않는다.

## 9. 실행 순서·완료 기록

| 단계 | 작업 | 통과 조건 |
| --- | --- | --- |
| S1 | 공통 UI·명령 정책을 추출하고 structured 어댑터 연결 | 기존 structured·session·controller 테스트와 앱 타입 검사 통과. 기존 UI 동작 직접 확인 |
| S2 | DIFF 모델·파서·렌더러와 형식/입출력/저장 분기를 함께 추가 | 두 확장자가 같은 내용·행 번호로 열리고 원본 편집·저장·복구 가능 |
| S3 | ENV 모델·파서·원문 변경·세션과 형식 등록을 함께 추가 | 문자열·주석·중복·초안 상태표와 저장 복구 테스트 통과 |
| S4 | EnvEditor·두 팔레트·출력 연결 | 실제 공통 컴포넌트 사용, 타입/중첩 우회 차단, 포인터/키보드·IME·Undo/Redo 확인 |
| S5 | PWA/확장·모든 입력 경로·두 배포 base 검증 | 새 형식 및 기존 형식의 파일 열기·저장·중계·오프라인 검증 기록 |
| S6 | 문서·버전·최종 변경 검토 | 요구사항·용어·README를 실제 지원 상태로 갱신하고 검증/미검증·성능 잔여 항목을 구분 |

각 단계는 관련 테스트와 타입 검사를 실행한 뒤 진행한다. 최종 공통 검사는 `npm run check`다. 이후 루트와 Pages 경로를 각각 빌드·검증한다. PowerShell에서는 임시 환경 변수를 복원한다.

```powershell
$diffEnvPreviousBase = $env:BASE_PATH
try {
  foreach ($diffEnvBase in @('/', '/the_viewer/')) {
    $env:BASE_PATH = $diffEnvBase
    npm run build:app
    if ($LASTEXITCODE -ne 0) { throw "PWA build failed: $diffEnvBase" }
    npm run verify:pwa-build -- $diffEnvBase
    if ($LASTEXITCODE -ne 0) { throw "PWA verification failed: $diffEnvBase" }
  }
} finally {
  if ($null -eq $diffEnvPreviousBase) {
    Remove-Item Env:BASE_PATH -ErrorAction SilentlyContinue
  } else {
    $env:BASE_PATH = $diffEnvPreviousBase
  }
}
```

확장 ZIP을 산출하는 단계에서는 `npm run package:extension` 후 `npm run verify:build`로 실제 버전 ZIP과 확장/PWA 산출물을 확인한다. 검증 완료만으로 배포·외부 게시를 수행하지 않는다.

최종 보고에는 변경 파일과 동작, 실행한 검사, 브라우저 확인, 남은 제한을 적는다. 미완료 단계는 완료로 표시하지 않는다. 이 지시서 작성 자체로 제품 버전 변경·구현·커밋을 수행하지 않는다.

## 10. 구현 완료 기록

- `diff`는 `.diff`와 `.patch`를 하나의 형식으로 읽고, 유효 unified diff의 파일·hunk·행 번호를 고정폭으로 표시한다. 바이너리·미지원·불완전 구간은 원문으로 표시하며 원본 탭 편집은 기존 문서 세션을 사용한다.
- `env`는 공통 BlockEditor의 레이아웃·캔버스·프로퍼티 행·값 칩·출력 패널을 사용한다. 프로퍼티/문자열 값 팔레트, 문자열 전용 평면 모델, 원문 토큰 패치, 주석·중복·미연결 선언 보존, 초안·Undo/Redo·복구를 연결했다.
- 형식 등록, 파일명·MIME 판별, 저장 이름, Worker 파싱, PWA 파일 연결, 확장 자동 열기·원격 이름 처리, 저장소·중계 모델 검증과 README·위키 지원 상태를 갱신했다.
- `npm run check` 통과: 린트, 앱·서비스 워커·확장·도구·테스트 타입 검사, 39개 테스트 파일 207개 테스트, PWA·확장 빌드.
- `BASE_PATH=/` 및 `BASE_PATH=/the_viewer/`에서 각각 `npm run build:app`와 `npm run verify:pwa-build` 통과.
- 실제 브라우저 점검은 완료하지 못했다. Computer Use가 현재 Chrome URL을 정책 확인에 충분한 신뢰도로 판별하지 못해 중단됐다. 따라서 화면 레이아웃, 실제 파일 선택·저장, PWA 설치 후 오프라인, 확장 중계 실동작은 미검증으로 남긴다.
- 구현 과정에서 제품 버전 변경·커밋·배포·확장 ZIP 생성은 하지 않았다. 실제 대용량 diff 렌더 비용도 측정하지 않았다.
