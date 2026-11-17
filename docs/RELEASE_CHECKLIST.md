# v1.7.0 Pre-release 릴리스 점검

- [x] 변경사항을 v1.6.0 Stable과 분리한 개발 브랜치에 작성
- [x] 외부 맵 원본 스타일 **공중 로비 자동 생성**·다른 높이 탐색·기존 건축물 보호·명령어 재시도 및 맵별 경계·요새 좌표 오안내 보호 코드 추가
- [x] v1.7.0 자동 테스트 **228/228**, API 타입·JS 구문·JSON/팩 검사 통과 ([CI](https://github.com/geumyi22/Manhunt-Night/actions/runs/44165606402))
- [x] 기존 v1.6.0 릴리스 월드 읽기 전용 입력으로 새 v1.7.0 월드·애드온·ZIP·해시 검사 및 DB 바이트 동일성 PASS
- [ ] 실제 외부 월드 **자동 로비 생성·건축물 보호·로비 전환**, 명령어·요새 등록·차원 이동 실기 검증 ([Issue #12](https://github.com/geumyi22/Manhunt-Night/issues/12))
- [ ] 실제 여러 플레이어 환경의 추적·부활·소집·승패 회귀
- [ ] 결과 기반 PR·릴리스 상태 결정

현재 공식 Stable은 [v1.6.0](https://github.com/geumyi22/Manhunt-Night/releases/tag/v1.6.0)입니다. v1.7.0은 새로운 외부 월드 실기 검증 전에는 Stable로 배포하지 않습니다.

이전 Stable 체크리스트: [v1.6.0 원문](history/RELEASE_CHECKLIST_v1.6.0.md)
