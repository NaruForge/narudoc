# NaruDoc

**Git-native, agent-native structured document engine.**

NaruDoc은 사람이 읽는 `.narudoc` 텍스트를 원본으로 사용한다. 사람·AI Agent·자동화가 동일한 엔진으로 문서를 읽고 수정하고 검증한다. Visual Editor는 엔진 위에 추가할 client이지 필수 실행 환경이 아니다.

기존 SDoc에서 겪은 복잡한 JSON Git diff와 editor-dependent CLI를 해결하는 것이 출발점이다. 작은 의미 변경이 무관한 공백·개행·목록 표현의 재직렬화를 일으키지 않아야 한다.

## MVP 1 · v0.0.1

목표 범위는 CLI 조회, 제목·섹션·문단·directive 편집, validation, HTML 출력이다. GUI, PDF, MCP, 실시간 협업, registry 공개 배포는 포함하지 않는다. 전체 CommonMark 호환이나 Word 대체를 주장하지 않는다. 구현·검증 근거는 [MVP Issue #2](https://github.com/NaruForge/NaruDoc/issues/2)에서 확인한다.

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

위 dry-run은 원본을 수정하지 않는다. 실제 편집은 `--dry-run`을 제거한다. 아직 npm registry에 배포하지 않았으므로 `npx` 설치 명령을 제공하지 않는다.

## 문서

- [제품 목적과 MVP](docs/product.md)
- [아키텍처](docs/architecture.md) / [폴더 배치](docs/repository-structure.md)
- [파일 문법·원본 보존 계약](docs/format.md)
- [Agent 안내](AGENTS.md) / [프로젝트 기록 규약](docs/project-records.md)
