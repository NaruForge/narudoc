# NaruDoc 0.0.2 파일 문법

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

ID는 `[A-Za-z][A-Za-z0-9._:-]*`이고 문서 내 유일하다. 문단마다 ID를 강제하지 않는다. attribute key는 단순 식별자이며 중복과 prototype 관련 예약 이름을 거부한다. 값은 한 줄 문자열이고 실행·평가하지 않는다. 중첩 목록·표·수식·Setext heading·blockquote는 MVP 의미 객체가 아니다.

## Directive 본문 · 0.0.2

속성 헤더와 본문은 빈 줄로 구분한다. 본문은 여러 문단, 기존 flat single-line ordered/unordered list, backtick 또는 tilde fenced code를 지원한다. 본문이 없거나 공백뿐이면 자식 배열은 비어 있으며 공백은 원본에 남는다. 알 수 없는 directive 이름에도 같은 규칙을 적용한다. `requirement` 전용 스키마는 없다.

코드 fence 밖의 `:::`만 directive를 닫는다. 코드 안의 `:::`와 `:::name`, 링크처럼 보이는 문자열은 코드다. fence 밖의 중첩 directive와 닫히지 않은 fence/directive는 오류다. 본문의 heading·metadata처럼 보이는 표현은 literal paragraph text이며 outline·ID 정의에 포함하지 않는다. 중첩 목록과 재귀 directive는 지원하지 않는다.

모델은 `DirectiveBodyBlock = Paragraph | List | Code`와 `Directive.children`을 사용한다. `DocumentSnapshot.blocks`는 최상위 블록만 담고 자식을 중복 등록하지 않는다. 자식 범위와 링크 `urlRange`는 전체 문서 원문의 UTF-16 위치다. 예시는 [directive-blocks.narudoc](../examples/directive-blocks.narudoc)을 참고한다.

**0.0.1 → 0.0.2는 breaking change다.** `body: Inline[]`를 제거하고 `children: DirectiveBodyBlock[]`로 교체한다. 저장한 모델은 기존 authoritative source를 새 parser로 재파싱하여 이행한다. `.narudoc` 파일을 자동 변환하거나 다시 저장하지 않는다. 기존 본문의 목록/fence는 이제 블록으로 해석되므로 원본 bytes 보존이 해석의 하위 호환을 뜻하지 않는다.

## 편집 의미

Section은 heading 시작부터 다음 동급/상위 heading 직전 또는 EOF까지이며 내부 하위 섹션과 뒤쪽 공백을 포함한다. 이동은 같은 부모의 동급 섹션 사이에서만 허용한다. 이동 대상 내부로 이동할 수 없다. 문단 교체의 index는 지정 section의 직접 자식 문단을 대상으로 한 0-based index다. Directive 내부 문단은 세지 않으며 본문 전용 편집 operation은 없다. 속성 편집과 섹션 이동은 본문을 재직렬화하지 않는다.

ID 변경은 `renameId`로 정의와 같은 문서 내부 참조를 함께 수정한다. 파서가 인식한 링크만 대상으로 하며, percent-encoded fragment는 decode한 ID로 비교하고 변경된 URL은 `#NEW`로 기록한다. 같은 ID는 no-op이다. 코드·일반 텍스트·외부 링크·다른 문서의 참조는 바꾸지 않는다. 일반 속성 편집으로 ID를 바꾸는 것은 계속 거부한다. 상세 명령·실패 계약은 [CLI](cli.md)를 따른다.

기존 속성 변경은 값 범위만 바꾸고, 속성 추가는 해당 directive header에 삽입한다. 새 텍스트의 개행은 문서의 첫 개행 방식에 맞춘다. 변경 없는 저장과 편집 범위 밖 문자는 그대로 보존한다. 문법 오류·중복 ID·깨진 내부 참조가 있는 문서에 대한 semantic write는 거부하고 plain text로 먼저 복구하도록 진단한다.

배치 편집에서도 각 단계는 앞선 결과를 대상으로 같은 규칙을 적용하며 중간의 잘못된 문서를 허용하지 않는다. 한 파일의 모든 단계가 성공하면 최종 결과만 저장한다. CLI의 10 MiB 문서 크기 제한은 초기 파일과 최종 결과에 적용한다. 배치 입력/순차 범위/실패 의미는 [CLI 계약](cli.md)을 따른다.

알 수 없는 directive 종류는 generic 객체로 보존·표시한다. 알려지지 않은 Markdown 표현은 의미를 추정하지 않고 literal text로 다룬다. 편집 후에는 재파싱과 동일 validation을 거치며, 새 문법이나 전체 Markdown 호환은 별도 범위다.
