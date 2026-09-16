# 0006 · 제한된 directive 자식 블록

Date: 2026-09-16

Status: Proposed

관련 근거: [Issue #13](https://github.com/NaruForge/narudoc/issues/13), [문법](../format.md), [구조](../architecture.md), [원본 보존 ADR](0001-source-preserving-edits.md), [위치 ADR](0002-offset-encoding.md).

## Context

기존 directive의 `body: Inline[]`는 여러 문단·목록·코드를 구분하지 못한다. 코드 안 delimiter와 가짜 링크도 본문 종료 또는 참조로 오인할 수 있다. Issue #13의 구현 범위는 generic directive 본문 구조화이며 도메인 schema, 재귀 directive, 본문 전용 편집은 제외한다. 이 문서는 구현과 함께 제안하는 기술 선택이며 사용자 승인 없이 채택 상태로 바꾸지 않는다.

대안은 기존 inline 본문을 유지하고 renderer에서 재파싱하기, 임의의 `Block[]`로 재귀 구조를 열기, body와 children을 병행 저장하기다. 첫 대안은 조회·검증·렌더링의 의미를 분리한다. 두 번째는 heading·metadata·중첩 directive의 의미와 ID/section 규칙까지 넓힌다. 세 번째는 두 표현의 동기화와 편집 원본을 모호하게 만든다.

## Decision

`DirectiveBodyBlock = Paragraph | List | Code`와 `children` 하나로 의미 모델을 표현하는 방식을 제안한다. 최상위 blocks에 자식을 중복 등록하지 않는다. 빈 본문은 빈 배열로 나타내고 공백은 authoritative source에 남긴다. 원문 line table의 동일 scanner를 사용하여 substring 상대 위치를 공개하지 않는다. 코드 밖에서만 directive 종료·중첩을 판단한다.

Core 참조 순회는 자식 문단·목록을 한 번씩 방문하고 code를 제외한다. Renderer는 같은 모델을 투영한다. 기존 section 문단 index는 유지하고 속성 변경·섹션 이동은 본문 원문을 보존한다. 공개 TypeScript 모델 및 inspect/get JSON의 breaking change를 0.0.2에 명시하고 기존 source 재파싱으로 이행한다. 영구 호환 body는 제공하지 않는다.

## Consequences

파서·검증·rename·HTML이 같은 블록 의미를 사용하고 기존 최소 patch 계약을 재사용한다. 새 의존성, 파일 자동 변환, 저장 보장 확대는 없다. 기존 목록/fence 본문은 해석이 달라지며 오래된 JSON 소비자는 갱신이 필요하다. 외부 소비자 존재 여부는 미확인이다. 원본 bytes 보존은 해석의 하위 호환을 보장하지 않는다.

Heading·metadata처럼 보이는 본문은 literal paragraph로 남으며 요구사항 도메인 검증은 제공하지 않는다. 재귀 구조나 자식 전용 편집이 실제 요구되면 ID·section·편집 경계와 대안을 별도 Issue/ADR에서 재검토한다. 구현·병합은 이 제안의 채택을 뜻하지 않는다.
