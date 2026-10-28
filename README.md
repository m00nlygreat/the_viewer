# The Viewer

`.eml`, `.csv`, `.md`, `.ics`, `.vcf` 파일을 브라우저에서 보고 편집하고 내보냅니다. 파일 처리·화면·작업 복구는 PWA가 담당하고, Chrome 확장은 파일 감지·읽기·전달을 담당합니다.

파일 본문은 서버에 업로드하지 않습니다. 확장은 파일을 전용 IndexedDB 티켓에 임시 저장하고 PWA가 Chrome 내부 메시지로 192 KiB 조각을 요청합니다. PWA가 문서를 열고 저장한 뒤 완료를 확인하면 티켓을 지웁니다. 실패한 전달은 10분 동안 재시도할 수 있습니다.

PWA 최초 접속과 서비스 워커 캐시 준비에는 네트워크가 필요합니다. 캐시 준비가 끝나면 앱 자산은 오프라인에서 사용할 수 있으며, Chrome의 로컬 파일도 확장으로 전달할 수 있습니다. HTTP(S) 파일 링크는 네트워크 연결이 필요합니다.

## 개발

- Node.js 22.12 이상
- `npm ci`
- `npm run dev`로 PWA 개발 서버 실행

로컬 개발은 루트 경로(`/`)를 사용합니다. Pages 프로젝트 사이트 빌드에는 `BASE_PATH=/the_viewer/`를 지정합니다.

## 검사와 빌드

| 명령 | 결과 |
| --- | --- |
| `npm run lint` | ESLint 검사 |
| `npm run typecheck` | 엄격한 TypeScript 검사 |
| `npm run test` | 형식 및 전달 프로토콜 테스트 |
| `npm run build:app` | PWA를 `dist/app`에 빌드 |
| `npm run build:extension` | 중계 확장을 `dist/chrome_extension`에 빌드 |
| `npm run package:extension` | 확장 빌드 후 `dist/the-viewer-chrome-v<package.json 버전>.zip` 생성 |
| `npm run check` | 린트·타입·테스트·두 타깃 빌드 실행 |

확장 번들에는 React UI, 편집기, 파일 파서와 파서 워커가 포함되지 않는지 빌드 검사에서 확인합니다. 확장 manifest 버전과 ZIP 파일명은 [package.json](package.json)의 버전을 사용합니다. `dist`는 저장소에 커밋하지 않습니다.

## 배포 순서

`main`에 푸시하면 Actions가 검사 후 PWA만 GitHub Pages에 배포합니다. PWA에서 실제 Chrome 확장 연결과 파일 수신을 확인한 다음 `Publish extension ZIP` workflow를 수동 실행합니다. 이 workflow는 같은 PWA 자산과 버전별 확장 ZIP을 Pages에 함께 배포합니다.

PWA: [https://m00nlygreat.github.io/the_viewer/](https://m00nlygreat.github.io/the_viewer/)

확장 ZIP: [최신 Chrome 확장 다운로드](https://m00nlygreat.github.io/the_viewer/downloads/the-viewer-chrome-latest.zip)

## Chrome 확장 설치 및 사용

Chrome 128 이상에서 위 ZIP을 내려받아 압축을 풀고 `chrome://extensions`에서 개발자 모드를 켠 뒤 **압축해제된 확장 프로그램을 로드**를 선택합니다. 확장은 파일 자동 감지를 위해 HTTP(S) 사이트 접근 권한과 `file://` 접근 권한을 사용합니다. 로컬 파일은 확장 세부정보의 **파일 URL에 대한 액세스 허용**을 켠 뒤 사용할 수 있습니다.

확장 도구모음 버튼은 PWA를 엽니다. 링크 메뉴의 **The Viewer로 열기**는 사이트와 파일명을 확인한 뒤 링크 파일을 가져옵니다. Chrome으로 연 EML·CSV·Markdown·ICS·VCF 파일과 해당 형식의 HTTP(S) 응답은 자동으로 전달합니다. URL 응답은 MIME과 파일명을 확인하고 HTML 페이지는 제외합니다. 자동 열기는 응답을 확인한 뒤 본문을 쿠키 없이 다시 요청하므로 서버가 GET을 두 번 처리할 수 있고, 인증이 필요한 파일은 다시 요청할 때 읽지 못할 수 있습니다.

기존 확장에 저장된 작업은 중계 페이지에서 한 번 이전할 수 있습니다. 문서별로 PWA 탭을 열어 원본 바이트, 편집본, 첨부 관계를 보존합니다. PWA 저장을 확인할 때까지 원본 확장 저장 데이터는 삭제하지 않습니다.

## 개인정보와 라이선스

- 저장·전송 동작과 보존 범위는 [개인정보 처리 안내](docs/PRIVACY.md)를 따릅니다.
- 형식 및 표시명은 [용어](wiki/TERMS.md), 현재 제품 요구사항은 [요구사항](wiki/REQUIREMENT.md)에 정리합니다.
- 의존성별 고지는 `public/licenses/THIRD_PARTY_NOTICES.md`와 빌드 산출물의 `licenses/`에 있습니다.
- 프로젝트 자체 소스 코드 라이선스는 별도 `LICENSE` 파일로 지정하지 않았습니다.
- 기준 목업과 구현 계획은 [목업](mockup/The%20Viewer.html), [GOAL](GOAL.md)에서 확인할 수 있습니다.
