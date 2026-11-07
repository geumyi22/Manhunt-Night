# 정식 Script API 조사 기록 — v1.5.0 기준 및 v1.5.1 보완

조사일: 2026-11-08. 코드·선언 확인 기준: `@minecraft/server` 2.11.0의 공식 npm 타입 선언과 Microsoft Learn stable 문서. 1~6절은 v1.5.0 개발 당시 조사·검증 기록입니다. **현재 v1.5.1은 7절의 보완 사항에 따라 Mojang 원본 나침반 픽셀을 사용합니다.** 과거의 자체 아이콘 정책을 현재 배포 정책으로 읽으면 안 됩니다. API 문서 확인과 실제 클라이언트 검증은 별개이며, 실기기 관찰은 해당 문단과 최종 QA 보고서에 구분합니다.

## 1. 아이템 투척: 가능한 것과 보장할 수 없는 것

정식 API에 `world.afterEvents.entityItemDrop`가 있습니다. 이벤트의 `entity`는 아이템을 떨어뜨린 엔티티, `items`는 실제로 떨어진 아이템 엔티티 배열입니다. 따라서 가까운 플레이어를 추측하지 않고 투척 주체와 아이템을 연결할 수 있습니다. 다만 사망 시 떨어진 아이템도 고려해야 하므로 참가 헌터, 살아 있는 상태, 체력 양수, 명시적 제작 모드를 함께 확인합니다. [공식 이벤트 문서](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityitemdropafterevent?view=minecraft-bedrock-stable)

```ts
class EntityItemDropAfterEvent {
  readonly entity: Entity;
  readonly items: Entity[];
}
world.afterEvents.entityItemDrop.subscribe(callback, options?);
```

조사한 정식 API에는 이에 대응하는 취소 가능한 before-drop 이벤트가 없습니다. `EntityItemComponent.itemStack`도 읽기 전용입니다. 엔티티의 수량을 직접 고쳐 초과분을 남기는 동작을 안정적이라고 가정하지 않습니다. [이벤트 구독](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityitemdropaftereventsignal?view=minecraft-bedrock-stable), [아이템 엔티티 컴포넌트](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityitemcomponent?view=minecraft-bedrock-stable)

구현은 다음 조건을 모두 만족할 때만 해당 엔티티 전체를 소비합니다.

1. 헌터가 `/mh:craft`로 제작 모드를 켰고 공개 시간이 지났습니다.
2. `entitySpawn`에서 관찰한 새 아이템이며, 관찰 후 2틱 이내입니다.
3. 관찰 당시와 현재의 아이템 종류·수량이 같습니다. 합쳐짐·나뉨·기존 바닥 아이템은 거절합니다.
4. 이름, 설명, 동적 속성, 인챈트가 없는 일반 재료입니다.
5. 현재 단계의 종류가 맞고, 수량은 남은 요구 수량 이하입니다.
6. 같은 엔티티 ID가 이미 처리되지 않았고 미완료 거래가 없습니다.

초과 수량·잘못된 순서·검증 불가능한 투척은 그대로 바닥에 둡니다. 작은 수량으로 나누어 버리는 것은 누적됩니다. 제작 모드 밖의 일반 투척에는 손대지 않습니다. 다른 헌터가 이어서 다음 재료를 제공할 수 있으며, 모든 콜백은 공유 진행 상태를 순서대로 처리합니다.

**실제 관찰:** 2026-11-08 Bedrock 26.63 단일 클라이언트의 Q키 투척에서 `entitySpawn` 뒤 같은 틱에 `entityItemDrop`이 발생했고, 실제 플레이어와 해당 아이템 ID가 연결되는 것을 확인했습니다. 최초 소비 시 `TypeError: value is not iterable`이 발생해 네이티브 이벤트 컬렉션을 `for...of` 대신 길이·인덱스로 읽도록 수정했습니다. `map`·인덱스 접근이 가능하지만 iterator가 없는 모의 컬렉션 회귀 검사를 추가했으며, 수정 후 실제 Q 투척으로 부분 수량과 9단계 완료·지급을 재확인했습니다. 묶음 투척, 즉시 합쳐짐, 사망 시 순서와 멀티플레이는 이 관찰만으로 확정하지 않습니다. [월드 after 이벤트 목록](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/worldafterevents?view=minecraft-bedrock-stable)

## 2. 저장·복제 방지와 중단 복구

팀 상태는 기존 월드 저장 상태의 `trackerCraft`에 저장합니다. 제작법, 단계, 현재 단계 누적 수량, 완료 사유, 지급받은 이름, 처리한 엔티티 ID, 미완료 거래가 포함됩니다. 제작 모드는 메모리에만 두고 일시정지·종료·사망·퇴장·재실행 때 해제합니다.

소비 순서: **거래 준비 저장 → 정확한 아이템 엔티티 제거 → 단계 변경 및 처리 ID 저장**. 지급 순서: **빈 칸 확인 → 지급 준비 저장 → 빈 칸에 아이템 쓰기 → 해당 플레이어 지급 완료 저장**. 준비 저장이 실패하면 아이템을 건드리지 않습니다. 결과 저장이나 엔티티/인벤토리 변경 결과가 불확실하면 `pending`을 유지하고 제작·자동 지급을 모두 중단합니다.

Bedrock의 아이템 엔티티, 플레이어 인벤토리와 월드 동적 속성을 하나의 원자적 디스크 트랜잭션으로 묶는 정식 API는 확인되지 않았습니다. 따라서 전원 차단이나 저장 중 강제 종료까지 완전한 exactly-once를 보장한다고 주장하지 않습니다. 재시작 후 엔티티를 찾지 못했다는 이유로 소비되었다고 추정하지도 않습니다. 청크가 언로드되었을 수 있기 때문입니다.

호스트가 실제 결과를 확인한 뒤 `resolvePending(host, confirmed)`로 기록을 확정할 수 있습니다. 자동 복제·환불은 하지 않습니다. 관리자 확인 전에는 불확실한 지급을 반복하지 않습니다. 이 복구 경로도 실제 월드 강제 종료 시나리오를 추가 확인해야 합니다.

직접 제작과 40분 자동 지급은 `completion` 한 필드의 `crafted` 또는 `auto` 값으로 구분하며 동시에 성립하지 않습니다. 인벤토리가 꽉 찬 경우 빈 칸을 기다리고, 미접속 헌터는 재접속 후 지급합니다. 지급 기록이 있는 사람은 기본 설정에서 분실·사망해도 자동 재지급하지 않습니다.

## 3. 나침반 바늘 지원 범위

조사한 정식 `ItemComponentTypes`와 2.11.0 선언에는 바닐라 나침반의 자석석 목표 또는 임의 플레이어 목표를 설정하는 컴포넌트/메서드가 없습니다. 일반 나침반 아이콘을 지정하는 것만으로 러너 방향 회전이 생기지 않습니다. 따라서 정식 API로 바닐라 내부 회전과 동일하게 구현했다고 표시하면 안 됩니다. [공식 컴포넌트 목록](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemcomponenttypes?view=minecraft-bedrock-stable), [아이콘 컴포넌트](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_icon?view=minecraft-bedrock-stable)

안정적인 대안은 러너 위치와 각 헌터 시선의 상대 방위각을 계산하고 32방향의 나침반 스타일 아이템 프레임을 헌터별로 선택하는 방식입니다. 32방향 양자화의 최대 방위 오차는 5.625도입니다. 기존 8방향의 22.5도보다 세분화되지만 연속 회전이나 엔진의 나침반 흔들림과는 시각적 차이가 남습니다. 플레이어별 아이템을 갱신하므로 다른 헌터와 상태를 공유해서는 안 됩니다. 차원이 다르면 해당 차원의 마지막 확인 위치만 표시하며, 실제 현재 러너 좌표와 혼동되는 변환은 하지 않습니다.

## 4. 이미지·라이선스·손그림 — v1.5.0 당시 결정

공식 Bedrock samples의 이미지 라이선스는 npm API 타입 선언의 MIT 라이선스와 다릅니다. 저장소의 `LICENSE.md`는 Mojang 권리와 Minecraft EULA 적용을 명시합니다. v1.5.0에서는 나침반 PNG를 자체 제작하고, 종이·토템은 게임에 포함된 텍스처 경로를 참조했습니다. v1.5.1에서는 나침반만 원본 픽셀로 교체했으며, 이를 프로젝트 독자 이미지나 MIT 이미지로 표시하지 않습니다. 현재의 출처·라이선스 분리는 7절을 따릅니다. [Mojang samples 라이선스](https://raw.githubusercontent.com/Mojang/bedrock-samples/main/LICENSE.md), [공식 아이템 텍스처 매핑](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/textures/item_texture.json)

기본 종이·토템 등의 내장 텍스처 경로를 참조하면 원본 이미지 파일을 별도로 배포하지 않을 수 있습니다. 실제 커스텀 아이템에서의 크기·표시 상태는 클라이언트 QA 대상입니다. 나침반은 별도 32개 원본 프레임이 아니라 `compass_atlas` 등으로 관리되므로, 단순한 파일 경로 변경을 바닐라 동작의 재현으로 간주하지 않습니다.

이번 요청에 손그림 원본 이미지가 첨부되었다는 근거는 확인되지 않았습니다. 따라서 직접 그림을 열어 검토했다고 주장하지 않습니다. 요청서에 적힌 나침반·동심원·토템과 네더라이트 8개·종이라는 시각 설명을 참고합니다.

## 5. 무작위 재료 27종

코드의 단일 원천은 `BP/scripts/tracker-crafting.js`가 내보내는 `MATERIALS`입니다. 각 항목은 `id`, 한국어 `name`, 기본 `amount`, 획득 `method`, 어려운 후보 여부 `hard`를 갖습니다. 21개 일반 후보에서 7종, 6개 어려운 후보에서 2종을 중복 없이 고른 뒤 9종의 순서를 섞습니다. 경기 동안 선택과 순서를 바꾸지 않습니다.

| 구분 | 재료 | 기본 수량 | 획득 방법·난도 검토 |
|---|---|---:|---|
| 일반 | 조약돌 | 8 | 돌 채굴, 초반 도구로 확보 |
| 일반 | 흙 | 8 | 지표 채굴, 낮은 난도 |
| 일반 | 모래 | 8 | 강·해변 채굴 |
| 일반 | 자갈 | 8 | 강·동굴 채굴 |
| 일반 | 참나무 원목 | 4 | 참나무 벌목, 생물군계에 따른 이동 가능 |
| 일반 | 막대기 | 8 | 목재로 제작 |
| 일반 | 석탄 | 4 | 지표·동굴 석탄 광석 |
| 일반 | 목탄 | 4 | 원목 제련, 석탄 광맥 불필요 |
| 일반 | 구리 주괴 | 4 | 구리 광석 채굴 후 제련 |
| 일반 | 유리 | 4 | 모래 제련 |
| 일반 | 벽돌 | 4 | 강·호수 점토를 제련 |
| 일반 | 점토 덩이 | 8 | 강·호수 점토 블록 채굴 |
| 일반 | 부싯돌 | 2 | 자갈 채굴, 반복 작업 가능 |
| 일반 | 뼈 | 3 | 스켈레톤 처치, 전투 필요 |
| 일반 | 실 | 3 | 거미 처치, 전투 필요 |
| 일반 | 썩은 살점 | 4 | 좀비 처치 |
| 일반 | 화약 | 2 | 크리퍼 처치, 위험을 고려해 2개 |
| 일반 | 깃털 | 3 | 닭 사냥 |
| 일반 | 설탕 | 4 | 사탕수수 제작 |
| 일반 | 종이 | 4 | 사탕수수 제작; 제작 결과가 3개씩이므로 남는 종이는 보관 |
| 일반 | 밀 | 4 | 씨앗 재배·뼛가루; 마을 건초는 선택 경로 |
| 어려움 | 철 주괴 | 6 | 철 채굴·제련, 일반 후보보다 도구·연료 작업 필요 |
| 어려움 | 금 주괴 | 6 | 철 곡괭이와 금 광맥 탐색·제련 필요 |
| 어려움 | 레드스톤 가루 | 6 | 철 곡괭이와 지하 탐색 필요; 광석당 다수 획득 |
| 어려움 | 청금석 | 6 | 지하 광맥 탐색 필요; 광석당 다수 획득 |
| 어려움 | 다이아몬드 | 6 | 철 곡괭이·깊은 지하 탐색, 후보 중 가장 높은 탐색 부담 |
| 어려움 | 책 | 6 | 가죽 6개+종이 18개; 소와 사탕수수 두 자원을 확보해 제작 |

수량 설정은 일반 재료 배수와 어려운 재료 공통 수량으로 분리합니다. 어려운 재료 기본값은 요청대로 각각 6개입니다. 네더 전용, 엔드 전용, 바다의 심장·보물상자·주민 거래 필수 재료는 제외했습니다. 자수정은 정동 발견 운 의존 때문에 최종 후보에서 제외하고 책으로 대체했습니다.

모든 후보는 오버월드 서바이벌에서 얻을 수 있으며 특정 구조물 발견이 필수는 아닙니다. 그러나 지형·동물·광석 분포가 달라 **모든 시드에서 공개 후 20분 이내 완성 가능하다고 보장하지 않습니다**. 특히 다이아몬드 6개와 서로 다른 지상 자원 확보에는 운과 역할 분담이 영향을 줍니다. 이러한 차이는 40분 자동 지급, 어려운 재료 수량 설정, 팀 공동 제작으로 완화합니다. 실제 3~4인 플레이를 통한 시간 분포 측정은 미검증입니다.

## 6. 검증 범위 — v1.5.0 당시 기록

추적기 제작 전용 모의 단위 테스트는 34개입니다. 재료 추출 1,000회, 공개 시각, 권한, 투척 종류·수량·순서, 동시 참여의 직렬 처리, 중복 이벤트, iterator 없는 네이티브 형태의 컬렉션, 합쳐진 엔티티 거절, 사망 투척, 배타적 완료, 미접속·가득 찬 인벤토리, 재시작, 저장 실패와 불확실한 거래 중단을 검사합니다. 별도 JavaScript 타입 검사도 수행했습니다.

이 결과는 실제 클라이언트의 이벤트 순서·엔티티 저장·인벤토리 렌더링·3~4인 네트워크 환경을 대체하지 않습니다. 전체 프로젝트 테스트 수, 통합·패키지 검사, 게임 실행 및 성능 측정 여부는 최종 QA 보고서를 기준으로 확인해야 합니다.

실기기 후속 결과: 네이티브 목록의 인덱스 순회 수정 후 26.63에서 Q 투척 9단계 완료·부분 수량 누적·추적기 1개 지급을 확인했습니다. 전체 검증 범위는 QA_REPORT.md를 기준으로 합니다.

## 7. v1.5.1 보완 — 원본 나침반 픽셀과 지원 범위

### 적용한 이미지와 방향 매핑

공식 `Mojang/bedrock-samples`의 stable 릴리스 `v1.26.60.5`, 커밋 `15701fa9c13923f12662984c32c124327e40e3d3`에 고정한 `compass_atlas.png`를 사용합니다. 이 샘플 버전은 이미지 출처이며 대상 게임 26.62의 직접 실행 검증을 의미하지 않습니다. 원본 atlas는 16×512 픽셀이고, 세로로 배치된 16×16 셀 32개를 갖습니다. [공식 릴리스](https://github.com/Mojang/bedrock-samples/releases/tag/v1.26.60.5), [고정된 원본 이미지](https://raw.githubusercontent.com/Mojang/bedrock-samples/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/items/compass_atlas.png)

`tools/assets.mjs`는 원본을 확대·회전·재채색하지 않고 각 셀의 RGBA 값을 그대로 추출합니다. 원본 셀 0·8·16·24의 빨간 바늘은 각각 아래·왼쪽·위·오른쪽을 가리키므로, 논리 프레임 `i`에는 원본 셀 `(i + 16) % 32`를 배정합니다. 헌터별 상대 방향 계산과 기존 아이템 갱신 구조는 유지합니다.

원본 32셀에는 동일 픽셀이 반복되는 셀이 있어 고유 이미지는 28개입니다. 원본 셀 `7=9`, `23=24=25`, `27=28`이 동일합니다. 이를 변조해 32개를 모두 다르게 만들지 않습니다. 별도로 확인한 `compass_item.png`는 16×16 정적 이미지이며 atlas 19번 셀과 완전히 같았습니다. 이 단일 이미지만 참조하는 방식은 러너를 가리키는 회전을 제공하지 않습니다.

### 정식 API와 렌더링의 제약

2.11.0 정식 API에는 아이템별 바닐라 나침반 목표를 바꾸는 컴포넌트나 메서드가 확인되지 않았습니다. 현행 `minecraft:icon`은 `textures.default` 등의 **텍스처 키 문자열**을 받으며, 공식 스키마에는 임의 frame·Molang 식·UV 영역 선택 속성이 없습니다. `textures`의 여러 키는 기본 아이콘·갑옷 장식·꾸러미 등 정의된 용도를 위한 것으로, 헌터별 방향 프레임을 넘기는 일반 인터페이스가 아닙니다. [정식 아이템 컴포넌트 목록](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemcomponenttypes?view=minecraft-bedrock-stable), [아이콘 문서](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_icon?view=minecraft-bedrock-stable), [공식 아이콘 스키마](https://raw.githubusercontent.com/Mojang/bedrock-samples/15701fa9c13923f12662984c32c124327e40e3d3/metadata/json_schemas/server/item/1.26.30/minecraft_icon%20v1.21.80.json)

원본 PNG를 배포하지 않고 내장 `compass_atlas` 경로와 셀 번호만으로 일반 손 아이콘·핫바·인벤토리 모두를 제어하는 공식 지원 방식은 확인하지 못했습니다. 공식 flipbook 설명은 블록 텍스처 대상입니다. 엔티티/attachable의 UV 애니메이션은 손 모델에서 연구할 수 있는 별도 경로지만 일반 인벤토리 아이콘까지 함께 변경한다는 근거는 아니므로 이번 배포에는 사용하지 않았습니다. [공식 flipbook 설명](https://learn.microsoft.com/en-us/minecraft/creator/documents/createanimatedblocktexture?view=minecraft-bedrock-stable), [UV 애니메이션 설명](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage?view=minecraft-bedrock-stable), [손 모델과 아이콘을 분리하는 공식 예제](https://learn.microsoft.com/en-us/minecraft/creator/documents/addcustomitems?view=minecraft-bedrock-stable)

따라서 v1.5.1의 정확한 설명은 **원본 나침반의 픽셀을 사용하고, 서버가 각 헌터의 방향에 맞는 32개 아이템 프레임을 선택한다**는 것입니다. 바닐라 내부 목표·흔들림·연속 회전까지 동일하게 재현한 것은 아닙니다. 5.625도는 논리 방향 선택의 최대 양자화 오차이며, 원근감 있게 그려진 원본 바늘 픽셀의 화면상 각도 오차를 뜻하지 않습니다.

### 출처와 라이선스 처리

원본 atlas와 변경하지 않은 upstream `LICENSE.md`, 고정 출처·SHA-256을 기록한 `SOURCE.json`, `NOTICE.md`는 `tools/vendor/vanilla-compass/`에 보관합니다. `RP/NOTICE.md`에도 동일한 안내를 넣으므로 애드온과 월드에 포함된 리소스 팩에도 출처·권리 안내가 들어갑니다. 원본 atlas SHA-256은 `7061f07c69c447f164d61fc009aaf4c9815ad854e59e6f17eea0a742583ed6f8`입니다.

Mojang samples는 MIT가 아니라 Minecraft EULA 적용 자료입니다. Usage Guidelines는 Mojang의 저작권 보호 콘텐츠 중 상당한 부분을 포함하지 않는 독창적인 mod의 배포를 허용하지만, 이번 나침반 이미지 사용을 개별 승인한 문장은 없습니다. 이번 구현은 독창적인 애드온에 필요한 작은 atlas 1장만 사용하는 것으로 진행했으며, **공식 승인을 받았다거나 원본 이미지가 자유 재배포 라이선스로 바뀌었다고 주장하지 않습니다**. 원본과 추출 프레임은 프로젝트 MIT 범위에서 명시적으로 제외하고 Mojang 권리·EULA·Usage Guidelines·비공식 제품 안내를 유지합니다. [고정된 샘플 라이선스](https://raw.githubusercontent.com/Mojang/bedrock-samples/15701fa9c13923f12662984c32c124327e40e3d3/LICENSE.md), [Minecraft EULA](https://www.minecraft.net/en-us/eula), [Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)

### 이번 보완의 검증

추적기 전용 테스트 9개가 원본 파일 해시, 32개 출력의 원본 RGBA 완전 일치, 28개 고유 이미지와 원본 중복 셀, 8방향·플레이어 회전·양자화 경계, 소유자별 상태 분리, 인벤토리 캐시, 라이선스 안내 동봉을 검사합니다. 원본 바늘은 타원형 투영과 피벗 위치 때문에 원형 바늘의 중심각 검사로 평가하지 않고, **방향 계산 검사와 원본 픽셀 일치 검사를 분리**했습니다. 생성된 네 기본 방향 PNG도 직접 열어 확인했습니다.

이 검사는 최신 이미지가 실제 게임의 모든 손·핫바·인벤토리 화면에서 동일하게 보인다는 보장을 대신하지 않습니다. 실제 클라이언트 결과, 전체 테스트 수와 멀티플레이·성능 검증 상태는 최신 `QA_REPORT.md`를 기준으로 합니다.
