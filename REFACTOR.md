# 리팩터링 점검

- 점검일: 2026-10-31
- 작업 브랜치: `refactor` (`main`의 `c7480c8fc7bd05b364b19ca2e7f75868cb468419`에서 생성)
- 범위: 앱·편집기·형식 처리·PWA·Chrome 중계 확장·저장소·테스트·빌드·배포 설정. 애플리케이션 코드는 변경하지 않고 개선 대상을 기록했다.
- 기준: [요구사항](wiki/REQUIREMENT.md), [용어](wiki/TERMS.md), [컴포넌트 작성 규칙](docs/COMPONENTS.md). 원본 자료와 로컬 fixture는 수정하지 않았다.
- 근거의 행 번호는 위 커밋 기준이다. **재현**은 실제 함수를 실행해 결과를 확인한 항목, **정적 확인**은 코드 경로로 확인한 항목이다. 경합·브라우저 수명 관련 영향은 별도 재현이 필요한 경우 이를 명시했다.

## 1. 요약

28개 항목을 기록했다. P1은 데이터 일관성·손실 위험 또는 기본 검증 실패, P2는 구조·성능·오류 복구, P3은 미사용 코드·스타일·빌드 정리다. P1 7개, P2 18개, P3 3개다.

| 우선순위 | ID | 대상 |
| --- | --- | --- |
| P1 | RF-01 | 저장 기준이 바뀐 뒤 Undo가 잘못된 내용을 내보냄 |
| P1 | RF-02 | 일정 직렬화가 원본 모델을 변경해 후속 편집에서 일정 소실 |
| P1 | RF-03 | 행 배열을 함수 인자로 펼쳐 작은 대량 CSV도 처리 실패 |
| P1 | RF-04 | 전체 문서 재저장과 직렬화 중간 상태의 복구 저장 |
| P1 | RF-05 | 초기 복구·파일 수신 경합과 공유 티켓 조기 삭제 |
| P1 | RF-06 | 저장소 실패를 숨기고 삭제 완료로 안내 |
| P1 | RF-24 | 기본 타입 검사 실패와 PWA 검사 범위 불일치 |
| P2 | RF-07–RF-09 | App 책임 분리, 형식 메타데이터, 문서 타입·마이그레이션 |
| P2 | RF-10–RF-12 | 입력 크기 제한, 파서 Worker·첨부 메모리, 자원 정리 |
| P2 | RF-13–RF-16 | 편집 동기화, 문자열 처리, Markdown 장식·위젯 |
| P2 | RF-17–RF-19 | 그리드 공통화, 일정·연락처 조회, 이메일 렌더링 |
| P2 | RF-20–RF-23 | 청크 오류, 번들 의존성, 전달 세션, 이전 작업 재시도 |
| P2 | RF-25 | 빌드 재사용과 확장 ZIP 배포 보존 |
| P3 | RF-26–RF-28 | 생성 자산, 미사용 코드, CSS 정리 |

## 2. 실행한 검증과 한계

환경은 Windows, Node.js `v24.16.0`, 기존 설치 의존성이다. 패키지나 잠금 파일을 갱신하지 않았다.

| 검사 | 결과 |
| --- | --- |
| `npm run lint` | 통과 |
| `npm run typecheck` | 실패: [Monaco 런타임](src/components/monacoRuntime.ts) 2행의 Worker import에 TS2307 |
| `npm run typecheck:app` | 통과. 다만 확장 소스와 전체 테스트도 포함됨(RF-24) |
| `npx --no-install tsc --noEmit --types vite/client,chrome` | 통과. 기본 검사와 Vite 타입 선언 차이를 확인 |
| `npm run test:app` | 7개 파일, 54개 테스트 통과 |
| `npm test` | 로컬 9개 파일·60개 중 59개 통과. 린트·타입 검사와 병렬 실행 시 50 MiB 전달 테스트가 기본 5초 제한 초과 |
| `npx vitest run tests/relay.test.ts --testTimeout=30000` | 단독 실행에서 4개 모두 통과. 전체 전달 장애로 단정할 결과는 아님 |
| `npx --no-install vite build --mode app` + `node scripts/verify-pwa-build.mjs /` | 루트 PWA 빌드·경로 검사 통과 |
| `BASE_PATH=/the_viewer/` 환경의 Vite 앱 빌드 + `node scripts/verify-pwa-build.mjs /the_viewer/` | Pages 하위 경로 빌드·검사 통과 |
| `npx --no-install vite build --mode extension` | 중계 확장 빌드·앱 전용 모듈 경계 검사 통과 |
| 실제 도메인 함수 실행 | RF-01·RF-02·RF-03 재현. 최대 192 KiB 청크의 메시지 검증도 통과 |

빌드는 원본 트리에 고지 파일 등을 다시 쓰는 `build:icons` 단계를 제외하고 Vite를 직접 실행했다. ZIP 생성·설치·배포, 실제 Chrome 포트 통신, 브라우저 저장 실패·IME·모바일 시각 검사는 실행하지 않았다.

로컬 전체 테스트에는 Git에서 제외된 fixture 검사의 2개 테스트가 포함됐다. 추적되는 테스트는 8개 파일이며, 깨끗한 checkout과 이 작업 폴더의 테스트 집합이 다르다. 해당 로컬 자료를 CI 필수 입력으로 취급하면 안 된다.

앱 빌드에서 측정한 주요 자산은 Monaco 런타임 JS 약 2.70 MB, CodeEditor JS 약 726 KB, Monaco CSS 약 414 KB다. 폰트는 135개·약 3.65 MB이고 PWA precache는 230개·약 9,000 KiB다. 크기는 압축 전 수치이며 초기 화면에서 전부 실행된다는 뜻은 아니다. 번들러는 큰 청크와 파서 모듈의 무효한 동적 import 경고를 냈다.

## 3. 데이터 일관성과 복구

### RF-01 · P1 · Undo의 수정 여부를 현재 저장 기준으로 다시 계산

- **근거·재현:** [세션](src/domain/session.ts) 27–28, 74–89행, [App](src/app/App.tsx) 395–413행. `historyEntry`가 `isDirty`를 저장하고 `undoDocument`가 그대로 덮어쓴다. 내보내기는 이 값이 false이면 현재 텍스트 대신 `savedBytes`를 반환한다.
- **재현 순서:** Markdown `before`를 열기 → `after`로 편집 → 내보낸 스냅샷을 저장 기준으로 반영 → 처음 상태로 Undo → 다시 내보내기. 실제 결과는 화면 텍스트 `before`, 저장 기준 `after`, `isDirty=false`, 출력 바이트 `after`였다.
- **영향:** 수정 표시·닫기 확인·출력이 서로 어긋난다. 사용자가 보는 내용과 다른 파일을 받을 수 있다.
- **개선:** 이력에서는 편집 상태만 복원하고 수정 여부는 현재 저장 기준과 비교한다. BOM 등 출력에 영향을 주는 메타데이터도 이력·저장 기준에 포함할지 명확히 정한다. 내보내기 함수가 잘못된 캐시 플래그만 믿지 않도록 불변식을 검사한다.
- **완료 조건:** 편집→내보내기→Undo/Redo, Undo 뒤 추가 저장, 저장 대기 중 추가 입력에서 화면·수정 표시·출력 바이트가 일치하는 회귀 검사.

### RF-02 · P1 · 일정 직렬화를 입력을 변경하지 않는 함수로 전환

- **근거·재현:** [일정 코어](src/domain/formats/calendar.ts) 96–139행. `new ICAL.Component(model.jcal)`에 원본 배열을 넘긴 뒤 속성·하위 컴포넌트를 수정한다. [세션 이력](src/domain/session.ts) 27–28행도 모델 참조를 공유한다.
- **재현 순서:** UID `a`, `b`인 두 일정을 파싱 → `a`를 제거한 모델 직렬화 → 남은 `b`의 제목을 수정해 다시 직렬화. 첫 출력에는 `b`가 남지만 두 번째 출력의 일정은 0개다. 직렬화 전후 원래 `jcal`의 변경도 확인했다.
- **원인·영향:** 첫 삭제가 원본 배열을 줄여 `componentIndex`와 실제 위치를 어긋나게 한다. 이전 모델·Undo 이력까지 오염된다.
- **개선:** 원본 컴포넌트 트리를 분리해 수정하고 안정적인 컴포넌트 식별자를 사용한다. 재파싱 또는 기준 모델 갱신 시 인덱스 재연결 규칙을 둔다.
- **완료 조건:** 입력 모델의 불변성, 연속 삭제·수정·추가·Undo, 동일 모델의 반복 직렬화 결과를 검증한다. UID가 같은 반복 예외 일정도 별도로 유지한다.

### RF-03 · P1 · 행 수에 비례하는 함수 인자 펼치기 제거

- **근거·재현:** [CSV 파서](src/domain/formats/csv.ts) 13행, [CSV 편집기](src/features/CsvEditor.tsx) 85·196행, [Markdown 표 코어](src/domain/formats/markdownTable.ts) 60·95행, [Markdown 그리드](src/features/MarkdownTableGrid.tsx) 108행의 `Math.max(...rows.map(...))` 패턴.
- **재현:** `parseCsv('column\n' + 'x\n'.repeat(200000), 'UTF-8', false, '\n')`는 400,007바이트 입력에서도 `RangeError: Maximum call stack size exceeded`를 냈다. 파일 크기 제한보다 훨씬 작다.
- **개선:** 반복문 또는 reduce로 최대 열 수를 구하는 순수 함수를 공유하고 불필요한 중간 배열을 없앤다. Markdown 표는 최대 열 수 계산과 행 파싱에서 같은 줄을 두 번 해석하는 작업도 합친다.
- **완료 조건:** 20만 행의 짧은 CSV, 불규칙 열 수, 큰 Markdown 표가 인자 개수에 의존하지 않고 처리된다.

### RF-04 · P1 · 복구 저장을 문서별 확정 스냅샷과 쓰기 큐로 분리

- **근거·정적 확인:** [App](src/app/App.tsx) 170–176행은 변경 후 180ms마다 열린 문서 전부를 저장한다. 309–334행은 모델과 revision을 먼저 갱신하고 텍스트 직렬화는 나중에 완료한다. [저장소](src/platform/storage.ts) 27행은 그 객체를 그대로 기록한다.
- **영향:** 한 글자를 입력하거나 보기 모드만 바꿔도 다른 큰 문서·첨부까지 structured clone·쓰기 대상이 된다. 직렬화가 180ms를 넘으면 `parseState=ready`이면서 `textRevision != revision`인 중간 객체가 저장될 수 있다. 새로 연 앱에는 해당 직렬화 Promise가 없어 복구가 막힐 위험이 있다. 이 경합은 저장 지연을 주입한 통합 재현이 필요하다.
- **개선:** 문서 ID별 변경 집합·revision·직렬화 완료를 추적하는 저장 큐를 두고, 닫기·복구 끄기·데이터 삭제와 같은 큐에서 순서를 보장한다. 확정 텍스트를 저장하거나 미완료 상태를 복구 가능한 명시적 형식으로 기록한다.
- **완료 조건:** 한 문서 수정 시 해당 문서만 저장되고, 느린 직렬화 중 재시작·닫기·복구 해제 후에도 오래된 쓰기가 문서를 되살리지 않는다.

### RF-05 · P1 · 초기화와 모든 파일 입력에 동일한 수신 트랜잭션 적용

- **근거·정적 확인:** [App](src/app/App.tsx) 138–155행은 비동기 복구 후 `setDocuments(saved)`로 목록을 교체한다. 파일 실행 수신과 공유 수신은 238–240·293–303행에서 `loaded`를 기다리지 않는다. [공유 티켓 읽기](src/platform/storage.ts) 50–55행은 파싱·문서 저장 전에 티켓을 삭제한다.
- **영향:** 초기 복구보다 먼저 열린 문서가 목록 교체로 사라질 수 있고, 공유 파일 열기에 실패하면 재시도할 티켓이 없다. StrictMode 재실행과 중복 수신에 대한 처리는 확장 전달 경로에만 별도로 존재한다. 실제 초기 로딩 경합은 브라우저 재현이 필요하다.
- **개선:** 복구 완료 후 입력 큐를 처리하고 수신 ID별 중복 방지를 공유한다. 공유 티켓은 조회와 완료 처리를 나눠 파싱·필요한 저장 성공 후 삭제한다. `openFiles`가 반환하는 문서·오류 결과로 완료 여부를 판단한다.
- **완료 조건:** 느린 초기 복구 중 OS 파일 실행·공유 수신, 중복 이벤트, 일부 파일 파싱 실패에서 문서 소실 없이 재시도 가능하다.

### RF-06 · P1 · 저장소 실패와 삭제 성공을 구분

- **근거·정적 확인:** [App](src/app/App.tsx) 499–519행에서 설정 변경·복구 해제·전체 삭제 오류를 `catch(() => undefined)`로 버린다. 전체 삭제는 실패해도 메모리 문서를 비우고 성공 알림을 낸다. [저장소](src/platform/storage.ts) 29–38행은 여러 저장소를 별도 트랜잭션으로 지운다.
- **영향:** 사용자는 지웠다고 보는데 IndexedDB 데이터는 남거나 일부만 지워질 수 있다. DB 열기 Promise가 실패한 상태로 캐시되면 이후 재시도도 같은 실패를 반환한다.
- **개선:** 저장소 명령의 성공·부분 실패·재시도 결과를 UI에 전달한다. 관련 object store는 한 트랜잭션에서 지우고, 메모리 상태 변경과 성공 안내는 결과에 맞춘다. 실패한 DB 연결 캐시의 초기화도 공통화한다.
- **완료 조건:** DB 열기·쓰기·삭제 실패를 주입했을 때 성공으로 표시되지 않고, 재시도와 현재 작업본 회수가 가능하다.

## 4. 구조와 책임 분리

### RF-07 · P2 · App을 문서 제어와 화면 조립으로 분리

- **근거·정적 확인:** [App](src/app/App.tsx)은 약 700행·51 KB이며 `App` 안에 state 18개, ref 10개, Effect 12개, callback 25개가 있다. 문서·이력·파싱 스케줄·복구·확장 전달·설치·키보드·화면 조립을 모두 담당한다.
- **문제:** 세션 코어가 있어도 App이 같은 revision·진단·저장 기준을 직접 조합한다. `documents`와 `documentsRef`, 여러 Map의 갱신 순서가 사실상 상태 전이 규칙이다. 개별 함수 테스트로 실제 화면 흐름을 검증하기 어렵다.
- **개선:** 문서 상태 전이를 담당하는 controller/reducer와 이력·파싱·저장 서비스를 먼저 추출한다. 수신·PWA 수명·알림은 별도 hook, 사이드바·문서 헤더·모드 탭·붙여넣기 창은 독립 컴포넌트로 둔다. 추가 전역 상태 라이브러리는 필요성이 확인될 때 선택한다.
- **완료 조건:** 화면에서 revision 객체를 직접 조합하지 않고, 같은 문서 명령이 UI 없이도 검증 가능하다. 문서 전환·닫기·Undo·내보내기 통합 시나리오를 유지한다.

### RF-08 · P2 · 형식 메타데이터와 계층 방향을 하나로 정리

- **근거·정적 확인:** [도메인 타입](src/domain/types.ts) 1–3행이 [플랫폼 파일 타입](src/platform/fileTypes.ts)을 가져오고 재노출한다. [브라우저 파일 처리](src/platform/browserFiles.ts) 7·29행은 MIME을 다시 정의하며, [파일 선택기](src/platform/FilePicker.tsx) 15·29행은 확장자 목록을 반복한다. App의 label과 [이메일 첨부 버튼](src/features/EmailEditor.tsx) 77행도 별도 목록이다.
- **영향:** 같은 파일을 MIME으로는 열 수 있는데 첨부의 열기 버튼은 숨겨지는 등 판정이 다를 수 있다. 새 형식 추가 시 UI·manifest·입출력·확장 설정을 각각 수정해야 한다.
- **개선:** 플랫폼에 의존하지 않는 공통 형식 모듈에 MIME·별칭·표시명·확장자·열기 판정을 둔다. 도메인과 플랫폼이 이를 참조하고 picker·첨부 UI·빌드 manifest에서 재사용한다. `PickedFile`도 React 컴포넌트를 통한 재노출 대신 공통 데이터 타입에서 가져온다.
- **완료 조건:** 형식 정의 한 곳의 변경으로 picker·첨부·내보내기·manifest가 함께 맞춰지고 확장 번들 경계는 유지된다.

### RF-09 · P2 · 문서 형식과 모델 타입을 연결하고 저장 스키마를 분리

- **근거·정적 확인:** [문서 타입](src/domain/types.ts) 85–117행에서 `format`과 `model`은 서로 독립된 union이다. [문서 렌더](src/app/App.tsx) 666–674행과 [직렬화](src/domain/serialize.ts)는 반복 cast를 요구한다. [기존 작업 복원](src/platform/pwa/extensionRelay.ts) 27–60·220–270행은 수동 검증 뒤 이중 cast를 사용한다.
- **문제:** CSV 문서에 다른 모델을 넣는 실수를 타입이 막지 못한다. 현재 모델과 과거 저장 레코드가 같은 타입을 공유해, 기존 VCF의 `recordId` 같은 새 필드 정규화가 여러 경계에 흩어져 있다. [저장 레코드 정규화](src/platform/storage.ts)도 일부 필드만 검증한다.
- **개선:** 형식으로 좁힐 수 있는 문서 union 또는 `ModelByFormat`을 사용한다. 저장 레코드·legacy snapshot은 버전별 DTO와 명시적 변환 함수로 분리하고 모델 검증을 공유한다. 출력 가능한 원문은 구조 모델이 잘못돼도 회수 가능하게 유지한다.
- **완료 조건:** 형식·모델 불일치는 컴파일에서 거부되고, 오래되거나 일부 필드가 잘못된 저장 문서도 문서별로 복구·오류 분리된다.

## 5. 입력·자원·편집 성능

### RF-10 · P2 · 바이트를 읽기 전에 크기를 검사하고 입력 정책 공유

- **근거·정적 확인:** [파일 선택기](src/platform/FilePicker.tsx) 24행, [드롭·실행 수신](src/platform/browserFiles.ts) 46–56행, [공유 수신 SW](src/platform/pwa/sw.ts) 21–23행은 먼저 모든 파일을 `arrayBuffer()`로 읽는다. 크기 제한은 [문서 생성](src/domain/session.ts) 93–94행에서 나중에 적용된다. [URL 파일 읽기](src/platform/extension/links.ts) 46–52행도 길이 헤더가 없으면 전체 본문을 읽은 뒤 검사한다.
- **문제:** 거절할 대용량 파일과 다중 파일까지 동시에 메모리에 올린다. 모바일 판정은 일부 경로의 `/Mobi|Android/`와 [전달 프로토콜](src/platform/relay/protocol.ts) 30–35행의 iOS 포함 판정이 다르다.
- **개선:** 기기별 제한을 독립 정책 모듈로 모으고 `File.size` 사전 검사, 제한된 동시 읽기, URL 스트림의 누적 크기 검사·취소를 적용한다. 파일 하나의 실패가 나머지 정상 파일 입력까지 막는지도 정한다.
- **완료 조건:** 초과 파일을 본문 할당 전에 거절하며, 크기 헤더 없는 응답·다중 입력·iOS 판정에서 동일한 정책을 따른다.

### RF-11 · P2 · 파서 Worker 재생성과 첨부 바이트 복제 비용 축소

- **근거·정적 확인:** [Worker 클라이언트](src/domain/workerClient.ts) 8–25행은 요청마다 Worker를 만들고 입력을 복사하며, [Worker 응답](src/domain/parser.worker.ts) 7–8행은 파싱 모델을 structured clone한다. 오래된 결과는 App에서 무시하지만 이미 실행 중인 Worker를 취소하지 않는다. [이메일 파서](src/domain/formats/email.ts) 5·46–49행은 첨부를 `number[]`로 바꾼다.
- **영향:** 큰 파일의 연속 편집에서 Worker 시작·모듈 로드·전체 텍스트 UTF-8 변환·큰 모델 복사가 반복된다. 첨부는 `Uint8Array`보다 큰 배열 표현으로 바뀌고 저장·미리보기에서 다시 변환된다.
- **개선:** 문서별 취소·최신 요청 우선 처리를 갖는 제한된 Worker 서비스와 명시적인 버퍼 소유권을 설계한다. 첨부는 typed array 또는 별도 Blob 저장소를 검토하고 legacy JSON 변환은 경계에 한정한다. `hasFatalDiagnostics` 같은 가벼운 판정은 파서 dispatcher에서 분리해 App·세션의 정적 import가 Worker fallback의 동적 분리를 무효화하지 않게 한다. 무조건 Worker 한 개로 직렬화해 다른 문서를 막는 방식은 피한다.
- **완료 조건:** 입력·닫기 후 취소된 요청이 자원을 해제하고, 원본 바이트를 보존하면서 큰 첨부 문서의 최대 메모리·파싱 지연이 줄어든다.

### RF-12 · P2 · 문서 닫기와 데이터 삭제의 자원 해제 경로 통합

- **근거·정적 확인:** [닫기·전체 삭제](src/app/App.tsx) 438–460·508–519행의 정리 범위가 다르다. 전체 삭제는 [CodeMirror 상태 캐시](src/components/codeEditorState.ts)의 원문 문자열을 정리하지 않는다. [CSV 상태 캐시](src/features/csvEditorState.ts)는 32개 제한만 있고 개별 삭제 API가 없다. 알림 타이머 Map은 만료 뒤에도 항목을 지우지 않고, 닫힌 문서의 파싱 토큰도 남는다.
- **개선:** 문서별 disposer와 전체 reset을 한 수명 관리 인터페이스로 통합한다. 모델·캐시·타이머·프레임·파서·전달 세션을 소유자가 해제하고, unmount 저장이 reset 뒤 캐시를 다시 만드는 순서도 처리한다.
- **완료 조건:** 문서 반복 열기·닫기와 전체 데이터 삭제 뒤 관련 Map·모델·원문 캐시가 남지 않는다. 탭 전환에 필요한 선택·스크롤 복원은 유지한다.

### RF-13 · P2 · 편집기 동기화와 IME 처리의 공통 계약 마련

- **근거·정적 확인:** [원본 Monaco](src/components/SourceEditor.tsx) 42–89·162–216·259–290행, [CodeMirror](src/components/CodeEditor.tsx) 129–159·190–225행, [블록 Monaco](src/features/MarkdownCodeBlockMonacoEditor.tsx) 95–140·145–172행에 외부 값 동기화·선택 매핑·Undo 전달이 반복된다. 블록 Monaco에는 원본 Monaco의 조합 중 외부 변경 병합 처리가 없다.
- **영향:** 선택 보존·혼합 개행·IME 관련 수정을 여러 군데 맞춰야 한다. YAML·코드 블록 편집에서 같은 보호가 적용되는지는 실제 IME 검증이 필요하다.
- **개선:** 엔진별 DOM 조작은 adapter로 두고 동기화 상태 머신·세션 텍스트·composition·변경 그룹 규약을 공유한다. Monaco 공통 옵션·키 처리·선택 매핑도 추출한다. 차이를 지우는 거대한 범용 컴포넌트로 합치지는 않는다.
- **완료 조건:** 전체 원본·모바일·코드·YAML 편집에서 외부 Undo와 IME 입력이 겹쳐도 입력·선택·개행을 보존한다.

### RF-14 · P2 · 입력마다 반복되는 전체 문자열 스캔과 diff 중복 제거

- **근거·정적 확인:** [텍스트 변환](src/components/editorText.ts) 20–47·159–171·205–237행은 변경마다 개행 전체 목록을 만들고 각 edit에서 다시 스캔한다. Monaco 동기화는 `findTextChanges` 호출 뒤 `createTextPositionMapper` 안에서 동일 diff를 다시 계산한다. [Markdown 통계](src/features/MarkdownEditor.tsx) 17–18행과 [원본 상태바](src/app/App.tsx) 645행도 전체 split을 반복한다.
- **개선:** 한 변경 집합에서 diff·위치 매핑을 함께 만들고 개행 인덱스를 재사용하거나 증분 갱신한다. 통계는 해당 텍스트 revision 기준으로 캐시하고 큰 문서에서는 입력 반영과 집계를 분리한다. [vCard 줄 접기](src/domain/vcard.ts) 101–110행의 문자별 `TextEncoder` 생성도 재사용 가능한 인코딩 계산으로 줄인다.
- **완료 조건:** 여러 위치 붙여넣기·혼합 개행 보존 결과를 유지하면서 긴 문서의 입력 지연·할당량을 측정해 비교한다.

### RF-15 · P2 · Markdown 장식 계산을 변경 범위 중심으로 축소

- **근거·정적 확인:** [라이브 프리뷰](src/components/markdownPreview.ts) 139–307·329–445·457–469행. 일반 장식은 선택 변경에도 전체 트리를 순회하고, 문서 변경 시 표·코드·frontmatter 상태가 각자 다시 탐색한다. frontmatter 감지는 매번 전체 문자열을 만든다. 표는 builder에서 검사하고 [상태 update](src/components/markdownTableState.ts) 33–36행에서 변경 여부를 확인하기 전에 또 파싱한다.
- **개선:** 파싱 결과·frontmatter 범위·블록 인덱스를 revision별로 공유한다. 기존 Decoration의 위치를 매핑하고 변경 블록·활성 행 주변을 갱신한다. 표 update는 원문이 같으면 재파싱을 건너뛴다. 긴 frontmatter의 개행 탐색도 반복적인 나머지 문자열 검색을 줄인다.
- **완료 조건:** 커서 이동과 본문 한 글자 변경의 작업량이 전체 표·코드 수에 비례해 커지지 않는다. 활성 행·중첩 목록·YAML·체크리스트의 기존 결과를 유지한다.

### RF-16 · P2 · Markdown 위젯 연결부와 기능별 배치를 공통화

- **근거·정적 확인:** [표 위젯](src/components/MarkdownTableWidget.tsx), [코드 위젯](src/components/MarkdownCodeBlockWidget.tsx), [frontmatter 위젯](src/components/MarkdownFrontmatterWidget.tsx)의 WeakMap·React root 생성·contenteditable·이벤트·해제가 거의 같다. 세 상태 클래스에도 snapshot·subscribe·editing·replace dispatch가 반복된다. 공통 components가 features를 가져오고 그 feature가 다시 components를 참조한다.
- **개선:** React–CodeMirror 연결용 작은 helper와 구독 저장소의 공통 부분을 추출한다. 표·코드·YAML별 구문 보존 로직은 각 기능에 둔다. Markdown 전용 구현은 같은 기능 디렉터리로 모아 공통 편집기와의 역방향 의존을 줄인다.
- **완료 조건:** root 해제 지연·이벤트 격리 수정이 한 곳에서 적용되고, 위젯 생성·갱신·제거 때 편집 상태와 포커스를 유지한다.

## 6. 기능별 화면과 전달 경로

### RF-17 · P2 · CSV와 Markdown 표의 그리드 기반 요소 공유

- **근거·정적 확인:** [CSV 편집기](src/features/CsvEditor.tsx) 73–74·107–213행과 [Markdown 표](src/features/MarkdownTableGrid.tsx) 66–67·153–234행에 Glide 타입 보정, 테마, 셀 변환, 붙여넣기·삭제·행열 동작이 반복된다. Markdown 쪽은 셀 한 개 수정에도 모든 행 배열을 복제한다.
- **개선:** 그리드 adapter·테마 생성·셀 변경 적용 같은 순수 로직을 공유하고 CSV의 필터 행 매핑과 Markdown의 원문 직렬화는 분리한다. 수정된 행만 복제하고 공통 색·폰트 토큰을 [스타일](src/styles.css)과 일치시킨다. 헤더 편집·표 도구막대의 반복 UI도 작은 컴포넌트로 추출한다.
- **완료 조건:** 정렬·필터 상태의 붙여넣기, 열 너비, 선택 삭제·채우기, Markdown 정렬·셀 구문 보존이 동일하게 작동한다.

### RF-18 · P2 · 일정·연락처의 조회 모델과 목록 렌더링 분리

- **근거·정적 확인:** [일정 반복 확장](src/domain/formats/calendar.ts) 36–63행은 이벤트마다 전체 `jcal`을 JSON 복제하고 최대 1만 회 반복한다. [일정 화면](src/features/CalendarEditor.tsx) 38–46·76행은 렌더마다 이를 반복하고 선택 일정도 다시 확장한다. [연락처 화면](src/features/ContactsEditor.tsx) 14·25행은 렌더마다 전체 검색 문자열을 만들고 모든 항목을 렌더한다.
- **개선:** 문서 revision·표시 기간 기준으로 일정 컴포넌트와 발생일을 한 번 계산하고 선택 상태와 분리한다. 검색 인덱스·날짜 formatter를 재사용하고 큰 목록은 가상화 또는 점진 렌더링을 검토한다. 날짜별 그룹에 항목을 추가할 때 누적 배열의 반복 복제도 줄인다.
- **완료 조건:** 일정 선택·편집 모드 전환만으로 전체 반복 계산이 다시 돌지 않고, 다수 연락처·반복 일정에서 검색과 선택이 응답한다.

### RF-19 · P2 · 이메일 HTML 준비를 렌더에서 분리하고 실제 정제 경로 검증

- **근거·정적 확인:** [이메일 화면](src/features/EmailEditor.tsx) 22–33행은 매 렌더마다 CID 치환·전체 HTML 정제를 수행한다. [이메일 테스트](tests/emailEditor.test.tsx) 7행은 DOMPurify를 입력 그대로 반환하도록 mock한다.
- **개선:** CID 해석·HTML 정제 정책을 전용 모듈로 추출하고 HTML·첨부 URL이 바뀔 때만 계산한다. UI 단위 검사와 별개로 실제 DOM 환경의 정제·외부 자원 차단 검사를 마련한다. 읽기 전용 역할에 맞춰 화면 이름도 검토할 수 있다.
- **완료 조건:** inline 이미지·본문·전달 메일을 유지하고, 이벤트 속성·외부 이미지·스타일 등 현재 제한이 실제 렌더 결과에서 검증된다. 현 시점에 정제 우회가 재현됐다는 뜻은 아니다.

### RF-20 · P2 · 지연 로딩 오류와 복구 동작을 문서 경계에 배치

- **근거·정적 확인:** [App](src/app/App.tsx) 23–28·641–643행은 여러 feature를 lazy로 가져오지만 ErrorBoundary는 없다. [진입점](src/main.tsx) 6–10행은 CSS preload 오류의 기본 처리만 막는다.
- **영향:** 배포 교체·캐시 불일치 등으로 청크 import가 실패할 때 문서별 재시도 대신 상위 렌더 실패로 이어질 수 있다. 구체적인 브라우저 실패 재현은 하지 않았다.
- **개선:** 문서 feature 경계에서 오류·재시도·현재 원문 회수 동작을 제공하고 preload 오류를 같은 정책으로 처리한다. 복구 저장이 끝나지 않은 편집 내용을 자동 새로고침으로 잃지 않게 한다.
- **완료 조건:** 편집기 청크·CSS 로드 실패를 주입해도 작업 공간과 원문 회수가 유지된다.

### RF-21 · P2 · 모바일 원본 편집과 Markdown 프리뷰의 의존성 분리

- **근거·정적 확인:** [원본 편집기](src/components/SourceEditor.tsx)는 모바일 분기 전에 Monaco 런타임·CSS를 정적으로 import한다. [CodeEditor](src/components/CodeEditor.tsx) 6행은 라이브 프리뷰를 항상 import하고, 프리뷰는 표 위젯을 통해 Glide와 [다수 언어 구문 강조](src/components/markdownCodeHighlight.ts)를 끌어온다.
- **영향:** 모바일에서 CodeMirror 원본을 쓰더라도 Monaco 의존 청크를 로드한다. 단순 CSV 원본에도 Markdown 표·하이라이터 의존성이 연결된다. 측정한 2.70 MB Monaco·726 KB CodeEditor 청크의 정리 지점이다.
- **개선:** 가벼운 원본 편집 컨테이너에서 데스크톱·모바일 구현을 각각 lazy로 선택한다. CodeMirror 기본 편집과 Markdown 프리뷰 extension도 분리한다. 언어 강조는 필요한 언어만 로드하는 방식을 비용과 함께 검토한다. 테마만 바뀔 때 [CodeEditor](src/components/CodeEditor.tsx) 267행의 전체 view 재생성 대신 reconfigure를 사용한다.
- **완료 조건:** 모바일 원본 진입에서 Monaco를 요청하지 않고, 프리뷰 미사용 원본은 Glide·Markdown 렌더 코드를 불러오지 않는다. 오프라인 기능과 테마 전환 시 편집 상태를 보존한다.

### RF-22 · P2 · 확장 전달의 연결·검증·완료를 세션으로 묶기

- **근거·정적 확인:** [PWA 전달](src/platform/pwa/extensionRelay.ts) 16–18·107–129행은 수신 Promise와 포트를 별도 Map으로 관리한다. 완료 성공 시 포트를 Map에서만 제거하며 명시적으로 disconnect하지 않는다. 완료 재시도는 파일 전체를 다시 수신한다. [청크 검증](src/platform/relay/protocol.ts) 71–89·103행은 decode→재encode 검증 후 수신부에서 다시 decode한다.
- **개선:** 연결·취소·TTL·완료 재시도를 소유하는 전달 세션을 만든다. 검증된 바이트를 재사용하고, 필요하면 프로토콜 버전을 올려 재수신 없는 완료 확인을 설계한다. 바이트 동일성·허용 origin·탭·순서 검증을 유지한다. legacy 복원·스키마 검사는 전송 모듈 밖으로 옮긴다.
- **완료 조건:** 중간 단절·완료 응답 유실·파싱 실패·재시도 후 포트가 남지 않고 티켓 삭제가 중복 실행에 안전하다. 실제 Chrome 통합 검사가 필요하다.

### RF-23 · P2 · 기존 작업 이전을 문서별 재시도 가능한 작업으로 분리

- **근거·정적 확인:** [확장 중계 화면](src/platform/extension/relay.ts) 158–182행은 모든 문서에 빈 탭·티켓을 먼저 만든 뒤 한 번에 PWA로 이동한다. 준비 중 오류가 나면 이미 만든 탭·티켓 정리나 해당 작업 재사용이 없다. [완료 상태 갱신](src/platform/extension/background.ts) 172–181행은 여러 탭에서 동일 storage 값을 읽고 덮어쓴다.
- **영향:** 일부 실패 후 재시도에서 중복 탭·티켓을 만들 수 있고, 동시 완료 시 `completedIds` 갱신이 유실될 여지가 있다. 이 동시성은 실제 확장 환경에서 재현해야 한다.
- **개선:** 문서별 job ID·준비/전달/완료 상태를 저장하고 실패 지점부터 재개한다. 생성 자원은 실패 시 정리하거나 재사용하며 완료 갱신을 직렬화한다. 렌더 함수와 이전 작업 제어를 분리한다.
- **완료 조건:** N번째 준비 실패, 탭 생성 뒤 실패, 동시 완료 후 재시도에서도 원본 데이터를 유지하고 완료 문서를 중복 이전하지 않는다.

## 7. 검증·빌드·미사용 코드

### RF-24 · P1 · 타입·테스트 검사 범위를 명시하고 기본 검사 복구

- **근거·재현:** [기본 TS 설정](tsconfig.json)은 [PWA TS 설정](tsconfig.app.json)의 `vite/client` 타입을 갖지 않아 기본 타입 검사가 실패한다. CLI에 `--types vite/client,chrome`를 추가하면 통과했다. PWA 설정의 `files`는 부모 `include`를 없애지 않아 확장 6개 소스와 전체 테스트·로컬 fixture까지 포함한다.
- **추가 문제:** [스크립트](package.json) 16–27행은 lint 대상과 테스트 파일을 수동 열거한다. 새 테스트가 PWA CI에서 빠질 수 있고 기본 Vitest 탐색은 Git 제외 로컬 fixture 검사까지 실행한다. 50 MiB 테스트는 CPU 경합에서 기본 5초 제한을 넘겼다. Worker가 없는 Node fallback 검사만으로 실제 Worker·저장소·App 상태 흐름을 보장할 수 없다.
- **개선:** 공통 TS 옵션과 앱·SW·확장·빌드 도구·테스트 프로젝트를 분리한다. Vitest 프로젝트/include 규칙으로 검증 집합을 정의하고 무거운 크기 한계 검사의 실행 조건·시간 제한을 명시한다. RF-01~RF-06을 보호하는 도메인·저장 경계 통합 검사를 우선 보강한다.
- **완료 조건:** 깨끗한 checkout에서 기본·PWA 검사가 모두 통과하고, 각 명령이 검사하는 파일 목록이 의도와 맞는다. 새 테스트가 파일명 규칙만으로 해당 CI에 포함된다.

### RF-25 · P2 · 검증한 빌드를 배포하고 확장 ZIP을 다음 PWA 배포에도 보존

- **근거·정적 확인:** [Pages workflow](.github/workflows/pages.yml)는 verify에서 루트·하위 경로를 빌드한 뒤 deploy에서 다시 빌드한다. [확장 workflow](.github/workflows/publish-extension.yml)도 `check`·`package:extension`·deploy에서 빌드를 반복한다. 확장 ZIP은 [게시 스크립트](scripts/publish-extension.mjs)가 그 실행의 앱 출력에만 복사한다.
- **영향:** 검증 산출물과 배포 산출물이 별도 생성된다. 수동 확장 배포 후 다음 일반 PWA 배포는 `downloads`를 구성하지 않은 새 앱 출력만 업로드하므로 기존 ZIP 다운로드 경로를 없앨 수 있다. 이 결과는 workflow 분석이며 실제 배포는 하지 않았다.
- **개선:** 검증 단계의 최종 Pages 산출물을 artifact로 넘겨 그대로 배포한다. 확장 ZIP의 버전별 보관소 또는 release 자산을 두고 PWA 배포에서도 명시적으로 포함한다. 확장 설치·검증 후 수동 게시하는 현재 요구사항은 유지한다.
- **완료 조건:** 검증·배포 해시가 같고, PWA 단독 업데이트 뒤에도 기존 버전·latest 확장 ZIP을 내려받을 수 있다.

### RF-26 · P3 · 자산 검증·라이선스 생성·버전 출력을 분리

- **근거·정적 확인:** [아이콘 스크립트](scripts/generate-icons.mjs)는 아이콘 생성 대신 파일 존재 확인·전체 lock 패키지의 라이선스 복사·버전 파일 출력을 수행한다. 기존 고지는 정리하지 않고 새 파일만 더한다. [Vite 설정](vite.config.ts)은 같은 고지 디렉터리를 확장에도 전부 복사한다. 현 로컬 고지 자산은 504개·약 1.04 MB다.
- **문제:** 명령 이름과 책임이 다르고 빌드가 소스 트리의 생성물을 변경한다. 설치 OS·남은 패키지 파일에 따라 결과가 달라지며 사용하지 않는 과거 고지가 누적될 수 있다. [SW](src/platform/pwa/sw.ts)의 직접 import인 `workbox-precaching`·`workbox-routing`도 현재는 직접 의존성 선언 없이 전이 설치에 의존한다.
- **개선:** 아이콘 확인·고지 생성·버전 출력을 분리하고 배포용 staging에서 결정적으로 생성한다. 포함 패키지의 고지는 유지하면서 현재 산출물과의 대응을 검증한다. 직접 import하는 패키지는 의존성에 명시한다. 폰트·precache 전체 약 9 MB의 구성도 오프라인 요구사항을 유지하며 검토한다.
- **완료 조건:** 깨끗한 Windows/Linux 설치에서 고지 목록이 설명 가능하고 일반 빌드가 추적 소스를 변경하지 않는다. 설치에 필요한 고지와 오프라인 자산은 빠지지 않는다.

### RF-27 · P3 · 미사용 코드와 과거 제품 경로 정리

앱·확장·SW 진입점에서 정적 import, 동적 import, Worker URL을 포함해 참조를 추적하고 아래 이름을 전체 검색했다. 외부 호출 없는 export와 테스트 전용 코드를 구분했다.

| 후보 | 확인 결과 | 권장 처리 |
| --- | --- | --- |
| [getMime](src/domain/formatParsing.ts) 56행 | 선언 외 참조 없음 | `FORMAT_MIME` 직접 접근으로 충분하므로 삭제 검토 |
| [makeBlankDocument](src/domain/session.ts) 109–110행 | 선언 외 참조 없음. App은 별도 생성 경로 사용 | 새 문서 생성 경로에서 사용하거나 중복 helper 삭제 |
| [saveShareTicket](src/platform/storage.ts) 47–49행 | 선언 외 참조 없음. SW가 같은 작업 직접 구현 | SW·앱 공유 모듈로 연결하거나 helper 제거. 공유 기능 자체는 유지 |
| [csvColumnColorVariable](src/components/csvColumnColors.ts) 13–15행 | 선언 외 참조 없음 | 사용처의 토큰 규약과 통합하거나 제거 |
| [createEmailPreviewDocument](src/features/emailPreviewDocument.ts) | 런타임 진입점에서 도달하지 않음. [이메일 테스트](tests/emailEditor.test.tsx) 12–20행만 사용 | 사용 종료된 iframe 문서 생성기와 그 테스트를 정리하고 현재 inline 본문 검증으로 교체 |

- **조건부 후보:** [EML 편집 가능 판정·직렬화](src/domain/formats/email.ts) 133행 이후와 [직렬화 dispatcher](src/domain/serialize.ts) 7–10행. 현재 이메일 보기는 읽기 전용이고 원본 편집은 텍스트로 출력하므로 UI에서 이 모델 편집 경로를 호출하지 않는다. 다만 dispatcher와 테스트 참조가 남아 있으므로 참조 없는 함수로 단정하지 않는다. 기능 확장 계획이 없다면 지원 API에서 제거하고 파싱과 분리할 수 있다.
- **축소 후보:** 내부에서만 쓰는 `unfoldVCard`, 상태 snapshot 타입 등은 필요 이상으로 export하지 않는다. 테스트에 노출된 순수 함수라는 이유만으로 삭제하지 않는다.
- **완료 조건:** 이름 검색과 엔트리 도달성으로 제거 범위를 재확인하고, 필요한 동적 파서·Monaco 언어 등록·legacy 복원 경로는 유지한다.

### RF-28 · P3 · CSS를 기능 단위로 나누고 사용 종료된 선택자 제거

- **근거·정적 확인:** [전역 스타일](src/styles.css)은 약 660행·62 KB에 앱 셸·대화상자·모든 feature·편집 엔진·반응형 규칙을 함께 담는다. 267–275행의 `.remote-dialog`·`.remote-icon`·`.remote-origin`·`.remote-permission-note`, 307행의 `.markdown-reading`과 `.markdown-prose` 계열은 현재 앱 소스에 사용처가 없다.
- **개선:** 토큰·공통 UI·셸·형식별·편집기 스타일로 나누고 기능 코드와 가까이 둔다. 더는 렌더하지 않는 원격 링크 창·과거 Markdown 보기 규칙을 제거한다. 같은 선택자가 여러 번 나온다는 이유만으로 상호 보완 규칙을 삭제하지 말고 실제 cascade를 확인한다.
- **주의:** `.format-*`처럼 동적으로 만드는 클래스, `cm-*`·Monaco·Glide 클래스, `hljs-*`, 파일 HTML의 전달 메일 클래스는 문자열 검색만으로 미사용 판정하면 안 된다.
- **완료 조건:** 다크·라이트·데스크톱·모바일, 원본·라이브 프리뷰·표·코드·YAML·이메일 화면에서 목업과 현재 요구사항의 스타일을 보존한다.

## 8. 권장 진행 순서

1. **검증 기반과 재현 문제:** RF-24 기본 검사 정리 → RF-01·RF-02·RF-03의 실패 시나리오를 회귀 검사로 고정하고 수정한다.
2. **문서 상태·저장 경계:** RF-07의 controller 추출을 RF-04·RF-05·RF-06과 함께 진행해 복구·수신·삭제 순서를 명시한다. RF-09의 타입·저장 스키마는 이 경계에 맞춰 점진 적용한다.
3. **공통 요소와 자원 수명:** RF-08·RF-12·RF-13·RF-16·RF-17을 작은 단위로 추출한다. 현재 구문 보존·IME·Undo 규칙을 유지한다.
4. **측정 가능한 성능:** RF-10·RF-11·RF-14·RF-15·RF-18·RF-19·RF-21은 큰 CSV·긴 Markdown·첨부 많은 EML·반복 일정으로 입력 지연·최대 메모리·요청 청크를 비교한다.
5. **전달·배포·정리:** RF-20·RF-22·RF-23은 실제 브라우저 실패 주입으로 확인하고, RF-25의 ZIP 보존을 검증한다. RF-26·RF-27·RF-28은 기능 변경과 분리해 정리한다.

큰 파일을 단순히 쪼개는 작업보다 상태 불변식과 소유권 정리가 먼저다. 원본 바이트 보존, 보기/원본의 동일 작업본, 명시적 업데이트, 중계 확장의 앱 모듈 제외, 원본 자료 보존은 리팩터링 후에도 유지해야 한다.
