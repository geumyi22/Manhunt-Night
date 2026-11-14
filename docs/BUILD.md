# 배포 파일 재현

Node.js 22 이상에서 저장소 루트로 이동해 실행합니다. 개발 의존성은 고정 버전과 `package-lock.json`으로 설치합니다. 게임에서 실행되는 팩에는 Node.js나 개발 의존성이 포함되지 않습니다.

```text
npm ci --ignore-scripts
npx tsc --noEmit
node --test tests/*.test.js
node tools/verify.mjs --source
node tools/build.mjs --base "기반 월드 디렉터리 또는 .mcworld 경로"
node tools/verify.mjs
```

`MANHUNT_BASE_WORLD` 환경 변수로 기반 월드를 지정할 수도 있습니다. 기반 월드는 읽기만 하며, 모든 결과는 저장소의 `dist/`에 생성합니다. 소스 이력과 기존 릴리스·게임 설치 월드는 변경하지 않습니다. 디렉터리는 `level.dat`와 `db/`가 바로 들어 있는 월드 폴더를 지정합니다. `.mcworld`도 같은 루트 구조를 가져야 합니다.

## 기반 지형의 출처와 변경 범위

이번 빌드는 앞선 작업에서 보관한 사용자 제공 **MANHUNT 원본 지형**을 사용합니다. 현재 GitHub에는 v1.4.0 소스와 QA 문서가 있었지만 다운로드 가능한 v1.4.0 월드 릴리스는 없었습니다. 따라서 **v1.4.0 배포 월드와 바이트 단위로 비교했다고 주장하지 않습니다.** 대신 실제로 사용한 보관본의 모든 DB 파일을 SHA-256으로 기록하고 출력 월드에서 같은지 검증합니다. v1.4.0 QA 문서의 과거 비교 주장과 이번에 직접 확인한 사실은 구분합니다.

원본 메타데이터는 리스폰 반경 128·명령 블록·실험 기능 스위치가 켜져 있었습니다. 새 배포 사본에서는 기존 Manhunt 빌드 정책을 적용해 반경 0, 명령 블록 OFF, 모험 모드 시작, 즉시 부활, 친구 초대와 필수 리소스 팩을 설정합니다. 실제 실험 스위치는 OFF이며 사용 이력 플래그는 보존합니다. 월드 이름은 v1.5.1으로 구분합니다. **시드·기존 지형 DB·그 외 메타데이터는 유지**하며, 변경 필드 전체는 `BUILD_MANIFEST.json`에 기록합니다. 원본 파일에는 쓰지 않습니다.

`.mcworld`에는 현재 저장소의 행동·리소스 팩이 포함됩니다. 다른 팩을 통째로 재배포하지 않습니다. 별도 `.mcaddon`은 같은 BP/RP를 두 `.mcpack`으로 담습니다. 요새 좌표와 도착 영역은 제공 월드의 기반 시드에 맞춘 고정 데이터이며, 빌드 과정에서 다른 기반 시드의 요새를 다시 탐색하지 않습니다. **다른 시드로 빌드하거나 다른 월드에 애드온을 적용할 때는 요새 힌트를 OFF로 설정해야 합니다.** 구체적인 설정 위치는 설치 가이드와 기능 설명서를 참고하세요.

## 결과와 무결성

- `Manhunt_Night_v1.5.1.mcworld`
- `Manhunt_Night_v1.5.1.mcaddon`
- `Manhunt_Night_Source_v1.5.1.zip`
- `Manhunt_Night_v1.5.1_FullFiles.zip`
- `README.md`, `INSTALL.md`, `FEATURES.md`, `CHANGELOG.md`, `QA_REPORT.md`, `LICENSE`
- `BUILD_MANIFEST.json`, `PACKAGE_CHECKS.json`, `SHA256SUMS.txt`
- 전체 ZIP 자체의 해시는 `Manhunt_Night_v1.5.1_FullFiles.zip.sha256`

전체 ZIP 안의 `SHA256SUMS.txt`는 안에 들어 있는 각 배포 파일을 검증합니다. ZIP이 자기 자신의 해시를 포함할 수 없으므로 전체 ZIP 해시는 별도 파일로 제공합니다. `node tools/verify.mjs`는 내부 CRC, ZIP 경로 안전성, 필수 파일, 동일한 팩 내용, 원본 DB 해시, 버전·UUID·정식 API 의존성, 아이템 텍스처와 32개 나침반 프레임, 부활 토템 조합, 일반/어려운 재료 분리, QA 시험 코드 미포함을 확인합니다.

소스 ZIP은 BP/RP·테스트·문서·빌드 도구·의존성 잠금 파일을 포함하고, `node_modules`, Git 메타데이터, 로컬 개인 월드, 배포 폴더를 포함하지 않습니다. ZIP은 기본 ZIP 포맷으로 작성하고 ZIP64·암호화·분할 압축은 지원하지 않습니다. 기반 입력의 압축 해제 크기 상한은 1 GiB입니다.

## GitHub Actions

GitHub에서 개인 월드 파일 없이 다음 명령으로 애드온·소스와 문서를 검사하고 아티팩트를 만듭니다.

```text
node tools/build.mjs --addon-only
node tools/verify.mjs --addon-only
```

Actions 통과는 실제 게임 실행 또는 멀티플레이 통과를 의미하지 않습니다. 실제 클라이언트 핵심 기능과 회귀 검증이 완료되기 전까지 배포는 Pre-release로 관리합니다. 무결성 결과와 최종 실행 상태는 `QA_REPORT.md`를 함께 확인하세요.
