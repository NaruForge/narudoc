# 원본 보존형 시각 편집 spike

설치와 `pnpm build` 후 `pnpm spike`를 실행하고 `http://127.0.0.1:4173`을 연다. 공개 가상 [fixture](../examples/visual-fidelity.narudoc)를 메모리에 읽는다. 파일을 저장하는 서버는 없으며 정적 harness asset만 제공한다. 테스트는 `pnpm test:browser`이고 Chromium 최초 설치는 `pnpm exec playwright install chromium`이다.

이 문서는 기존 per-block spike harness의 검증 범위를 기록한다. 실제 파일을 여는 현재 단일 문서 편집기는 [로컬 편집기 안내](local-editor.md)의 document projection과 Core 문단 범위 연산을 사용한다. 따라서 아래 spike의 “지원하지 않음” 표시는 spike harness의 범위이며 현재 파일 편집기 계약을 거꾸로 제한하지 않는다.

## 경계와 지원 범위

SourceSession의 source/engine snapshot이 원본이다. PM 문서, DOM과 selection은 projection이다. 각 편집 가능한 제목/문단에는 해당 generation의 target/path/PM offset sidecar가 있다. Adapter는 NaruDoc 문법을 스캔하지 않고 parser의 text range를 사용한다. 실제 text transaction으로 Core operation을 계획하고 재파싱 결과의 projection과 draft까지 대조한다. Source 전체를 editor에서 export하는 경로가 없다.

| 동작 | 결과 |
| --- | --- |
| ID 있는 제목, section/directive 문단의 일반 text | 한 inline run 안의 typing/delete/replace/plain paste |
| Strong/emphasis 안 일반 text | 기존 marker를 유지하며 같은 run 안에서 수정 |
| Link/code/escape가 포함된 text run, 여러 줄 text run | 표시·보존, 직접 편집 금지 |
| List/code/table와 ID 없는 heading | 읽기 전용 안전한 HTML projection |
| Mark 경계 넘기, block split/merge, multiline paste, drag/drop | 명시적 거부 |
| Focus/selection | source no-op |
| Invalid draft | 화면 입력과 마지막 valid source 유지, 진단 표시 |
| IME composition | draft만 갱신, compositionend 이후 Core 확정 |
| Undo/redo | 각 블록의 PM history transaction을 동일 Core 경로로 적용 |
| Stale snapshot/mapping | 충돌 진단, 현재 source와 pending draft 유지 |

링크를 클릭해 문서 밖으로 이동하지 않는다. 링크/code의 텍스트를 atom으로 표시하고 HTML 문자열은 기존 escaping/safe URL renderer에서만 만든다. App CSP는 자체 script만 허용하고 document code/raw HTML을 실행하지 않는다. 정적 HTML export CSP는 바꾸지 않았다.

## 실행 근거

2026-09-17 Windows, Node 24.18.0, pnpm 10.17.1, Playwright 1.63.0 Chromium으로 실행했다. 별도 playwright-cli 탐색 세션의 UA는 HeadlessChrome/152.0.0.0이었다.

- Headless 신규 테스트: BOM/LF/CRLF/CR/no-op/heading spacing/strong/directive/Unicode, 최소 patch, 입력·참조·stale 거부, API/batch/CLI parity.
- 자동 실제 브라우저 테스트: load/focus/selection no-op, 400 → 420 독립 기대 source 및 API parity, delete/paste, synthetic Korean composition·😀, undo/redo의 원문 복구, invalid draft, protected blocks, script 미실행, BOM/EOL/EOF, stale composition.
- 별도 도구 탐색: 제목에 ` design`, directive 문단에 ` Verified.`를 키보드로 추가하고 source/valid 상태 확인. Screenshot과 source 비교는 각각 다른 증거다.
- [숫자 변경 화면](evidence/26-adapter.png), [탐색 편집 화면](evidence/26-exploratory.png).
- **실제 OS 한글 IME 수동 검증 미실행.** 이 실행 환경에서 native OS 입력 제어를 제공하지 않는다. Synthetic composition/Unicode 문자열 입력 성공을 OS IME 성공으로 주장하지 않는다. Firefox/WebKit/mobile 검증도 미실행.

최종 head의 전체 회귀·CI와 독립 reviewer 결과는 관련 PR에 기록한다. Screenshot은 fidelity의 대체물이 아니다.

## #27 재사용 판단

검증된 단일 run 편집·projection·draft/valid 분리·Core operation replay 경로를 첫 로컬 client에 재사용할 수 있다. 모든 mark/escape/multiline/block 편집을 제공한다고 확대하지 않는다. #27은 파일 revision/save boundary와 구조 생성 UI를 이 adapter 밖에서 구현하고 server가 operations를 다시 검증한다. PM JSON이 source를 소유하도록 바꿀 필요가 없다. 실제 OS IME와 더 넓은 편집 범위는 남은 검증 위험이다. [Proposed ADR 0008](adr/0008-source-owned-editor-adapter.md)을 참고한다.

삭제된 ordinary text run의 undo를 위해 `expected: ""`는 path index 바로 앞의 의미적 inline gap을 뜻한다(배열 length는 끝). Parser가 기록한 inline node range로 gap을 찾으며 raw offset을 받지 않는다. 삽입 결과는 동일 mark/link/code 구조와 전체 validation을 통과해야 한다. Adapter는 빈 gap도 sidecar로 매핑하고 history의 복구 삽입을 같은 연산으로 처리한다. 외부 snapshot replace는 별도 epoch를 바꾸므로 내용이 같은 블록도 명시적 projection 재생성 전까지 stale이다.

## #31 세션 정비

SourceSession은 DOM/PM import가 없는 공개 `@naruforge/narudoc-editor-adapter/session`으로 분리했다. Core의 공통 target 열거를 mount에 사용하고 구조 epoch가 달라지면 동일 내용의 문단도 오래된 view로 편집할 수 없다. 연속 typing journal은 정확한 source 재계획을 통과할 때만 축약한다. PM undo 기록은 별도로 유지한다.

두 문단의 실제 PM selection/transaction/history 비교 proof는 `tests/proofs/session-topology.mjs`이며 `node --test tests/acceptance/session-topology.test.mjs`로 실행한다. 복합 gesture 실패·빈 draft·cross-paragraph selection을 확인했지만 제품 UI의 cross-block 편집을 출시한 것은 아니다. 다음 확장 방향과 비용 측정은 [Proposed ADR 0011](adr/0011-targets-and-source-session.md)을 따른다.
