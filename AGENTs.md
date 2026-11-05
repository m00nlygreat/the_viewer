# 에이전트 메모

## 컴포넌트 작성

- React 컴포넌트를 작성하거나 수정할 때는 [컴포넌트 작성 규칙](docs/COMPONENTS.md)을 읽고 따른다.

## 버전 관리

- 제품 코드나 배포 설정을 커밋하기 전에 변경 영향에 따라 SemVer 버전을 올린다: 호환성을 깨는 변경은 MAJOR, 하위 호환 기능 추가는 MINOR, 버그 수정과 호환되는 개선은 PATCH다.
- PWA와 Chrome 확장은 같은 버전을 사용한다. [package.json](package.json)을 기준으로 [package-lock.json](package-lock.json)의 루트 버전과 [public/version.json](public/version.json)의 `version`도 맞춘다.
- Vite가 생성하는 앱 버전 표시와 확장 manifest/version 파일은 [package.json](package.json)에서 읽으므로 생성 산출물을 직접 수정하지 않는다.

## 위키 관리

- 이 저장소의 간단한 위키는 [wiki](wiki/)에 둔다.
- 위키 문서는 한국어로 짧고 명확하게 작성한다.
- 위키 문서나 프로젝트 문서를 참조할 때는 백틱 경로 대신 반드시 마크다운 링크와 프로젝트 기준 상대 경로를 사용한다. 예: [요구사항](wiki/REQUIREMENT.md).
- [wiki/REQUIREMENT.md](wiki/REQUIREMENT.md)는 현재 요구사항 요약의 유지본이다. 요구사항을 정리하거나 갱신할 때 이 파일을 함께 관리한다.
- [wiki/TERMS.md](wiki/TERMS.md)는 프로젝트 용어와 GUI 표시명의 유지본이다. 용어, 명명 기준, 화면 표시명을 정리하거나 갱신할 때 이 파일을 함께 관리한다.
- [wiki/LOG.md](wiki/LOG.md)에는 프로젝트 관련 중대 결정사항, 새로 알아낸 사실, 방향 변경을 시간순으로 남긴다.
- 원본 자료 폴더는 사용자가 요청하지 않는 한 수정하지 않는다.
