# Manhunt Night v1.7.5 — 개발 및 배포 체크리스트

## 완료된 작업

- [x] 버전명 **v1.7.5** 통일: BP/RP/코어, npm 패키지, lockfile, 빌드 도구, CI 아티팩트, README·설치·기능·변경 기록
- [x] 다른 맵에서 기존과 같은 공중 로비 자동 생성 및 블록 보호·실패 롤백 시도
- [x] 다른 시드의 월드 경계 상대화·기존 고정 요새 좌표 오안내 방지
- [x] 정식 API만 사용한 **탐험 중 네더 요새 자동 위치 기록**, 96블록 중복 차단 및 최대 8곳, 수동 좌표 우선
- [x] 자동 감지 ON/OFF, 러너 전용 조건부 힌트, 미탐색 시 거짓 좌표 금지
- [x] JavaScript·API 타입·JSON/팩·원본 월드 DB·ZIP CRC/SHA-256 검사 통과
- [x] 회귀 테스트 **238/238 PASS** ([Actions #44168454632](https://github.com/geumyi22/Manhunt-Night/actions/runs/44168454632))
- [x] v1.6.0 Stable·월드 DB·QA 이력 보존, 새 v1.7.5 시험 패키지 생성

## Stable 전 필요한 실기 확인

- [ ] Minecraft 실제 다른 시드 월드에서 로비 자동 생성·재시도·블록 보호
- [ ] 자연 발생 위더 스켈레톤 및 실제 네더 요새에서 자동 발견·힌트 테스트
- [ ] 참가자 2~3인 이상 기존 기능·저장/재접속·차원 이동/승패 회귀
- [ ] 실제 성능 및 다른 애드온/변형 시드에서의 제한 기록
- [ ] 결과를 [Issue #12](https://github.com/geumyi22/Manhunt-Night/issues/12)와 최신 QA 보고서에 반영한 뒤 Stable 출시 여부 판단

**현재 공식 배포:** [v1.6.0 Stable](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.6.0). v1.7.5는 미검증 환경이 남아 있는 **Pre-release 개발 후보**이며 자동 테스트 통과만으로 정식 Stable을 출시하지 않습니다.
