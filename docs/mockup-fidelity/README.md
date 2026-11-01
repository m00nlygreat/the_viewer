# 목업 충실도 재평가 근거

- 일자: 2026-11-01
- 브랜치: json
- 판정: 주요 레이아웃과 표현을 보정했다. 실제 포인터 드래그 중 시작 원본·고스트·삽입선의 치수가 기준과 일치함을 확인했고, 9개 화면의 관련 상태를 32개 live 경로로 점검했다. 최신 상태 경로의 새 화면 이미지는 저장하지 않았다. 실제 팬·한글 IME·모바일 기기 터치는 미완료이며, 모든 상태 조합 검수도 아니다.
- 원본: [JSON 뷰어 디자인](../../ref/JSON%20%EB%B7%B0%EC%96%B4%20%EB%94%94%EC%9E%90%EC%9D%B8.html)
- 보정 계획: [GOAL](../../GOAL.md)

## 비교 조건

라이트 테마, 1440 × 980, 캔버스 100%의 동일 order 상태를 비교했다. `total`·`tags[2]`는 빈 자리, `note`는 null, `memo`는 연결 안 된 블록이다. `customer`·`tags`는 펼치고 `recipient`는 접었으며 `wrapColor`를 선택했다. `placedAt`은 JSON 문자열 그대로 비교했다. 전 사례 입력은 합성 fixture만 사용했다.

앱 셸이 만드는 절대 위치 차이는 제외했지만 편집기 내부의 폭·정렬·서체·색·팝오버·출력 차이는 제외하지 않았다. `capture=1`은 검수 페이지 머리글만 숨기며 초안 안내·미리보기·잠긴 버튼은 그대로 보인다. 캡처 전 폰트 로드와 100% 배율을 확인했다. 제품 화면의 합성 사례에서 실제 브라우저 입력·포인터 조작을 확인하고, 재현 URL의 hover 표시는 같은 CSS 상태를 검수 전용 클래스에 적용한다. 사용자는 실제 입력을 공유할 수 없다고 답했으므로 계속 합성 fixture만 사용한다.

[사례 명세](order-review.fixture.json)는 재현용 데이터이고 앱 저장 스키마가 아니다. [계측값](measurements.json)은 브라우저 관측치다. 내용에 따라 달라지는 폭을 고정 규격으로 사용하지 않는다.

## 기준 화면과 저장 캡처

| 상태 | 목업 | 저장 캡처 |
| --- | --- | --- |
| order 편집기 | [기준 편집기](reference-editor.jpg) | [현재 편집기](current-editor-final.png) |
| 텍스트 펼치기 | [기준 문단](reference-expanded-text.jpg) | [현재 문단](current-case-text-expanded.png) |
| 날짜·시간 | [기준 날짜](reference-date.jpg) | [현재 날짜 사례](current-case-date-links-final.png), [날짜 팝오버](current-date-popover-final.png) |
| 색 | [기준 색](reference-cases-top.jpg) | [현재 색 사례](current-case-color-final.png), [HEX 변환 후](current-case-color-converted.jpg), [색 팝오버](current-color-popover-final.png) |
| 숫자·컨테이너 | [기준 중간 사례](reference-cases-middle.jpg) | [숫자](current-case-numbers-final.png), [컨테이너](current-case-containers-final.png) |
| 깊이·키·상호작용 | [기준 하단 사례](reference-cases-bottom.jpg) | [깊은 중첩 단독 보기](current-case-deep-isolated.png), [전체 복귀](current-case-deep-return-root.png), [키](current-case-keys-final.png), [상호작용](current-case-interaction-final.png) |
| 상태 캡처 | — | [hover](current-case-interaction-hover.png), [focus](current-case-interaction-focus.png), [입력 오류](current-case-interaction-input-error.png), [타입 메뉴](current-case-interaction-type-menu.png), [드래그](current-case-interaction-drag.png), [드롭 대상](current-case-interaction-drop-target.png) |
| 가져오기 | 디자인 원본 가져오기 대화상자 | [기본 창](current-import-dialog.png), [입력 오류](current-import-dialog-error.png) |
| 테마·폭 | — | [다크](current-dark-final.png), [390px 라이트](current-mobile-light-final.png), [430px 다크](current-mobile-dark-final.png) |

위 `current*.png` 이미지는 2026-11-01의 이전 보정 시점에 저장한 역사 캡처다. 수정 후 1440×980 Chrome 화면도 새로 열어 live로 확인했지만 저장 이미지 파일은 다시 만들지 않았다.

## 최신 live 관측

이전 1440×980 캡처에서는 root 폭이 333.953px였다. date chip의 `font: ... !important` 선언이 `font-variant-numeric`을 초기화해 숫자 너비가 기준과 달라진 원인을 찾아, 두 CSS 속성의 우선순위를 맞췄다. 수정 뒤 같은 order fixture를 1440×980 viewport, 캔버스 100%에서 재측정한 root는 335.3125×795px, `id` 행은 183.34375×40px, 최장 `placedAt` 행은 315.3125px였다. 저장 기준 root와 치수가 일치한다. live 화면도 시각 확인했지만 저장된 캡처는 갱신하지 않았다. 컨테이너 깊이 1/2/3은 각각 패딩 6/8/8, 5/7/7, 4/6/6px와 모서리 10/9/8px를 쓴다. 키는 깊이에 따라 13/12.5/12px, 굵기 500, 행간 19.5/18.75/18px다. 빈 자리는 최상위 96×26px, `tags[2]` 84×24px, 더 깊은 행 76×22px다.

출력 도구막대는 44px, 코드 안쪽 패딩은 16px, 코드 글꼴은 12px/21.6px Geist Mono다. 점검 영역은 137.5px, 제목은 34px, 진단 행은 31.5px로 원본의 패딩·높이를 맞췄다. 캔버스·코드·점검은 각각 내부 스크롤을 소유한다. 날짜 팝오버는 272×239px, 색 팝오버는 248×318px다. 측정 세부값은 [measurements.json](measurements.json)에 있다.

라이트 order 캡처에서 `document.fonts.status`는 `loaded`다. `--font-sans` 미정의로 빠졌던 CSS 선언을 전역 토큰으로 채워 키 computed style이 13px·500·19.5px, 일반 문자열 값은 13px·400·19.5px가 됐다. 날짜 chip은 중요한 `font` 축약 선언이 숫자 서체 세부 속성을 초기화하지 않도록 `font-variant-numeric: tabular-nums !important`를 설정한다. 수정 후 computed style은 `tabular-nums`다. 출력 코드는 12px/21.6px Geist Mono다.

숫자 사례에서 숫자 풀이 12px/18px, 정밀도 경고 #DC2626와 6px 점, 불리언·null 아이콘과 URL 링크 표면을 확인했다. 유효한 ISO 일시는 날짜 버튼 하나만 보이며, 변환 가능한 비표준 날짜는 원문 텍스트와 변환 제안을 나란히 둔다. 타입 메뉴는 원본과 같은 200×142px, 항목 32px, 0 8px 패딩, 원본 그림자·선택 배경이다. 숫자 입력 chip은 105×28px, 입력은 72×19.5px이고 1.5px 검은 ring을 쓴다. 오류 입력은 빨간 경계선을 유지한다.

팝오버 배치 함수는 자연 크기를 유지하고, 위·아래 공간과 좁은 화면 경계를 계산한다. 네 가지 크기·위치 경계 테스트가 통과했다. 타입 메뉴는 JSDOM UI 검사에서 사용 가능한 항목으로 초점을 옮기고 방향키로 순회하며, Escape와 컨테이너 변환 뒤 초점 복귀, 바깥 포인터 클릭 닫기를 확인했다. 이 검사는 실제 화면의 드래그나 시각 차이를 대신하지 않는다.

## UI 조작 확인

자체 Chrome 탭에서 타입 메뉴를 열면 첫 활성 항목으로 초점이 이동하고, 아래 방향키로 다음 타입을 선택한 뒤 Escape로 닫을 때 `total 값 선택` 버튼에 초점이 돌아왔다. 가져오기 textarea에 `{`를 입력하면 `JSON CloseBraceExpected (1:2)` 상태가 표시되고 적용 버튼이 비활성화됐다. Escape 취소 뒤 대화상자는 닫혔고 초안의 프로퍼티 수 9개·빈 자리 2개가 유지됐다.

날짜 팝오버는 최신 폰트 토큰 적용 뒤 272×239px로 관측했다. 취소하면 입력 버튼으로 초점이 복귀했고 값은 그대로였다. 시간 `09:12:44`를 `10:12:44`로 바꿔 적용했을 때 ISO 값과 화면 미리보기가 갱신됐다.

구조 편집기 입력은 합성 `compositionstart`/`compositionend` 이벤트로 검사했다. 조합 중 한글이 입력된 상태에서 Enter와 Escape가 편집을 확정하거나 닫지 않고, `keyCode=229`만 전달되는 조합 입력에서도 같은 동작을 유지하며, 조합 종료 후 Enter가 값을 저장한다. 이 컴포넌트 검사는 실제 Windows 한글 IME 입력을 대신하지 않는다.

점검 목록은 `빈 자리 · $.total`, `빈 자리 · $.tags[2]`, `연결 안 된 블록 · $.미연결`로 짧게 표시되고 상세 이유는 툴팁과 접근성 이름에 남는다. 클릭 가능한 점검 행은 대상 노드로 이동한다. 팔레트 숫자 칩을 캔버스에 끌어 놓자 루트 프로퍼티가 14개에서 15개로 늘었다. 캔버스 바깥에서 놓으면 변화가 없고, 숫자 칩에 초점을 둔 뒤 Enter를 눌러도 추가됐다. 검수 fixture는 문서 공통 이력을 조립하지 않으므로 아래의 일반 앱 문서에서 별도로 Undo 통합을 검수했다. Space 팬은 기본 페이지 스크롤을 막고 이동 거리를 캔버스 스크롤로 바꾸도록 보강했으며 회귀 검사를 추가했다. 이 검사는 DOM 이벤트 계산을 확인하므로 실제 middle/Space 동시 포인터 제스처의 브라우저 검수를 대신하지 않는다.

2026-11-01 후속 Chrome live 검수에서 `customer` 객체를 실제 포인터로 끌었다. 첫 프레임은 시작 원본의 흐림과 floating ghost를 보였으나 삽입선은 대조하지 못했다. 이어 order fixture를 25%로 축소하고 `id` 드래그 핸들에서 `customer` 드래그 핸들로 실제 포인터를 이동했다. 활성 프레임에 시작 원본 opacity 0.35, 고스트 opacity 0.85/-2도, `$.customer` 앞 `.sd-entry.is-drop-before`를 함께 캡처했다. 삽입 pseudo-element의 computed height는 2px, 행은 x=243.5~309.5px·y=74~114.5px로 기준 삽입선 수치와 일치했다. CUA 화면 이미지는 검수 중 표시됐고 workspace 파일로는 저장하지 않았다. 합성 order fixture만 사용했다. CUA 실제 Space+포인터 및 중간 버튼+포인터 시도에서는 캔버스 이동이 관찰되지 않았다. `drag` 입력이 왼쪽 버튼 이동만 지원해 키/중간 버튼 홀드와 동시에 겹칠 수 없으므로 팬은 통과 처리하지 않는다. [관측 기록](measurements.json)에 좌표와 한계를 남겼다.

같은 Chrome 검수 탭에서 `memo` 블록은 기존 `scrollWidth` 568px 경계를 190px 넘었고 스크롤 값도 이를 포함하지 않았다. 좌표 기준을 확대되는 `.sd-canvas-grid`로 옮기고 미연결 블록의 실측 범위를 반영한 뒤 그리드 `scrollWidth`는 858px이 됐다. `맞춤`은 44%로 축소해 루트와 `memo`를 583×527px 화면 안에 함께 배치했다. 100%로 복원한 뒤에도 루트의 키 9개와 빈 자리 2개를 유지했다. 추가로 `id`와 `customer`를 분리해 기본 배치를 확인했다. 루트는 그리드 좌표 x=48, y=40~714였고 새 블록은 x=48, y=855와 905에 놓였다. 두 블록 사이 18px 간격이 있고 루트·저장 위치의 `memo`와 겹치지 않았다. 측정값은 [measurements.json](measurements.json)에 기록했고 좌표 계산은 [레이아웃 테스트](../../tests/structuredCanvasLayout.test.ts)로 검증했다.

1440×980 live 재검수에서 order와 8개 사례군을 각각 열었다. 제품 노드와 행이 렌더됐고 어느 사례에서도 문서 자체의 가로 넘침은 없었다. 선택·focus·hover·입력·입력 오류·타입 메뉴·날짜/색 팝오버·확장 텍스트·단독 보기·정적 드래그/드롭 상태도 DOM 치수와 상태 표식으로 확인했다. 이는 각 사례의 모든 상태 조합이나 실제 활성 포인터 드래그 프레임 확인을 뜻하지 않는다. 최신 재검수 후에도 저장된 case 캡처는 다시 만들지 않았다.

2026-11-01 390×844·430×844 뷰포트의 라이트·다크 조합을 모두 live로 열었다. 각 화면의 문서 `scrollWidth`는 뷰포트와 같고, 팔레트·캔버스·출력 영역 안에서 필요한 스크롤을 처리했다. 390px에서 캔버스 viewport는 375×289px, 콘텐츠 scroll extent는 862×861px였다. 390px 다크에서 날짜 272×239px·색 248×317px 팝오버를 열어 화면 안에 배치되고 문서 크기가 늘지 않는 것을 확인했다. 이는 뷰포트 시뮬레이션이며 실제 모바일 기기 터치 검수는 아니다. 저장 캡처는 최신 화면으로 교체하지 않았다.

## 2026-11-01 상태 행렬 후속 검수

1280×720 live 브라우저에서 order와 8개 사례군을 각각 기본·선택 상태로 열고, 사례별 추가 상태를 합쳐 32개 경로를 확인했다. 검수 경로는 실제 `StructuredDataEditor` 제품 컴포넌트를 렌더한다. 아홉 화면 모두 문서 가로 넘침이 없었다. 캔버스 내부의 콘텐츠 넘침은 캔버스 자체 스크롤 영역에 머물렀다.

| 화면 | 확인한 상태 |
| --- | --- |
| order | 기본, 선택, 날짜 팝오버, 색 팝오버 |
| text | 기본, 선택, 펼친 텍스트 |
| date-links | 기본, 선택, 날짜 팝오버 |
| colors | 기본, 선택, 색 팝오버 |
| numbers | 기본, 선택 |
| containers | 기본, 선택 |
| deep | 기본, 선택, 깊은 노드 단독 보기 |
| keys | 기본, 선택, 잘못된 키 입력 |
| interaction | 기본, 선택, focus, hover, 입력, 입력 오류, 타입 메뉴, 드래그, 드롭 대상 |

타입 메뉴에는 비활성 변환 항목 2개가 표시됐고, 단독 보기의 팔레트에는 항목이 없어 배열 추가 버튼이 비활성이었다. 키 입력 오류는 `aria-invalid=true`, 숫자 입력 오류도 오류 경계선으로 표시됐다. 깊은 노드 단독 보기의 루트 경로는 `$.level1.level2.level3.level4`다. URL로 고정한 화면 상태와 DOM 표식 검수이며 모든 상태의 조합을 검사한 것은 아니다. 새 상태 캡처 파일은 저장하지 않았다. 사용자는 실제 입력 자료를 공유할 수 없다고 답했으므로 합성 fixture를 사용했다.

단일 touch pan과 두 pointer pinch 확대 테스트는 JSDOM 합성 입력으로 추가했다. 실제 모바일 기기 touch는 검수하지 않았다. 후속 CUA 입력에서 4초 Space 홀드·Space modifier·middle-button hold를 left-drag와 함께 시도했지만 캔버스 `scrollLeft`/`scrollTop`은 0으로 유지됐다. 같은 화면의 휠 아래 입력은 `scrollTop=253`으로 이동했고 휠 위로 0에 복원됐다. 캔버스는 스크롤 가능하지만 실제 팬은 확인하지 못해 미완료로 남긴다. [팬 재검수 계측](measurements.json)

가져오기 창은 480×431px, 입력 textarea는 438×220px로 측정했다. 잘못된 JSON을 넣으면 파서 오류가 나타나고 적용 버튼이 비활성화된다. 기본·오류 캡처와 기존 계측값은 [measurements.json](measurements.json)에 기록했다. 자체 fixture에서 오류 입력 취소 후 초안 보존도 확인했다.

## 2026-10-31 후속 입력·이력 검수

검수 fixture 바깥의 자체 임시 JSON 문서를 열어 실제 앱 문서 컨트롤러를 확인했다. 가져오기에서 정밀도 큰 수를 포함한 JSON을 적용했고, Undo 한 번으로 빈 구조와 `{}` 미리보기에 돌아간 뒤 Redo로 같은 값과 구조를 복구했다. 날짜 문자열의 시간을 `09:12:44`에서 `10:12:44`로 바꾸고 Undo했을 때 원래 ISO 문자열이 복원됐다. 색 팝오버 취소는 기존 HEX를 유지했고 적용 후 Undo는 원래 `#E11D48`을 복원했다.

제품 화면의 실제 포인터 조작으로 기존 노드의 객체 내부 이동·결합, 캔버스 분리, 형제 재정렬, 캔버스 밖 실패 드롭을 확인했다. 재정렬 후 배열/객체 순서가 달라지고 중복 노드가 생기지 않았다. 키보드 이동 대체도 문서별 이력에 들어가며 각 구조 동작의 Undo/Redo가 한 단계씩 복구했다. 출력 리사이저는 포인터 이동에서 340→360px, 방향키에서 16px 증가했으며 더블클릭으로 340px 기본값에 복귀했다. hit area 9px와 2px 표시선은 스타일에서 확인했다.

앱을 390px 다크, 430px 라이트 뷰포트에서 살펴봤다. 팔레트·캔버스·코드 영역은 자체 스크롤을 사용하고 화면 폭을 늘리지 않았다. 확대/축소와 휠 스크롤에서 콘텐츠와 점 격자가 함께 움직였다. 실제 포인터 드래그의 원본 흐림과 고스트는 live 프레임에서 관찰했지만 삽입선 비교와 저장된 캡처는 남아 있다. middle/Space 포인터 팬, Windows 한글 IME, 모든 사례의 hover/focus·오류·불가 타입 상태도 아직 검수하지 않았다. 사용자가 실제 입력 자료를 공유할 수 없다고 했으므로 합성 fixture만 사용한다.

Escape와 캔버스 배경 포인터 입력에서 선택이 해제되고 편집 모델은 보존되는 것을 [컴포넌트 테스트](../../tests/structuredDataEditor.test.tsx)로 고정했다. 도메인 명령과 스키마 추론을 [편집 명령 모듈](../../src/domain/structuredCommands.ts)로 분리했다. 이 구현과 남은 차이를 [GOAL](../../GOAL.md)에 기록했다.

키 이름 사례에서 기존 키를 다른 프로퍼티가 사용 중인 `a`로 바꾸려 하면 저장을 막고 입력란을 유지하며 “중복되거나 유효하지 않은 값입니다.” 오류를 표시했다. 검수 fixture는 다시 불러와 원래 상태로 복원했다.

## 검수 화면과 번들 경계

제품 `StructuredDataEditor`를 사용하는 개발 전용 `?structured-review=1` 경로에 order와 8개 사례군을 뒀다. order는 빈 자리·미연결 블록·선택·접힘 상태를 초기화한다. 최신 `npm run check`는 25개 테스트 파일·150개 테스트와 앱/확장 빌드를 통과했다. `npm run verify:build`도 PWA·확장 중계·manifest·ZIP을 확인했고, `dist/app` 자산에서 `structured-review`, 검수 상태 props와 전용 CSS 식별자가 검색되지 않았다.

## 2026-11-01 최초 폰트 보정 관측 — 최신 live 관측으로 갱신됨

CSS에서 사용하던 `--font-sans` 토큰이 정의되지 않아 해당 글꼴 선언이 무효였다. 토큰을 추가하고 order 기준에서 키 13px/500/19.5px, 값 13px/400/19.5px, 출력 코드 Geist Mono 12px/21.6px를 확인했다. 이 최초 측정에서는 `id` 행 178.266px, root 높이 803px였다. 이후 행 치수와 높이를 183.34375×40px, 795px로 맞췄다. 처음 남았던 root 폭 1.359375px은 중요한 `font` 축약 선언에 초기화된 tabular 숫자 설정을 복구해 기준 치수와 맞췄다. 최종 재측정은 저장 기준과 같은 1440×980 viewport·100% 확대에서 수행했으며 live 캡처 파일은 갱신하지 않았다.

재현 경로는 `?structured-review=1&case=<사례>&state=<상태>&capture=1` 형식이다. 사례는 `order`, `text`, `date-links`, `colors`, `numbers`, `containers`, `deep`, `keys`, `interaction`을 쓴다. 상태는 `selected`, `input`, `input-error`, `focus`, `hover`, `type-menu`, `date-popover`, `color-popover`, `expanded-text`, `isolated`, `drag`, `drop-target`이다. 적용되지 않는 사례/상태 조합은 기본 화면을 보인다. `measure=1`을 더하면 숨은 계측 결과에 root, `id`/최장 행, `placedAt` 행의 직계 자식과 날짜 chip·아이콘·문자 폭·`font-variant-numeric`이 나온다. Chrome에서 live 계측을 다시 읽었다. [order](current-editor-final.png), [펼친 텍스트](current-case-text-expanded.png), [focus](current-case-interaction-focus.png), [hover](current-case-interaction-hover.png), [드래그 표현](current-case-interaction-drag.png) 이미지는 저장된 역사 캡처다.

`expanded-text`는 실제 긴 값을 펼친 상태로 시작하고 `focus`는 값 버튼에 실제 DOM focus를 준다. `hover`와 `drag`는 검수 경로에서 같은 CSS 상태를 재현한다. 저장된 드래그 캡처는 포인터가 움직이는 중간 화면이 아니라 상태 고정 화면이다. 별도 live 포인터 드래그에서 원본 fade와 ghost를 관찰했지만 삽입선의 비교 가능한 위치를 확인하지 못했고 그 프레임은 저장하지 않았다. 실제 pan 제스처와 한글 IME, 8개 케이스 전체의 각 hover/focus 조합은 미검수다. 사용자 자료 대신 합성 fixture를 사용한다.
