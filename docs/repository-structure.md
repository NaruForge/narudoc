# 저장소 구조

현재 코드를 찾기 위한 지도다. 새 기능을 위해 아래 구조를 다시 설계하거나 모든 문서를 먼저 읽을 필요는 없다.

| 경로 | 현재 책임 |
| --- | --- |
| [apps/cli](../apps/cli/) | CLI 인자·help·출력과 공용 저장 호출 |
| [apps/web](../apps/web/) | 지정 파일의 로컬 HTTP·브라우저 UI |
| [packages/file-store](../packages/file-store/) | UTF-8·revision·lock·저장과 로컬 자산 접근 |
| [packages/model](../packages/model/) | 문서 snapshot·범위·operation 입력 계약 |
| [packages/parser](../packages/parser/) | 문법 파싱과 원본 범위 |
| [packages/core](../packages/core/) | 문서 조회·검증·의미 편집 |
| [packages/renderer-html](../packages/renderer-html/) | 모델의 안전한 HTML 표현 |
| [packages/editor-adapter](../packages/editor-adapter/) | 원문 편집 session과 ProseMirror 연결 |
| [tests/acceptance](../tests/acceptance/) | 문서·CLI·저장 회귀 |
| [tests/browser](../tests/browser/) | 입력·선택·로컬 편집기 회귀 |
| [examples](../examples/) | 공개 문서 예제 |

## 작업에서 구현과 검증으로

- 문법·원본 범위: parser와 [파일 계약](format.md).
- 의미 편집·대상·batch: model/core와 해당 acceptance 테스트.
- 입력·selection·Undo: editor-adapter와 해당 browser/session 테스트.
- 저장·충돌·파일 접근: file-store와 CLI/Web 호출부, 관련 저장 테스트.
- 명령·도움말: apps/cli와 [CLI 계약](cli.md).

실제 동작이 바뀐 계약·예제만 함께 갱신한다. 폴더 지도 형식, 모든 package의 문서 등록, 매 작업의 인계 양식은 검사 대상이 아니다. 파일을 추가·이동하기 위한 별도 승인 절차도 없다.

현재 코드의 책임 경계는 [아키텍처](architecture.md), 제품 목표는 [제품 비전](product.md), 일상 개발 방식은 [AGENTS.md](../AGENTS.md)를 참고한다. 구조·의존성 검사는 원문 엔진의 headless 경계 등을 보호하는 용도로 유지하며 지도 문구를 강제하지 않는다.
