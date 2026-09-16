# 0007. 제한된 pipe table과 셀 원문 범위

Date: 2026-09-17

Status: Proposed

관련 작업: [Issue #25](https://github.com/NaruForge/narudoc/issues/25).

## Context

기술 문서의 파라미터를 표로 작성하고 숫자 하나만 수정해야 한다. 기존 paragraph literal 해석에는 셀 선택과 padding 보존 계약이 없다. 전체 GFM 도입은 지원 범위와 parser 교체를 넓히며, directive로 표를 표현하는 대안은 읽기 쉬운 pipe 표현과 어긋난다. Renderer에서 표를 해석하면 엔진과 출력의 의미가 분리된다.

## Decision

섹션 직접 본문의 양끝 pipe·헤더·단순 separator·동일 열 수를 갖는 제한 표를 제안한다. 상세 인식/escape 정책은 [파일 계약](../format.md)이 소유한다. 기존 inline parser를 재사용하며 표 문맥에서만 escaped pipe를 해석한다. Directive 자식 타입은 확장하지 않는다.

Parsed Table/TableRow/TableCell의 범위는 전체 source UTF-16이다. Cell의 padding 포함 range와 contentRange를 분리한다. Authoring TableInput은 headers/rows 문자열 배열만 받는다. Section ID와 직접 표 index로 조회하고 header/body 및 row/column으로 셀을 지정한다. 기존 snapshot/revision, 최소 patch, 참조 순회, 순차 batch, 파일 저장 경계를 재사용한다. 새 표만 직렬화하며 기존 표를 재정렬하지 않는다.

## Consequences

0.0.3의 Block union과 inspect JSON에 table이 추가된다. 기존 표 모양 paragraph가 의미 표로 바뀌므로 문단 index가 달라질 수 있다. 문단 index 계산 규칙은 여전히 직접 paragraph만 센다. 소비자는 table 분기를 추가하고 authoritative source를 재파싱해야 한다. 파일 자동 migration이나 모델 JSON의 영구 저장 호환성은 제공하지 않는다.

행/열 구조 편집, 정렬, caption, directive 내부 표와 전체 Markdown 호환은 제외한다. 장래 client가 범위를 잘못 해석하지 않도록 byte 비교·Unicode·참조·보안 테스트를 유지한다. 구현/병합 승인은 ADR 채택을 뜻하지 않는다.
