# NaruDoc 개발 안내

NaruDoc은 읽을 수 있는 `.narudoc` 원본과 headless 문서 엔진을 중심으로 사람·AI·자동화가 함께 문서를 다루는 제품이다. CLI-first는 엔진을 먼저 검증하는 전략이지 시각적 편집을 포기하는 뜻이 아니다.

## 제품 판단 기준

아래는 [제품 원칙](docs/product.md#지켜야-할-제품-원칙)의 요약이다. 상세 정의와 장기 목표는 제품 문서가 소유한다.

- 엔진은 편집기에 의존하지 않는다. CLI·API·향후 Visual Editor는 같은 엔진의 client이며, 편집기 내부 모델을 저장 원본으로 삼지 않는다.
- CLI는 최초 reference client이자 유지할 1급 인터페이스다. 핵심 문서 작업은 GUI 없이 가능해야 하며 Engine → CLI/API 검증 → GUI 순서로 설계한다. 커서·창 배치 같은 화면 전용 동작은 예외다.
- 일반 저장의 no-op은 byte-for-byte 동일해야 한다. 의미 편집은 대상과 필요한 문법 경계만 바꾸며 무관한 원문을 재직렬화하지 않는다.
- 제품의 승인된 Agent·스크립트·CI 작업에 매번 사람 확인을 강제하지 않는다. 이는 저장소 개발·게시의 승인 규칙을 완화하지 않는다.

## 시작

- 변경 전에 [프로젝트 기록 규약](docs/project-records.md)을 읽고 실제 GitHub Issue의 승인 범위와 완료 조건을 확인한다.
- `git status --short`와 관련 diff를 확인한다. 사용자·다른 Agent의 변경과 기존 `.agents/`, Issue 양식·기록 규약을 보존한다.
- 제품 목적·완성형·로드맵 설명이나 기능 설계에는 [제품 비전](docs/product.md)을 먼저 읽고 장기 원칙·현재 지원·새 제안을 구분한다. 설계 판단에는 문서의 [점검 시나리오](docs/product.md#설계-제안-점검)를 적용한다.
- 일반 수정은 해당 계약만 읽는다. 모듈 경계는 [아키텍처](docs/architecture.md), source와 문법은 [파일 계약](docs/format.md)을 따른다. 모든 작업에 전체 문서 읽기를 강제하지 않는다.
- 설계 착수와 PR 검토에서 [ADR·계약 변경 절차](docs/project-records.md)에 따라 ADR 필요 여부와 근거를 남긴다. CLI 자동화 계약은 [CLI 문서](docs/cli.md)를 따른다.

## 코드 배치와 경계

- `apps/cli`: 명령, 파일 I/O, revision·lock·저장. `packages/model`: 공통 계약. `parser`: 원본→모델. `core`: 조회·검증·편집. `renderer-html`: 모델→HTML.
- 파일 배치 기준은 [저장소 구조](docs/repository-structure.md)를 따른다. 빈 미래 패키지를 만들지 않는다.
- 현재 엔진 라이브러리 `model/parser/core/renderer-html`에는 DOM·React·Tiptap·파일 시스템·네트워크 의존성을 넣지 않는다. 향후 UI adapter까지 금지하는 규칙은 아니다. 공개 export를 사용하고 순환 의존성을 금지한다. 원본 범위·UTF-8/BOM/개행 계약은 [파일 계약](docs/format.md)을 따른다.
- 지원하지 않는 문법·동시성 보장·테스트 결과를 지원한다고 주장하지 않는다. 사용자 문서를 코드나 HTML로 실행하지 않는다.

## 개발과 검증

Node.js 22 이상과 package.json에 고정한 pnpm을 사용한다. `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`를 실행한다. CLI는 `pnpm exec narudoc --help`로 확인한다.

수정한 기능과 원본 보존·실패 경로를 함께 테스트한다. 공통 계약·빌드 변경은 전체 테스트로 검증한다. `git diff --check`를 확인하고 실행 명령·성공/실패·미실행 사유를 Issue/PR에 남긴다. CI 미실행을 통과로 처리하지 않는다. main 직접 push, 자동 merge, npm publish는 별도 승인 없이 수행하지 않는다.
