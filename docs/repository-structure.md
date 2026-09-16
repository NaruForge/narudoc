# 저장소 구조

worknaru-dev의 실행 프로그램/라이브러리 구분을 채택한다. npm 배포 여부가 아니라 책임으로 분류한다.

| 경로 | 책임 |
| --- | --- |
| apps/cli | 사용자 실행 프로그램, 인자·출력·파일 저장 |
| packages/model | 원본 범위, 문서, inline, 진단, edit 계약 |
| packages/parser | 지원 문법 파싱과 원본 범위 |
| packages/core | 조회, validation, 의미 편집과 검증된 patch |
| packages/renderer-html | 순수 모델 기반 안전한 HTML |
| tests/acceptance | 패키지 통합, CLI, 저장·원본 보존 회귀 |
| tests/fixtures | 개행·Unicode·잘못된 문서 |
| examples | 사용 가능한 공개 문서 예제 |
| scripts | 빌드·검증 도구; 제품 runtime 아님 |
| docs | 현재 제품 계약과 설계 |

독립된 책임·의존 경계가 있을 때만 패키지를 추가한다. 테스트는 해당 책임과 가깝게 두거나 공통 acceptance에 둔다. 미래 GUI·MCP·DB를 위한 빈 폴더는 만들지 않는다. 기존 .agents, .github/ISSUE_TEMPLATE, docs/project-records.md를 보존한다.
