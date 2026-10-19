# The Viewer

`.eml`, `.csv`, `.md`, `.ics`, `.vcf` 파일을 브라우저 안에서 열고 편집해 다시 내보내는 PWA입니다. 같은 화면과 형식 처리 코어로 Chrome 확장 프로그램도 빌드합니다.

파일 내용과 편집본은 브라우저 안에서 처리합니다. 기본 파일 열기·내보내기는 로컬 파일 선택과 다운로드를 사용합니다. PWA의 설치·오프라인·파일 연결 기능은 브라우저 지원 여부에 따라 달라질 수 있습니다. Chrome 확장은 사용자가 링크 메뉴에서 요청한 HTTPS 파일만 선택 권한을 받은 뒤 가져옵니다.

## 실행

- Node.js 22.12 이상
- `npm ci`
- `npm run dev`로 PWA 개발 서버 실행

로컬 개발은 루트 경로(`/`)를 사용합니다. Pages의 프로젝트 사이트 경로는 `BASE_PATH=/the_viewer/`처럼 빌드할 때 지정합니다.

## 검사와 빌드

| 명령 | 결과 |
| --- | --- |
| `npm run lint` | ESLint 검사 |
| `npm run typecheck` | 엄격한 TypeScript 검사 |
| `npm run test` | 형식 파서·직렬화 회귀 테스트 |
| `npm run build:app` | PWA를 `dist/app`에 빌드 |
| `npm run build:extension` | 압축 해제용 확장을 `dist/chrome_extension`에 빌드 |
| `npm run package:extension` | 확장 빌드 후 `dist/the-viewer-chrome-v0.1.0.zip` 생성 |
| `npm run check` | 린트·타입·테스트·두 빌드 실행 |

각 타깃은 별도 출력 폴더를 사용합니다. 생성된 `dist`는 저장소에 커밋하지 않습니다.

## GitHub Pages 배포

`main` 브랜치에 푸시하면 Actions가 린트·타입·테스트와 두 타깃 빌드를 실행합니다. 성공하면 PWA 빌드에 `/the_viewer/` base 경로를 적용하고 `dist/app`만 Pages에 올립니다. 저장소 이름이 바뀌면 workflow의 `BASE_PATH` 값을 함께 바꿉니다.

현재 배포: [https://m00nlygreat.github.io/the_viewer/](https://m00nlygreat.github.io/the_viewer/)

## Chrome 확장 설치

Chrome에서 `chrome://extensions`를 열고 개발자 모드를 켠 다음 **압축해제된 확장 프로그램을 로드**를 선택해 `dist/chrome_extension`을 지정합니다. 파일을 다시 빌드한 뒤에는 확장 프로그램 카드의 새로고침 버튼을 누릅니다. 스토어 게시나 자동 설치는 이 저장소의 배포 과정에 포함하지 않습니다.

## 개인정보와 라이선스

- 저장·전송 동작과 보존 범위는 [개인정보 처리 안내](docs/PRIVACY.md)를 따릅니다.
- 의존성별 고지는 `public/licenses/THIRD_PARTY_NOTICES.md`와 빌드 산출물의 `licenses/`에 있습니다.
- 프로젝트 자체의 소스 코드 라이선스는 별도 `LICENSE` 파일로 지정하지 않았습니다.
- 디자인 기준은 [목업](mockup/The%20Viewer.html), 구현 요구사항은 [GOAL](GOAL.md), 프로젝트 요약은 [wiki](wiki/REQUIREMENT.md)에서 확인할 수 있습니다.
