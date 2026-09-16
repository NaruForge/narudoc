# 0010. 의미 입력 계약과 client binding 분리

- 기록일: 2026-09-17
- Status: Proposed
- 관련 작업: [Issue #31](https://github.com/NaruForge/narudoc/issues/31)
- 채택일: 없음. 구현과 ADR 채택은 별개다.

## Context

모델 union, batch 필드 목록, CLI 옵션/dispatch/help가 수동으로 같은 입력을 정의했다. 웹 JSON reader는 CLI와 달리 duplicate key를 허용했고 100개 단위 replay의 실패 위치를 전체 요청으로 전달하지 않았다.

대안은 수동 타입과 validator의 동등성 검사, 외부 범용 schema 라이브러리, 제한된 실행 입력 정의에서 타입을 추론하는 방식이다. 현재 필요한 구조는 문자열·안전 정수·boolean·배열·plain object·discriminated union뿐이다. 교차 필드·문법·문서 의미까지 schema로 옮기면 parser/Core의 두 번째 구현이 된다.

## Decision

`model/operation-contract.ts`의 모든 operation 및 authoring DTO 정의에서 TypeScript 타입과 입력 검증을 도출하는 현재 구현을 제안한다. 작은 `input-schema.ts`는 이 유한한 어휘만 검사하며 범용 JSON Schema validator를 주장하지 않는다. Core는 ID/참조/문법/대상·교차 필드 의미와 최소 patch를 소유한다. 기존 `readDirectiveInput`/`readTableInput` API는 공통 형식 검사 뒤 의미 검사를 하는 wrapper로 유지한다.

CLI binding은 의미 필드를 기존 flag 또는 JSON DTO 입력으로 연결한다. 옵션 타입/필수 여부/enum/도움말/예제는 계약을 사용하며 Node 파일·HTTP 설정은 모델에 넣지 않는다. Binding coverage, Core exhaustive dispatch, 전체 실제 예제 실행, 생성 명령표 대조가 drift를 검사한다. `capabilities` 하나가 기계용 발견 경로다.

Node JSON helper는 기존 file-store에서 CLI·웹이 공유한다. Duplicate key(escape된 이름 포함)를 거부하고 UTF-8/BOM은 공용 decode/reader를 따른다. `planSequence`는 초기 문서와 매 단계 입력·결과를 순서대로 검증한다. 선행 의미 오류보다 후행 shape 오류를 먼저 보고하지 않는다. 기존 `planBatch` 1..100은 호환 request policy로 유지하고 웹 0..10000은 host 정책이다. 웹은 전체 sequence 성공 후 한 번 저장하며 오류는 전체 operationIndex와 해당 단계 diagnostics를 포함한다.

## Consequences

새 operation은 하나의 실행 입력 정의와 Core 구현, 필요한 client binding을 추가한다. CLI와 GUI의 표면을 1:1로 강제하지 않는다. 작은 schema reader 자체는 유지 비용이며 지원 어휘를 늘릴 때 inference·runtime·발견 출력 검사를 함께 바꿔야 한다. schema-valid는 document-valid를 의미하지 않는다.

기존 명령·flag·envelope `schemaVersion:1`과 문법은 유지한다. 웹 duplicate key, 직접 JS Core 호출의 unknown field/잘못된 enum·기본 타입 거부는 강화된다. 진단 message 문자열보다 code/operationIndex를 사용한다. 웹 diagnostics/operationIndex는 추가 필드다. 기존 명령 입력을 재작성하거나 문서를 migration하지 않는다. 정확히 같은 section 문단을 교체할 때 mixed EOL이 정규화되던 결함도 no-op 계약에 맞게 수정한다.

제품 버전은 구현 배포 단위, envelope schemaVersion은 응답/요청 껍질, 파일 해석 호환성은 문법 계약이 설명한다. 같은 schemaVersion이어도 과거 0.0.2 directive children·0.0.3 table 해석 변경처럼 parsed Block 의미가 달라질 수 있다. 호환 필드 추가에는 envelope 버전을 무조건 올리지 않는다. 의미/필수 필드/문법의 breaking change는 영향과 source 재파싱·명시적 이행을 해당 Issue/PR과 format/CLI에 기록한다. 파생 snapshot을 영구 원본으로 취급하지 않는다.
