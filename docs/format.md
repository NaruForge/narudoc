# NaruDoc 0.0.3 파일 문법

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
