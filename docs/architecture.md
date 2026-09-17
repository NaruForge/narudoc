# 아키텍처

이 문서는 현재 코드의 책임과 확장 경계를 소유한다. 장기 목적은 [제품](product.md), 파일 해석은 [format](format.md), 명령·자동화는 [CLI](cli.md), 작업별 코드/검증 경로는 [저장소 구조](repository-structure.md#작업에서-구현과-검증으로)가 원본이다. 구현 사실과 ADR의 채택 상태는 별개이며 연결된 ADR은 각 문서의 Status를 확인한다.

## 의존 경계

| 책임 | 허용 의존 |
| --- | --- |
| model | 내부 의존 없음 |
| parser | model |
| core | model, parser |
| renderer-html | model |
| file-store | model, Node 파일 I/O |
| editor-adapter | model, core, renderer-html, ProseMirror; 순수 session은 model/core만 |
| apps/web | core, model, renderer-html, file-store; browser는 editor-adapter |
| apps/cli | core, model, renderer-html, file-store; edit launcher만 web |

엔진 네 라이브러리(model/parser/core/renderer-html)는 DOM·editor·Node I/O·네트워크에 의존하지 않는다. `headless`는 화면을 숨긴 편집기 인스턴스가 아니라 순수 문서 처리다. CLI/API/Visual Editor는 client이며 GUI가 CLI subprocess를 반드시 호출할 필요는 없다. Package 공개 export를 사용한다. 재귀 source, workspace/map coverage, cycle·deep import와 launcher 예외는 [실행 검사](../scripts/verify-architecture.mjs)가 확인한다.

## 원본 소유권

| 값 | 책임과 수명 |
| --- | --- |
| `.narudoc` source | 저장의 authoritative 원본. strict UTF-8/BOM/EOL/EOF 계약은 format/file-store가 보장한다. |
| parsed model / DocumentSnapshot | parser가 source에서 도출한 블록·inline·범위·진단. 현재 source에만 유효하며 영속 원본이 아니다. |
| authoring DTO | 새 객체의 의미 입력. 가짜 source range를 요구하지 않는다. |
| operation request | 의미 변경 의도. model의 실행 입력 정의에서 형식을, Core에서 대상·문법·참조를 검증한다. |
| EditPlan / TextEdit / result | 해당 입력 snapshot에 적용 가능한 expected text와 UTF-16 범위, 검증된 다음 snapshot. 다른 source에 재사용하지 않는다. |
| editor projection / 입력 draft | PM/DOM 표시와 IME·미완성 입력. source를 export하여 저장하는 경로가 아니다. 유효한 Core 결과만 source에 반영한다. |

흐름은 source → parse → operation → 최소 TextEdit → 재파싱/검증 → file-store 저장이다. 범위는 전체 문서 기준 UTF-16 `[start,end)`이며 surrogate 분할·중첩·expected 불일치를 거부한다. 일반 no-op은 정확히 같은 bytes다. 제목·문단·속성은 공통 접두/접미사를 보존하고, 이동은 source slice를 이동한다. 새 객체 생성만 제한된 문법으로 직렬화하며 기존 문서를 다시 직렬화하지 않는다. 완전한 lossless CST·incremental parser 구현은 아니다. [ADR0001](adr/0001-source-preserving-edits.md), [ADR0002](adr/0002-offset-encoding.md)를 참고한다.

## 실행 입력 계약

의미 입력의 원본은 [operation-contract.ts](../packages/model/src/operation-contract.ts)다. 모든 operation/authoring DTO의 TypeScript 타입과 runtime shape 검사를 같은 정의에서 도출한다. Core는 문서 문맥의 의미 검증을, CLI binding은 flag/출력/파일 입력을, 웹은 HTTP 인증·요청 한도를 소유한다. Node JSON lexical duplicate-key reader는 file-store에서 공유한다. Shape-valid는 document-valid를 뜻하지 않는다.

공통 `planSequence`는 초기 문서와 각 단계의 입력/결과를 순서대로 검증한다. 후행 형식 오류가 선행 의미 오류를 가리지 않는다. `planBatch`의 1..100 compatibility policy와 웹의 0..10000 host limit은 다르며 의미 transaction 규칙은 같다. 웹 오류는 전체 operationIndex/diagnostics를 보존하고 어떤 중간 단계도 저장하지 않는다. 전체 snapshot을 보유할 필요가 없는 replay는 final-only mode를 사용한다. [ADR0005](adr/0005-sequential-batch-edits.md), [ADR0010](adr/0010-executable-operation-contract.md)에 대안·호환성·유지 비용을 기록한다.

제품 버전은 구현 배포, envelope schemaVersion은 입출력 껍질, 파일 해석 호환성은 [format의 이행 설명](format.md)이 소유한다. 하나의 버전 숫자가 모두를 보장하지 않는다. 호환 필드 추가와 breaking 의미/문법 변경을 구분하고 후자는 소비자 영향·재파싱/이행·회귀를 같은 작업에서 기록한다.

## 대상과 편집 세션

Core query의 직접 본문/text/table resolver를 CLI와 adapter가 재사용한다. Stable ID와 snapshot 상대 index/path, GUI selection은 서로 다르다. `get`의 targets와 `table get`의 target은 현재 단계 scope를 표시한다. A/B 앞 X 삽입 뒤 다음 단계 index 1은 A, 2는 B다. 외부 stale revision은 file-store의 별도 SHA-256 검사이며 내부 index 이동을 해결하지 않는다. ID rename은 parser가 기록한 정의/실제 내부 링크 범위를 공통 참조 순회로 고친다.

순수 `editor-adapter/session`은 source/snapshot, 저장 기준 revision, draft 등록, selection과 의미 gesture를 조정한다. PM/DOM adapter는 projection과 composition을 담당한다. 한 gesture의 모든 operation을 준비한 뒤 한 번 공개하고, 구조가 바뀌면 오래된 view/selection을 무효화한다. Journal의 연속 inline 편집 축약은 exact-source 재계획으로 확인하고 undo history와 구분한다.

실제 두 문단 PM proof는 단일 document projection과 복수 view를 비교한다. 다음 자연스러운 편집 확장은 단일 projection을 기준으로 검토하며 현재 per-block 제한을 제품 원칙으로 고정하지 않는다. 현재 저장 시 history 초기화, 자동 ID UX 제외, 측정 절충과 남은 검증은 [ADR0011](adr/0011-targets-and-source-session.md)에 있다. 현재 제품 지원은 [spike](visual-editor-spike.md)와 [로컬 편집기](local-editor.md)를 따른다.

## 저장과 안전

CLI·웹은 file-store의 strict UTF-8, SHA-256 revision, cooperative lock, pre-save revision check, 같은 폴더 temporary file + rename, 크기 제한, symlink/hardlink 제한과 no-clobber를 공유한다. Lock을 자동으로 빼앗지 않는다. Dry-run은 저장 함수를 호출하지 않으며 실제 저장 성공의 보장은 아니다. 비협조적 writer에 대한 완전한 compare-and-swap이나 전원 장애 내구성은 보장하지 않는다. [ADR0004](adr/0004-file-save-guarantees.md)가 경계를 설명한다.

웹은 한 지정 파일만 다루며 Host/Origin/token/CSRF 검사 후 operations를 서버에서 재계획한다. 브라우저 raw source를 그대로 저장하지 않는다. 충돌은 draft를 유지하며 overwrite를 거부한다. [로컬 보안 계약](local-editor.md)과 [ADR0009](adr/0009-local-editor-save-boundary.md)를 따른다. Renderer는 model만 받아 text/attribute를 escape하고 위험 URL을 막으며 raw HTML/script·문서 code를 실행하거나 파일/네트워크를 읽지 않는다.

## 파서와 새 기능 배치

현재 v0.0.3은 좁은 NaruDoc 문법을 해석하는 순수 TypeScript scanner다. Directive의 paragraph/list/code scanner와 table row scanner는 전체 문서 범위를 유지한다. Validation·rename은 공통 참조 순회, renderer는 parsed model을 사용하며 client에 문법 parser를 복제하지 않는다. 상세 문법과 migration은 [format](format.md), 대안은 [ADR0003](adr/0003-bounded-parser.md), [directive 모델](adr/0006-directive-body-blocks.md), [table 모델](adr/0007-bounded-pipe-tables.md)을 참고한다.

| 새 요구의 성격 | 배치 판단 |
| --- | --- |
| 기존 의미 작업의 순서만 필요 | 기존 operation의 sequence/gesture 조합. 각 단계가 valid여야 한다. |
| Generic 객체의 문자열 속성만 필요 | 기존 directive attribute. `requirement.status`에 도메인 상태 전이 검증이 있는 것처럼 주장하지 않는다. |
| 새로운 원자적 의미·유효성·참조/보존 요구 | 명시적 Core operation과 공통 입력 계약. 모호한 raw string patch나 UI 전용 규칙으로 우회하지 않는다. |
| 현재 모델로 표현할 수 없는 문서 구조/문법 | model/parser/format·호환성·ADR 필요를 함께 검토하고 headless 검증 후 client에 연결한다. |
| 커서·창 배치·composition 표시 | client/session/adapter. 저장 문서 의미에 영향이 생기면 Core 경계를 다시 판단한다. |

새 도메인별 setter나 plugin registry는 실제 의미 요구 없이 추가하지 않는다. Engine → CLI/API 검증 → GUI 연결 순서와 source 보존 원칙은 [제품](product.md)이 소유한다.
