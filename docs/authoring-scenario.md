# 기술 문서 편집 시나리오

공개 가상 설계서 [engineering.narudoc](../examples/engineering.narudoc)를 복사하여 다음 수정 요청을 CLI만으로 수행한다. 420 V는 제품 설계 권고가 아닌 시나리오용 값이다.

> 목표 전압을 400 V에서 420 V로 바꾸고, REQ-001의 status를 reviewed로 바꾼다. 검증 절이 제어 절보다 먼저 나오도록 순서를 바꾸되, 상호 참조와 무관한 원문은 유지한다. 검증한 문서를 HTML로 출력한다.

## 재현

Node.js 22 이상, 저장소에 고정된 pnpm, Git이 필요하다. 저장소 루트에서 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/verify-authoring.mjs
```

성공하면 `PASS`와 결과 디렉터리를 출력한다. 매번 저장소 내부 `.narudoc-scenarios/authoring-*`에 새 복사본을 만들므로 기존 예제와 이전 결과를 덮어쓰지 않는다. 생성물은 Git 추적에서 제외한다. 실패하면 프로세스가 실패하고, 실행된 CLI 응답은 `commands.json`에 남는다.

| 결과물 | 확인할 내용 |
| --- | --- |
| `before.narudoc` | 입력 원본 bytes |
| `engineering.narudoc` | 편집된 문서 |
| `engineering.html` | CLI가 생성한 HTML |
| `changes.diff` | Git이 생성한 실제 변경 diff |
| `commands.json` | CLI 인자, 종료 코드, stdout, stderr |

## 확인하는 사용자 흐름

1. `inspect`, `outline`, `get`으로 문서와 수정 대상을 확인한다.
2. 조회한 revision으로 문단 변경을 dry-run한 뒤 저장한다. 예상 결과와 실제 파일 전체 bytes, preview와 저장의 edit·revision 일치를 확인한다.
3. 편집 전 revision을 사용한 속성 변경이 `NARU_STALE` / 종료 코드 4로 거부되고 원본이 보존되는지 확인한다. 새 snapshot과 요구사항을 다시 읽은 뒤 같은 수정 의도를 적용한다.
4. requirement 속성 변경과 동급 섹션 이동에도 같은 dry-run·저장·validation 과정을 적용한다. 이동한 절 전체의 원문과 최종 순서를 확인한다.
5. 같은 속성 값을 다시 지정하는 no-op의 파일 불변을 확인한다.
6. HTML의 수정된 값, 절 순서와 참조 대상·링크를 검사하고 Git diff를 저장한다.

## 사용하면서 드러나는 제약

- 문단은 안정 ID 대신 섹션의 직접 자식 문단 index로 선택한다. 자연어 요청을 그대로 명령에 넣을 수 없고, 조회 결과에서 대상을 확인해야 한다.
- 여러 변경을 한 번에 저장하는 transaction은 없다. 각 명령 뒤 revision을 새로 조회하며, 중간 실패 시 앞서 성공한 변경은 남는다. 이 시나리오도 개별 명령의 보존만 검증한다.
- `reviewed`는 generic directive에 저장하는 문자열이다. 요구사항 검토 승인이나 허용된 상태 전이를 엔진이 판단하지 않는다.
- 섹션 이동은 같은 부모의 같은 level 사이에서만 지원한다. 이 시나리오의 두 절은 그 조건을 만족한다.
- 충돌 시 자동 재시도하지 않는다. 여기서는 통제된 문단 변경 후에도 속성 수정 의도가 유효함을 확인하고 진행한다. 일반 자동화는 재조회 후 변경 의도를 다시 판단해야 한다.

이 스크립트는 현재 [CLI 계약](cli.md)의 사용 예이자 회귀 검증이다. HTML 문자열을 검사하며 브라우저의 시각적 배치, 비협조적 외부 writer와의 완전한 동시성, 전원 장애 내구성을 검증하지 않는다. 개행·BOM 조합과 다른 오류 경로는 기존 acceptance test의 범위다. 실제 실행 결과와 후속 판단은 [Issue #7](https://github.com/NaruForge/narudoc/issues/7)과 연결 PR에 기록한다.
