# 아키텍처

이 문서는 현재 구현을 설명한다. 장기 목적은 [제품 비전](product.md), 명령과 자동화 계약은 [CLI 문서](cli.md)를 따른다. 아래에 연결한 ADR은 현재 선택을 앞으로 유지할지 검토하기 위해 작성한 제안이며, 실제 채택 상태는 각 ADR에서 확인한다. 구현이 존재한다는 사실을 과거 ADR 승인으로 해석하지 않는다.

## 제품 원칙과 현재 구현

현재 CLI는 엔진을 사용하는 최초 reference client다. 엔진은 아래 model/parser/core/renderer-html의 책임을 포괄하며, CLI는 인자·출력·파일 I/O를 담당한다. `headless`는 UI chrome이 없다는 뜻에 그치지 않고 핵심 문서 처리가 DOM·편집기 인스턴스 없이 실행된다는 뜻이다.

향후 GUI/API adapter도 같은 엔진을 사용해야 한다는 [제품 원칙](product.md#엔진과-클라이언트의-관계)을 적용한다. GUI가 CLI subprocess를 반드시 호출해야 한다는 뜻은 아니며, 현재 GUI/SDK 배포나 모든 client 간 동등성 검증이 완료되었다는 뜻도 아니다. UI adapter의 화면 의존성과 엔진의 화면 독립성을 구분한다.

## 의존 경계

- model → 내부 의존성 없음.
- parser → model.
- core → model, parser.
- renderer-html → model.
- file-store → model, Node 파일 I/O. CLI와 웹의 실제 저장 구현을 공유한다.
- apps/web → core, renderer-html, file-store 및 공통 타입; browser bundle은 editor-adapter를 사용한다.
- apps/cli → core, renderer-html, file-store 및 공통 타입. edit launcher만 apps/web을 사용한다.
- editor-adapter → model, core, renderer-html, ProseMirror. DOM은 이 client adapter에만 있다.

위 엔진 라이브러리는 Node I/O·DOM·editor·네트워크에 의존하지 않는다. renderer는 원본을 재파싱하거나 Core 편집 로직을 복제하지 않는다. CLI는 Core operation을 호출하며 문서를 독자적으로 편집하지 않는다.

제한된 [시각 편집 spike](visual-editor-spike.md)는 source snapshot을 소유하고 PM transaction을 Core `setInlineText`로 연결한다. Parser text range/semantic target 기반 sidecar로 원문을 찾고 editor JSON/DOM을 저장하지 않는다. 일반 텍스트 범위 밖 구조는 보호하며 draft·composition·유효 snapshot을 분리한다. 선택 근거는 [Proposed ADR 0008](adr/0008-source-owned-editor-adapter.md)이다.

## 원본 소유권

UTF-8 파일 → 원본 string + 위치를 가진 semantic model → operation → TextEdit[] → 재파싱/검증 → 저장. 원본 string을 authoritative로 보존한다. 이 MVP는 완전한 lossless CST·incremental parser 구현이라고 주장하지 않는다. 원본+범위 기반 보존을 먼저 증명한다.

Edit 범위는 UTF-16 code unit의 반열린 구간 [start, end)이다. 변경 대상의 expected text를 확인하고 중첩·범위 오류·surrogate 분할을 거부한다. 전체 snapshot이 바뀌면 plan을 재사용하지 않는다. 제목·문단·속성은 공통 접두·접미사를 보존하며, 섹션 이동은 원본 slice를 이동한다.

`planBatch`는 기존 operation을 메모리에서 순서대로 계획하고 매 단계 재파싱·검증한다. 각 단계 edits는 해당 단계 입력 snapshot에 속하며 최초 원문의 patch로 합치지 않는다. CLI는 초기 revision과 최종 크기를 확인하고 전체 성공 시 기존 save를 한 번 호출한다. 실패한 중간 결과는 저장하지 않는다. 입력/응답은 [CLI 계약](cli.md), 선택 근거와 대안은 [순차 배치 ADR](adr/0005-sequential-batch-edits.md)에 있다.

`insertParagraph`는 기존 section 문단과 같은 범위(다음 heading 전)의 문단 index로 삽입 위치를 정한다. 기존 문단 앞 또는 직접 본문의 마지막 블록 끝에 길이 0의 patch 하나를 만든다. 기존 공백 구간을 유지하고 인접 블록과의 분리에 부족한 개행만 추가하며, CR과 LF의 결합도 계산한다. 삽입 입력의 단일 문단 검사와 최종 전체 문서 재파싱·검증은 Core가 소유한다. 기존 범위 patch·저장 구조의 확장이므로 별도 ADR을 추가하지 않는다.

유지 제안의 대안과 결과: [원본 보존 편집 방식](adr/0001-source-preserving-edits.md), [위치 단위](adr/0002-offset-encoding.md).

ID 변경은 parser가 기록한 heading `idRange`, directive의 ID 속성 `valueRange`, inline link `urlRange`를 최소 patch로 수정한다. 참조 순회와 fragment 해석은 Core validation과 편집이 공유한다. 문법을 Core에서 다시 스캔하지 않으며 전체 문자열 검색·치환을 사용하지 않는다. 기존 UTF-16/원문 범위 편집 선택을 확장 적용하므로 별도 ADR을 추가하지 않는다.

## 저장과 안전

`insertChildSection`은 Core의 전체 section 범위를 사용해 기존 자손 뒤에 삽입한다. 제목 level은 부모 + 1로 제한하고 새 ID/제목 및 전체 결과를 검증한다. 마지막 블록 끝의 삽입 patch 하나로 기존 원문과 trailing whitespace를 유지한다. CLI/batch는 같은 operation을 사용하며 기존 section 경계·patch·저장 계약 확장이므로 새 ADR을 추가하지 않는다.

CLI와 웹이 공유하는 file-store는 엄격한 UTF-8 decoding, 원본 SHA-256 revision, 협조적 lock, 같은 폴더 임시 파일과 rename을 담당한다. 저장 직전에 원본 revision을 다시 확인한다. symlink·hardlink 파일 편집은 MVP에서 거부한다. 외부의 비협조적 writer에 대한 완전한 compare-and-swap이나 전원 장애 내구성은 보장하지 않는다. lock은 자동으로 빼앗거나 삭제하지 않는다.

HTML은 텍스트·속성을 escape하고 위험 URL을 막는다. raw HTML·코드·directive를 실행하지 않는다. 렌더링은 네트워크·파일 읽기를 하지 않는다.

파일 입력의 symlink·hardlink 제한은 조회에도 적용된다. Dry-run은 편집 계획과 결과를 검사하되 저장 함수를 호출하지 않는다. 실제 저장의 보장 범위와 유지 제안은 [파일 저장 ADR](adr/0004-file-save-guarantees.md), 응답·재시도는 [CLI 계약](cli.md)을 참고한다.

## 파서 선택

새 directive 생성은 parsed model과 분리된 authoring DTO를 `model`의 공통 입력 정의와 `core/directive-input.ts`의 의미 검사로 확인하고 새 객체만 직렬화한다. 각 child를 directive 문맥에서 기존 parser로 확인한 뒤 섹션 직접 본문의 마지막 블록 끝에 삽입 patch를 만든다. 기존 문서 전체를 직렬화하지 않는다. 코드 fence 길이는 본문과 충돌하지 않도록 정하며 최종 문서의 참조 검증과 CLI 저장은 기존 경로를 사용한다. CLI는 JSON 문법·중복 key를 검사하고 Core가 field/type·의미 검증을 소유한다. 신규 문법/범용 serialization engine/schemaVersion 도입이 아닌 기존 계약 확장이므로 새 ADR을 추가하지 않는다.

Directive의 본문은 `Paragraph | List | Code` 자식만 가진다. Top-level과 본문은 같은 원문 line table에서 문단·목록·fence scanner를 공유하므로 자식 범위도 전체 문서 UTF-16 위치다. 본문의 heading·metadata는 문단 텍스트이며 재귀 directive는 허용하지 않는다. 코드 scanner가 fence 끝까지 소비한 뒤 directive delimiter를 검사한다. `DocumentSnapshot.blocks`는 최상위만 보유한다.

Core validation과 rename은 같은 순회에서 자식 문단·목록의 실제 링크를 한 번씩 처리하며 code는 제외한다. Renderer는 재파싱 없이 자식을 각각 `<p>`, `<ul>/<ol>`, `<pre><code>`로 투영한다. Section 문단 index와 속성·섹션 원문 편집 계약은 유지한다. `body → children` 공개 모델 변경과 제한된 자식 경계의 대안은 [ADR 0006](adr/0006-directive-body-blocks.md)에 제안한다. 이행과 본문 해석 변경은 [문법 계약](format.md)에 명시한다.

`replaceDirectiveParagraph`는 자식 중 paragraph만 센 index로 대상 원문 범위를 찾는다. 교체 입력은 임시 directive 본문으로 기존 parser에 전달하여 정확히 한 문단인지 검사한다. 따라서 최상위 heading/metadata 규칙을 본문에 잘못 적용하지 않는다. 정확히 같은 원문은 no-op이며, 그 외에는 개행을 맞춘 뒤 최소 patch를 적용하고 전체 결과를 재파싱·검증한다. CLI와 batch는 같은 operation을 호출한다. 기존 원본 보존·저장 경계의 확장이므로 별도 ADR을 추가하지 않는다.

v0.0.3은 docs/format.md의 좁은 NaruDoc 문법만 구현하는 순수 TypeScript scanner를 사용한다. 앞선 micromark 후보는 범용 Markdown interoperability가 필요해질 때 비교한다. 직접 구현 범위를 CommonMark 전체로 확대하지 않는다. 도구/의존성 선택과 무관하게 snapshot/범위 계약 및 fidelity tests를 유지한다.

현재 방식을 유지할지 판단할 대안과 재검토 조건은 [제한 문법 parser ADR](adr/0003-bounded-parser.md)에 정리한다.

표는 parser의 별도 bounded row scanner에서 escape/code를 구분하고 절대 셀 contentRange를 계산한다. Core는 DTO를 기존 parser로 확인하고 기존 section 삽입/최소 patch/순차 batch 경로를 사용한다. 참조 validation과 rename은 공통 순회에서 셀 inline을 처리하며 renderer는 재파싱하지 않는다. 모델/호환성 결정은 [Proposed ADR 0007](adr/0007-bounded-pipe-tables.md), 상세 문법은 [파일 계약](format.md)을 따른다.

[단일 파일 로컬 편집기](local-editor.md)는 browser draft/유효 snapshot/저장 revision을 분리하고, 인증된 의미 연산을 서버에서 Core로 재계획한 뒤 공용 save를 한 번 호출한다. 엔진에는 HTTP·DOM을 넣지 않는다. 저장 경계와 보안 선택은 [Proposed ADR 0009](adr/0009-local-editor-save-boundary.md)를 참고한다.

## 실행 입력 계약

대상 해석과 편집 상태의 소유권은 아래 절을 함께 따른다.

의미 입력의 원본은 model의 [operation-contract.ts](../packages/model/src/operation-contract.ts)다. TypeScript 타입과 runtime shape 검사는 같은 정의를 사용한다. Core는 문서 문맥의 의미 검증을, CLI binding은 flag/출력/파일 입력을, 웹은 HTTP 인증·요청 한도를 소유한다. 공통 Node JSON reader는 file-store에 있다. 공통 순차 planning은 host limit과 분리하며 전체 요청 실패 index를 유지한다. [ADR 0010](adr/0010-executable-operation-contract.md)은 대안·호환성·유지 비용을 기록한 Proposed 문서다.

## 대상과 편집 세션

Core query가 section 직접 본문과 text/table 대상을 해석한다. Stable ID와 snapshot 상대 index/path는 다른 계약이다. `get`의 targets와 `table get`의 target은 현재 단계 scope를 표시한다. Batch 내부 삽입 뒤에는 바뀐 index를 사용하며 외부 stale revision 검사는 file-store에 남는다.

순수 `editor-adapter/session`은 source/snapshot, 저장 기준 revision, draft 등록, selection과 의미 gesture를 조정한다. PM/DOM adapter는 projection과 입력 composition을 담당한다. 한 gesture의 모든 operation을 준비한 뒤 한 번 공개하고, 구조가 바뀌면 오래된 view를 무효화한다. 저장 journal의 연속 inline 편집 축약은 exact-source 재계획으로 확인하며 undo history와 구분한다. 실제 두 문단 PM proof, 측정 결과와 다음 단일 문서 projection 방향은 [Proposed ADR 0011](adr/0011-targets-and-source-session.md)에 있다.
