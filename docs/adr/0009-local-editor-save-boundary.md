# 0009 — 단일 파일 로컬 편집기의 저장 경계

Date: 2026-09-17

Status: Proposed

Related: [Issue #27](https://github.com/NaruForge/narudoc/issues/27), [adapter](0008-source-owned-editor-adapter.md), [저장](0004-file-save-guarantees.md)

## Context

원본 보존 adapter를 실제 파일 편집으로 연결할 때 browser draft를 디스크 revision과 혼동하거나 GUI가 새 저장 원본이 되는 위험이 있다. CLI subprocess 호출, 별도 웹 저장 구현, raw source 업로드를 비교했다. 첫 방식은 서버의 의미 입력 계약을 CLI 출력에 결합하고, 두 번째는 기존 저장 보장의 중복을 만들며, 세 번째는 client의 결과를 신뢰하는 우회 경로가 된다.

## Decision

CLI의 실제 Node 파일 구현을 `packages/file-store`로 이동해 CLI와 `apps/web`이 공유한다. 엔진 네 패키지는 Node I/O·DOM·네트워크 없이 유지한다. CLI `edit FILE`만 웹 launcher를 호출한다. 브라우저는 #26 adapter의 source snapshot과 연산 목록을 갖고, 서버는 요청의 base revision을 실제 파일과 비교한 다음 Core `planBatch`로 연산을 재계획한다. 전체 성공 후 공용 `save`를 한 번 호출한다. Raw source/HTML/임의 파일 경로 저장은 받지 않는다.

Browser draft, 유효 source, 저장된 source/revision을 분리한다. 오류/충돌은 draft를 유지한다. Reload의 명시적 취소/폐기 선택만 draft를 없앨 수 있다. 저장 중 편집은 잠그고 성공한 서버 source와 client source의 일치도 검사한다. Save/reload/구조 생성은 block history를 새로 시작한다. 영속 history나 자동 merge는 제공하지 않는다.

Loopback 127.0.0.1의 임의 사용 가능 port에 bind한다. 정확한 Host/Origin, 실행별 256-bit bearer token, JSON content type, 고정 route/asset allowlist를 사용한다. Token은 첫 URL fragment로 전달하고 탭 sessionStorage에 보관한 뒤 주소에서 지운다. POST에는 같은 Origin이 필수다. CORS 허용 없음. App CSP는 외부 script/이미지/frame/form을 막으며 HTML export renderer의 별도 CSP는 유지한다. 같은 OS 사용자나 browser extension으로부터의 비밀 격리는 보장하지 않는다.

연산 request는 10 MiB/10,000개로 제한한다. Core의 기존 1..100 batch 계약은 유지하고 서버가 최대100개씩 순차 계획하며 마지막에 한 번만 저장한다. 100개를 넘는 타이핑도 동작하며 후속 batch 실패는 디스크에 부분 반영되지 않는다. Export는 같은 계획 경로 후 고정 `FILE.html`에 기존 no-clobber 출력을 사용한다.

## Consequences

GUI가 새 문법/저장 구현을 소유하지 않고 CLI와 같은 source 변경을 검증할 수 있다. Client operation journal은 메모리에만 있고 길이/크기 제한에 도달하면 저장 오류와 draft가 남는다. 제한 전에 저장을 나누는 것이 필요하며 자동 checkpoint/merge는 후속 범위다. 블록별 undo 범위와 읽기 전용 inline/블록 제약은 adapter를 따른다. 실제 OS IME·다른 browser/device 지원은 별도 증거가 필요하다. 세션 URL을 가진 같은 머신 client는 해당 파일을 편집할 수 있으므로 URL을 공유하지 않는다. 비협조적 외부 writer에 대한 완전 CAS/전원 장애 내구성은 기존 저장 adapter처럼 보장하지 않는다.
