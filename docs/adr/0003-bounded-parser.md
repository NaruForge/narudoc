# 0003. 제한 문법용 scanner 유지

- 기록일: 2026-09-16
- Status: Proposed
- 과거 구현: 2026-09-16, [PR #4](https://github.com/NaruForge/narudoc/pull/4), 구현 commit `5c2f3a84c05a6b778c5b462f0945abb31cac1f21`
- 채택일: 없음 — 현재 유지 제안이며 과거 ADR 승인을 뜻하지 않는다.
- 검토 작업: [Issue #5](https://github.com/NaruForge/narudoc/issues/5)

## Context

v0.0.1은 [파일 계약](../format.md)의 제한된 문법을 처리하는 TypeScript scanner를 사용한다. 초기 논의에는 micromark 활용 제안이 있었으나 최종 구현은 달랐고, PR #4에 그 차이와 지원 범위가 명시되어 있다. 여기서는 확인되지 않은 당시 선택 이유를 만들어내지 않고 현재 방식을 유지할지 평가한다.

제품이 요구하는 것은 특정 parser가 아니라 읽을 수 있는 원본, 의미 편집, 원본 보존이다. 현재 scanner가 완전한 CommonMark/YAML parser 또는 lossless CST라는 뜻은 아니다.

| 대안 | 현재 평가 |
| --- | --- |
| 현재 제한 문법 scanner | 구현 범위와 범위 정보가 명확하고 기존 fidelity 검증을 사용할 수 있다. 문법·성능·오류 복구를 직접 유지해야 한다. |
| 기존 Markdown parser와 모델 변환 | 범용 Markdown 연동이 필요할 때 비교할 후보다. 원본 위치·확장 문법·보존 계약과의 적합성은 실제 예제로 검증해야 한다. |
| 별도 lossless·증분 parser | 복잡한 구문과 지속적인 편집을 위한 후보지만 현재 필요성·개발 비용·효과가 입증된 선택은 아니다. |

## Decision

현재 지원 문법에 한정해 scanner를 유지할 것을 제안한다. 지원하지 않는 Markdown의 의미를 임의로 추정하지 않고 [파일 계약](../format.md)의 literal 처리와 진단 규칙을 따른다. Generic directive 보존을 모든 도메인 객체의 의미 지원으로 확대 해석하지 않는다.

새 문법은 별도 승인 범위와 예제·실패 경로·원본 보존 검증을 갖춰 추가한다. 직접 구현 범위를 자동으로 CommonMark 전체로 확대하지 않는다. parser를 교체하더라도 공개 snapshot·위치 계약과 지원 문법의 결과를 검증한다.

## Consequences

현재 MVP의 좁은 문법과 source range 동작을 설명하고 검증하기 쉽다. 대신 표준 Markdown 도구와의 호환성이 제한되며, 확장이 누적될수록 자체 유지 비용이 커질 수 있다. 비정상 입력의 성능도 별도 회귀 검증 대상이다.

범용 Markdown 연동, 중첩 구조, 편집 중 오류 복구, 큰 문서의 성능 요구가 실제 작업으로 등장하면 기존 parser 활용과 현재 방식의 비용을 비교한다. 원본 보존·지원 문법·오류 진단을 같은 예제로 확인한 뒤 교체 여부를 판단한다. 특정 후보가 더 빠르거나 더 잘 보존한다고 사전 단정하지 않는다.

## 근거와 검증 경로

- [현재 아키텍처](../architecture.md), [parser](../../packages/parser/src/index.ts), [inline 처리](../../packages/parser/src/inline.ts)
- [Parser 회귀](../../tests/acceptance/parser.test.mjs): inline 링크 해석·비정상 입력
- [Core fidelity 회귀](../../tests/acceptance/core.test.mjs), [모듈 경계 회귀](../../tests/acceptance/boundaries.test.mjs)
- [PR #4의 보완 commit](https://github.com/NaruForge/narudoc/commit/07a94fb33167026a580a52416666eeeeeaf04ecc): 비정상 링크 처리와 크기 제한 보완

이 ADR은 새 문법이나 parser 교체를 승인하지 않는다. 실제 검증 결과는 변경 PR에 기록한다.
