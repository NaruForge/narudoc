# 0013. Figure annotation과 문서 폴더 자산 경계

Date: 2026-09-17

Status: Proposed

관련 작업: [Issue #37](https://github.com/NaruForge/narudoc/issues/37).

## Context

Figure는 문서 근처의 기존 이미지를 참조해야 하지만, 엔진(model/parser/core/renderer-html)은 filesystem/network를 읽지 않는다. 임의 경로 읽기, 문서 폴더 탈출, 위장 파일은 로컬 편집기의 파일 접근 경계를 넓히는 결정이다. Generic directive의 `name=figure`를 재해석하면 기존 generic 의미와 충돌하고, 원격 URL/업로드는 첫 범위를 넘는다.

## Decision

`@figure id=".." src=".." alt=".." caption=".."` 한 줄 annotation을 독립 Figure 블록으로 파싱한다. `@table`과 같은 JSON quoted 속성 문법을 공유하되 뒤따르는 본문 블록은 없다. 번호·caption·`[@id]` 참조·rename은 ADR 0012의 공통 resolver를 Table과 별도 1-based 계열로 확장하며 Figure 전용 참조 엔진을 만들지 않는다.

자산 root는 실행 시 지정된 `.narudoc`의 실제 부모 디렉터리 하나다. Source에는 `/` 구분의 상대 경로만 저장하고 절대/drive/UNC/`..`/빈 segment를 거부한다. 실제 파일 검사는 CLI·웹이 공유하는 file-store의 resolver가 수행한다: 각 segment를 lstat으로 내려가며 symlink/junction과 hardlink(nlink>1)를 거부하고, magic bytes·최소 컨테이너 구조·치수를 sniff하여 확장자와 대조한다. PNG/JPEG/WebP만 지원한다. 제한값은 파일당 10 MiB, 문서당 64 MiB, Figure 100개, 16384px다. 검사→읽기 사이를 재검사하지만 race-free sandbox나 외부 이미지 bytes의 불변성은 보장하지 않는다.

자원 진단은 문서 validation 오류가 아니라 호스트 resource diagnostic이다. 그래서 누락 asset 문서도 읽기·복구 편집이 가능하고 placeholder로 표시된다. 단 저장·export는 결과 문서의 자원 검증 실패 시 아무것도 쓰지 않는다. Renderer는 호스트가 만든 URL mapping만 사용한다. 웹은 경로 대신 세션 token으로 HMAC된 opaque asset URL을 현재 문서의 figure에 한해 제공하며, 이 URL은 원문이나 export HTML에 저장하지 않는다. Export는 linked-assets(상대 경로)만 지원한다.

## Consequences

Block union에 Figure가 추가되므로 소비자는 재파싱과 figure 분기가 필요하다. 기존 literal `@figure` 텍스트의 해석이 바뀔 수 있으며 자동 migration은 없다. 문서 이동성은 문서 폴더 기준 상대 경로로 확보된다. SVG·원격·data URL·업로드·파일 복사/삭제·편집 도구는 계속 비목표다. Junction/symlink의 보수적 거부는 정상 사용자의 링크 구성도 막을 수 있으며, 완화에는 별도 근거와 테스트가 필요하다. 이 제안의 구현/병합은 ADR 채택을 뜻하지 않는다.
