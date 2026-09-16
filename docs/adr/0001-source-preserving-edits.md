# 0001. 원본 문자열·의미 모델·범위 패치 방식 유지

- 기록일: 2026-09-16
- Status: Proposed
- 과거 구현: 2026-09-16, [PR #4](https://github.com/NaruForge/narudoc/pull/4), 구현 commit `5c2f3a84c05a6b778c5b462f0945abb31cac1f21`
- 채택일: 없음 — 현재 유지 제안이며 과거 ADR 승인을 뜻하지 않는다.
- 검토 작업: [Issue #5](https://github.com/NaruForge/narudoc/issues/5)

## Context

[제품 비전](../product.md)은 읽을 수 있는 원본, 작은 의미 변경의 국소 diff, 편집기와 독립된 엔진을 요구한다. 이 원칙은 이 ADR의 승인 여부와 별개인 제품 제약이다.

현재 구현은 원본 문자열과 위치를 가진 의미 모델을 함께 유지하고, 의미 편집으로 `TextEdit[]`를 만든 뒤 재파싱·검증한다. 일반 저장에서 전체 문서를 재직렬화하지 않는다. 이는 [MVP Issue #2](https://github.com/NaruForge/narudoc/issues/2)와 PR #4로 확인한 구현 사실이다. 아래 비교는 현재 유지 여부에 대한 평가이며 기록되지 않은 과거 판단을 복원한 것이 아니다.

| 대안 | 현재 평가 |
| --- | --- |
| 의미 모델 전체를 다시 직렬화 | 출력 형태를 통일하기 쉽지만 변경하지 않은 표현까지 바뀔 수 있어 제품의 원본 보존 기준과 맞지 않는다. |
| 원본 문자열 + 의미 모델 + 범위 패치 | 기존 구현과 회귀 검증을 활용하고 무관한 원문을 유지할 수 있다. 위치·경계·snapshot 검증의 책임이 따른다. |
| 완전한 lossless CST와 증분 편집 | 더 풍부한 구문 보존·편집의 대안이지만 현재 MVP가 제공하는 계약은 아니다. 필요성과 비용을 별도 검증해야 한다. |

## Decision

원본 문자열을 저장의 기준으로 유지하고, 의미 편집은 해당 snapshot에 대한 범위 패치로 표현하는 현재 방식을 유지할 것을 제안한다. 편집 계획은 다른 원본에 재사용하지 않고 expected text·범위·Unicode 경계를 검사한다. 적용 결과를 재파싱하고 공통 검증을 거친다.

CLI와 향후 시각적 편집기는 공통 의미 편집을 사용한다. 편집기 내부 모델을 저장 원본으로 승격하지 않는다. 위치 단위는 [0002](0002-offset-encoding.md), 실제 파일 저장은 [0004](0004-file-save-guarantees.md)의 별도 검토 대상이다. 완전한 CST나 증분 parser를 구현했다고 표현하지 않는다.

## Consequences

변경 없는 저장, 국소 수정, 섹션 내부 원문 보존을 일관된 기준으로 검증할 수 있다. 편집기 교체가 곧 원본 형식 변경이 되지 않도록 경계를 유지할 수 있다.

각 operation은 올바른 범위와 삽입 경계를 계산해야 한다. 구조 변경에는 필요한 구분 개행이 추가될 수 있고, 모든 사용자 의도를 단순 문자열 교체로 처리할 수 있는 것은 아니다. 재파싱 비용도 남는다. 현재 섹션 이동 등의 제약은 [파일 계약](../format.md)을 따른다.

새 문법이나 시각적 편집에서 원본 보존을 유지하기 어려워지거나 전체 재파싱 비용이 실제 제약으로 확인되면 CST·증분 방식과 비교해 재검토한다. 어떤 방식으로 바뀌어도 no-op bytes, 무관한 원문, 잘못된 patch와 stale snapshot의 거부를 확인해야 한다.

## 근거와 검증 경로

- [현재 아키텍처](../architecture.md), [모델 계약](../../packages/model/src/index.ts)
- [의미 편집](../../packages/core/src/operations.ts), [patch 적용](../../packages/core/src/patch.ts)
- [Core 회귀](../../tests/acceptance/core.test.mjs): fidelity, 이동, 최소 변경, 잘못된 범위와 stale plan
- [CLI 회귀](../../tests/acceptance/cli.test.mjs): 실제 저장의 bytes·mtime·Git diff 보존

테스트 링크는 검증할 경로다. 특정 revision의 실행 결과는 해당 작업의 PR에 기록한다.
