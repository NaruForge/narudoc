# NaruDoc 프로젝트 기록 규약

이 문서는 repository work와 중요한 architecture decision의 기록 위치, 원본, 운영 기준을 정한다. 일상 작업에는 이 문서와 GitHub native 기능을 사용한다. 외부 Blueprint, bootstrap Skill, 동기화 서비스는 필요하지 않다.

## 일상 작업의 읽기 경로

착수에는 [정보별 원본](#정보별-원본)과 [Work 승인 근거](#work-item-종류와-내용), 상태 변경에는 [Lifecycle](#lifecycle와-종료), 설계/PR에는 [ADR 판단·호환성](#설계pr에서-확인할-사항)을 읽는다. [원격 설정](#적용한-원격-설정과-변경-권한)과 [설치 이력](#설치-당시-확인한-기존-기록)은 해당 관리 작업에서만 참고한다. 이 경로는 기존 승인·설치 기록을 대체하거나 추가 승인을 요구하지 않는다.

실행 가능한 입력·binding·문법·저장 경계가 바뀌면 관련 코드와 계약/예제/회귀를 같은 PR에 둔다. 검증 결과에는 대상 SHA와 로컬/CI/독립 reviewer/browser 자동/실제 사람·OS IME/skip·미실행을 구분한다. 구조 검사의 성공이나 문서 키워드 포함만으로 Agent 이해도·사람 사용성을 주장하지 않는다.

## Provider와 적용 범위

- Work Item provider: **GitHub** 하나만 사용한다.
- 저장소와 Issue 원본: [NaruForge/narudoc](https://github.com/NaruForge/narudoc), [Issues](https://github.com/NaruForge/narudoc/issues).
- lifecycle 원본: [NaruDoc Project #8](https://github.com/users/NaruForge/projects/8)의 `Status` 필드. 저장소 전용 [Work items board](https://github.com/users/NaruForge/projects/8/views/1)를 사용한다.
- Project owner: `NaruForge` 개인 계정. Project ID: `PVT_kwHOAmTnZc4BjpTv`. Status field ID: `PVTSSF_lAHOAmTnZc4BjpTvzhic2_M`.
- 2026-09-16 사용자 승인에 따라 Project·board·Status·label·Issue Form을 설정하고, 자동화는 WorkNaru-dev와 같은 동작으로 맞췄다. 아래 운영 기준을 따른다. 이후 원격 설정 변경에는 해당 작업의 승인 범위를 확인한다.
- `AGENTS.md`, 이 규약, Installation Receipt와 `.github/ISSUE_TEMPLATE/`의 양식·설정은 Git으로 함께 관리한다.
- Project가 없거나 접근할 수 없을 때 로컬 Issue, status label, 다른 board를 대체 원본으로 만들지 않는다. 필요한 설정 또는 접근 문제를 보고하고 관련 기록 작업을 중단한다.

GitHub를 선택한 이유는 저장소와 Issues가 이미 존재하고, 설치 전 조사한 제품 정의에 여러 단계에 걸친 지속적인 개발이 예정되어 있었기 때문이다. 별도 Local tracker, GitLab, Jira 또는 provider `none`을 함께 사용하지 않는다. 향후 provider 변경은 별도 제안과 승인을 거친다.

저장소와 Issue는 공개되어 있다. Project는 비공개이므로 Issue 접근 권한과 Project 접근 권한이 다를 수 있다. 공개 제출 내용에는 공개 가능한 정보만 포함하고, Project 접근 제한을 해소하기 위해 로컬 진행 상태표를 만들지 않는다.

## 정보별 원본

| 정보 | 유일한 authoritative source |
|---|---|
| Repository work / content | GitHub Issue 제목과 본문. 논의와 근거는 해당 Issue comment에 연결한다. |
| Kind | Issue label 중 `idea`, `work`, `bug` 정확히 하나. |
| Progress | 전용 Project의 `Status` 필드. 본문, label, 로컬 문서에 현재 단계를 복제하지 않는다. |
| Modifier | Issue의 `blocked`, `needs-triage` label. |
| Closure | Issue의 native open/closed와 close reason. 세부 처분 사유는 해당 종료 comment. |
| Dependency | Issue의 native `Relationships → blocked by / blocking` 관계. |
| Release scope | GitHub Milestone. 실제 릴리스 또는 납품 범위가 있을 때만 지정한다. |
| Priority | 초기에는 별도 priority field나 label을 도입하지 않는다. |
| Area | 필요할 때 기존 `documentation`, `accessibility` 등 분류 label을 사용한다. |
| Personal next action | 사용자가 별도로 사용하는 개인 작업 체계. Issue 링크만 연결하고 repository backlog나 진행 상태를 복제하지 않는다. |
| Completed implementation history | Git commit과 merged PR 이력. 별도 완료 대장을 만들지 않는다. |
| Durable decision / ADR status | 해당 `docs/adr/*.md` 문서. |
| Long-term capability direction | [장기 로드맵](roadmap.md). 제품 능력·발전 순서·선행 능력·달성 기준. |

Milestone, PR 상태, 담당자, 개인 할 일의 완료 여부로 Project `Status`를 대신하지 않는다. Issue 종료는 작업의 처분을, Git과 merged PR은 실제 변경 이력을 기록한다. Issue·ADR·PR·commit은 링크로 연결하며 본문과 상태를 복제하지 않는다. 이 문서에도 개별 Work Item의 현재 상태를 기록하지 않는다.

로드맵은 제품 능력 사이의 선행 조건과 발전 방향을 설명한다. 개별 Issue의 실행 순서·승인·진행 상태·native Dependency를 대신하지 않는다. 로드맵의 항목을 승인된 Work로 해석하거나 모든 항목을 미리 Issue로 생성하지 않는다.

로드맵은 장기 범위·발전 순서·선행 능력·달성 기준이 바뀔 때 수정하며, 근거는 관련 Issue/PR에 남긴다. 개별 작업의 진행·병합·완료는 로드맵에 복제하지 않는다.

## Work Item 종류와 내용

| Canonical kind | GitHub label | 의미 |
|---|---|---|
| `idea` | `idea` | 아직 구현 승인을 받지 않은 제안. |
| `work` | `work` | 수행 승인을 받은, 검증 가능한 결과 하나. |
| `bug` | 기존 `bug` | 재현 가능한 기대 동작과 실제 동작의 차이. |

`enhancement` 등 기존 분류 label을 canonical kind로 해석하지 않는다. 승인된 idea를 구현할 때는 같은 Issue의 `idea`를 `work`로 교체하고 승인 근거를 남긴다. 기록을 복제하여 별도 작업 대장을 만들지 않는다.

각 Issue는 배경 또는 문제, 원하는 결과, 범위, 비목표, 검증 가능한 완료 조건, 위험, 관련 근거를 제공해야 한다. 정보가 없으면 없음 또는 미확인이라고 밝힌다. Work는 승인한 사람과 승인 근거를 포함한다. Bug는 확인 가능한 환경, 재현 절차, 기대 동작, 실제 동작을 포함한다.

Issue Form은 내용 수집 수단이며 제출 자체가 작업 승인이나 완료를 뜻하지 않는다. 승인 근거가 없는 `work` 제출은 triage에서 `idea`로 분류하고, 승인 전에는 실행하지 않는다. 자유 입력으로 생성된 Issue에도 같은 기준을 적용한다.

Issue 간 선행 관계는 생성 후 `Relationships`에서 연결한다. 본문에는 별도의 의존 관계 목록이나 완료 checkbox를 유지하지 않는다. 외부 접근 제한처럼 Issue 간 관계로 표현할 수 없는 위험과 진행을 막는 사유는 본문에 설명한다. Dependency는 선행 관계를, `blocked` modifier는 현재 진행을 막는 상황을 표현한다. 관계가 있다는 이유만으로 modifier나 progress를 자동 변경하지 않는다.

## Lifecycle와 종료

```text
Inbox -> Backlog -> Ready -> In progress -> In review -> Done
```

| Canonical lifecycle | Project Status 값 | 진입 기준 |
|---|---|---|
| Inbox | `Inbox` | Issue가 Project에 등록되어 초기 Status가 설정되었다. |
| Backlog | `Backlog` | 검토했으며 추후 다룰 대상으로 남겼다. 수행 승인을 대신하지 않는다. |
| Ready | `Ready` | 수행 승인, 범위, 완료 조건, 의존 관계가 명확하고 착수를 막는 미해결 사항이 없다. |
| In progress | `In progress` | 실제 작업을 시작했다. |
| In review | `In review` | 결과와 검증 근거가 준비되어 검토 중이다. |
| Done | `Done` | 완료 조건을 충족하고 결과 검증이 끝났다. Issue는 `closed / completed`이다. |

이 값은 전용 Project의 단일 `Status` 필드만 소유한다. Board의 column은 이 필드의 표시이며 별도 상태가 아니다. 새로 생성되거나 수정되는 열린 Issue는 native 자동화로 Project에 추가되고 `Inbox`를 받는다. 자동화가 추가하지 않은 실제 Issue는 승인 범위 안에서 Project에 추가하고 초기 Status를 확인한다. PR이나 Project draft item을 두 번째 repository Work Item으로 운영하지 않는다.

`blocked`는 현재 진행 불가, `needs-triage`는 분류 또는 필수 정보의 추가 검토가 필요함을 뜻한다. 어느 단계에도 붙을 수 있으며 단계 자체를 바꾸지 않는다. `Ready`로 진입하기 전에 해당 사유를 해결한다. 승인 전 idea는 `Ready`로 이동하지 않는다.

검토 결과 재작업이나 재계획이 필요하면 실제 상황에 맞는 앞 단계로 돌아갈 수 있다. 단계를 통과했다는 이력을 만들기 위해 가짜 전이를 수행하지 않는다.

완료 처리에서는 완료 조건과 검증 근거를 확인한 후 `Status = Done`과 `closed / completed`를 함께 맞추고 두 native surface를 다시 읽는다. 상태와 종료 처분은 서로 다른 정보이며 일치 규칙으로 검증한다. 부분 실패나 모순이 있으면 완료로 보고하지 말고 중단·보고한다.

거절, 중복, 불필요해짐, 의도적 중단은 `closed / not_planned`로 종료한다. 해당 종료 comment에 `Disposition: rejected`, `Disposition: duplicate`, `Disposition: obsolete`, `Disposition: abandoned` 중 해당 값과 근거를 적고, 중복이면 원본 Issue를 연결한다. 이때 `Done`으로 이동하지 않고 마지막 진행 단계를 보존한다. 닫힌 Issue의 마지막 단계는 현재 활동 중이라는 뜻이 아니다. 기존 `duplicate`, `invalid`, `wontfix` label을 종료 처분의 원본으로 삼지 않는다.

닫힌 Issue를 다시 열어야 하면 사용자 권한 범위를 확인하고 native closure와 실제 재개 단계가 모순되지 않게 처리한다. 기존 종료 comment는 이력으로 보존한다. 자동으로 완료나 재개를 추정하지 않는다.

Project에는 다음 두 native workflow만 활성화한다.

| Workflow | 조건과 동작 |
|---|---|
| `Auto-add to project` | 저장소 `NaruForge/narudoc`, 필터 `is:issue is:open`. 새로 생성되거나 수정되어 조건을 만족하는 Issue를 이 Project에 추가한다. |
| `Item added to project` | Project에 `issue` 또는 `pull request`가 추가되면 `Status = Inbox`를 지정한다. 자동 추가 대상은 위 필터에 따라 Issue로 한정한다. |

이 설정은 2026-09-16 확인한 [WorkNaru-dev Project](https://github.com/users/NaruForge/projects/7/workflows)의 자동화를 기준으로 하되 저장소 대상은 `NaruForge/narudoc`으로 지정했다. 위 표가 NaruDoc의 운영 규약이며 WorkNaru-dev를 다시 읽거나 설정을 지속적으로 동기화할 필요는 없다.

`Auto-add sub-issues to project`, `Auto-archive items`, `Auto-close issue`, `Code changes requested`, `Code review approved`, `Item closed`, `Item reopened`, `Pull request linked to issue`, `Pull request merged`는 비활성화한다. 특히 종료·병합 이벤트만으로 `Done`으로 보내지 않는다. 이후 단계 변경과 종료 처분은 위 검증 규칙에 따라 처리한다. 자동화가 실패하면 중복 상태 원본을 만들지 말고 native 설정과 해당 Issue를 확인한다.

## Architecture Decision Records

다음 중 하나에 해당하는 실제 결정이 기록될 때 ADR을 제안한다.

- 향후 작업의 구조나 인터페이스를 크게 제약한다.
- 의미 있는 대안 사이에서 선택해야 한다.
- 되돌리는 비용이 크다.
- 장래 유지보수자가 선택 이유를 알아야 한다.

일반적인 함수명, 작업 순서, 일시적인 조사 내용, 평범한 구현 상세는 Issue나 일반 문서에 둔다. 중요한 실제 결정을 기록할 필요가 생기기 전에는 `docs/adr/` directory, README, template, placeholder ADR을 만들지 않는다. 설치 자체를 가짜 결정으로 기록하지 않는다.

- 위치: `docs/adr/`.
- 파일명: `NNNN-kebab-case-title.md`.
- 번호: 최초 실제 기록은 `0001`. 이후 기존 번호를 조사하고 다음 미사용 번호를 선택한다. 동시 생성 충돌 시 중단하며 기존 번호를 재사용·재정렬하지 않는다.
- 문서에는 제목, 날짜, `Status` 및 필요한 관련 링크를 둔다.
- Status는 `Proposed`, `Accepted`, `Rejected`, `Superseded` 중 하나다. 해당 ADR만 상태의 원본이다.
- 필수 본문은 `Context`, `Decision`, `Consequences`다. Context에는 배경·제약·대안을, Decision에는 제안 또는 승인된 선택을, Consequences에는 장단점과 후속 영향을 기록한다.

실제 결정 기록 작업의 승인 범위를 확인하고 `Proposed`로 작성한다. 사람의 결정 없이 `Accepted` 또는 `Rejected`를 부여하지 않는다. 수락·거절된 ADR의 의미와 근거를 나중 선택에 맞춰 덮어쓰지 않는다. 선택을 변경하려면 새 ADR을 만들고, 변경 승인을 받은 뒤 이전 ADR을 `Superseded`로 표시하며 양방향 링크를 남긴다.

별도 Decision Log, 수동 ADR 상태 index, Issue label에 ADR 상태를 복제하지 않는다. 파일 목록은 필요할 때 directory를 조회한다. 기존 제품 정의의 원칙을 소급하여 ADR로 옮기거나 승인된 결정으로 재해석하지 않는다.

### 현재 구현의 재평가

이미 구현된 선택도 앞으로 유지할지 검토할 필요가 있으면 ADR로 제안할 수 있다. 제품의 원칙은 제품 문서에 유지하고 ADR의 Context에서는 제약으로 연결한다. Decision에는 구체적인 기술 선택을 유지·변경하려는 현재 제안을 적는다.

- 과거 구현 사실은 실제 Issue·PR·commit으로 연결한다. 당시 이유가 확인되지 않으면 현재의 대안 평가임을 밝히고 과거 판단을 추정하지 않는다.
- 기록일, 근거로 확인한 과거 구현일, 실제 채택일을 구분한다. Proposed의 채택일은 없으며 사람의 결정 전에는 부여하지 않는다.
- 현재 아키텍처는 구현 사실을 설명한다. Proposed ADR은 유지 여부를 검토하는 문서로 연결하며 과거에 승인된 ADR이 있었던 것으로 소급하지 않는다.
- ADR 초안의 작성·병합과 결정 채택은 별개다. 문서화 Issue는 승인된 문서 결과와 검증·검토 조건으로 종료하며, 그 범위에 채택이 명시되지 않았다면 모든 ADR의 Accepted 전환을 요구하지 않는다. 문서 병합만으로 ADR Status를 바꾸지 않는다.

### 설계·PR에서 확인할 사항

설계 착수 시 Issue의 관련 근거에 ADR 필요 여부와 이유를 남긴다. 필요하면 해당 ADR을 연결하고, PR 검토에서도 실제 변경 범위를 기준으로 같은 판단을 확인한다. 일상적인 수정까지 ADR을 만들지는 않는다. Work 양식과 PR 양식은 이 판단의 안내이며 별도 승인이나 상태 원본이 아니다.

문법·ID·공개 API·CLI 응답을 바꾸는 작업은 기존 문서와 소비자에 미치는 호환성 영향, 마이그레이션 필요 여부를 Issue에서 검토한다. 사용자 문서를 묵시적으로 다시 작성하지 않는다. 변경되는 계약과 관련 문서·예제·검증은 같은 PR에서 갱신하고 실제 보장 범위를 명시한다. 실험 단계라는 이유로 영향을 생략하거나 안정성을 새로 보장하지 않는다.

## 적용한 원격 설정과 변경 권한

아래 설정은 별도 승인 후 적용·검증했다. 이후 변경을 허용하는 포괄적 권한은 아니다. 설정을 변경할 때는 대상과 내용을 제시하고 해당 변경의 승인 범위를 확인한다.

| 대상 | 적용한 설정 |
|---|---|
| Project | `NaruForge` 개인 계정 소유의 비공개 `NaruDoc` Project #8. `NaruForge/narudoc` 저장소에만 연결. |
| Board view | `Work items`, board layout, filter `repo:NaruForge/narudoc is:issue`, group by `Status`. |
| Field | `Status` 옵션은 `Inbox`, `Backlog`, `Ready`, `In progress`, `In review`, `Done` 순서. |
| Workflow | 열린 NaruDoc Issue 자동 추가와 추가 항목의 `Inbox` 초기화만 활성화. 세부 조건은 위 표를 따른다. |
| Labels | 아래 4개 추가. 기존 10개 label과 기존 `bug`의 이름·색·설명을 보존. |
| Issue Forms | `.github/ISSUE_TEMPLATE/`의 승인된 파일 4개를 default branch `main`에 게시. [게시 commit](https://github.com/NaruForge/narudoc/commit/0bb7ccd5a546a1e2ebc2a4340fa12706a974e11f). |
| 기타 설정 | 저장소 공개 범위, Issues 활성화, 권한, 보호 규칙, Milestone은 변경하지 않음. |

| 새 label | 색상 | Description |
|---|---|---|
| `idea` | `A371F7` | Proposal awaiting implementation approval |
| `work` | `1D76DB` | Approved work with a verifiable outcome |
| `blocked` | `B60205` | Work cannot proceed; see issue context |
| `needs-triage` | `FBCA04` | Classification or required information needs review |

Idea, Work, Bug 양식의 기본 label은 각각 `idea`, `work`, `bug`와 공통 `needs-triage`다. [양식 선택 화면](https://github.com/NaruForge/narudoc/issues/new/choose)과 각 양식의 실제 입력·기본 label을 읽기 전용으로 확인했다. 자유 입력은 `blank_issues_enabled: true`로 유지한다. `projects`, 자동 담당자, 조직 Issue type 기본값은 설정하지 않는다. 필요한 label이 원격에 없으면 양식의 기본값만으로 생성되지 않으므로, 향후 양식을 변경하거나 게시할 때 label과 설정을 확인한다.

프로젝트 기록 파일과 양식의 커밋·push·PR 병합은 사용자 승인에 따라 수행한다. 이후 커밋·push·게시에는 해당 작업의 승인 범위를 확인한다. 인증·권한 갱신이나 새로운 provider 활성화 역시 provider 선택에 포함되지 않는다.

## 검증, 충돌과 보존

작업 전 실제 프로젝트 루트와 대상 경로를 확인한다. 경로가 루트 밖으로 나가거나 상위 경로의 symlink·junction 때문에 외부에 쓰게 되면 중단한다. 생성 파일·설정·기록은 이 프로젝트 내부에만 두며 전역 Skill, 사용자 홈 또는 공유 경로에 설치하지 않는다.

로컬 변경 후 모든 생성·수정 파일을 다시 읽고 다음을 확인한다.

- Agent 안내에서 이 문서에 도달하고 외부 Blueprint 없이 기록 원본과 절차를 알 수 있다.
- provider가 하나이며 종류·단계·modifier·종료·의존 관계·릴리스·ADR 상태의 소유권이 모순되지 않는다.
- Issue Form의 YAML과 필수 정보가 유효하고 진행 상태 입력이나 중복 tracker가 없다.
- 실제 결정 없는 ADR directory, 예시 Work Item, placeholder, 수동 상태 index, bootstrap runtime 또는 Skill이 없다.
- [Installation Receipt](../.agents/blueprints/establish-project-records.yaml)는 정확히 하나다. 설치에 사용한 canonical 경로의 마지막 변경 40자리 commit과 exact source를 담는다.
- 승인한 파일만 생성·변경했고 기존 파일과 사용자의 작업을 보존했다.

원격 변경이 별도 승인되면 각 변경 묶음 직후 소유권, 공개 범위, Project와 repository 연결, view, `Status` 옵션, label, workflow를 다시 조회한다. 양식 게시가 승인되었다면 실제 `main`의 양식 파일과 기본값도 다시 읽는다. 설정 검증을 위해 Issue·PR·sample item을 만들거나 가짜 lifecycle 전이를 수행하지 않는다. 실제 lifecycle 운영 검증은 최초 실제 작업의 승인 범위에서 수행하며 설정 검증과 구분한다.

인증 실패, 권한 부족, 예상과 다른 소유자, 기존 tracker나 ADR 규약, 중복 상태 원본, 승인 범위 밖 변경, 읽기와 쓰기 사이의 충돌이 발견되면 중단한다. 자동 migration·rename·renumber·normalize·overwrite를 하지 않고 보존·통합·설치 중단 대안을 보고한다. 일부만 적용되면 적용된 범위와 미적용 범위를 명시하고 완료로 보고하지 않는다.

설치 되돌리기는 이번 설치가 만든 파일과 설정만 대상으로 한다. 후속 편집과 기존 사용자 작업을 먼저 확인하며, 원격 객체 삭제나 설정 복원은 별도 승인을 받는다. 이미 사용된 기록을 자동 삭제하지 않는다.

## 설치 당시 확인한 기존 기록

2026-09-16 조사 당시 로컬·원격에 commit이 없었고, 로컬에는 추적되지 않은 `docs/PRODUCT.md`만 있었다. 프로젝트 Agent instruction, Issue form, 로컬 tracker·Issue, ADR·Decision Log는 없었다. 원격 Issue·PR·Milestone·연결된 Project·Actions workflow·조회된 ruleset도 없었다.

기존 label은 `accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`였다. 기존 제품 문서와 label은 보존 대상이다. 이 단락은 설치 당시 조사 근거이며 이후 진행 상태를 관리하는 대장이 아니다.
