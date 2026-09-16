# CLI 사용과 자동화 계약 · v0.0.1

이 문서는 현재 CLI의 명령과 입출력 계약을 설명한다. 장기 목표는 [제품 비전](product.md), 문법·편집 의미·크기 제한은 [파일 계약](format.md), 저장 보장은 [아키텍처](architecture.md)를 따른다. API와 문법은 실험 단계다.

저장소에서 의존성을 설치하고 빌드한 뒤 `pnpm exec narudoc`으로 실행한다. npm registry 설치는 제공하지 않는다. 명령은 사용자 입력을 묻지 않으며, stdin을 사용하는 경우에는 입력 스트림의 끝까지 기다린다.

## 명령과 옵션

아래 표의 모든 일반 명령은 `--json`을 받을 수 있다. `FILE`은 하나만 지정하며 `--stdin`과 동시에 지정할 수 없다. 알 수 없는 명령·옵션, 반복 옵션과 명령에 맞지 않는 옵션은 인자 오류다.

| 명령 | 명령별 옵션 | 의미 |
| --- | --- | --- |
| `inspect FILE` | `--stdin` | 모델·길이·진단을 항상 JSON으로 출력 |
| `outline FILE` | `--stdin` | 제목과 섹션 구조 조회 |
| `get FILE --id ID` | `--stdin` | ID 대상 조회; heading이면 해당 섹션의 원문 반환 |
| `validate FILE` | `--stdin` | 문서 진단과 유효성 판단 |
| `render FILE --to html` | `--stdin`, `--output FILE` | 유효한 문서를 HTML로 출력 |
| `new FILE` | `--title TITLE`, `--id ID` | 새 문서 생성; 생략 시 제목 `Untitled`, ID `document` |
| `heading set-title FILE --id ID --title TITLE` | 편집 공통 옵션 | 제목 변경 |
| `section insert FILE --after ID --id NEW_ID --title TITLE` | 편집 공통 옵션 | 지정 섹션 뒤에 동급 섹션 삽입 |
| `section remove FILE --id ID` | 편집 공통 옵션 | 섹션과 하위 내용 삭제 |
| `section move FILE --id ID --after ID` | 편집 공통 옵션 | 같은 부모·같은 level의 섹션 이동 |
| `paragraph replace FILE --id SECTION --index 0 --text TEXT` | 편집 공통 옵션 | 지정 섹션의 직접 자식 문단 교체; index는 0부터 시작 |
| `directive set FILE --id ID --key KEY --value VALUE` | 편집 공통 옵션 | 속성 추가·변경; ID 변경 제외 |
| `id rename FILE --id OLD --new-id NEW` | 편집 공통 옵션 | ID 정의와 같은 문서 내부 참조를 함께 변경 |
| `batch FILE --operations PLAN --revision SHA256` | `--dry-run` | 단일 문서의 의미 편집 목록을 순차 검증 후 한 번 저장 |

편집 공통 옵션은 `--dry-run`, `--revision SHA256`이다. 기존 문서 편집 7종과 `batch`에서 지원하며 읽기 명령과 `new`에서는 지원하지 않는다. 개별 편집의 `--revision`은 선택 옵션이지만 조회 후 변경하는 자동화에서는 사용한다. `batch`에서는 필수다.

읽기 명령은 `FILE` 대신 `-` 또는 `--stdin`을 사용할 수 있다. 기존 문서 편집과 `new`는 실제 파일 경로가 필요하다. `--to`는 `html`만 지원한다. `new`와 `render --output`은 기존 파일을 덮어쓰지 않는다.

`--help` 또는 인자 없는 실행은 도움말 텍스트를 stdout에 출력한다. `--help --json`도 텍스트다. `--version`은 버전 텍스트, `--version --json`은 `{"version":"0.0.1"}`을 출력한다. 이 특수 응답들은 일반 문서 envelope를 사용하지 않는다.

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

파서 생성 모델의 heading에는 `idRange`(ID 문자만, `{#`·`}` 제외), inline link에는 `urlRange`(목적 URL만, 괄호 제외)가 추가된다. `inspect`와 `get` JSON에도 나타날 수 있는 선택적 필드이며 기존 필드는 유지한다. 범위는 전체 문서 원문 기준 UTF-16이다. 기존에 저장한 모델을 편집 입력으로 재사용하지 말고 현재 원문을 다시 파싱한다. `parseInline` 단독 호출은 기본적으로 위치 필드를 추가하지 않으며 세 번째 인자 `sourceOffset`을 제공하면 해당 원문 위치를 기준으로 `urlRange`를 계산한다.

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

`id rename FILE --id OLD --new-id NEW`는 heading 또는 directive의 ID와 파서가 인식한 같은 문서 내부 링크를 하나의 operation으로 변경한다. 제목/문단/목록/directive 본문 및 강조 안의 링크가 포함된다. 비교는 기존 검증과 같은 `decodeURIComponent` 규칙이다. 예를 들어 `#REQ%2D001`도 `REQ-001`을 가리키므로 변경 대상이다. 변경된 목적지는 `#NEW`로 기록하며 링크 라벨은 유지한다.

```sh
pnpm exec narudoc id rename examples/engineering.narudoc --id REQ-001 --new-id REQ-CTRL-001 --dry-run --json
```

실제 저장은 조회한 `--revision`과 함께 실행한다. 같은 ID 지정은 no-op으로 인코딩 표현까지 유지한다. 잘못된 새 ID나 다른 대상과의 ID 충돌은 `NARU_ARGUMENT`(2), 없는 대상은 `NARU_TARGET`(2), 처음부터 유효하지 않은 문서는 `NARU_INVALID_DOCUMENT`(3)로 실패한다. 원문은 저장하지 않는다. 수동으로 만든 모델에 필요한 위치가 없거나 불일치하면 Core는 `NARU_PATCH`로 거부하므로 현재 parser로 다시 파싱한다.

코드 블록/inline code/escape로 인해 링크로 인식되지 않는 텍스트, 링크 라벨, metadata·directive의 일반 속성 값, 외부 URL과 `other.narudoc#OLD`는 바꾸지 않는다. 다른 문서에서 들어오는 참조도 갱신하지 않는다. 문법 전체를 정규식으로 검색·치환하지 않고 현재 지원 문법의 의미 링크만 처리한다. 일반 `directive set --key id`는 계속 거부한다.

배치에는 `{ "type": "renameId", "id": "REQ-001", "newId": "REQ-CTRL-001" }`을 넣는다. ID와 참조가 같은 단계에서 바뀌므로 중간 참조 오류 없이 다음 단계에서 새 ID를 사용할 수 있다. 앞선 단계의 원문 범위가 바뀌어도 새 snapshot에서 위치를 계산한다.

## 단일 문서 배치 편집

`batch FILE --operations PLAN --revision SHA256`은 한 파일에 기존 7종 편집을 목록 순서대로 적용한다. `PLAN`은 JSON 파일 경로이며 `--operations -`이면 stdin에서 계획을 읽는다. 대상 문서 `FILE`은 실제 파일이어야 한다. `--stdin`은 받지 않는다. 계획 파일에는 문서 파일과 같은 symlink/hardlink 제한을 적용한다.

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

계획의 각 작업은 아래 필드를 정확히 가진다. `type`과 `index`를 제외한 값은 모두 올바른 Unicode 문자열이다. `index`는 0 이상의 안전한 정수다. 의미 제약은 해당 개별 편집과 같다.

| type | type 외 필수 필드 |
| --- | --- |
| `setHeadingTitle` | `id`, `title` |
| `insertSection` | `after`, `id`, `title` |
| `removeSection` | `id` |
| `moveSection` | `id`, `after` |
| `replaceParagraph` | `id`, `index`, `text` |
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

현재 제품·패키지 버전 `0.0.1`, 문법 문서의 대상 버전, CLI JSON의 `schemaVersion: 1`은 서로 다른 의미다. 원본 파일에 별도의 문법 버전 선택 필드는 정의되어 있지 않다. `--version --json`에도 일반 응답의 schemaVersion은 없다.

현재 계약은 실험 단계이고 영구적인 하위 호환을 보장하지 않는다. 그렇더라도 문법·ID·API·응답을 변경할 때 기존 문서와 소비자의 영향을 생략하지 않는다. 마이그레이션 필요 여부를 Issue에서 검토하고 변경되는 계약·예제·검증을 같은 PR에서 갱신한다. 사용자 문서를 묵시적으로 다시 작성하지 않는다. 절차 원본은 [프로젝트 기록 규약](project-records.md)이다.
