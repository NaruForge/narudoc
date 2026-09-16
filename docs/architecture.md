# 아키텍처

## 의존 경계

- model → 내부 의존성 없음.
- parser → model.
- core → model, parser.
- renderer-html → model.
- apps/cli → core, renderer-html 및 공통 타입.

라이브러리는 Node I/O·DOM·editor·네트워크에 의존하지 않는다. renderer는 원본을 재파싱하거나 Core 편집 로직을 복제하지 않는다. CLI는 Core operation을 호출하며 문서를 독자적으로 편집하지 않는다.

## 원본 소유권

UTF-8 파일 → 원본 string + 위치를 가진 semantic model → operation → TextEdit[] → 재파싱/검증 → 저장. 원본 string을 authoritative로 보존한다. 이 MVP는 완전한 lossless CST·incremental parser 구현이라고 주장하지 않는다. 원본+범위 기반 보존을 먼저 증명한다.

Edit 범위는 UTF-16 code unit의 반열린 구간 [start, end)이다. 변경 대상의 expected text를 확인하고 중첩·범위 오류·surrogate 분할을 거부한다. 전체 snapshot이 바뀌면 plan을 재사용하지 않는다. 제목·문단·속성은 공통 접두·접미사를 보존하며, 섹션 이동은 원본 slice를 이동한다.

## 저장과 안전

CLI는 엄격한 UTF-8 decoding, 원본 SHA-256 revision, 협조적 lock, 같은 폴더 임시 파일과 rename을 담당한다. 저장 직전에 원본 revision을 다시 확인한다. symlink·hardlink 파일 편집은 MVP에서 거부한다. 외부의 비협조적 writer에 대한 완전한 compare-and-swap이나 전원 장애 내구성은 보장하지 않는다. lock은 자동으로 빼앗거나 삭제하지 않는다.

HTML은 텍스트·속성을 escape하고 위험 URL을 막는다. raw HTML·코드·directive를 실행하지 않는다. 렌더링은 네트워크·파일 읽기를 하지 않는다.

## 파서 선택

v0.0.1은 docs/format.md의 좁은 NaruDoc 문법만 구현하는 순수 TypeScript scanner를 사용한다. 앞선 micromark 후보는 범용 Markdown interoperability가 필요해질 때 비교한다. 직접 구현 범위를 CommonMark 전체로 확대하지 않는다. 도구/의존성 선택과 무관하게 snapshot/범위 계약 및 fidelity tests를 유지한다.
