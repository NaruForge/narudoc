# 저장소 구조

실행 프로그램/라이브러리를 npm 배포 여부가 아니라 책임으로 분류한다. 아래 package 경로 coverage는 workspace discovery와 대조한다.

| 경로 | 책임 |
| --- | --- |
| [apps/cli](../apps/cli/) | 인자 binding·help·출력·공용 저장 호출 |
| [apps/web](../apps/web/) | 지정 파일 하나의 HTTP 보안·browser UI |
| [packages/file-store](../packages/file-store/) | 공용 Node UTF-8/revision/lock/atomic save·JSON lexical reader·figure asset resolver |
| [packages/model](../packages/model/) | parsed snapshot·범위와 authoring/operation 실행 입력 계약 |
| [packages/parser](../packages/parser/) | 지원 문법 파싱과 원본 범위 |
| [packages/core](../packages/core/) | 조회·target 해석·validation·의미 편집·순차 transaction |
| [packages/renderer-html](../packages/renderer-html/) | 순수 모델 기반 안전한 HTML |
| [packages/editor-adapter](../packages/editor-adapter/) | 순수 source session과 별도 PM/DOM projection·입력 adapter |
| apps/editor-spike | 파일 저장 없는 인메모리 실행 harness |
| tests/browser | Chromium adapter·로컬 client 실행 검증 |
| tests/acceptance | 패키지 통합, CLI, 저장·원본 보존 회귀 |
| tests/fixtures | 개행·Unicode·잘못된 문서 |
| examples | 사용 가능한 공개 문서 예제 |
| scripts | 빌드·검증 도구; 제품 runtime 아님 |
| docs | 제품 비전, 현재 계약·구조와 설계 결정 |

독립된 책임·의존 경계가 있을 때만 패키지를 추가한다. 테스트는 해당 책임과 가깝게 두거나 공통 acceptance에 둔다. 미래 GUI·MCP·DB를 위한 빈 폴더는 만들지 않는다. 기존 .agents, .github/ISSUE_TEMPLATE, docs/project-records.md를 보존한다.

## 작업에서 구현과 검증으로

| 작업 | 시작할 코드 | 소유 계약 | 가까운 검증 |
| --- | --- | --- | --- |
| 의미 operation/입력 필드 추가 | [실행 정의](../packages/model/src/operation-contract.ts), [Core dispatch](../packages/core/src/operations.ts), [CLI binding](../apps/cli/src/commands.ts) | [입력 경계](architecture.md#실행-입력-계약), [CLI](cli.md) | [계약 parity/오류 corpus](../tests/acceptance/contracts.test.mjs), [생성 reference 검사](../scripts/verify-contracts.mjs) |
| 문법·원본 범위·no-op/최소 diff 수정 | [parser](../packages/parser/src/index.ts), [patch](../packages/core/src/patch.ts), [의미 편집](../packages/core/src/operations.ts) | [format](format.md) | [수정·보존 테스트](../tests/acceptance/), [authoring](../scripts/verify-authoring.mjs) |
| 대상 조회/index/batch 의미 | [query](../packages/core/src/query.ts), [sequence](../packages/core/src/batch.ts) | [대상·세션](architecture.md#대상과-편집-세션), [ADR0011](adr/0011-targets-and-source-session.md) | [session 회귀](../tests/acceptance/session.test.mjs), [batch](../tests/acceptance/batch.test.mjs) |
| 브라우저 입력·한글 composition·selection | [PM adapter](../packages/editor-adapter/src/index.ts), [순수 session](../packages/editor-adapter/src/session.ts) | [adapter 범위](visual-editor-spike.md), [local editor](local-editor.md) | [browser spike](../tests/browser/spike.spec.mjs), [두 topology proof](../tests/proofs/session-topology.mjs) |
| 저장 직전 revision·lock·오류 | [file-store](../packages/file-store/src/index.ts), [HTTP host](../apps/web/src/index.ts) | [저장 경계](architecture.md#저장과-안전), [CLI revision](cli.md#revision과-dry-run) | [저장 회귀](../tests/acceptance/), [실제 충돌 journey](../tests/browser/web.spec.mjs) |
| HTML/위험 URL | [renderer](../packages/renderer-html/src/index.ts), [참조 해석](../packages/core/src/references.ts) | [format](format.md), [local security](local-editor.md) | [acceptance](../tests/acceptance/), [browser security](../tests/browser/) |
| 새 package/의존성·문서/도움말 | [구조 검사](../scripts/verify-architecture.mjs), [문서/연습 검사](../scripts/verify-guide.mjs), [CLI binding](../apps/cli/src/commands.ts) | 이 문서, [architecture](architecture.md) | [의도적 drift mutation](../tests/acceptance/boundaries.test.mjs), [contracts](../tests/acceptance/contracts.test.mjs) |
| 신규 기능의 범위·우선순위·선행 능력 판단 | 코드 수정 전에 실제 Issue와 [로드맵](roadmap.md) 확인 | [제품 원칙](product.md), [장기 발전 경로](roadmap.md) | 사용자 결과·선행 조건·기존 계약 영향 검토; 구현 시 해당 작업의 테스트 경로로 연결 |

새 기능이 문서 의미·저장 결과에 영향을 주면 Core와 실행 입력 계약부터 추가한다. Flag/HTTP/auth는 host에, 화면 layout/composition은 adapter에 둔다. Generic directive attribute의 문자열 저장과 특정 도메인의 상태 전이/schema 검증은 다르다. 후자가 필요하면 별도 요구와 의미 계약을 먼저 정하며 UI form에 숨겨 넣지 않는다.

검사는 runtime cycle과 공개 export, 중첩 source의 금지 의존, workspace/map coverage, 로컬 링크·anchor, 실행 연습과 생성 reference를 확인한다. Type-only 파일 참조는 runtime cycle과 구분한다. CLI → web의 `startEditor/openBrowser` launcher만 명시적 app 예외다. 정적 검사로 동적 우회나 Agent 이해도를 증명하지 않으며 새 로딩 방식·workspace glob은 조용히 건너뛰지 않고 검토를 요구한다.

새 세션/인계의 최소 입력은 실제 Issue, 기준 SHA, 관련 PR/diff와 검증 근거 링크다. Root 또는 package cwd에서 자동 포함된 지침과 직접 연 문서를 구분하고, 링크의 본문까지 주입됐다고 가정하지 않는다. Harness의 root/cwd/override 탐색은 해당 버전의 실제 fresh session으로 확인하며 결과는 Issue/PR에 남긴다. 개인 전역 지침이나 credentials를 저장소로 복사하지 않는다. [Codex의 공식 탐색 설명](https://learn.chatgpt.com/docs/agent-configuration/agents-md)은 특정 harness의 참고 자료이며 다른 Agent의 로딩 보장은 아니다.

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
| [로드맵](roadmap.md) | 장기 제품 능력·발전 순서·선행 능력·달성 기준. 현재 진행 상태·작업 목록·출시 일정은 제외 |

요약은 원본을 링크하고 세부 계약을 독립적으로 복제하지 않는다. 계약을 변경하면 같은 PR에서 관련 문서·예제·검증을 함께 갱신한다. 제품 비전에 진행 상태표·완료 대장·출시 일정을 넣지 않고 ADR 상태 index도 만들지 않는다. 현재 구조 설명은 구현 사실이며, 제안 단계 ADR이 그 사실을 과거의 승인으로 바꾸지는 않는다.
