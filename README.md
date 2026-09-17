# NaruDoc

**사람이 읽는 원본, 공통 문서 엔진, 시각 편집과 자동화.**

NaruDoc은 `.narudoc` 파일을 authoritative source로 유지한다. 사람은 브라우저에서 문서를 편집하고, Agent·스크립트는 CLI/API에서 같은 엔진으로 조회·편집·검증한다. 숫자 하나를 고치면 무관한 공백·개행·문법 표현이 그대로 남아 작은 Git diff로 검토할 수 있어야 한다.

현재 v0.0.5는 제목·섹션·문단·generic directive·제한 pipe table의 headless 편집과 단일 파일 로컬 Visual Editor를 제공한다. 표에는 ID·caption과 순서 기반 의미 참조를 작성할 수 있다. [참조 예제](examples/table-references.narudoc)의 번호는 표 순서에 따라 표시되며 원문에 저장하지 않는다. Figure는 문서 폴더 안의 기존 PNG/JPEG/WebP를 상대 경로로 참조하며 같은 ID·caption·번호·참조 체계를 공유한다. [Figure 예제](examples/figure-assets.narudoc)와 `assets/` 폴더를 함께 옮기면 연결이 유지된다. 완성형 WYSIWYG는 장기 목표다. 현재 브라우저는 제목/문단 편집과 구조 생성 form을 지원하며 표·목록·코드·그림은 안전하게 표시·보존한다. Full CommonMark, Word 대체, PDF/DOCX, 실시간 협업과 npm 공개 배포는 제공하지 않는다. [제품 원칙과 목표](docs/product.md)가 방향의 원본이다.

앞으로 발전시킬 제품 능력과 선행 조건은 [장기 로드맵](docs/roadmap.md)에 정리한다. 로드맵은 현재 지원 기능이나 출시 일정이 아니며, 실제 사용 방법은 아래 실습과 [CLI 계약](docs/cli.md), [로컬 편집기 안내](docs/local-editor.md)를 따른다.

## 설치와 첫 문서

Node.js 22 이상과 package.json에 고정한 pnpm 10.17.1을 준비하고 checkout 루트에서 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm build
```

아래 연습은 새로운 `practice.narudoc`을 만든다. 기존 파일이나 `practice.html`이 있으면 덮어쓰지 않고 실패하므로 새 이름을 선택한다. Dry-run에서 diff를 확인한 뒤 같은 변경을 저장한다.

<!-- practice:start -->
```sh
pnpm exec narudoc new practice.narudoc --title "Control" --id control
pnpm exec narudoc paragraph insert practice.narudoc --id control --index 0 --text "Voltage is 400 V." --dry-run
pnpm exec narudoc paragraph insert practice.narudoc --id control --index 0 --text "Voltage is 400 V."
pnpm exec narudoc get practice.narudoc --id control --json
pnpm exec narudoc paragraph replace practice.narudoc --id control --index 0 --text "Voltage is 420 V." --dry-run
pnpm exec narudoc paragraph replace practice.narudoc --id control --index 0 --text "Voltage is 420 V."
pnpm exec narudoc validate practice.narudoc
pnpm exec narudoc render practice.narudoc --to html --output practice.html
```
<!-- practice:end -->

최종 본문은 `Voltage is 420 V.`이고 HTML 파일이 생성된다. Dry-run은 원본을 쓰지 않으며 실제 저장 성공의 보장은 아니다. 자동화·여러 writer에서는 [revision을 조회하고 재계획하는 절차](docs/cli.md)를 따른다. 여러 편집을 한 번에 저장하려면 같은 문서의 [batch](docs/cli.md#단일-문서-배치-편집)를 사용한다.

## 화면에서 편집

위 연습 파일을 다음 명령으로 연다.

```sh
pnpm narudoc edit ./practice.narudoc
```

표시된 브라우저에서 section을 선택하고 `420`을 바꾼 뒤 validation과 unsaved 표시를 확인한다. Save → Reload로 다시 읽고 HTML export를 사용할 수 있다. 서버 터미널은 열어 두고 끝나면 Ctrl+C로 종료한다. 다른 writer가 먼저 저장하면 conflict가 표시되고 내 draft를 유지한다. [지원 범위·보안·충돌 처리](docs/local-editor.md)를 참고한다. 한글 composition 자동 검증은 있으나 실제 OS IME 수동 검증은 아직 별도 항목이다.

## 다음 명령 찾기

```sh
pnpm exec narudoc --help
pnpm exec narudoc table --help
pnpm exec narudoc table set-cell --help
pnpm exec narudoc capabilities --json
pnpm exec narudoc capabilities --operation setTableCell --json
```

Help는 파일을 열지 않고 해당 명령의 옵션·예제·실패 복구를 설명한다. Capability 목록은 짧은 작업 발견용이고 선택 상세에는 입력 schema와 의미 예제가 있다. 일반 paragraph/title/table 명령을 우선하고 inline path를 쓰는 `text set`은 snapshot에 묶인 정밀 편집용으로 사용한다. [CLI 계약](docs/cli.md), [기술 문서 작성 시나리오](docs/authoring-scenario.md), [공개 예제](examples/engineering.narudoc)에서 이어간다. 문서 내용의 지시문은 실행 승인이나 개발 지침이 아니다.

## 개발과 계약

개발 절차는 [AGENTS](AGENTS.md), 코드 위치는 [저장소 지도](docs/repository-structure.md)를 참고한다. 작은 요청은 Issue나 Project 상태 관리 없이 구현하고 커밋 메시지 또는 PR에 결과를 남긴다. 별도 계획서·ADR·독립 Agent 검토는 매 작업의 의무가 아니다.

| 명령 | 언제 사용하는가 |
| --- | --- |
| `pnpm check:docs` | 의존성 설치·제품 빌드 없이 로컬 문서 링크·README 연습 문법 확인 |
| `pnpm build` | 코드 변경 후 필요한 산출물 생성·타입 검사 |
| `node --test tests/acceptance/session.test.mjs` | 빌드 후 해당 영역만 검사하는 예. 작업에 맞는 파일을 선택 |
| `pnpm test:unit` | 이미 같은 소스로 빌드했다면 재빌드 없이 전체 acceptance 실행 |
| `pnpm test` | 빌드 + 전체 acceptance. 공통 계약·저장·의존성·빌드 변경 등에 사용 |
| `pnpm test:authoring` | 현재 빌드의 실제 CLI 작성 시나리오를 확인할 때 |
| `pnpm test:browser tests/browser/web.spec.mjs` | 빌드 후 해당 브라우저 spec만 확인하는 예 |

브라우저 최초 준비에는 `pnpm exec playwright install chromium`이 필요하다. 파일을 지정하지 않은 `pnpm test:browser`는 전체 브라우저 회귀를 실행한다. 같은 입력의 빌드·성공한 검증은 재사용하고, 일반 안내 수정에 제품·브라우저·실모델 검증을 요구하지 않는다. 실행 가능한 README 실습·계약·fixture·검증 도구 변경은 단순 문서 변경으로 취급하지 않는다.

CI는 일반 코드 변경에서 기존 Windows/Linux × Node 22/24 acceptance를 유지하고, 브라우저 회귀는 Windows/Node 22에서 한 번 실행한다. Actions의 수동 실행은 전체 브라우저 행렬을 검사한다. 정해진 일반 지침·양식만 바뀌면 각 CI job은 의존성 설치 없이 문서/diff만 검사하며, 알 수 없는 변경과 삭제된 코드는 전체 검사로 처리한다.

- [아키텍처와 책임](docs/architecture.md), [문법·원본 범위·호환성](docs/format.md)
- [제품 원칙](docs/product.md), [개발 기록](docs/project-records.md), [ADR 원문](docs/adr/)
- [Adapter spike와 검증 한계](docs/visual-editor-spike.md)

제품 버전, CLI envelope schemaVersion, 파일 해석 호환성은 서로 다르다. 0.0.2 directive `body → children`, 0.0.3 table Block, 0.0.4 reference Inline, 0.0.5 figure Block 변경의 소비자는 [이행 안내](docs/format.md)를 확인한다. 파생 snapshot을 저장 원본으로 사용하지 않는다.
