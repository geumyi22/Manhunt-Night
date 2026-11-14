# Manhunt Night v1.6.0

> 2026-11-14 Stable 배포 승인: 친구들과 확인한 실제 2·3인 QA와 자동 검사·성능 기록을 반영했습니다. 정식 경기 2~8명, 1인 연습·기존 저장 형식은 유지합니다. 확인 범위와 알려진 제한은 [QA 보고서](docs/QA_REPORT.md)에 있습니다.

Minecraft Bedrock 26.62 기준 · 러너 1명 vs 헌터 1~7명 · 1인 연습 지원.
**v1.6.0 Stable**: 사용자와 친구들의 직접 QA, 실제 2·3인 게임 흐름, 212개 자동 회귀와 TPS·호스트 메모리 측정을 근거로 배포합니다. FPS·게임별 네트워크 수치와 실제 8인 규모는 미확인 범위로 공개합니다.

## 현재 배포 및 개발 상태 (2026-11-15 확인)

- **Stable 배포:** [v1.6.0 릴리스](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.6.0)의 [Stable 전체 ZIP](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0_Stable_FullFiles.zip)을 권장합니다. `.mcworld`·`.mcaddon`·현재 소스·설치 안내·QA·SHA-256을 함께 제공합니다. 게임만 가져오려면 [v1.6.0 월드](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0.mcworld)를 사용하세요.
- **동일한 게임 파일:** Stable은 검증된 기존 v1.6.0 게임 코드의 배포 상태를 전환합니다. 기존 태그와 자산을 덮어쓰지 않고, 최신 문서·소스는 이름에 `Stable`이 있는 추가 묶음으로 제공합니다. 게시 상태와 최종 자산은 릴리스 페이지에서 확인할 수 있습니다.
- **기존 배포 보존:** [v1.5.1](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.5.1)과 이전 월드·애드온·기록은 그대로 유지합니다.
- **자동 검증:** 기존 204개를 포함한 **212/212 통과**. 2인 승패·재접속, 8인 개별 추적기 지급·소집 경계를 포함합니다. 실제 기기 결과와 [GitHub Actions](https://github.com/geumyi22/Manhunt-Night/actions)는 [QA 보고서](docs/QA_REPORT.md)에서 구분합니다.
- **QA 기록:** [Issue #3](https://github.com/geumyi22/Manhunt-Night/issues/3)에 직접 플레이 확인·실측·CI와 출시 판단을 보존합니다. 확인된 게임 흐름을 반복 시험하도록 요구하지 않으며, 추가 인원·측정 및 개별 상황은 알려진 제한으로 구분합니다.
- **버그 제보:** [Issues](https://github.com/geumyi22/Manhunt-Night/issues)에서 재현 조건·베드락 버전·영상/Content Log를 함께 기록해 주세요. 개인 정보나 토큰은 첨부하지 마세요.

## 다운로드 파일 선택

| 목적 | 다운로드 | 참고 |
|---|---|---|
| Minecraft에 월드만 가져오기 | [v1.6.0 .mcworld](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0.mcworld) | Behavior/Resource Pack 내장. 별도 애드온 중복 적용 금지 |
| 다른 월드에 애드온 적용 | [v1.6.0 .mcaddon](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0.mcaddon) | 반드시 대상 월드 백업. 다른 시드에서는 요새 힌트 OFF |
| **Stable 전체 보관/배포** | [v1.6.0 Stable FullFiles ZIP](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0_Stable_FullFiles.zip) | 월드·애드온·소스·Stable QA/문서·검증 자료 통합본 |
| Stable 소스만 | [v1.6.0 Stable Source ZIP](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_Source_v1.6.0_Stable.zip) | 개발·검토용 |
| 배포 파일 무결성 확인 | [Stable SHA256SUMS](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/SHA256SUMS_Stable.txt) | 전체 ZIP 자체의 외부 .sha256도 확인 |

같은 v1.6.0 릴리스에 남아 있는 `..._FullFiles.zip`(초기 배포 스냅샷)과 `..._Stable_FullFiles.zip`(최종 Stable 문서 포함)은 구분해 주세요. 게임용 `.mcworld`·`.mcaddon`은 기존에 검증한 파일을 그대로 보존합니다. 상세한 선택 기준과 유지보수 정책은 [릴리스·저장소 안내](docs/RELEASE_GUIDE.md)를 참고하세요.

## 설치와 시작

1. `Manhunt_Night_v1.6.0.mcworld`를 열어 가져옵니다. 필요한 두 팩이 포함되어 있습니다.
2. 월드를 열어 친구를 초대하고 `/mh:menu`에서 러너 선택, 게임 설정, 경기 시작을 누릅니다.
3. 새 월드는 5초 카운트다운 → 러너 출발·경기 시간 시작 → 기본 60초 도주 유예 후 헌터 출발입니다.
4. 헌터에게 20분에 제작법 공개, 순서대로 재료를 버려 팀 공동 제작합니다. 미완성이면 40분에 헌터별 추적기 1개 지급. `/mh:trackerrecipe`, `/mh:craft`를 사용합니다.

기존 월드는 삭제하지 않습니다. `.mcaddon`은 다른 월드용입니다. 이미 팩이 포함된 새 `.mcworld`에는 중복 적용하지 마세요. 기존 저장 설정은 이관하며 새 기본값과 다를 수 있습니다.

## v1.6.0 변경

- 정식 경기는 2~8명(러너 1명·헌터 1~7명), 혼자 있을 때는 기존 1인 연습을 사용합니다.
- 2인 경기의 헌터는 팀 공동 제작을 혼자 진행합니다. 다른 헌터가 없으면 소집서는 소비되지 않습니다.
- 8명은 게임 규칙의 상한입니다. 실제 8인 성능·HUD 가독성은 미검증이며, 서버/월드의 접속 정원도 따로 충족해야 합니다.
- 20/40분·제작 재료·부활·쿨다운·진행 중 참가자 명단과 저장 형식은 그대로입니다. 기존 v1.5.1 배포는 보존합니다.

## 기존 주요 기능

아래 기능은 v1.5.0~v1.5.1에서 도입·수정되어 **v1.6.0 Stable에도 유지**됩니다. 자세한 과거 변경 내역은 [변경 기록](docs/CHANGELOG.md)을 참고하세요.

- 32방향 러너 추적기: 각 소유자의 시선 기준으로 빨간 바늘 회전. 같은 차원 실시간, 다른 차원은 마지막 위치로 구분.
- 27종 후보에서 일반 7종·어려움 2종을 중복 없이 뽑는 팀 공동 투척 제작. 지급 기록·보류 거래·중복 방지.
- 러너 접근 경고 90/60/40/10블록, 야생 부활 기본 2회, 부활 토템으로 기본 누적 최대 3회.
- 헌터 소집서: 같은 차원 팀원을 안전한 위치로 소집, 러너 350블록 이내 금지, 기본 팀 공용 5분/경기 2회.
- 기존 5개 설정 카테고리와 로비, 수신기, 요새 힌트, 경계, 전적, 명령어 보존.

나침반은 **공식 원본 나침반의 32프레임 픽셀을 그대로 사용**합니다. 플레이어별 목표 방향에 맞춰 프레임을 교체하므로 바닐라 내부의 흔들림·보간 동작까지 동일하지는 않습니다. 원본 이미지의 저작권·EULA는 `RP/NOTICE.md`에 별도 표기하며 MIT 적용 대상이 아닙니다. 기본 종이·토템은 게임 리소스 경로를 참조합니다.

## 문서

- [릴리스 파일 선택·저장소 운영](docs/RELEASE_GUIDE.md)
- [설치·업데이트](docs/INSTALL.md)
- [기능·설정·명령어](docs/FEATURES.md)
- [변경 기록](docs/CHANGELOG.md)
- [QA와 미검증 범위](docs/QA_REPORT.md)
- [친구들과 확인할 항목](docs/FRIENDS_TEST.md)
- [API·재료 27종·라이선스 근거](docs/API_RESEARCH_v1.5.md)
- [소집 안전성](docs/SUMMON_DESIGN.md)
- [재현 가능한 빌드](docs/BUILD.md)

## 개발 검사

Node.js 22 이상에서 `npm ci`, `npm run typecheck`, `npm test`, `node tools/verify.mjs --source`.
배포 생성: `node tools/build.mjs --base <보존한 원본 월드 폴더 또는 mcworld>`.
원본 월드는 읽기만 하며 결과는 `dist/`에 생성됩니다. SHA-256과 패키지 검증 결과를 함께 제공합니다.

**개발 이력:** v1.4.0 소스에서 v1.5.0을 개발하고 v1.5.1을 병합했습니다. 새 배포 월드의 지형은 별도로 보존된 사용자 제공 MANHUNT 원본을 바탕으로 구성했습니다. v1.4.0 배포 월드 바이너리와 동일하다는 의미는 아닙니다.
