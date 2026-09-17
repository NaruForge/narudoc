# 0012. 표 annotation과 snapshot 기반 의미 참조

Date: 2026-09-17

Status: Proposed

관련 작업: [Issue #36](https://github.com/NaruForge/narudoc/issues/36).

## Context

표의 stable ID, 사람이 작성한 caption, 순서에서 계산한 번호를 분리해야 한다. 기존 generic directive 이름을 예약하거나 table을 directive 자식으로 바꾸면 기존 해석과 index 계약을 불필요하게 바꾼다. 사용자는 한 줄 속성형 annotation을 선택했다.

## Decision

`@table id="tab-id" caption="Caption"`과 다음 pipe table을 단일 Table로 묶는다. 빈 줄은 최대 한 줄이고 ID는 필수다. 속성은 JSON quoted string이며 caption은 plain single-line text다. `[@tab-id]`는 의미 참조이고 일반 링크 구문이 우선한다. 상세 문법과 호환성은 [파일 계약](../format.md)이 소유한다.

Core가 한 snapshot의 정의/참조/번호/진단을 해석한다. ID가 있는 표만 문서 순서로 번호를 가진다. Renderer와 editor는 같은 context를 전달받으며 Core 역의존이나 별도 번호 계산을 만들지 않는다. 번호는 source에 저장하지 않는다. Display offset도 그 snapshot의 label을 기준으로 계산한다.

## Consequences

0.0.4는 공개 Inline union과 기존 literal 해석을 확장한다. 소비자는 원문을 재파싱하고 reference 분기를 처리한다. 파일 자동 migration과 envelope/batch schemaVersion 변경은 없다. 기존 source bytes 보존과 의미 해석 호환은 별개다. Figure 도입 시 이 resolver의 정의/번호 계열과 model context를 확장할 수 있으나 현재 미사용 registry나 Figure 타입을 추가하지 않는다. 이 제안의 구현/병합은 ADR 채택을 뜻하지 않는다.
