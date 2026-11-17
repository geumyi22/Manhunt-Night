# v1.7.5 네더 요새 자동 발견 — 설계와 제약

## 목표

다른 시드에서도 호스트가 항상 좌표를 입력하지 않아도, 플레이어가 실제로 네더를 탐험하는 동안 **요새로 추정할 근거가 확보된 위치**를 저장해 러너의 기존 40분/헌터 선진입 힌트로 활용합니다. 멀리 존재하는 미탐험 요새의 위치를 계산하는 것과는 다른 기능입니다.

## 사용하는 안정적인 신호

1. 정식 `world.afterEvents.entitySpawn` 이벤트에서 엔티티가 **`minecraft:wither_skeleton`**, 차원은 네더, `cause === 'Spawned'`인지 확인합니다. `Spawned`는 문서상 자연 스폰 초기화 원인입니다.
2. 같은 차원의 현재 경기 참가자가 수평 96블록·높이 64블록 이내여야 합니다.
3. 이벤트 주변 7×7×3 범위의 로드된 블록에서 `minecraft:nether_brick`·계단·울타리 등 8개 이상 확인해야 합니다. 청크/블록을 읽을 수 없으면 기록하지 않습니다.
4. 만족하면 해당 몹 위치의 네더 X/Z를 **추정 후보**로 기록하고 중복 범위 96블록 이내를 걸러 최대 8개를 영구 저장합니다.
5. 러너에게는 기존 40분 경과/헌터 선진입 힌트 조건이 충족될 때만 공개합니다. 수동 등록한 좌표는 자동 후보보다 우선합니다.

이 조건은 일반 자연 생성 네더 요새 탐험에서 오탐 위험을 낮추지만 **구조물 생성 ID를 확인한 것이 아니며 절대적인 판정이 아닙니다.** 모드 팩·사용자 제작 건축물·스폰 이벤트 조작 등으로 잘못 탐지할 수 있습니다. 자연 스폰이 발생하지 않거나 몹 생성이 꺼져 있으면 감지가 실패할 수 있습니다. 구조물 중앙이 아니라 근처에 자연 스폰된 몹의 위치라는 점도 중요합니다.

## 왜 정확한 미탐험 요새 자동 탐색은 아닌가?

- [Dimension.getGeneratedStructures](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable)는 지정 위치에서 생성 구조물이 존재하는지 확인하는 **Pre-release API**입니다. 미탐험 요새의 좌표 목록을 반환하는 안정적 검색 API가 아닙니다.
- [Dimension.runCommand](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable)의 `/locate structure fortress` 반환값은 [CommandResult.successCount](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/commandresult?view=minecraft-bedrock-stable) 등 성공 여부만 제공하고 좌표를 반환하지 않습니다.
- [EntitySpawnAfterEvent.cause](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityspawnafterevent?view=minecraft-bedrock-stable)와 [EntityInitializationCause.Spawned](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityinitializationcause?view=minecraft-bedrock-stable)는 정식 API에 존재합니다.
- [네더 요새 구조 및 몹 생성 특성](https://minecraft.wiki/w/Nether_Fortress)은 위더 스켈레톤·네더 벽돌을 탐지 단서로 이용하는 이유를 설명합니다.

## 데이터·성능·보안

- 탐지 실패가 기존 저장 상태·라운드·게임 재생에 영향을 주지 않게 하고, 추가된 후보는 `s.autoFortresses`로 저장합니다. 게임 종료 후에도 유지됩니다.
- `fortressAuto` 기본 ON, 비활성화 시 이미 저장된 자동 후보도 힌트/도착 판정에 사용하지 않습니다. 수동 좌표는 별도입니다.
- 자연 스폰 위더 스켈레톤이 아닌 이벤트에서는 블록을 읽지 않습니다. 맞는 신호에 한해 최대 147개 블록을 검사하며 8개를 찾으면 즉시 중단합니다.
- 자동 탐지 사실이나 위치를 헌터 화면에 노출하지 않고, 러너가 기존 안내 조건에 도달했을 때만 전송합니다.
- 모의 Bedrock 검사와 실제 Minecraft 실기 결과는 구분합니다. 실제 동작·성능·예외 상황은 [QA 기록](QA_REPORT.md), [Issue #12](https://github.com/geumyi22/Manhunt-Night/issues/12)에서 관리합니다.
