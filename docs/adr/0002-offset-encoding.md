# 0002. UTF-16 공개 범위와 UTF-8 파일 경계 유지

- 기록일: 2026-09-16
- Status: Proposed
- 과거 구현: 2026-09-16, [PR #4](https://github.com/NaruForge/narudoc/pull/4), 구현 commit `5c2f3a84c05a6b778c5b462f0945abb31cac1f21`
- 채택일: 없음 — 현재 유지 제안이며 과거 ADR 승인을 뜻하지 않는다.
- 검토 작업: [Issue #5](https://github.com/NaruForge/narudoc/issues/5)

## Context

현재 모델의 Range와 CLI edit offset은 UTF-16 code unit 기준의 반열린 구간 `[start, end)`이다. 파일은 UTF-8로 읽고 쓴다. 두 단위를 혼동하면 한글·보조 평면 문자·BOM이 있는 문서를 잘못 수정할 수 있다. 이 계약은 [MVP Issue #2](https://github.com/NaruForge/narudoc/issues/2)에 명시되어 있다.

| 대안 | 현재 평가 |
| --- | --- |
| UTF-8 byte offset | 파일 bytes와 직접 대응하지만 현재 문자열 operation에 별도 변환이 필요하다. |
| Unicode code point 또는 사용자에게 보이는 문자 단위 | 일부 소비자에게 자연스럽지만 현재 문자열 인덱스·파일 byte와 모두 다르며 별도 경계 규칙이 필요하다. |
| UTF-16 code unit | 현재 모델·CLI·문자열 연산과 일치한다. 다른 언어의 소비자가 명시적으로 변환해야 한다. |

위 비교는 현재의 계약 유지 평가다. 초기 논의의 다른 후보를 채택된 계약으로 취급하지 않는다.

## Decision

공개 범위는 UTF-16 code unit의 `[start, end)`로 유지할 것을 제안한다. offset은 원본 문자열 기준이며 BOM과 개행도 그 문자열의 일부다. UTF-8 byte 수, 화면의 문자 수, 줄·열 번호로 해석하지 않는다. 예를 들어 `A😀B`에서 이모지는 UTF-16 범위 `[1, 3)`이다.

JSON edit를 소비하는 프로그램은 해당 원본 revision을 확인하고 같은 단위로 범위를 해석해야 한다. UTF-16이 기본 문자열 인덱스가 아닌 환경에서는 변환을 수행하거나 의미 편집 명령을 사용한다. surrogate pair를 나누는 patch와 유효하지 않은 Unicode 결과는 거부한다.

파일 입력의 UTF-8 decoding과 원본 bytes의 revision 검사는 CLI 파일 경계에서 수행한다. 크기 제한은 UTF-8 bytes 기준이며 `sourceLength`나 edit offset으로 계산하지 않는다. 구체적인 필드는 [CLI 계약](../cli.md)을 따른다.

## Consequences

현재 원본 위치·patch·문자열 연산의 단위를 유지하고 불필요한 변환을 줄일 수 있다. 대신 소비자는 표시용 문자 위치와 저장용 위치를 구별해야 한다. UTF-16 범위만으로 모든 사용자 인식 문자 경계를 보장하는 것은 아니다.

다른 언어의 SDK나 새로운 편집기에서 위치 변환 부담이 실제 문제로 확인되면 재검토한다. 단위 변경은 공개 모델과 CLI 소비자에 영향을 주므로 조용히 바꾸지 않고 계약·호환성·필요한 마이그레이션을 검토한다.

## 근거와 검증 경로

- [파일 계약](../format.md), [모델 Range·boundary](../../packages/model/src/index.ts)
- [patch 경계 검사](../../packages/core/src/patch.ts), [CLI UTF-8 decoding·revision](../../apps/cli/src/io.ts)
- [Core 회귀](../../tests/acceptance/core.test.mjs): 한글·보조 평면 문자·surrogate 분할 거부
- [CLI 회귀](../../tests/acceptance/cli.test.mjs): BOM·CRLF 보존, UTF-8 크기 경계

테스트의 실행 여부와 결과는 해당 revision의 PR에서 확인한다.
