# 0011. Snapshot 대상과 순수 편집 세션

- 기록일: 2026-09-17
- Status: Proposed
- 관련 작업: [Issue #31](https://github.com/NaruForge/narudoc/issues/31)
- 채택일: 없음. 구현과 ADR 채택은 별개다.
- 구현 참고: Issue #35가 단일 문서 projection·문단 범위 연산·Save 후 document undo를 구현했지만, 이 ADR의 Status를 자동으로 바꾸지는 않는다.

## Context

Core의 paragraph/table 조회와 adapter mount가 직접 본문과 index를 따로 계산했다. 같은 내용의 문단을 삽입한 뒤 오래된 view가 기존 index로 편집하면 expected text 비교만으로 오대상을 구분하지 못한다. SourceSession은 PM/DOM 모듈에 함께 있고 입력마다 operation을 저장하여 같은 text run의 typing도 저장 시 모두 replay했다.

## Decision

Core query의 `directSectionBody`, `textTarget`, `textTargets`를 공통 대상으로 사용한다. ID는 영속 식별자이며 paragraph/table index와 inline path는 **현재 단계 snapshot** 상대 위치다. CLI get의 additive `targets`와 table get의 `target`은 이 scope를 함께 반환한다. Batch는 매 단계 다음 snapshot을 대상으로 한다. A/B 앞에 X를 넣으면 다음 단계 index 1은 A, 2는 B다. 이는 외부 파일 SHA-256 revision과 다른 문제이며 index를 stable handle로 바꾸었다고 주장하지 않는다.

`editor-adapter/session`은 DOM·PM 없이 source, 유효 snapshot, operation journal, draft 등록, selection, generation/구조 epoch, 저장 기준 source/revision을 조정한다. PM adapter는 projection과 composition 입력을 소유한다. Selection offset은 표시 inline text의 UTF-16 위치이며 source/PM 좌표와 혼용하지 않는다. 구조 변경 시 기존 selection/view를 보수적으로 무효화한다. 같은 텍스트의 삽입도 epoch 검사를 통과할 수 없다.

Operation은 한 의미 변경, gesture는 한 사용자 의도에 속한 operation들의 원자적 준비·공개 단위다. Batch는 순차 의미 transaction이고 file commit은 별도의 revision/lock 경계다. Gesture는 모든 단계 성공 후 source/log/history/listener를 한 번 갱신한다. 실패하면 이전 source와 draft를 보존한다. 빈 paragraph·IME 중간 상태는 projection draft로 남고 유효 source에 placeholder를 넣지 않는다.

실행 가능한 두 문단 proof는 실제 PM Schema/EditorState/Selection/transaction/history로 단일 문서 projection과 복수 view를 비교한다. 단일 projection은 cross-paragraph selection과 복합 undo를 한 PM 상태에서 표현한다. 복수 view는 두 selection/history를 별도로 조정해야 한다. **다음 자연스러운 문서 편집 확장은 단일 문서 projection을 기준으로 검토한다.** Issue #35의 현재 로컬 파일 편집기는 이 projection을 사용하고, 기존 per-block view는 spike/호환 경로에 남긴다. SourceSession은 어느 projection에서도 Core operation만 받아 source를 소유한다. 이 구현 사실은 사람의 ADR 채택 결정을 대신하지 않는다.

저장 journal은 인접한 동일 inline target/path의 연속 setInlineText를 exact-source 재계획으로 축약하고, 문서 projection의 문단 입력은 `splitParagraph`, `joinParagraph`, `replaceParagraphRange`로 기록한다. 대상 전환·구조 편집·rename·rebase·복합 gesture를 넘지 않는다. Undo 기록은 journal과 별도이며 현재 로컬 파일 편집기는 document gesture history를 사용한다. 각 gesture의 의미 역연산은 실제 다음 snapshot에 replay해 이전 source와 byte-for-byte 같은 경우에만 history에 기록한다. 정확한 역연산을 증명하지 못한 구조 form operation은 저장 journal에는 남지만 기존 undo history를 넘지 못하는 장벽이 된다. 성공한 Save는 새 기준 revision과 journal을 rebase하면서 검증된 history를 유지한다. 제한을 넘은 가장 오래된 gesture가 저장 checkpoint에도 있으면 양쪽 lineage에서 함께 제거하고, 그렇지 않아 replay lineage를 보존할 수 없으면 history barrier로 전환한다. 명시적 Reload/SourceSession 교체는 history를 초기화한다.

새 ID 자동 제안은 향후 Core의 문서 전체 충돌 검사를 재사용하고 새 객체 생성이 성공할 때만 source에 기록해야 한다. 기존 문서를 열 때 ID를 자동 추가하지 않으며 제목 변경은 ID를 바꾸지 않는다. 현재 UI의 명시적 ID 입력과 Core의 중복 거부를 유지한다. 자동 ID UI는 이번 변경 범위가 아니다.

## Consequences

`node --test tests/acceptance/session*.test.mjs`는 독립 기대 source, 복합 gesture 실패의 무공개, selection, undo/redo, caller DTO 소유권, 단계 index 이동과 structural stale을 검증한다. Browser 회귀는 단일 projection의 split/join/multiline paste, 경계 빈 draft, typing/undo/redo와 Save 후 undo를 확인한다. Proof는 native cross-block drag나 OS IME 검증의 대체물이 아니다.

`node scripts/benchmark-session.mjs --baseline <a7607fd-checkout>`는 공개 가상 문서, 600회 동일 run 입력, warmup 후 3회 측정으로 실제 이전 SourceSession과 새 구현을 비교한다. Windows/Node24.18.0의 19,275-byte 문서에서 이전 log는 600개/71,783 bytes, 합친 log는 1개/119 bytes였다. 저장 replay는 이전 665.75–753.04ms, 새 구현 1.86–2.97ms였다. 입력 전체는 이전 649.72–1382.76ms, 새 구현 1410.04–1424.75ms로 증가했다. 추가 exact-source planning 비용을 감수한 최소 대책이며 일반 성능 우월성이나 통계적 결과를 주장하지 않는다. 이 수치는 당시 session history를 비활성화한 benchmark 범위이며, 현재 document history 성능을 측정한 결과가 아니다.

복잡성은 작은 session coordinator와 두 좌표(generation/epoch), 보수적 mapping 무효화 및 guarded coalescing이다. 범용 selector registry, CRDT, incremental parser, full WYSIWYG, snapshot 영속화는 추가하지 않는다. 더 큰 문서·서로 다른 target의 긴 journal과 전체 문서 PM mapping은 남은 검증 범위다.
