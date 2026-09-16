# 0008. Source 소유형 ProseMirror 어댑터

Date: 2026-09-17

Status: Proposed

관련 작업: [Issue #26](https://github.com/NaruForge/narudoc/issues/26).

## Context

Editor JSON을 원본으로 삼으면 import/export 과정에서 무관한 공백과 문법 표현을 잃는다. 화면 입력을 실제 transaction으로 처리하되 `.narudoc source + engine snapshot`을 유지할 필요가 있다. 비교 후보는 native contenteditable 직접 구현, Tiptap, ProseMirror 직접 사용이다. 첫 후보는 selection/IME/history를 직접 관리해야 하고 Tiptap의 extension 계층은 이번 제한 projection에 필요하지 않다.

2026-09-17 확인한 공식 [transaction/state guide](https://github.com/ProseMirror/website/blob/master/markdown/guide/state.md), [view guide](https://github.com/ProseMirror/website/blob/master/markdown/guide/view.md), [history](https://github.com/ProseMirror/prosemirror-history), [Tiptap events](https://tiptap.dev/docs/editor/api/events)를 근거로 실제 transaction을 가로채는 직접 ProseMirror adapter를 제안한다. 공식 사이트 guide는 조회 403으로 공식 GitHub 원본을 읽었다. 설치 버전: model 1.25.11, state 1.4.4, view 1.42.3, history 1.5.0. Tiptap core 후보 조회 버전은 3.31.3이며 설치하지 않았다.

## Decision

Engine에 화면 의존성을 추가하지 않는다. Parser는 일반 text의 절대 UTF-16 range를 추가하고, Core `setInlineText`는 ID/문단 index/inline path/expected text로 의미 대상을 확인한다. 범위가 원문과 화면 텍스트에 동일하게 대응하는 run만 편집한다. 결과를 재파싱해 inline 구조가 바뀌지 않았는지 확인하고 기존 validation과 patch를 재사용한다. CLI/batch도 같은 연산을 제공한다.

`packages/editor-adapter`는 각 제목/문단을 제한된 하나의 ProseMirror textblock으로 투영한다. Sidecar가 해당 source generation, 의미 target/path, PM text 위치를 연결한다. Offset은 모두 UTF-16이며 byte 단위가 아니다. Marks는 표시하고 링크/code/escape/multiline run은 보호 atom으로 표시한다. 표/list/code는 안전한 기존 renderer를 이용하는 읽기 전용 블록이다.

Transaction에서 이전 유효 projection과 draft의 변경 범위를 구하고 한 ordinary text run 안에서만 Core operation을 만든다. 문서를 HTML/JSON에서 다시 직렬화하지 않는다. Composition 도중에는 draft만 바꾸고 확정 후 검증한다. 실패하면 draft와 마지막 유효 source를 함께 유지한다. ProseMirror history의 undo/redo transaction도 같은 Core 경로를 거친다. 외부 source 교체/다른 편집으로 stale generation이 되면 pending draft를 적용하지 않는다.

## Consequences

Editor를 제거해도 source와 headless operation이 독립적으로 남는다. UUID/DOM/PM state를 저장 형식으로 승격할 필요가 없다. 현재 위치 정보는 additive 공개 모델 변경이며 구 snapshot은 source 재파싱이 필요하다. 원문에 escape가 있는 run은 아직 안전한 문자별 역매핑을 제공하지 않아 읽기 전용이다. Mark 경계, block split/merge, 빈 문단으로의 삭제는 지원하지 않는다.

History는 블록별 메모리 세션이며 영속/global 구조 편집 undo가 아니다. 실제 OS IME는 synthetic 이벤트와 다르므로 미확인 환경을 별도로 기록한다. 검증 결과와 #27 재사용 범위는 [spike 결과](../visual-editor-spike.md)를 따른다. 이 PR 병합은 ADR Accepted 전환이 아니다.

Whole-run 삭제 후 history 복원을 위해 inline 사이의 gap도 semantic path로 표현한다. `expected: ""`를 쓰며 node range는 parser가 소유하고 결과 구조를 Core가 확인한다. 별도 raw undo patch나 editor JSON 저장은 사용하지 않는다. 외부 source 교체는 epoch로 모든 기존 mapping을 무효화한다.
