# Manhunt Night 릴리스·저장소 운영 안내

> v1.7.5은 **다른 맵에서도 기존 공중 로비를 자동 생성하도록 개선한** 별도 Pre-release 작업입니다. 실제 다른 월드의 실기 QA 전까지 v1.6.0 Stable을 대체하지 않습니다. 이 문서의 v1.6.0 다운로드 링크는 아직 유효한 공식 Stable을 가리킵니다.

> 상태 확인일: **2026-11-15 (KST)**. 이후 변경 여부는 [현재 `main`](https://github.com/geumyi22/Manhunt-Night), [Releases](https://github.com/geumyi22/Manhunt-Night/releases), [Actions](https://github.com/geumyi22/Manhunt-Night/actions)에서 확인합니다.

## 1. 공식 배포 현황

| 버전 | GitHub 배포 상태 | 비고 |
|---|---|---|
| [v1.6.0](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.6.0) | **Stable** | 2~8인 규칙 지원. 실제 2·3인 QA·자동 212개·호스트 TPS/메모리 측정 근거 |
| [v1.5.1](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.5.1) | Pre-release | 과거 문제 재현과 비교를 위한 원본 보존 |
| [v1.5.0](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.5.0) | Pre-release | 이전 개발·QA 기준 보존 |

이 표는 배포·검증 기록이며, 최신 게임 버전/실기 측정 결과를 추정하지 않습니다. v1.6.0은 코드 기준 Stable로 승인되었지만 FPS·게임별 네트워크 측정 및 **8인 실제 경기**는 수행됐다고 주장하지 않습니다. 상세: [최신 QA](QA_REPORT.md), [Stable 점검표](RELEASE_CHECKLIST.md).

## 2. v1.6.0에서 어떤 파일을 받나요?

| 목적 | 파일 |
|---|---|
| **바로 월드에서 플레이** | [`Manhunt_Night_v1.6.0.mcworld`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0.mcworld) |
| **다른 월드에 애드온만 적용** | [`Manhunt_Night_v1.6.0.mcaddon`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0.mcaddon) |
| **게임·소스·QA를 한 번에 보관** | [`Manhunt_Night_v1.6.0_Stable_FullFiles.zip`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0_Stable_FullFiles.zip) |
| **최종 Stable 소스만** | [`Manhunt_Night_Source_v1.6.0_Stable.zip`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_Source_v1.6.0_Stable.zip) |
| **Stable SHA-256 목록** | [`SHA256SUMS_Stable.txt`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/SHA256SUMS_Stable.txt) |
| **전체 ZIP의 해시** | [`Manhunt_Night_v1.6.0_Stable_FullFiles.zip.sha256`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/Manhunt_Night_v1.6.0_Stable_FullFiles.zip.sha256) |
| **Stable QA 상세** | [`QA_REPORT_Stable.md`](https://github.com/geumyi22/Manhunt-Night/releases/download/v1.6.0/QA_REPORT_Stable.md) |

같은 릴리스에 `Manhunt_Night_v1.6.0_FullFiles.zip`도 남아 있습니다. 이는 Stable 최종 문서가 추가되기 전의 **기존 v1.6.0 묶음**이므로, 새로 전체 파일을 보관할 때는 `_Stable_FullFiles.zip`을 권장합니다. 원래의 `.mcworld`·`.mcaddon` 파일은 동일한 검증 대상 게임 배포물로 유지되며, 초기 묶음과 과거 자료도 삭제하지 않습니다.

**설치 주의:** 새 `.mcworld`에 팩이 이미 포함돼 있으므로 `.mcaddon`을 중복 적용하지 마세요. `.mcaddon`을 다른 시드에 사용할 경우 요새 힌트를 끄세요. 기존 플레이 월드를 백업하고 [설치 안내](INSTALL.md)를 따르세요.

## 3. GitHub 소스와 검증의 기준

- **`main`:** 현재 승인된 소스와 최신 문서. 기존 v1.6.0 Stable 배포 파일의 해시를 별도 승인 없이 덮어쓰지 않습니다.
- **작업 브랜치 → PR → CI → 병합:** 코드/문서를 분리하고 변경 목적·영향·검증을 기록합니다. 실제 게임 코드 변경이라면 회귀·타입·패키지 검사와 데이터/월드 보존 검증이 필요합니다.
- **릴리스:** 게임 코드·팩/월드·API 호환성 변경이 있을 때만 새 버전과 QA 근거를 검토합니다. 문서만 변경하는 작업은 릴리스 번호를 올리지 않습니다.
- **테스트 층위:** [Source QA](https://github.com/geumyi22/Manhunt-Night/actions)는 자동 검증입니다. 실제 단일 클라이언트·다중 기기·FPS/TPS/메모리 측정과 구분합니다. 수치와 미검증 항목은 [QA 보고서](QA_REPORT.md)에 근거합니다.
- **과거 기록:** `docs/history/`와 `docs/qa/`의 원본·측정 표본·해시는 작업 이력 및 증거입니다. 기계적 정리나 파일 수 축소를 이유로 삭제·이름 변경·재작성하지 않습니다.

## 4. 작업 브랜치·이슈 정리 원칙

2026-11-15 기준 `main` 외에는 기존 작업 이력이 남은 브랜치 **9개**가 있습니다. 관련 PR의 병합은 확인됐으나, 이력·복구에 사용할 수 있도록 **브랜치 삭제·강제 푸시·히스토리 변경을 수행하지 않았습니다**. 필요하면 복구 참조를 확정하고 명시적 승인 아래 정리합니다.

이전 QA [Issue #3](https://github.com/geumyi22/Manhunt-Night/issues/3)은 Stable 출시 기록으로 닫혔습니다. 향후 재현 가능한 새 버그는 새 Issue로 관리하고, 검증을 끝낸 기존 항목을 증거 없이 다시 실패로 바꾸지 않습니다. 제보 형식은 [버그 양식](https://github.com/geumyi22/Manhunt-Night/issues/new/choose)을 사용합니다.

## 5. 남아 있는 명시적 제한

- **확인됨:** v1.6.0 실제 2·3인 게임 흐름·사용자 보고·일부 TPS/호스트 메모리 수치. 확인된 범위는 각 QA 보고서에 기재합니다.
- **미측정/미검증:** 실제 8인 상한, FPS, 게임별 네트워크, 일부 조건부 실패 복구 및 모든 시드에서의 네더 요새 안내.
- **외부 리소스:** 바닐라 나침반 이미지 출처·Mojang 저작권 고지 및 MIT 예외는 [리소스 고지](../RP/NOTICE.md)를 유지합니다.

후속 기능을 추가하려면 현재 릴리스의 정상 동작을 기준으로, 최소 변경·기능별 회귀 테스트·롤백을 우선합니다.
