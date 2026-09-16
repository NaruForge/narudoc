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

편집 공통 옵션은 `--dry-run`, `--revision SHA256`이다. 둘 다 기존 문서 편집 6종에서만 지원하며 읽기 명령과 `new`에서는 지원하지 않는다. `--revision`은 선택 옵션이지만 조회 후 변경하는 자동화에서는 사용한다.

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
| 기존 문서 편집 `--json` | `dryRun`, `changed`: boolean, `nextRevision`: 결과 SHA-256, `edits`: TextEdit 배열, `diagnostics`: 편집 결과 진단 |

`new --json`은 `schemaVersion`, `file`, `revision`만 반환하며 `offsetEncoding`은 없다. 도움말·버전과 실행 예외도 별도의 형태다. 모든 JSON이 같은 envelope라고 가정하지 않는다.

Range는 `{ start, end }`이고 UTF-16 code unit 기준 `[start, end)`이다. 파일 byte offset이나 줄·열 번호가 아니다. 원본의 BOM과 개행도 위치 계산에 포함한다. `TextEdit`는 `{ start, end, expected, text }`이며 `expected`는 교체 전 문자열, `text`는 교체할 문자열이다. 반환된 edit 배열은 해당 원본 snapshot에만 해당하고 다른 revision에 재사용하지 않는다. CLI는 이 배열을 입력받아 적용하는 명령을 제공하지 않는다.

진단은 `{ code, message, severity, range }`이며 `severity`는 `error` 또는 `warning`이다. 사람이 읽는 메시지보다 코드·severity·종료 코드를 기준으로 분기한다. Block·inline의 현재 필드와 타입은 [공통 모델](../packages/model/src/index.ts), outline 결과는 [조회 구현](../packages/core/src/query.ts)과 대응한다. 임의의 JSON을 안정된 독립 파일 포맷으로 저장하는 계약은 아니다.

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

실행 예외의 JSON 형태는 다음과 같다. 아래는 잘못된 ID로 실행했을 때의 형태 예시이며 message는 고정된 파싱 계약으로 사용하지 않는다.

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

기존 문서 편집 응답의 `revision`은 편집 전 원본이다. `nextRevision`은 dry-run에서는 예상 결과, 실제 저장 성공 시에는 그 편집 결과의 revision이다. 다른 writer가 그 뒤에 파일을 바꾸지 않는다는 보장은 아니다. No-op이면 `changed: false`, `edits: []`이고 두 revision이 같다.

`--revision`은 조회했던 원본과 현재 읽은 원본이 다르면 편집을 거부한다. 실제 저장도 별도 원본 검사를 수행하지만 완전한 파일 시스템 CAS를 보장하지 않는다. 충돌 시 다시 조회하고 변경 의도를 재검토한 뒤 새 revision으로 작업한다. 기존 lock을 자동 삭제해서 재시도하지 않는다.

Dry-run은 문서를 읽고 지정한 revision·대상·편집 결과의 유효성과 크기 등을 검사한다. 원본을 쓰지 않고 저장 잠금을 얻지 않으며 저장 직전 재검사나 실제 쓰기 가능 여부도 확인하지 않는다. 따라서 기존 lock이 있어도 dry-run은 성공하고 실제 변경은 잠금 충돌로 실패할 수 있다. 예상 `nextRevision`은 저장 성공을 예약하거나 동시 변경을 막는 토큰이 아니다.

텍스트 preview의 `@@ UTF-16 start:end @@`와 JSON 문자열로 표시한 `-`/`+`는 사람이 검토할 표시다. `git apply`에 넣는 unified patch가 아니다. 실제 편집은 검토한 의미 명령을 원본 revision과 함께 다시 실행한다.

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
