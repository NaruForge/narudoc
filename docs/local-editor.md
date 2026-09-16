# 단일 문서 로컬 편집기

저장소 checkout에서 Node22 이상과 고정 pnpm으로 실행한다. npm 배포나 계정은 필요하지 않다.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm narudoc edit ./examples/visual-fidelity.narudoc
```

실제 지정 파일을 편집한다. 연습할 때는 공개 예제의 복사본을 지정한다. 명령은 기본 browser를 열고 실행별 URL을 출력한다. 자동 실행이 불가능하면 출력 URL을 연다. `--no-open`은 자동 열기를 생략하고 `--port N`은 원하는 loopback port(0이면 자동)를 지정한다. 프로세스를 유지하고 Ctrl+C로 종료한다. URL의 세션 토큰을 다른 사람에게 공유하지 않는다. 서버가 종료돼도 저장한 `.narudoc` 파일은 CLI/API로 사용할 수 있다.

## 편집 흐름

목차에서 절을 선택하고 제목·section 문단·directive 문단의 일반 글자를 직접 편집한다. Strong/emphasis 안의 일반 글자도 지원한다. Link/code/escape/여러 줄 inline은 보호되고 목록·code·table·metadata는 읽기 전용이다. 복잡한 mark 경계, Enter로 블록 나누기, 여러 줄 paste, drag/drop은 지원하지 않는다.

오른쪽 도구에서 하위 섹션, 문단, 한 문단 requirement/note를 추가한다. 새 객체의 ID·제목·내용과 문단 위치(0부터)를 입력하며 `.narudoc` delimiter나 JSON은 입력하지 않는다. Directive를 고르고 `status` 등의 generic 속성을 수정할 수 있다. 별도 requirement 상태 schema는 없다. Core가 ID·참조·문법을 검증하고 실패한 form 값은 남는다.

상단은 파일·미저장 상태를, 오른쪽은 공통 validation의 오류와 경고를 표시한다. 오류 draft/composition 중에는 저장과 구조 변경이 차단된다. 문서 자체가 잘못됐다면 읽기 전용 본문과 진단을 보여준다. ID 없는 heading도 읽을 수 있지만 시각 편집 대상이 아니다. 파일 복구가 필요한 경우 외부에서 수정한 뒤 Reload한다.

Save 전까지 디스크는 변하지 않는다. Save 성공 후 새 revision이 기준이 된다. 텍스트 undo/redo는 각 블록 안에서 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y로 동작한다. Save·Reload·구조 변경 후 block history는 초기화된다. 미저장 상태에서 페이지 이탈은 browser 경고를 요청하며, Reload는 draft 폐기 확인을 거친다. 탭 crash/강제 종료에 대한 draft 복구는 없다.

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
