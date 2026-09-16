# NaruDoc

**Git-native, agent-native structured document engine.**

NaruDoc의 본체는 사람이 읽는 `.narudoc` 원본과 편집기에 독립적인 문서 엔진이다. 사람·AI Agent·스크립트·CI는 같은 엔진으로 문서를 생성·조회·수정·검증·출력한다. CLI는 최초 reference client이자 계속 유지할 1급 인터페이스이며, API와 향후 Visual Editor도 같은 엔진을 사용하는 경로다.

기존 SDoc에서 겪은 복잡한 JSON Git diff와 editor-dependent CLI를 해결하는 것이 출발점이다. 작은 의미 변경이 무관한 공백·개행·목록 표현의 재직렬화를 일으키지 않아야 한다.

**Headless-first 설계와 사람이 쓰기 편한 WYSIWYG는 함께 추구한다.** CLI-first는 CLI-only가 아니다. 설계서·요구사항 같은 기술 문서를 사람이 시각적으로 작성하면서도, AI와 자동화는 편집기 실행 없이 같은 핵심 작업을 수행할 수 있어야 한다. 시각적 편집기는 장기 목표이며 아직 구현되지 않았다. 대상 사용자, 엔진과 client의 관계, 승인 정책과 성공 기준은 [제품 비전](docs/product.md)을 따른다.

## MVP 2 첫 단계 · v0.0.3

현재 제공 범위는 CLI 조회, 제목·섹션·문단·directive·표 편집, validation, HTML 출력이다. GUI, PDF, MCP, 실시간 협업, registry 공개 배포는 포함하지 않는다. API와 문법은 실험 단계이며 전체 CommonMark 호환이나 Word 대체를 주장하지 않는다. 구현·검증 근거는 [MVP Issue #2](https://github.com/NaruForge/narudoc/issues/2)에서 확인한다.

여러 의미 편집은 [단일 문서 배치](docs/cli.md#단일-문서-배치-편집)로 순차 검증한 뒤 한 번에 저장할 수 있다. 중간 편집이 실패하면 앞선 부분 결과도 저장하지 않는다.

[하위 섹션 생성](docs/cli.md#하위-섹션-생성)은 부모 ID로 마지막 자식 절을 추가한다. 제목 수준을 직접 조립하지 않고 새 문서의 계층을 만들고 문단·요구사항을 채울 수 있다.

[섹션 문단 삽입](docs/cli.md#섹션-문단-삽입)으로 빈 섹션에 첫 문단을 쓰거나 기존 본문에 문단을 추가할 수 있다. 새 문서 생성부터 삽입·수정·검증·HTML 출력까지 GUI 없이 실행한다.

Generic directive 본문에 여러 문단·평면 목록·코드 블록을 함께 담을 수 있다. [예제](examples/directive-blocks.narudoc)와 [문법·이행 안내](docs/format.md)를 참고한다. 0.0.2는 `body → children` 공개 모델/조회 JSON의 breaking change이며 기존 source를 새 parser로 재파싱해야 한다.

[Generic directive 생성](docs/cli.md#generic-directive-생성)은 JSON 의미 객체로 요구사항·note 등을 새로 추가한다. 원문 문법을 직접 조립하지 않고 문단·목록·코드가 있는 객체를 생성한 뒤 기존 편집 명령으로 수정할 수 있다.

[Directive 본문 문단 편집](docs/cli.md#directive-본문-문단-편집)은 ID와 문단 index로 요구사항 문장 등을 교체한다. 속성·다른 문단·목록·코드의 원문은 유지하며 CLI와 batch에서 같은 엔진을 사용한다.

[ID 변경](docs/cli.md#id와-내부-참조-변경)은 정의와 같은 문서의 내부 링크를 함께 수정한다. 원문 전체에서 같은 문자열을 치환하지 않아 코드·외부 링크·무관한 텍스트를 유지한다.

## 개발 실행

Node.js 22 이상. package.json의 pnpm 버전을 설치한 뒤 저장소 루트에서 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm exec narudoc inspect examples/engineering.narudoc --json
pnpm exec narudoc heading set-title examples/engineering.narudoc --id dc-link-control --title "DC-Link Voltage Control" --dry-run
pnpm exec narudoc validate examples/engineering.narudoc
pnpm exec narudoc render examples/engineering.narudoc --to html --output out.html
```

위 dry-run은 원본을 수정하지 않으며 실제 저장 성공을 보장하지 않는다. 실제 편집은 `--dry-run`을 제거한다. 자동화에서는 [revision을 포함한 사용 흐름과 오류 처리](docs/cli.md)를 따른다. `out.html`이 이미 있으면 출력은 실패하며 덮어쓰지 않는다. 아직 npm registry에 배포하지 않았으므로 `npx` 설치 명령을 제공하지 않는다.

## 문서

- [제품 비전·원칙·현재 범위](docs/product.md)
- [CLI 사용·JSON 응답·실패 처리](docs/cli.md)
- [기술 문서 편집 시나리오 재현](docs/authoring-scenario.md)
- [아키텍처](docs/architecture.md) / [폴더 배치](docs/repository-structure.md)
- [파일 문법·원본 보존 계약](docs/format.md)
- [설계 결정 기록](docs/adr/) — 각 문서의 Status를 확인한다.
- [Agent 안내](AGENTS.md) / [프로젝트 기록 규약](docs/project-records.md)

[표 조회·생성·셀 편집](docs/cli.md#표-조회생성셀-편집)으로 파라미터 표를 만들고 숫자만 수정한다. 0.0.3에서는 제한 pipe table이 새 Block 타입으로 해석되므로 [이행 안내](docs/format.md#제한된-표--003)를 확인한다.
