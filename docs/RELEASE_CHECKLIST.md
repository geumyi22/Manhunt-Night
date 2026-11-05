# 릴리스 점검표

- [ ] 소스 백업 및 변경 사항 비교
- [ ] `node --test tests/*.test.js` 통과
- [ ] JS 구문 및 팩 JSON 검사 통과
- [ ] Script API 선언에 맞춘 타입 검사 수행(로컬 환경 별도)
- [ ] `.mcaddon`과 `.mcworld` 패키징·해시 검사
- [ ] 원본 월드 데이터 보존 검사
- [ ] 실제 Bedrock 클라이언트에서 UI와 3~4인 게임 확인
- [ ] 네더/엔드/사망/부활/15분 추적 기능 확인
- [ ] 실제 게임 미검증 시 **Pre-release** 표기
- [ ] Releases에 `.mcworld`, `.mcaddon`, 전체 ZIP, QA 보고서 첨부

이 저장소의 자동 QA는 실제 Minecraft 클라이언트 테스트를 대체하지 않습니다.
