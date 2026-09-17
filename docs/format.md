# NaruDoc 0.0.5 파일 문법

## 범위

`.narudoc`은 UTF-8 텍스트이며 BOM·LF·CRLF를 보존한다. 완전한 CommonMark/YAML이 아닌 제한된 문법이다. SourceRange와 JSON edit offset은 UTF-16 code unit, [start,end)이다. 파일 byte offset과 혼동하지 않는다.

CLI의 문서 크기 한도는 BOM을 포함한 UTF-8 기준 10 MiB다. 새 문서와 편집 결과에도 같은 한도를 적용하며, 초과하면 `NARU_LIMIT`로 실패하고 원본을 보존한다. 기존 문서 편집의 `--dry-run`도 편집 결과의 크기와 유효성을 검사한다. 다만 저장 잠금 획득·저장 직전 원본 재검사·실제 쓰기 가능 여부는 확인하지 않아 저장 성공을 보장하지 않는다. 응답과 사용법은 [CLI 계약](cli.md)을 따른다. 변환된 HTML 출력에는 이 문서 크기 한도를 적용하지 않는다.

- 첫 블록의 `---`로 둘러싼 단순 `key: value` metadata. 중첩 YAML·alias·객체는 지원하지 않는다.
- 1~6개의 `#`로 시작하는 ATX heading. 끝의 `{#stable-id}`가 선택적 ID다.
- 빈 줄로 구분하는 문단, flat single-line ordered/unordered lists, fenced code.
- inline text, `*emphasis*`, `**strong**`, backtick code, `[label](url)`과 `[label](#id)` 참조. raw HTML은 텍스트다.
- `:::name` 다음의 단순 속성, 선택적 빈 줄과 본문, 마지막 `:::`로 구성한 generic directive. 중첩 directive는 지원하지 않는다.

```text
---
title: Control design
---
# Architecture {#architecture}

See [control](#control).

## Control {#control}

A **structured** paragraph.

:::requirement
id: REQ-001
status: draft

The controller shall validate its inputs.
:::
```

ID는 `[A-Za-z][A-Za-z0-9._:-]*`이고 문서 내 유일하다. 문단마다 ID를 강제하지 않는다. attribute key는 단순 식별자이며 중복과 prototype 관련 예약 이름을 거부한다. 값은 한 줄 문자열이고 실행·평가하지 않는다. 중첩 목록·수식·Setext heading·blockquote는 MVP 의미 객체가 아니다.

## Directive 본문 · 0.0.2

속성 헤더와 본문은 빈 줄로 구분한다. 본문은 여러 문단, 기존 flat single-line ordered/unordered list, backtick 또는 tilde fenced code를 지원한다. 본문이 없거나 공백뿐이면 자식 배열은 비어 있으며 공백은 원본에 남는다. 알 수 없는 directive 이름에도 같은 규칙을 적용한다. `requirement` 전용 스키마는 없다.

코드 fence 밖의 `:::`만 directive를 닫는다. 코드 안의 `:::`와 `:::name`, 링크처럼 보이는 문자열은 코드다. fence 밖의 중첩 directive와 닫히지 않은 fence/directive는 오류다. 본문의 heading·metadata처럼 보이는 표현은 literal paragraph text이며 outline·ID 정의에 포함하지 않는다. 중첩 목록과 재귀 directive는 지원하지 않는다.

모델은 `DirectiveBodyBlock = Paragraph | List | Code`와 `Directive.children`을 사용한다. `DocumentSnapshot.blocks`는 최상위 블록만 담고 자식을 중복 등록하지 않는다. 자식 범위와 링크 `urlRange`는 전체 문서 원문의 UTF-16 위치다. 예시는 [directive-blocks.narudoc](../examples/directive-blocks.narudoc)을 참고한다.

**0.0.1 → 0.0.2는 breaking change다.** `body: Inline[]`를 제거하고 `children: DirectiveBodyBlock[]`로 교체한다. 저장한 모델은 기존 authoritative source를 새 parser로 재파싱하여 이행한다. `.narudoc` 파일을 자동 변환하거나 다시 저장하지 않는다. 기존 본문의 목록/fence는 이제 블록으로 해석되므로 원본 bytes 보존이 해석의 하위 호환을 뜻하지 않는다.

## 편집 의미

`insertChildSection`은 부모 heading ID로 마지막 자식 섹션을 생성한다. 부모 level 1..5에서는 새 level을 부모 + 1로 정하며 level 6 아래는 거부한다. 기존 자손 전체 뒤이자 부모의 다음 동급/상위 heading 전에 추가하므로 기존 자손의 순서/부모 관계를 바꾸지 않는다. 새 ID는 heading/directive를 포함해 문서 내 유일해야 한다. 기존 `insertSection`의 동급 삽입과 section move의 같은 부모 제약은 유지한다.

부모 섹션 전체 범위의 마지막 블록 끝에 새 heading과 필요한 경계 개행만 삽입한다. 기존 원문·BOM·혼합 개행·공백을 재작성하지 않는다. 새 개행은 문서의 첫 EOL(없으면 LF)을 따르고, EOF에서는 기존 trailing 공백/개행이 새 heading 뒤에 남아 마지막 개행 유무를 유지한다. 결과를 다시 parse/validate하며 제목의 내부 참조도 확인한다. 같은 ID로 반복 실행하면 중복 오류다.

`insertDirective`는 `sectionId`가 가리키는 heading의 직접 본문 끝(첫 하위/다음 heading 전)에 새 generic directive를 추가한다. 기존 마지막 직접 블록 뒤에 새 원문과 필요한 경계 개행만 삽입하며 기존 블록·공백·BOM·혼합 개행은 재작성하지 않는다. EOF에서는 기존 마지막 블록 뒤의 공백·개행이 새 directive 뒤에 남아 마지막 개행 유무를 유지한다. 이름에 따른 도메인 스키마는 없다. 새 ID는 필수이며 문서 내 유일해야 한다.

입력은 source range가 없는 `DirectiveInput`/`DirectiveChildInput`이다. `name`, `id`, `attributes`, `children`을 모두 제공한다. 이름은 `[A-Za-z][A-Za-z0-9_-]*`, ID는 기존 규칙을 따른다. Attributes는 문자열 값의 객체이며 `id`·예약 key·알 수 없는 필드·잘못된 타입을 거부한다. 속성 값은 앞뒤 공백 없는 한 줄 문자열(빈 값 허용)이다. CLI JSON의 중복 key도 거부한다. Children은 빈 배열 또는 다음 객체의 배열이다.

| type | 필드와 생성 규칙 |
| --- | --- |
| `paragraph` | `text`: directive 문맥에서 정확히 한 문단. Heading/metadata 모양은 literal이며 앞뒤 빈 줄·추가 블록·delimiter 주입은 거부한다. |
| `list` | `ordered`: boolean, `items`: 비어 있지 않은 문자열 배열. 각 항목은 앞뒤 공백 없는 비어 있지 않은 한 줄이다. Unordered는 `-`, ordered는 연속 숫자와 `.`를 사용한다. Ordered에만 선택적 `start`(기본 1, 0 이상 안전한 정수)를 허용하며 마지막 번호까지 9자리 이하여야 한다. |
| `code` | `value`: Unicode 문자열, 선택적 `language`: 앞뒤 공백·제어문자·backtick 없는 한 줄(기본 빈 문자열). 본문의 가장 긴 backtick 연속보다 긴 fence(최소 3개)를 사용한다. 비어 있지 않은 value가 개행으로 끝나지 않으면 닫는 fence를 위해 마지막 개행 하나를 추가한다. |

새 입력의 개행은 문서의 첫 EOL(없으면 LF)로 맞춘다. Child 사이에 빈 줄을 넣고 생성한 각 child가 기존 parser에서 같은 종류의 블록 하나인지 확인한다. 전체 결과도 다시 parse/validate하여 자기 참조·기존 ID 참조를 확인하고 깨진 참조를 거부한다. 코드의 링크 모양 텍스트는 참조로 취급하지 않는다. 기존 파일/모델 문법이나 schemaVersion은 바꾸지 않으며 문서 migration은 없다. 같은 ID로 재실행하면 중복 오류이며 자동 중복 제거는 하지 않는다.

`insertParagraph`는 섹션 heading ID와 문단 index로 문단 하나를 추가한다. 다음 heading 전까지의 직접 문단만 세며, directive 내부와 하위 섹션 문단은 제외한다. 직접 문단이 n개라면 0..n을 허용한다. index < n은 해당 문단 바로 앞, index == n은 직접 본문의 마지막 블록 뒤(첫 하위/다음 heading 전)에 추가한다. 문단이 없는 섹션은 0을 사용하며 목록·코드·directive가 있으면 그 뒤에 추가한다. 그러므로 index 0이 언제나 섹션의 첫 블록 앞을 뜻하지는 않는다.

입력은 section 문단 교체와 같은 단일 문단 문법을 따른다. 빈 입력·앞뒤 빈 줄·여러 블록·heading/list/fence/directive 삽입은 거부하며 참조는 전체 결과에서 검증한다. 새 문단의 개행은 문서의 첫 개행 방식(없으면 LF)을 사용한다. 기존 원문은 삭제·교체하지 않고 문단과 필요한 경계 개행만 삽입한다. 양옆에 블록이 있으면 빈 줄을 확보하며 기존 공백 줄과 혼합 개행은 그대로 둔다. EOF에 추가할 때 기존 마지막 블록 뒤의 공백·개행은 새 문단 뒤에 남기므로 마지막 개행 유무도 유지한다. 같은 명령을 반복하면 문단이 다시 추가되며 중복 제거/no-op은 아니다.

`splitParagraph`, `joinParagraph`, `replaceParagraphRange`는 직접 문단의 표시 text 범위를 보존형으로 편집하는 문서 gesture 연산이다. `index`와 `{ index, offset }`는 매 단계 snapshot의 section 직접 문단 기준이며 `offset`은 UTF-16 표시 text 위치다. Split은 지원되는 strong/emphasis 경계를 보존하고, join은 인접 직접 문단 사이의 빈 줄 경계만 제거한다. Range replace는 같은 section에서 보호 block을 건너지 않는 선택만 허용하며, expected 불일치·surrogate 분할·link/code/escape 내부 편집은 거부한다.

Range의 plain replacement는 `LF`·`CRLF`·`CR`을 문단 경계로 해석하고 구조 문법을 새로 실행하지 않는다. 문서 편집기의 multiline paste는 이 연산을 사용하며 빈 줄은 정규화된다. 결과에 빈 문단이 남거나 heading/list/fence/directive·markup-like 입력이 생기면 원본을 유지하고 실패한다. standalone CLI binding은 없고 Core/API/batch와 웹 편집기가 같은 실행 정의를 공유한다.

Section은 heading 시작부터 다음 동급/상위 heading 직전 또는 EOF까지이며 내부 하위 섹션과 뒤쪽 공백을 포함한다. 이동은 같은 부모의 동급 섹션 사이에서만 허용한다. 이동 대상 내부로 이동할 수 없다. Section 문단 교체의 index는 지정 section의 직접 자식 문단을 대상으로 한 0-based index다. Directive 내부 문단은 세지 않는다. 속성 편집과 섹션 이동은 본문을 재직렬화하지 않는다.

`replaceDirectiveParagraph`는 directive ID와 본문 문단의 0-based index로 기존 문단 하나를 교체한다. `children` 중 paragraph만 세므로 목록·코드는 index에 포함하지 않는다. 빈 본문에 문단을 삽입하거나 기존 문단을 삭제하는 기능은 아니다. 입력은 directive 문맥에서 정확히 한 문단이어야 하며 앞뒤 빈 줄·추가 블록·닫는 delimiter·중첩 directive를 거부한다. Heading·metadata처럼 보이는 줄은 기존 본문 문법에 따라 literal paragraph다. 교체 후 전체 문서를 재파싱·검증하므로 깨진 내부 참조도 거부한다.

원래 문단과 정확히 같은 입력은 혼합 개행까지 보존하는 no-op이다. 변경 입력의 개행은 문서의 첫 개행 방식에 맞추며 대상 범위 안의 최소 patch만 적용한다. Header·다른 자식·문단 주변 공백·문서의 마지막 개행 유무는 유지한다. 기존 문법·모델과 `replaceParagraph` 의미는 변경하지 않으며 문서 마이그레이션은 없다.

ID 변경은 `renameId`로 정의와 같은 문서 내부 참조를 함께 수정한다. 파서가 인식한 링크만 대상으로 하며, percent-encoded fragment는 decode한 ID로 비교하고 변경된 URL은 `#NEW`로 기록한다. 같은 ID는 no-op이다. 코드·일반 텍스트·외부 링크·다른 문서의 참조는 바꾸지 않는다. 일반 속성 편집으로 ID를 바꾸는 것은 계속 거부한다. 상세 명령·실패 계약은 [CLI](cli.md)를 따른다.

기존 속성 변경은 값 범위만 바꾸고, 속성 추가는 해당 directive header에 삽입한다. 새 텍스트의 개행은 문서의 첫 개행 방식에 맞춘다. 변경 없는 저장과 편집 범위 밖 문자는 그대로 보존한다. 문법 오류·중복 ID·깨진 내부 참조가 있는 문서에 대한 semantic write는 거부하고 plain text로 먼저 복구하도록 진단한다.

배치 편집에서도 각 단계는 앞선 결과를 대상으로 같은 규칙을 적용하며 중간의 잘못된 문서를 허용하지 않는다. 한 파일의 모든 단계가 성공하면 최종 결과만 저장한다. CLI의 10 MiB 문서 크기 제한은 초기 파일과 최종 결과에 적용한다. 배치 입력/순차 범위/실패 의미는 [CLI 계약](cli.md)을 따른다.

알 수 없는 directive 종류는 generic 객체로 보존·표시한다. 알려지지 않은 Markdown 표현은 의미를 추정하지 않고 literal text로 다룬다. 편집 후에는 재파싱과 동일 validation을 거치며, 새 문법이나 전체 Markdown 호환은 별도 범위다.

## 제한된 표 · 0.0.3

섹션 heading 이후 직접 본문에서 헤더 행과 바로 다음 separator 행으로 시작한다. 모든 행은 양끝 pipe가 필수이며 바깥 space/tab은 허용한다. Separator의 각 셀은 3개 이상의 `-`만 허용하고 colon 정렬은 지원하지 않는다. Body는 0행 이상이며 빈 줄이나 pipe 행이 아닌 블록에서 끝난다. 서로 다른 표는 빈 줄로 분리한다. 인식된 표의 separator/body 열 수 불일치는 `NARU_TABLE_COLUMNS` 오류다. 빈 셀은 허용한다. 앞뒤 pipe 없는 형태나 지원하지 않는 separator는 literal paragraph다. Code 및 directive 안과 첫 heading 전의 표 모양 텍스트는 기존 해석을 유지한다.

구분자는 escape되지 않고 유효한 단일 backtick code 바깥에 있는 pipe다. 홀수 연속 backslash 뒤 pipe는 escape이며 짝수이면 구분자다. 표 셀에서만 `\|`를 화면의 `|`로 해석한다. Code 안의 pipe는 literal이고 미종결 backtick은 기존 inline 규칙대로 일반 문자다. 전체 GFM/CommonMark, 여러 줄 셀, 중첩 표를 지원하지 않는다.

`Table`은 `header: TableRow`, `separatorRange`, `rows: TableRow[]`, `range`를 가진다. Row는 `cells`와 `range`, cell은 padding 포함 `range`, space/tab을 제외한 `contentRange`, 기존 `inline` 배열을 가진다. 모든 범위는 전체 문서 UTF-16 `[start,end)`이며 행 range는 EOL을 제외한다. 빈 셀 contentRange는 왼쪽 padding 뒤의 길이 0 범위다. Link urlRange도 같은 절대 위치를 사용한다.

생성 DTO `TableInput`은 `headers: string[]`와 `rows: string[][]`만 받는다. 헤더는 최소 1열, 각 body는 동일 열 수다. 각 문자열은 앞뒤 공백 없는 한 줄 Unicode(빈 문자열 허용)이며 unescaped pipe와 제어문자를 거부한다. 현재 inline 표기를 입력하며 참조는 결과 전체에서 검증한다. `insertTable`은 `sectionId`의 마지막 직접 블록 뒤, 다음 heading 앞에 새 표와 필요한 개행만 추가한다. 새 표는 `| content |`와 `---`로 생성하며 기존 원문과 EOF 공백은 보존한다.

`setTableCell`은 `sectionId`, 직접 `tableIndex`, `part: header|body`, `row`, `column`, `text`를 받는다. Index/좌표는 0-based, header row는 0이다. 셀 contentRange 안의 최소 patch만 적용하고 padding·separator·다른 셀은 유지한다. 같은 내용은 no-op이다. 기존 revision/lock/크기/batch 저장 규칙을 적용하며 원문 offset 입력은 제공하지 않는다. 참조 validation/rename은 실제 셀 링크를 한 번 순회하고 code의 가짜 링크는 무시한다. Renderer는 모델에서 안전한 table HTML을 만든다.

**0.0.2 → 0.0.3:** Block union/inspect JSON에 table이 추가된다. 이전 버전에서 literal paragraph였던 위 문법은 이제 table이다. Section/directive 문단 index는 여전히 직접 paragraph만 세지만, 예전 표 모양 paragraph가 빠져 같은 파일의 숫자 index는 달라질 수 있다. 소비자는 table 분기를 추가하고 원문을 재파싱·조회한 뒤 편집한다. 자동 파일 변환은 없고 CLI envelope schemaVersion은 1을 유지한다. 근거는 [Proposed ADR 0007](adr/0007-bounded-pipe-tables.md)이다.

## 표 annotation과 의미 참조 · 0.0.4

섹션 직접 본문에서 `@table id="tab-parameters" caption="Control parameters"` 한 줄을 pipe table 앞에 둔다. 사이에는 space/tab만 있는 빈 줄을 최대 한 줄 허용한다. Annotation과 표는 하나의 Table이며 기존 무주석 표도 같은 tableIndex에 포함된다. Code/directive 내부 annotation 모양은 기존 literal 해석을 유지하고 첫 heading 전 annotation은 오류다. `@table` 다음 공백 또는 줄 끝이 시작자 경계다.

속성은 space/tab으로 구분한 `key="JSON string"`이며 `id`는 필수, `caption`은 선택이다. 순서는 자유이고 중복/알 수 없는 key, 잘못된 ID, 표 없는 annotation, 연속 annotation, 두 줄 이상 빈 간격은 오류다. Caption은 제어문자 없는 한 줄 Unicode 평문이며 Markdown/참조를 해석하지 않는다. Quote/backslash는 JSON escape로 표현한다. Table의 `annotationRange`, `idRange`(quote 제외), `captionRange`(quote 포함), `captionAttributeRange`(앞 공백 포함)는 전체 source UTF-16 범위다. Table.range는 annotation부터 마지막 행까지이고 행/셀 범위는 변하지 않는다.

`[@tab-parameters]`는 표 ID를 가리키는 의미 참조다. `reference` Inline은 `targetId`, `targetRange`, `range`를 가진다. 닫히지 않은 참조는 `malformed`로 표시하여 validation에서 진단한다. 본문/heading/목록/표 셀/directive 본문의 공통 inline 문법이다. 일반 `[label](url)`이 우선하므로 `[@id](url)`은 기존 링크다. Escape된 `\[@id]`, code, 링크 label, caption/속성 안에서는 의미 참조를 만들지 않는다. 잘못된 구문, 미정의/모호한 ID, 표가 아닌 대상은 위치를 가진 오류다.

ID는 heading/directive/table 전체에서 유일하다. ID 있는 표만 문서 등장 순서로 1부터 번호를 가지며 caption 유무는 번호에 영향을 주지 않는다. 참조 표시는 `Table N`, 표 caption은 `Table N: Caption`(caption 없으면 `Table N`)이다. 일반 내부 링크는 원래 label을 유지한다. 번호는 source에 쓰지 않고 `resolveReferences(snapshot)`에서 계산한다. `inlineText(nodes, context)`는 같은 snapshot의 표시 label을 사용하고 context가 없으면 새 참조를 `[@ID]`로 반환한다. 편집 표시 offset은 해당 snapshot context를 사용한다.

`insertTable`의 선택적 id/caption으로 생성하고 `setTableMetadata`로 기존 표를 annotation하거나 caption을 편집한다. 생략 필드는 유지, 빈 caption은 제거, 기존 ID 변경은 `renameId`만 허용한다. `insertReference`/`setReferenceTarget`은 section 직접 paragraph의 inline path에서 작성/대상을 변경한다. 삽입은 ordinary text leaf의 UTF-16 offset과 expected를 사용하며 gap은 expected 빈 문자열/offset 0이다. Strong/emphasis 내부는 지원하고 보호 inline 내부는 거부한다. 전체 validation과 의도한 inline shape를 확인한다.

0.0.3 → 0.0.4는 Inline union과 새 예약 구문 해석의 호환성 변경이다. 기존 literal annotation/참조는 새 의미가 될 수 있으므로 literal은 시작자를 escape하거나 code로 표현한다. 파일 자동 migration은 없다. 소비자는 원문을 재파싱하고 reference 분기를 추가한다. CLI envelope와 batch schemaVersion은 1이다. 근거는 [Proposed ADR 0012](adr/0012-table-semantic-references.md)다.

## Figure와 로컬 asset · 0.0.5

섹션 안에서 `@figure id="fig-control" src="assets/control.png" alt="Control diagram" caption="Control layout"` 한 줄이 하나의 Figure 블록이다. `@figure` 다음 공백 또는 줄 끝이 시작자 경계이며, 첫 heading 전의 annotation은 오류다. Code/directive 본문 안의 annotation 모양은 기존 literal 해석을 유지한다. 속성은 표 annotation과 같은 space/tab 구분 `key="JSON string"`이며 순서는 자유다. `id`·`src`·`alt`는 필수이고 `caption`은 선택이다. 중복/알 수 없는 key, 잘못된 ID, 빈 src는 오류다. `alt`는 명시적 빈 문자열(장식 이미지)을 허용한다. `caption`은 표와 같은 한 줄 평문이다.

Figure의 `range`는 annotation 한 줄이며 `idRange`(quote 제외), `srcRange`·`altRange`·`captionRange`(quote 포함), `captionAttributeRange`(앞 공백 포함)는 전체 source UTF-16 범위다. 파일 bytes·절대 경로·브라우저 URL은 source에 저장하지 않는다.

`src`는 문서 폴더 기준의 이식 가능한 상대 경로다. `/`만 구분자로 사용하며 backslash, 절대/drive/UNC 경로, 빈/`.`/`..` segment, 앞뒤 공백, 제어문자를 거부한다. 확장자는 `.png`·`.jpg`·`.jpeg`·`.webp`만 허용한다(대소문자 무관). 공백·한글·`#`·`%`는 파일명의 literal 문자로 저장하며, URL이 필요한 출력은 segment별 percent-encoding만 적용하고 저장 값을 decode하지 않는다.

파일의 존재·실제 형식·크기 검증은 parser/Core가 아니라 CLI·웹이 공유하는 Node resolver(`file-store`)가 수행한다. Core 문서 validation은 Figure 구조·ID·참조만 다루므로, 누락 asset이 있어도 문서는 읽기·편집할 수 있고 진단과 placeholder로 표시한다. Resolver는 실제 bytes의 magic·최소 컨테이너 구조·치수를 검사해 확장자 불일치·위장 HTML·잘린 파일을 거부하고, symlink/junction과 hardlink를 보수적으로 거부한다. 제한값은 파일당 10 MiB, 문서당 합계 64 MiB, Figure 100개, 치수 16384px이다(로컬 편집기 메모리 상한이 이유이며 문서 10 MiB 한도와 별개다). 검사→읽기 사이에 재검사하지만 race-free filesystem sandbox를 보장하지는 않는다.

ID 있는 Figure는 Table과 별도 계열로 문서 순서 1부터 번호를 가지며 `Figure N`으로 표시된다. `[@fig-id]` 의미 참조와 `[label](#fig-id)` 일반 링크, `renameId`, 중복 ID 거부는 #36의 공통 체계를 공유한다. `insertFigure`는 섹션 직접 본문 끝에 annotation 한 줄만 추가하고 asset 파일을 복사·수정하지 않는다. `setFigureMetadata`는 src/alt/caption의 quote 범위만 최소 patch하며 `src`를 바꿔도 Figure ID와 기존 참조는 유지된다. ID 변경은 `renameId`만 허용한다.

저장·export는 결과 문서의 asset 검증에 실패하면 원본 파일과 출력을 변경하지 않는다. stdin처럼 asset root가 없는 입력은 이 자원 검증을 건너뛰며, `validate --stdin`의 결과가 asset 존재를 보장하지 않는다. HTML export는 linked-assets 방식으로 `--output` 위치 기준의 상대 URL을 기록하며, 문서와 `assets/`의 상대 배치를 유지해 함께 옮겨야 한다. 세션 URL·절대 경로를 출력에 저장하지 않는다.

0.0.4 → 0.0.5는 Block union에 `Figure`가 추가되는 호환성 변경이다. 기존 literal `@figure` 텍스트는 새 구문으로 해석될 수 있으므로 escape/code를 사용한다. 파일 자동 migration은 없고 소비자는 재파싱 후 figure 분기를 추가한다. Renderer의 figure는 snapshot의 reference context가 필수이며 파일을 읽지 않고 호스트의 URL mapping만 사용한다. CLI envelope와 batch schemaVersion은 1을 유지한다. 근거는 [Proposed ADR 0013](adr/0013-figure-local-assets.md)이다.

## 일반 text 위치와 편집

Parser의 ordinary text Inline에는 선택적 절대 `range`가 추가된다. `parseInline`에 sourceOffset을 제공할 때 기록하며 기존 link urlRange는 유지한다. Escape를 해석한 text는 range 길이와 표시 길이가 다를 수 있으므로 직접 offset mapping을 가정하면 안 된다. Source를 재파싱해 최신 범위를 사용한다.

`setInlineText`는 [CLI 계약](cli.md#일반-inline-text-편집)의 semantic target/path/expected로 단일 text run을 고른다. 원문과 표시 text가 동일한 run에서만 최소 patch를 허용한다. 결과 inline 구조와 전체 validation을 확인하므로 markup/블록/ID를 몰래 바꾸지 못한다. 지원 범위 밖 escape/multiline/link/code는 보호한다. 별도 visual 전용 문서 규칙은 없다.

Inline node의 선택적 `range`는 code/strong/emphasis/link의 바깥 문법 경계에도 기록한다. 이 범위는 일반 text가 삭제된 자리의 의미적 gap 삽입을 위한 것이며 node 자체의 raw 편집 허가는 아니다. `expected: ""`의 gap 삽입도 동일한 결과 구조·참조 검증을 거친다.
