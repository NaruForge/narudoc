# CLI 사용과 자동화 계약 · v0.0.3

이 문서는 현재 CLI의 명령과 입출력 계약을 설명한다. 장기 목표는 [제품 비전](product.md), 문법·편집 의미·크기 제한은 [파일 계약](format.md), 저장 보장은 [아키텍처](architecture.md)를 따른다. API와 문법은 실험 단계다.

저장소에서 의존성을 설치하고 빌드한 뒤 `pnpm exec narudoc`으로 실행한다. npm registry 설치는 제공하지 않는다. 명령은 사용자 입력을 묻지 않으며, stdin을 사용하는 경우에는 입력 스트림의 끝까지 기다린다.

## 명령과 옵션

아래 표의 모든 일반 명령은 `--json`을 받을 수 있다. `FILE`은 하나만 지정하며 `--stdin`과 동시에 지정할 수 없다. 알 수 없는 명령·옵션, 반복 옵션과 명령에 맞지 않는 옵션은 인자 오류다.

| 명령 | 명령별 옵션 | 의미 |
| --- | --- | --- |
| `inspect FILE` | `--stdin` | 모델·길이·진단을 항상 JSON으로 출력 |
| `table get FILE --section ID --index N` | `--stdin` | 직접 표 조회 |
| `table insert FILE --section ID --from INPUT` | 편집 공통 옵션 | 표 JSON DTO 생성 |
| `table set-cell FILE --section ID --index N --part header\|body --row N --column N --text TEXT` | 편집 공통 옵션 | 셀 내용만 수정 |
| `outline FILE` | `--stdin` | 제목과 섹션 구조 조회 |
| `get FILE --id ID` | `--stdin` | ID 대상 조회; heading이면 해당 섹션의 원문 반환 |
| `validate FILE` | `--stdin` | 문서 진단과 유효성 판단 |
| `render FILE --to html` | `--stdin`, `--output FILE` | 유효한 문서를 HTML로 출력 |
| `new FILE` | `--title TITLE`, `--id ID` | 새 문서 생성; 생략 시 제목 `Untitled`, ID `document` |
| `heading set-title FILE --id ID --title TITLE` | 편집 공통 옵션 | 제목 변경 |
| `text set FILE --kind KIND --id ID --index N --path N.N --expected TEXT --text TEXT` | 편집 공통 옵션 | 일반 inline text run 의미 편집 |
| `section insert FILE --after ID --id NEW_ID --title TITLE` | 편집 공통 옵션 | 지정 섹션 뒤에 동급 섹션 삽입 |
| `section insert-child FILE --parent ID --id NEW_ID --title TITLE` | 편집 공통 옵션 | 부모의 마지막 자식 섹션 생성; level은 부모 + 1 |
| `section remove FILE --id ID` | 편집 공통 옵션 | 섹션과 하위 내용 삭제 |
| `section move FILE --id ID --after ID` | 편집 공통 옵션 | 같은 부모·같은 level의 섹션 이동 |
| `paragraph replace FILE --id SECTION --index 0 --text TEXT` | 편집 공통 옵션 | 지정 섹션의 직접 자식 문단 교체; index는 0부터 시작 |
| `paragraph insert FILE --id SECTION --index N --text TEXT` | 편집 공통 옵션 | 지정 섹션의 직접 문단 앞 또는 본문 끝에 문단 하나 삽입 |
| `directive set FILE --id ID --key KEY --value VALUE` | 편집 공통 옵션 | 속성 추가·변경; ID 변경 제외 |
| `directive insert FILE --section ID --from INPUT` | 편집 공통 옵션 | Semantic JSON으로 새 directive 생성; INPUT은 파일 또는 `-` |
| `directive replace-paragraph FILE --id ID --index N --text TEXT` | 편집 공통 옵션 | Directive 본문의 N번째 문단 교체; 목록·코드는 세지 않음 |
| `id rename FILE --id OLD --new-id NEW` | 편집 공통 옵션 | ID 정의와 같은 문서 내부 참조를 함께 변경 |
| `batch FILE --operations PLAN --revision SHA256` | `--dry-run` | 단일 문서의 의미 편집 목록을 순차 검증 후 한 번 저장 |

편집 공통 옵션은 `--dry-run`, `--revision SHA256`이다. 기존 문서를 수정하는 모든 개별 편집과 `batch`에서 지원하며 읽기 명령과 `new`에서는 지원하지 않는다. 개별 편집의 `--revision`은 선택 옵션이지만 조회 후 변경하는 자동화에서는 사용한다. `batch`에서는 필수다.

읽기 명령은 `FILE` 대신 `-` 또는 `--stdin`을 사용할 수 있다. 기존 문서 편집과 `new`는 실제 파일 경로가 필요하다. `--to`는 `html`만 지원한다. `new`와 `render --output`은 기존 파일을 덮어쓰지 않는다.

`--help` 또는 인자 없는 실행은 도움말 텍스트를 stdout에 출력한다. `--help --json`도 텍스트다. `--version`은 버전 텍스트, `--version --json`은 `{"version":"0.0.3"}`을 출력한다. 이 특수 응답들은 일반 문서 envelope를 사용하지 않는다.

## JSON 응답

일반 문서 조회·렌더링·기존 문서 편집의 성공 응답에는 다음 공통 필드가 있다. 소비자는 JSON 키 순서나 출력 공백에 의존하지 않는다.

| 필드 | 형식과 의미 |
| --- | --- |
| `schemaVersion` | 숫자 `1`; CLI JSON 응답의 현재 schema 표식 |
| `file` | 전달된 입력 경로 문자열; stdin이면 `-` |
| `revision` | 읽은 원본의 SHA-256, 64자리 소문자 16진수. 파일 입력은 원본 bytes, stdin은 엄격한 UTF-8 decoding 후 문자열의 UTF-8 표현 기준 |
| `offsetEncoding` | 문자열 `utf-16`; 범위와 길이의 단위 |

| 명령 | 공통 필드 외의 결과 |
| --- | --- |
| `inspect` | `sourceLength`: 원본 UTF-16 길이, `blocks`: block 배열, `diagnostics`: 진단 배열 |
| `outline --json` | `sections`: `id`(없으면 null), `title`, `level`, heading의 `range`, `sectionRange`, `parentStart`(없으면 null)를 갖는 배열 |
| `get --json` | `node`: ID를 가진 block, `source`: 원문. Heading의 `node.range`는 제목 줄이며 `source`는 하위 내용을 포함하는 섹션 원문이다. |
| `validate --json` | `valid`: error 진단이 없으면 true, `diagnostics`: 진단 배열 |
| `render --json` | stdout 출력이면 `html`: HTML 문자열, `--output`이면 `output`: 출력 경로 문자열 |
| 기존 문서의 개별 편집 `--json` | `dryRun`, `changed`: boolean, `nextRevision`: 결과 SHA-256, `edits`: TextEdit 배열, `diagnostics`: 편집 결과 진단 |
| `batch --json` | `dryRun`, `changed`, `nextRevision`, `diagnostics`와 `steps`: `{ operationIndex, edits }` 배열. 최상위 `edits`는 없다. |

`new --json`은 `schemaVersion`, `file`, `revision`만 반환하며 `offsetEncoding`은 없다. 도움말·버전과 실행 예외도 별도의 형태다. 모든 JSON이 같은 envelope라고 가정하지 않는다.

Range는 `{ start, end }`이고 UTF-16 code unit 기준 `[start, end)`이다. 파일 byte offset이나 줄·열 번호가 아니다. 원본의 BOM과 개행도 위치 계산에 포함한다. `TextEdit`는 `{ start, end, expected, text }`이며 `expected`는 교체 전 문자열, `text`는 교체할 문자열이다. 반환된 edit 배열은 해당 원본 snapshot에만 해당하고 다른 revision에 재사용하지 않는다. CLI는 이 배열을 입력받아 적용하는 명령을 제공하지 않는다.

진단은 `{ code, message, severity, range }`이며 `severity`는 `error` 또는 `warning`이다. 사람이 읽는 메시지보다 코드·severity·종료 코드를 기준으로 분기한다. Block·inline의 현재 필드와 타입은 [공통 모델](../packages/model/src/index.ts), outline 결과는 [조회 구현](../packages/core/src/query.ts)과 대응한다. 임의의 JSON을 안정된 독립 파일 포맷으로 저장하는 계약은 아니다.

파서 생성 모델의 heading에는 `idRange`(ID 문자만, `{#`·`}` 제외), inline link에는 `urlRange`(목적 URL만, 괄호 제외)가 선택적 필드로 제공된다. 범위는 전체 문서 원문 기준 UTF-16이다. 기존에 저장한 모델을 편집 입력으로 재사용하지 말고 현재 원문을 다시 파싱한다. `parseInline` 단독 호출은 기본적으로 위치 필드를 추가하지 않으며 세 번째 인자 `sourceOffset`을 제공하면 해당 원문 위치를 기준으로 `urlRange`를 계산한다.

**0.0.2의 breaking change:** `inspect.blocks` 및 directive를 조회한 `get.node`에서 `body: Inline[]`가 제거되고 `children: DirectiveBodyBlock[]`가 제공된다. 자식 타입은 `paragraph | list | code`로 제한되며 비어 있는 본문은 `[]`다. 최상위 blocks에는 자식을 중복 등록하지 않는다. 자식/진단/URL 범위 역시 전체 원문 기준이다. JSON 소비자는 children을 순회하도록 변경하고 저장한 모델은 기존 source를 새 parser로 재파싱해야 한다. 영구 body 호환 계층은 없다. `.narudoc` 파일 자동 변환은 없지만 기존 본문 목록/fence의 해석은 바뀐다. [문법 계약](format.md)을 참고한다. CLI envelope의 `schemaVersion: 1`과 batch 입력은 유지되므로 이 값만으로 모델 호환성을 판단하지 말고 제품 버전도 확인한다.

## stdout·stderr와 종료 코드

`inspect`는 `--json` 유무와 관계없이 JSON을 출력한다. 문서를 읽고 구조를 조회했다는 성공과 문서가 유효하다는 판단은 다르다. 문법·참조 오류 진단이 포함되어도 inspect는 0으로 끝날 수 있으므로 저장·출력 전에 `validate` 결과를 확인한다. 읽기 자체가 실패하면 실행 예외가 된다.

| 상황 | stdout | stderr | 종료 코드 |
| --- | --- | --- | --- |
| 정상 조회·편집·출력 | 텍스트 또는 JSON 결과 | 보통 없음 | 0 |
| `validate --json`, 문서 오류 | `valid: false`와 diagnostics를 가진 JSON | 없음 | 3 |
| `validate`, 문서 오류 | 없음 | 진단 텍스트 | 3 |
| `validate`, warning만 있음 | 유효 결과(JSON 또는 `Valid: ...`) | 텍스트 모드에서는 warning 진단 | 0 |
| 실행 예외, `--json` | 없음 | 아래 error JSON | 아래 분류 |
| 실행 예외, 텍스트 모드 | 없음 | 오류 코드·메시지·진단 텍스트 | 아래 분류 |

실행 예외의 JSON 형태는 다음과 같다. 아래는 잘못된 ID로 실행했을 때의 형태 예시이며 message는 고정된 파싱 계약으로 사용하지 않는다. 배치의 특정 작업에서 실패하면 `error.operationIndex`가 추가된다. 계획 전체의 형식 오류, 초기 문서 오류, 파일 I/O·revision·최종 크기·저장 실패에는 이 필드가 없다.

```json
{"schemaVersion":1,"error":{"code":"NARU_TARGET","message":"Expected one target for ID missing; found 0.","diagnostics":[]}}
```

| 종료 코드 | 분류 | 대표 코드 |
| --- | --- | --- |
| 0 | 성공 또는 error 진단 없는 validation | warning은 허용 |
| 1 | 내부/미분류 오류 | `NARU_INTERNAL` 등 아래 분류에 없는 실행 오류 |
| 2 | 인자 또는 대상 오류 | `NARU_ARGUMENT`, `NARU_TARGET` |
| 3 | 문서·encoding 오류 | `NARU_INVALID_DOCUMENT`, `NARU_ENCODING`; validate의 error 진단 |
| 4 | 원본 변경 또는 잠금 충돌 | `NARU_STALE`, `NARU_LOCKED` |
| 5 | 파일 I/O 또는 크기 제한 | `NARU_IO`, `NARU_LIMIT` |

같은 종료 코드 3이라도 validate 결과와 실행 예외의 채널·형태가 다르다. 프로세스 결과를 받은 뒤 stdout과 stderr를 구분해 읽는다. 오류나 warning을 숨기고 성공으로 처리하지 않는다.

## Revision과 dry-run

기존 문서 편집 응답의 `revision`은 편집 전 원본이다. `nextRevision`은 dry-run에서는 예상 결과, 실제 저장 성공 시에는 그 편집 결과의 revision이다. 다른 writer가 그 뒤에 파일을 바꾸지 않는다는 보장은 아니다. 개별 편집의 no-op이면 `changed: false`, `edits: []`이고 두 revision이 같다. 배치의 변경 상쇄와 단계별 edits는 아래 계약을 따른다.

`--revision`은 조회했던 원본과 현재 읽은 원본이 다르면 편집을 거부한다. 실제 저장도 별도 원본 검사를 수행하지만 완전한 파일 시스템 CAS를 보장하지 않는다. 충돌 시 다시 조회하고 변경 의도를 재검토한 뒤 새 revision으로 작업한다. 기존 lock을 자동 삭제해서 재시도하지 않는다.

Dry-run은 문서를 읽고 지정한 revision·대상·편집 결과의 유효성과 크기 등을 검사한다. 원본을 쓰지 않고 저장 잠금을 얻지 않으며 저장 직전 재검사나 실제 쓰기 가능 여부도 확인하지 않는다. 따라서 기존 lock이 있어도 dry-run은 성공하고 실제 변경은 잠금 충돌로 실패할 수 있다. 예상 `nextRevision`은 저장 성공을 예약하거나 동시 변경을 막는 토큰이 아니다.

텍스트 preview의 `@@ UTF-16 start:end @@`와 JSON 문자열로 표시한 `-`/`+`는 사람이 검토할 표시다. `git apply`에 넣는 unified patch가 아니다. 실제 편집은 검토한 의미 명령을 원본 revision과 함께 다시 실행한다.

## ID와 내부 참조 변경

`id rename FILE --id OLD --new-id NEW`는 heading 또는 directive의 ID와 파서가 인식한 같은 문서 내부 링크를 하나의 operation으로 변경한다. 제목/문단/목록/directive 자식 문단·목록 및 강조 안의 링크가 포함된다. 자식 code의 가짜 링크는 validation과 rename 모두 무시한다. 비교는 기존 검증과 같은 `decodeURIComponent` 규칙이다. 예를 들어 `#REQ%2D001`도 `REQ-001`을 가리키므로 변경 대상이다. 변경된 목적지는 `#NEW`로 기록하며 링크 라벨은 유지한다.

```sh
pnpm exec narudoc id rename examples/engineering.narudoc --id REQ-001 --new-id REQ-CTRL-001 --dry-run --json
```

실제 저장은 조회한 `--revision`과 함께 실행한다. 같은 ID 지정은 no-op으로 인코딩 표현까지 유지한다. 잘못된 새 ID나 다른 대상과의 ID 충돌은 `NARU_ARGUMENT`(2), 없는 대상은 `NARU_TARGET`(2), 처음부터 유효하지 않은 문서는 `NARU_INVALID_DOCUMENT`(3)로 실패한다. 원문은 저장하지 않는다. 수동으로 만든 모델에 필요한 위치가 없거나 불일치하면 Core는 `NARU_PATCH`로 거부하므로 현재 parser로 다시 파싱한다.

코드 블록/inline code/escape로 인해 링크로 인식되지 않는 텍스트, 링크 라벨, metadata·directive의 일반 속성 값, 외부 URL과 `other.narudoc#OLD`는 바꾸지 않는다. 다른 문서에서 들어오는 참조도 갱신하지 않는다. 문법 전체를 정규식으로 검색·치환하지 않고 현재 지원 문법의 의미 링크만 처리한다. 일반 `directive set --key id`는 계속 거부한다.

배치에는 `{ "type": "renameId", "id": "REQ-001", "newId": "REQ-CTRL-001" }`을 넣는다. ID와 참조가 같은 단계에서 바뀌므로 중간 참조 오류 없이 다음 단계에서 새 ID를 사용할 수 있다. 앞선 단계의 원문 범위가 바뀌어도 새 snapshot에서 위치를 계산한다.

## 하위 섹션 생성

`section insert-child FILE --parent ID --id NEW_ID --title TITLE`은 부모의 기존 자손 전체 뒤에 마지막 자식 섹션을 만든다. 새 제목 수준은 부모보다 한 단계 깊으며 부모의 다음 동급/상위 heading 앞에 삽입한다. 부모의 직접 본문 끝에 넣는 문단/directive 삽입과 위치 의미가 다르다. 기존 `section insert --after`는 동급 섹션 추가로 유지하며 `--parent`와 `--after`는 각 명령에서 혼용할 수 없다.

```sh
pnpm exec narudoc section insert-child sample.narudoc --parent control --id protection --title "Protection" --revision REVISION_FROM_INSPECT --dry-run --json
```

실제 저장은 같은 revision으로 `--dry-run`을 제거한다. 없는 부모 또는 heading이 아닌 대상은 `NARU_TARGET`(2), 6단계 부모·중복/잘못된 새 ID·잘못된 제목은 `NARU_ARGUMENT`(2), 깨진 참조를 포함한 결과는 `NARU_INVALID_DOCUMENT`(3)다. Revision·lock·크기 제한과 JSON 응답은 기존 편집 계약을 따른다. 반복 생성은 같은 ID 충돌이며 자동 중복 제거는 하지 않는다.

Core/batch는 `{ "type": "insertChildSection", "parent": "control", "id": "protection", "title": "Protection" }`을 사용한다. 후속 단계에서 새 ID를 부모로 추가 계층을 만들거나 문단/directive를 추가할 수 있다. 후속 실패 시 전체 batch를 저장하지 않는다. [계층 작성 계획](../examples/hierarchy-edit.json)은 `design` 새 문서에서 제어·보호·검증 절과 요구사항을 작성한다.

기존 문법·모델·응답 envelope와 section insert/move의 의미는 유지한다. 문서 migration은 없고 구버전은 새 명령/operation을 지원하지 않는다. 공개 Operation union의 exhaustive switch 소비자는 새 분기를 고려해야 한다. 원문/EOL/EOF 보존 규칙은 [파일 계약](format.md#편집-의미)을 따른다.

## 섹션 문단 삽입

`paragraph insert FILE --id SECTION --index N --text TEXT`는 기존 섹션에 문단 하나를 추가한다. `get FILE --id SECTION --json`의 원문 또는 `inspect`의 블록을 조회하여 다음 heading 전까지의 직접 문단 수 n을 확인한다. Index는 기존 `paragraph replace`처럼 문단만 세며 directive 내부/하위 섹션 문단과 목록·코드는 제외한다. 0..n 중 n 미만은 해당 문단 앞, n은 본문의 마지막 블록 뒤이자 첫 하위/다음 heading 전에 삽입한다. 문단이 없으면 0으로 마지막 비문단 블록 뒤에 추가하고, 본문도 없으면 heading 뒤에 첫 문단을 만든다.

```sh
pnpm exec narudoc paragraph insert sample.narudoc --id control --index 0 --text "The controller validates its inputs." --revision REVISION_FROM_INSPECT --dry-run --json
```

실제 저장에는 같은 명령에서 `--dry-run`을 제거한다. 입력은 기존 section 문단 교체와 같은 한 문단이어야 한다. 빈 문자열·앞뒤 빈 줄·여러 문단·구조 문법은 `NARU_ARGUMENT`(2), 없는 섹션/heading이 아닌 ID·범위 밖 index는 `NARU_TARGET`(2), 깨진 참조는 `NARU_INVALID_DOCUMENT`(3)다. CLI에서 음수·소수 등 잘못된 index 표기는 `NARU_ARGUMENT`(2)다. Revision·lock·크기 제한과 응답은 기존 편집 계약을 따른다. 실패하면 삽입을 저장하지 않는다.

Core/batch는 `{ "type": "insertParagraph", "id": "control", "index": 0, "text": "The controller validates its inputs." }`을 사용한다. Batch에서 index는 각 단계 직전 snapshot 기준이며, 삽입 뒤에는 기존 문단 index가 달라질 수 있다. 반복 삽입은 중복 제거/no-op이 아니므로 자동 재시도 전에 문서를 다시 조회한다. 원본 보존과 경계 개행은 [파일 계약](format.md#편집-의미)을 따른다.

기존 문법·모델·응답 envelope와 교체 index는 변경하지 않는다. 문서 migration은 없으며, 구버전은 새 operation을 지원하지 않는다. 공개 Operation union을 exhaustive switch로 처리하는 소비자는 새 분기를 고려해야 한다. [새 문서 작성 계획](../examples/new-document-edit.json)과 [편집 시나리오](authoring-scenario.md)는 새 문서에 삽입한 뒤 기존 교체 명령으로 수정하고 검증·HTML 출력까지 수행한다.

## Generic directive 생성

`directive insert FILE --section ID --from INPUT`은 섹션의 직접 본문 끝에 새 객체를 생성한다. `INPUT`은 아래 의미 구조의 JSON 파일이며 `--from -`이면 stdin을 읽는다. 원문 fragment가 아니다. 대상 문서는 실제 파일이어야 하고 `--stdin`은 허용하지 않는다. 파일 입력의 UTF-8 엄격 decoding·선두 BOM·10 MiB 한도·symlink/hardlink 제한은 batch와 같다. Stdin도 UTF-8/BOM/10 MiB 한도를 적용한다. 결과 문서 크기와 revision·dry-run·협조적 lock·JSON 응답은 기존 개별 편집 경로를 따른다.

```json
{
  "name": "requirement",
  "id": "REQ-DC-001",
  "attributes": { "status": "draft" },
  "children": [{ "type": "paragraph", "text": "Validate all inputs." }]
}
```

```sh
pnpm exec narudoc directive insert sample.narudoc --section control --from examples/requirement-input.json --revision REVISION_FROM_INSPECT --dry-run --json
```

실제 저장에서는 `--dry-run`을 제거한다. 필수/선택 필드와 paragraph/list/code 생성 규칙은 [파일 계약](format.md#편집-의미)을 따른다. 알 수 없는 필드, 잘못된 타입·name·ID·attribute·child, 중복 JSON key, 중복 문서 ID는 `NARU_ARGUMENT`(2)다. 대상 section이 없거나 heading이 아니면 `NARU_TARGET`(2), 깨진 참조는 `NARU_INVALID_DOCUMENT`(3)다. 실패 전 계획은 저장하지 않는다. 저장 중 I/O 오류의 보장 범위는 기존 파일 계약을 따른다.

Core/batch는 동일 필드에 `type: "insertDirective"`, `sectionId: "control"`을 더한 operation을 사용한다. API 입력 타입은 parsed 모델과 분리되어 range를 요구하지 않는다. 생성 후 같은 batch에서 속성·본문 수정 및 ID rename을 실행할 수 있고, 후속 실패는 삽입도 저장하지 않는다. 반복 호출은 같은 ID 충돌이므로 재시도 전 조회한다.

CLI의 directive 입력과 batch JSON 모두 중복 object key를 거부한다. Escape를 풀었을 때 같은 key도 중복이며, 이는 이전 batch의 JSON.parse last-value-wins 동작을 의도적으로 좁힌다. 정상적인 고유 key 계획은 그대로 실행된다. 중복 key는 operation 해석 전 입력 오류이므로 `operationIndex`가 없다. 응답 envelope와 schemaVersion은 유지한다. 구버전은 새 operation을 지원하지 않으며 exhaustive union 소비자는 새 분기를 고려해야 한다. [실행 예제](../examples/requirement-input.json)와 [시나리오](authoring-scenario.md)를 참고한다.

## Directive 본문 문단 편집

`directive replace-paragraph FILE --id ID --index N --text TEXT`는 ID가 있는 generic directive(예: requirement)의 본문 문단 하나를 교체한다. `get FILE --id ID --json`으로 `node.children`을 조회하고 paragraph만 센 0-based index를 지정한다. 전체 children 배열 index와 다를 수 있다. 목록·코드 편집, 문단 삽입·삭제는 지원하지 않는다.

```sh
pnpm exec narudoc get examples/engineering.narudoc --id REQ-001 --json
pnpm exec narudoc directive replace-paragraph examples/engineering.narudoc --id REQ-001 --index 0 --text "The controller shall validate all inputs." --dry-run --json
```

실제 저장에는 조회한 `--revision`을 함께 전달한다. 입력은 directive 문맥에서 한 문단이어야 한다. 제목/metadata 형태의 literal text는 허용하지만 빈 입력·앞뒤 빈 줄·여러 문단·목록·fence·directive delimiter 주입은 `NARU_ARGUMENT`(2)로 거부한다. 없는 ID·directive가 아닌 대상·범위 밖 index는 `NARU_TARGET`(2), 깨진 참조 등 유효하지 않은 결과는 `NARU_INVALID_DOCUMENT`(3)다. Revision·잠금 충돌과 dry-run·JSON 응답은 기존 편집 계약을 따른다.

Core/batch의 타입은 `{ "type": "replaceDirectiveParagraph", "id": "REQ-001", "index": 0, "text": "The controller shall validate all inputs." }`이다. 정확히 같은 원문 입력은 혼합 개행도 보존하는 no-op이며 변경 입력은 문서의 첫 개행 방식에 맞춘다. 무관한 원문을 다시 직렬화하지 않는다. 기존 section 문단 편집의 대상/index 의미와 JSON envelope는 바뀌지 않는다. Operation union에 새 타입이 추가되므로 exhaustive switch를 사용하는 API 소비자는 새 분기를 고려해야 한다. 구버전 도구는 새 명령/operation을 지원하지 않으며 문서 마이그레이션은 필요 없다.

조회부터 HTML 출력, 원본 보존과 실패 복구의 실행 예는 [acceptance test](../tests/acceptance/directive-edit.test.mjs)에 있다.
`engineering.narudoc` 복사본에 사용할 배치 예제는 [directive-paragraph-edit.json](../examples/directive-paragraph-edit.json)이며 [편집 시나리오](authoring-scenario.md)에서 실행·검증한다.

## 단일 문서 배치 편집

`batch FILE --operations PLAN --revision SHA256`은 한 파일에 지원하는 편집을 목록 순서대로 적용한다. `PLAN`은 JSON 파일 경로이며 `--operations -`이면 stdin에서 계획을 읽는다. 대상 문서 `FILE`은 실제 파일이어야 한다. `--stdin`은 받지 않는다. 계획 파일에는 문서 파일과 같은 symlink/hardlink 제한을 적용한다.

입력은 아래처럼 `schemaVersion: 1`과 `operations` 두 필드만 갖는다. 계획의 UTF-8 크기 한도는 BOM 포함 10 MiB이며 선두 BOM은 허용한다. 작업 수는 1~100개다. 알 수 없는 버전·필드·타입·누락 필드와 잘못된 JSON은 `NARU_ARGUMENT` / 종료 코드 2다. 인코딩 오류는 3, 크기 초과는 5다.

```json
{
  "schemaVersion": 1,
  "operations": [
    { "type": "replaceParagraph", "id": "dc-link-control", "index": 0, "text": "The target voltage is 420 V." },
    { "type": "setDirectiveAttribute", "id": "REQ-001", "key": "status", "value": "reviewed" },
    { "type": "moveSection", "id": "dc-link-control", "after": "validation" }
  ]
}
```

계획의 각 작업은 아래 필드를 정확히 가진다. `insertDirective`의 `attributes`/`children`은 위 구조화 입력 규칙을 따른다. 표의 headers/rows는 별도 DTO이며, 나머지 필드 중 `index`, `tableIndex`, `row`, `column`은 0 이상의 안전한 정수이고 다른 값은 모두 올바른 Unicode 문자열이다. 의미 제약은 해당 개별 편집과 같다.

| type | type 외 필수 필드 |
| --- | --- |
| `setHeadingTitle` | `id`, `title` |
| `setInlineText` | `kind`, `id`, `index`, `path`, `expected`, `text` |
| `insertTable` | `sectionId`, `headers`, `rows` |
| `setTableCell` | `sectionId`, `tableIndex`, `part`, `row`, `column`, `text` |
| `insertSection` | `after`, `id`, `title` |
| `insertChildSection` | `parent`, `id`, `title` |
| `removeSection` | `id` |
| `moveSection` | `id`, `after` |
| `replaceParagraph` | `id`, `index`, `text` |
| `insertParagraph` | `id`, `index`, `text` |
| `insertDirective` | `sectionId`, `name`, `id`, `attributes`, `children` (상기 구조화 입력) |
| `replaceDirectiveParagraph` | `id`, `index`, `text` |
| `setDirectiveAttribute` | `id`, `key`, `value` |
| `renameId` | `id`, `newId` |

`--revision`은 조회한 원본의 64자리 소문자 SHA-256으로 필수다. 순차 적용 도중 revision을 갱신하는 옵션은 없다. 처음 조회한 파일 snapshot을 저장 시에도 재확인한다.

각 단계는 앞선 단계 결과를 대상으로 한다. 앞서 삽입한 섹션을 다음 단계에서 수정할 수 있다. 초기 문서와 **모든 중간 결과**가 유효해야 하므로, 중간에 깨진 참조를 만들고 마지막에 복구하는 계획은 거부한다. 최종 문서의 UTF-8 크기를 검사하고, 모두 성공해야 기존 저장 경로를 한 번 호출한다. 계획 검증·크기 검사·충돌 검사가 실패하면 부분 결과를 저장하지 않는다. 자동 재시도는 하지 않는다.

성공 응답의 `steps`에는 `{ operationIndex, edits }`가 작업 순서대로 포함된다. `operationIndex`는 0부터 시작한다. 첫 단계의 edits는 최초 원문, 이후 단계는 직전 단계 적용 결과의 UTF-16 범위를 사용한다. **서로 다른 단계의 edits를 합쳐 최초 원문에 적용하면 안 된다.** 텍스트 dry-run도 각 단계 번호와 해당 단계 입력 기준 범위를 표시한다. 최상위 `changed`는 최초/최종 원문 비교다. 변경이 상쇄되면 `changed: false`이며 revision은 같지만 단계별 edits는 비어 있지 않을 수 있다.

특정 작업 실패 시 stderr error JSON은 기존 오류 코드와 `operationIndex`를 제공한다. 예를 들어 두 번째 작업의 대상이 없으면 `error.code: "NARU_TARGET"`, `error.operationIndex: 1`, 종료 코드 2다. 이때 stdout에는 부분 성공 결과를 출력하지 않는다. 진단 범위는 실패한 단계가 검사한 메모리 snapshot 기준이며 디스크 원문에 바로 적용할 수 없다. 실패한 계획은 저장되지 않는다.

Dry-run은 저장·잠금·쓰기 권한을 확인하지 않는다. 실제 저장은 기존 협조적 lock/revision/rename의 보장 범위를 유지한다. 비협조적 외부 writer에 대한 완전한 CAS, 전원 장애 내구성, 여러 파일의 transaction은 제공하지 않는다. rename 이후 정리 작업이 실패한 I/O 오류는 이미 최종 내용이 저장되었을 수 있으므로 재조회해야 한다.

재현 예제는 [engineering-edit.json](../examples/engineering-edit.json), 실행 시나리오는 [기술 문서 검증](authoring-scenario.md)이다. 선택 근거는 [ADR 0005](adr/0005-sequential-batch-edits.md)에 기록한다. 기존 개별 명령의 응답은 바뀌지 않으며 문서 마이그레이션은 필요 없다.

## 파일 제약

파일 입력은 엄격한 UTF-8 decoding과 [문법·크기 계약](format.md)을 따른다. 파일 경로의 symlink와 입력 파일의 hardlink를 거부하며 조회에도 같은 제한이 적용된다. stdin은 파일 identity 대신 전달된 입력 내용만 다룬다.

문서 입력·생성·편집 결과의 한도는 UTF-8 bytes 기준이다. UTF-16 길이와 다르며 HTML 출력에 문서 입력 크기 한도를 적용하지 않는다. 파일 생성·저장은 기존 내용과 경합할 수 있으므로 오류 결과를 확인해야 한다. 보장 범위와 비정상 종료 후 제약은 [저장 ADR](adr/0004-file-save-guarantees.md)을 참고한다.

## 조회부터 출력까지

저장소 루트에서 빌드 후 실행하는 예다. `sample.narudoc`과 `sample.html`이 없는 작업 위치를 사용한다. 기존 파일을 예제로 덮어쓰지 않는다. `REVISION_FROM_INSPECT`는 inspect가 반환한 실제 revision으로 바꾼다.

```sh
pnpm exec narudoc new sample.narudoc --title "Control design" --id control --json
pnpm exec narudoc inspect sample.narudoc --json
pnpm exec narudoc heading set-title sample.narudoc --id control --title "Control architecture" --revision REVISION_FROM_INSPECT --dry-run --json
pnpm exec narudoc heading set-title sample.narudoc --id control --title "Control architecture" --revision REVISION_FROM_INSPECT --json
pnpm exec narudoc validate sample.narudoc --json
pnpm exec narudoc render sample.narudoc --to html --output sample.html --json
```

Dry-run 결과를 검토한 뒤 실제 편집을 실행한다. 그 사이 원본이 바뀌었다면 기존 revision으로 강행하지 않는다. 검증 성공 후 diff를 검토하고 HTML 출력을 확인한다. Git으로 관리하는 문서라면 해당 파일의 `git diff`를 사용한다.

자동화는 `--json`으로 결과를 받되 명령별로 유효성·출력 채널·종료 코드를 처리한다. [CLI 회귀 테스트](../tests/acceptance/cli.test.mjs)는 정상 흐름과 충돌·보존 경로의 실행 예를 제공한다.

## 버전과 호환성 변경

현재 제품·패키지 버전 `0.0.3`, 문법 문서의 대상 버전, CLI JSON의 `schemaVersion: 1`은 서로 다른 의미다. 원본 파일에 별도의 문법 버전 선택 필드는 정의되어 있지 않다. `--version --json`에도 일반 응답의 schemaVersion은 없다.

현재 계약은 실험 단계이고 영구적인 하위 호환을 보장하지 않는다. 그렇더라도 문법·ID·API·응답을 변경할 때 기존 문서와 소비자의 영향을 생략하지 않는다. 마이그레이션 필요 여부를 Issue에서 검토하고 변경되는 계약·예제·검증을 같은 PR에서 갱신한다. 사용자 문서를 묵시적으로 다시 작성하지 않는다. 절차 원본은 [프로젝트 기록 규약](project-records.md)이다.

## 표 조회·생성·셀 편집

```sh
pnpm exec narudoc table insert sample.narudoc --section parameters --from examples/table-input.json --revision REVISION_FROM_INSPECT
pnpm exec narudoc table get sample.narudoc --section parameters --index 0 --json
pnpm exec narudoc table set-cell sample.narudoc --section parameters --index 0 --part body --row 0 --column 1 --text 420 --revision REVISION_FROM_TABLE_GET --dry-run --json
```

`table get`은 읽기 명령으로 stdin을 허용하며 JSON은 공통 envelope와 `node`, `source`를 반환한다. Revision은 조회 후 편집에 사용한다. `table insert --from`은 기존 strict JSON/중복 key/UTF-8/BOM/10 MiB 정책을 적용하고 `-`로 stdin 입력을 받는다. DTO는 `{ "headers": ["Name", "Value"], "rows": [["Voltage", "400"]] }`이며 추가 필드를 거부한다.

Core는 `getTable(doc, sectionId, index)`, `insertTable { sectionId, headers, rows }`, `setTableCell { sectionId, tableIndex, part, row, column, text }`을 제공한다. Batch에는 각 operation의 `type`을 포함한다. Header 편집은 `part: "header", row: 0`, body는 `part: "body"`와 0-based row/column이다. 직접 표 index만 세고 다음 heading부터 제외한다. 의미 제약/원본 보존/0.0.3 해석 변경은 [표 계약](format.md#제한된-표--003)을 따른다.

개별 쓰기는 dry-run/revision을 지원한다. 잘못된 DTO/셀 문법/part/header row는 NARU_ARGUMENT(2), 없는 section/table/cell은 NARU_TARGET(2), 결과 참조 오류는 NARU_INVALID_DOCUMENT(3)다. Revision/lock/크기 실패는 기존 코드이며 부분 저장하지 않는다. Body row가 데이터 범위 밖이면 대상 오류다. `--index`, `--row`, `--column`은 음수·소수·안전한 정수 밖 값을 인자 오류로 거부한다. 미지원 행/열 CRUD와 표 UI는 제공하지 않는다.

## 일반 inline text 편집

`text set` / Core·batch `setInlineText`는 화면 adapter와 같은 headless 연산이다. `kind`는 `heading`(index 0), `paragraph`(section ID/직접 문단 index), `directiveParagraph`(directive ID/본문 문단 index)다. `path`는 inspect의 inline 배열에서 text leaf까지의 0-based index를 점으로 연결한다(예: strong 안 text는 `1.0`). `expected`는 조회한 leaf의 전체 표시 text이고 `text`는 그 run의 새 text다. Revision은 기존 편집 공통 옵션이다. 잘못된 target/path는 대상/인자 오류, expected 불일치는 NARU_STALE이다.

Parser가 기록한 text range의 원문과 표시 text가 동일한 단일 줄 run만 편집한다. Escape/code/link 내부 및 mark 경계를 넘는 편집은 거부한다. 결과는 동일 inline 구조와 기존 validation을 통과해야 한다. 제어문자/잘못된 Unicode/구조 변경/빈 블록 결과는 저장하지 않는다. 기존 source의 최소 patch이며 BOM/EOL/무관한 mark/link 표기는 보존한다. 이 연산은 임의 source offset/raw patch 입력이 아니다. Text range 필드는 additive이고 현재 source를 다시 parse하여 사용한다.

`setInlineText`의 `expected: ""`는 path가 지정한 inline index 앞의 의미적 gap 삽입이다(배열 길이는 끝). 삭제로 사라진 run의 undo도 같은 headless 연산으로 재현한다. Gap 위치는 parser의 inline node 범위에서 얻고 임의 offset은 받지 않는다. 링크/code 내부로 내려가는 path는 거부하며 결과 inline 구조가 유지되어야 한다.

## 로컬 시각 편집 실행

`pnpm narudoc edit FILE [--no-open] [--port N]`은 checkout의 지정 파일 하나에 대한 loopback editor를 시작한다. 기본 browser를 열고 실행별 인증 URL을 출력한다. `--json`은 `{ "url": "..." }`을 출력하며 프로세스는 서버를 유지한다. 기본 port는 0(자동), 허용값은 0..65535다. stdin/raw source/path browsing은 지원하지 않는다. 기존 headless 명령은 브라우저를 실행하지 않는다. 저장·충돌·제한 및 검증은 [로컬 편집기 문서](local-editor.md)를 따른다.
