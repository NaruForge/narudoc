# 제품 목적과 MVP 1

NaruDoc은 WYSIWYG에서 출발한 SDoc을 그대로 이름만 바꾼 제품이 아니다. 사람이 읽는 파일을 중심으로 headless authoring을 먼저 구현하는 구조화 문서 엔진이다.

## 해결할 문제

- 작은 콘텐츠 수정에 JSON 구조·재직렬화 diff가 섞여 Git review가 어렵다.
- CLI가 editor runtime과 UI 상태에 의존하면 AI·CI가 문서를 안정적으로 조작하기 어렵다.
- 특정 편집기의 schema를 원본으로 사용하면 viewer·host·editor 교체 비용이 커진다.

## MVP 1

GUI 없이 inspect → edit → validate → render를 수행한다. 명시적 ID로 제목과 섹션을 조작하고 문단·generic directive를 편집한다. 편집은 원본 범위 patch이며 전체 문서를 다시 출력하지 않는다. no-op, 국소 수정, 섹션 이동, Unicode·개행·실패 경로를 자동 테스트한다.

Visual Editor·PDF·협업·MCP·WorkNaru 통합·전체 Markdown 호환·legacy migration은 이번 범위 밖이다. 기존 문서 엔진 라이브러리의 채택 여부보다 지원 문법과 원본 보존을 검증할 수 있는 계약을 우선한다. 새로운 grammar 확장은 별도 승인과 테스트를 거친다.

제품/패키지 버전은 0.0.1이다. 버전 표시는 v0.0.1을 사용한다. API·문법은 실험 단계이며 안정성을 과장하지 않는다. 개인·회사 자료를 예제나 테스트에 사용하지 않는다.
