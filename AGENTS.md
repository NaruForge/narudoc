# NaruDoc 개발 안내

NaruDoc은 사람이 읽는 `.narudoc` 파일을 Git·AI Agent·자동화가 함께 사용하는 headless 문서 엔진이다. GUI는 엔진의 client이며 문서 원본을 소유하지 않는다.

## 시작

- 변경 전에 [프로젝트 기록 규약](docs/project-records.md)을 읽고 실제 GitHub Issue의 승인 범위와 완료 조건을 확인한다.
- `git status --short`와 관련 diff를 확인한다. 사용자·다른 Agent의 변경과 기존 `.agents/`, Issue 양식·기록 규약을 보존한다.
- [제품](docs/product.md), [구조](docs/architecture.md), [문법](docs/format.md)을 작업 범위에 맞게 읽는다.
- 설계 착수와 PR 검토에서 [ADR·계약 변경 절차](docs/project-records.md)에 따라 ADR 필요 여부와 근거를 남긴다. CLI 자동화 계약은 [CLI 문서](docs/cli.md)를 따른다.

## 코드 배치와 경계

- `apps/cli`: 명령, 파일 I/O, revision·lock·저장. `packages/model`: 공통 계약. `parser`: 원본→모델. `core`: 조회·검증·편집. `renderer-html`: 모델→HTML.
- 파일 배치 기준은 [저장소 구조](docs/repository-structure.md)를 따른다. 빈 미래 패키지를 만들지 않는다.
- 라이브러리에는 DOM·React·Tiptap·파일 시스템·네트워크 의존성을 넣지 않는다. 패키지의 공개 export를 사용하고 순환 의존성을 금지한다.
- 전체 문서 재직렬화로 저장하지 않는다. UTF-16 범위 계약, UTF-8/BOM/개행과 무관한 원본 bytes를 보존한다.
- 지원하지 않는 문법·동시성 보장·테스트 결과를 지원한다고 주장하지 않는다. 사용자 문서를 코드나 HTML로 실행하지 않는다.

## 개발과 검증

Node.js 22 이상과 package.json에 고정한 pnpm을 사용한다. `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`를 실행한다. CLI는 `pnpm exec narudoc --help`로 확인한다.

수정한 기능과 원본 보존·실패 경로를 함께 테스트한다. 공통 계약·빌드 변경은 전체 테스트로 검증한다. `git diff --check`를 확인하고 실행 명령·성공/실패·미실행 사유를 Issue/PR에 남긴다. CI 미실행을 통과로 처리하지 않는다. main 직접 push, 자동 merge, npm publish는 별도 승인 없이 수행하지 않는다.
