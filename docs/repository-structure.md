# 저장소 구조

worknaru-dev의 실행 프로그램/라이브러리 구분을 채택한다. npm 배포 여부가 아니라 책임으로 분류한다.

| 경로 | 책임 |
| --- | --- |
| apps/cli | 사용자 실행 프로그램, 인자·출력·파일 저장 |
| packages/model | 원본 범위, 문서, inline, 진단, edit 계약 |
| packages/parser | 지원 문법 파싱과 원본 범위 |
| packages/core | 조회, validation, 의미 편집과 검증된 patch |
| packages/renderer-html | 순수 모델 기반 안전한 HTML |
| packages/editor-adapter | Source 소유형 브라우저 projection·transaction/draft adapter |
| apps/editor-spike | 파일 저장 없는 인메모리 실행 harness |
| tests/acceptance | 패키지 통합, CLI, 저장·원본 보존 회귀 |
| tests/fixtures | 개행·Unicode·잘못된 문서 |
| examples | 사용 가능한 공개 문서 예제 |
| scripts | 빌드·검증 도구; 제품 runtime 아님 |
| docs | 제품 비전, 현재 계약·구조와 설계 결정 |

독립된 책임·의존 경계가 있을 때만 패키지를 추가한다. 테스트는 해당 책임과 가깝게 두거나 공통 acceptance에 둔다. 미래 GUI·MCP·DB를 위한 빈 폴더는 만들지 않는다. 기존 .agents, .github/ISSUE_TEMPLATE, docs/project-records.md를 보존한다.

## 문서의 책임

| 원본 | 담을 내용 |
| --- | --- |
| [README](../README.md) | 제품 소개, 비전 요약, 현재 제공 범위, 시작 방법과 문서 진입점 |
| [제품](product.md) | 장기 목적·대상 사용자·원칙·비목표·성공 기준 |
| [아키텍처](architecture.md) | 현재 구현의 책임·의존 관계·제약 |
| [파일 문법](format.md) | 현재 지원 문법과 원본 보존·편집 의미 |
| [CLI](cli.md) | 현재 명령·입출력·오류·자동화 계약 |
| [ADR](adr/) | 중요한 선택의 배경·대안·이유·결과와 해당 결정의 Status |
| [프로젝트 기록 규약](project-records.md) | 승인·기록·변경·검토 절차 |
| GitHub Issue / Project | 승인된 작업 내용 / 실제 진행 상태 |

요약은 원본을 링크하고 세부 계약을 독립적으로 복제하지 않는다. 계약을 변경하면 같은 PR에서 관련 문서·예제·검증을 함께 갱신한다. 제품 비전에 진행 상태표·완료 대장·출시 일정을 넣지 않고 ADR 상태 index도 만들지 않는다. 현재 구조 설명은 구현 사실이며, 제안 단계 ADR이 그 사실을 과거의 승인으로 바꾸지는 않는다.
