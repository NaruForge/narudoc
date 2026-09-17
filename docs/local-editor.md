# 단일 문서 로컬 편집기

저장소 checkout에서 Node22 이상과 고정 pnpm으로 실행한다. npm 배포나 계정은 필요하지 않다.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm narudoc edit ./examples/visual-fidelity.narudoc
```

실제 지정 파일을 편집한다. 연습할 때는 공개 예제의 복사본을 지정한다. 명령은 기본 browser를 열고 실행별 URL을 출력한다. 자동 실행이 불가능하면 출력 URL을 연다. `--no-open`은 자동 열기를 생략하고 `--port N`은 원하는 loopback port(0이면 자동)를 지정한다. 프로세스를 유지하고 Ctrl+C로 종료한다. URL의 세션 토큰을 다른 사람에게 공유하지 않는다. 서버가 종료돼도 저장한 `.narudoc` 파일은 CLI/API로 사용할 수 있다.

## 편집 흐름

목차에서 절을 선택하고 제목·section 문단·directive 문단의 일반 글자를 직접 편집한다. Strong/emphasis 안의 일반 글자도 지원한다. 하나의 문서 projection에서 Enter로 직접 문단을 나누고, 제목 끝 Enter로 해당 section의 첫 직접 문단을 시작하며, 문단 시작의 Backspace/끝의 Delete로 인접 문단을 병합한다. 선택 영역을 여러 문단으로 붙여넣을 수도 있다. Directive 안에서는 기존 일반 글자 편집만 유지하고 문단 분리·병합은 확장하지 않는다. Link/code/escape/여러 줄 inline은 보호되고 목록·code·table·metadata는 읽기 전용이다. 복잡한 mark 경계와 drag/drop은 지원하지 않는다.

일반 붙여넣기는 `LF`·`CRLF`·`CR`을 문단 경계로 해석하고 빈 줄은 제거한다. 붙여넣기 내용으로 heading/list/fence/directive 같은 구조를 만들거나 markup-like 문자를 실행하지 않으며, 해당 입력은 draft로 남기고 원본은 바꾸지 않는다. 선택은 같은 section의 서로 인접한 직접 문단 범위만 넘을 수 있다. 문서의 경계를 넘거나 보호된 inline/block을 자르는 편집은 거부한다.

오른쪽 도구에서 하위 섹션, 문단, 한 문단 requirement/note를 추가한다. 새 객체의 ID·제목·내용과 문단 위치(0부터)를 입력하며 `.narudoc` delimiter나 JSON은 입력하지 않는다. Directive를 고르고 `status` 등의 generic 속성을 수정할 수 있다. 별도 requirement 상태 schema는 없다. Core가 ID·참조·문법을 검증하고 실패한 form 값은 남는다.

상단은 파일·미저장 상태를, 오른쪽은 공통 validation의 오류와 경고를 표시한다. 오류 draft/composition 중에는 저장과 구조 변경이 차단된다. 문서 자체가 잘못됐다면 읽기 전용 본문과 진단을 보여준다. ID 없는 heading도 읽을 수 있지만 시각 편집 대상이 아니다. 파일 복구가 필요한 경우 외부에서 수정한 뒤 Reload한다.

Save 전까지 디스크는 변하지 않는다. Save 성공 후 새 revision이 기준이 되지만 byte-exact 의미 역연산이 검증된 문서 편집의 undo/redo history는 유지된다. 상단 Undo/Redo 버튼 또는 편집 영역에서 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y를 사용한다. Save 뒤에도 직전 문서 gesture를 되돌린 뒤 다시 Save할 수 있다. History는 정해진 개수로 제한되며 오래된 항목이 탈락해도 저장 기준 journal과 현재 source의 replay 일치는 유지한다. 일부 구조 추가 form이나 새 directive 속성처럼 정확한 역연산을 보장하지 않는 operation은 history에 넣지 않고 기존 history도 넘지 못하게 하는 장벽으로 처리한다. Reload·구조 변경에 따른 명시적 session 교체는 history를 초기화한다. 미저장 상태에서 페이지 이탈은 browser 경고를 요청하며, Reload는 draft 폐기 확인을 거친다. 탭 crash/강제 종료에 대한 draft 복구는 없다.

문단 경계나 제목 끝에서 Enter를 누르면 source에 빈 placeholder를 쓰지 않고 잠시 화면 projection에만 빈 문단을 만든다. 그 문단에 실제 텍스트를 입력하면 Core의 `insertParagraph`로 commit되고, 비워 둔 채 남은 draft는 저장할 수 없다. 제목과 첫 직접 문단 사이에 보호 block이 있으면 그 경계를 건너 삽입하지 않는다. 조합 중인 입력도 같은 session draft 경계를 따르며, 실제 OS IME 동작은 별도 수동 검증 대상이다.

CLI/다른 탭에서 먼저 저장하면 Save가 충돌로 실패하고 최신 disk revision을 표시한다. 화면 초안과 디스크 양쪽을 유지하며 자동 덮어쓰기/merge는 없다. 필요 내용을 별도로 보관한 뒤 Reload로 명시적으로 폐기한다. Lock·크기 제한·권한·통신 오류도 초안을 보존한다. 최대 request 10 MiB/10,000 operations이므로 긴 작업은 적절히 나눠 저장한다.

HTML export는 현재 유효 draft를 기존 renderer로 출력하되 `.narudoc`을 저장하지 않는다. 출력은 지정 파일 옆 `FILE.html`이며 이미 있으면 실패한다. 기존 HTML을 덮어쓰지 않는다. 생성된 파일을 browser에서 열 수 있다.

## 구조와 보안

[Proposed ADR 0009](adr/0009-local-editor-save-boundary.md)에 저장·인증 경계를 기록한다. 서버는 고정 파일 하나만 접근하고 browser의 raw source 대신 의미 연산을 Core에서 다시 계획한다. 공통 `file-store`가 CLI와 같은 strict UTF-8/SHA-256/lock/pre-save check/임시 파일+rename/10 MiB/symlink·hardlink 제한을 적용한다. No-op은 bytes와 mtime을 유지한다. 완전 OS CAS나 전원 장애 내구성은 보장하지 않는다.

Host/Origin/session token을 검사하고 CORS를 허용하지 않는다. 고정 route 이외 파일 탐색·path 요청을 받지 않는다. App CSP와 안전 renderer가 document script/raw HTML/위험 URL 실행을 막는다. 서버는 localhost 전용이며 remote 공개/tunnel, 계정/auth server가 없다.

## 재현 검증과 한계

`pnpm test`는 저장·no-op·보안·stale/lock·후속 batch 실패·크기/encoding/hardlink·export no-clobber를 headless로 검증한다. `pnpm exec playwright install chromium` 후 `pnpm test:browser`는 spike와 로컬 편집기 실제 Chromium 테스트를 실행한다.

Windows/Node24/Chromium에서 open→outline→400을420으로 수정→child/paragraph/requirement 추가→status/본문 변경→validation→save→reload→export→CLI inspect/validate/render를 수행했다. GUI 연산을 API로 replay한 source/validation을 비교한다. 독립 기대 문자열 bytes로 BOM/LF/CRLF/CR/혼합 개행/EOF·다른 블록·공백·inline 보존을 확인한다. Invalid draft/Reload 취소/실제 lock/실제 과대 파일/두 탭 및 CLI 충돌/안전 렌더를 검증한다. 권한 오류 UI는 EACCES 응답을 모의한 테스트이며 실제 OS ACL 변경 검증과 다르다.

한글·보조 Unicode 입력과 synthetic composition을 테스트했다. 실제 OS 한글 IME 수동 검증은 수행하지 못했으며, 자동 입력을 수동 IME 검증으로 주장하지 않는다. Firefox/WebKit/mobile/접근성 전수 검증 미실행. 키보드는 기본 native controls와 adapter를 사용한다. Browser automation도 사람이 직접 수행한 manual test와 구분한다. Screenshot은 실제 실행 화면이며 fidelity의 증거를 대체하지 않는다.

- [열기 화면](evidence/27-open.png)
- [편집 화면](evidence/27-edit.png)
- [충돌 화면](evidence/27-conflict.png)

최종 PR head의 전체 테스트·CI·독립 reviewer 실행 결과는 Issue/PR에 기록한다.

추가 도구 탐색: 문서화한 `pnpm narudoc edit FILE --no-open --port 4187`을 실제 실행하고 playwright-cli의 Windows HeadlessChrome152에서 heading 클릭→End→문자 입력→Save→Reload를 수행했다. 저장 source의 heading spacing과 다른 블록 보존, CLI validate를 확인했다. 기본 OS browser 자동 launch와 실제 OS IME 조작은 미실행이다.

웹 입력의 duplicate key 거부 및 전체 요청 operationIndex/diagnostics는 [공통 입력 계약](cli.md#기능-발견과-입력-원본)을 따른다. 저장 전에 전체 sequence를 성공해야 하며 중간 결과를 저장하지 않는다.

현재 편집 세션은 source/snapshot, 저장 기준 revision, 문서 gesture history와 draft를 순수 coordinator에서 관리한다. 웹 본문은 하나의 ProseMirror document projection을 사용하고, 실제 저장은 `splitParagraph`, `joinParagraph`, `replaceParagraphRange` 같은 Core 의미 연산을 통해서만 수행한다. 연속 입력과 여러 줄 붙여넣기는 하나의 사용자 의도 단위로 undo/redo할 수 있으며, 성공한 Save는 저장 기준과 journal을 rebase하되 past/future history를 버리지 않는다. 구조 변경 뒤 기존 view/selection은 무효화된다. [세션 ADR](adr/0011-targets-and-source-session.md)은 관련 방향과 남은 검증 조건을 기록하며, 사람의 채택 결정 없이 Proposed 상태를 유지한다.
