# 측정 자료 읽기

이 폴더는 실제 3인 시험의 공개 허용 자료입니다. 최종 수치는 measurement-summary.json과 measurement-windows.json을 우선 확인하세요. 기능별 JSON 중 일부는 당시의 관측 구간을 보존한 역사적 스냅샷이므로 그 안의 진행 중 표시는 해당 시점의 상태입니다. 최종 종료·정리는 final-cleanup-observations.json에 있습니다.

정상 상태1065행, 실제 DROP18행을 보존했습니다. 마지막 불완전 JSON1행은 보완하거나 추정하지 않고 제외했으며 fragment-review.json에 종료 후 재검사 결과를 남겼습니다. 원본 Content Log와 계정명이 들어 있는 스크린샷은 공개하지 않습니다. 두 메모리 CSV는 숫자와 시간만 포함하고 JSON은 식별 필드를 제거한 사본입니다.

전체5315.120초의 TPS에는 로비·일시정지·종료후가 포함됩니다. 실제3인 명단/접속을 유지한 grace/running 동일상태664구간의 합계3320.114초를 별도로 보고합니다. 이는 두 라운드의 합계입니다. 메모리 두 구간 사이69.1462716초를 보간하지 않습니다. FPS와 게임 네트워크는 미측정입니다.

두 헌터의 가까운 시간 투척은 각각1tick/61ms,2ticks/107ms입니다. 동일tick이나 정확한카메라3.000초/광선8.000초를 입증하지 않으며, 이를 새로운 필수출시조건으로 만들지 않습니다. 드래곤은 사용자의 요청에 따라 명령으로 사망시켰고 그 실제 이벤트의 러너승리 처리를 확인했습니다. 직접 검으로 드래곤을 처치한 시험으로 표시하지 않습니다.

재계산 도구는 tools에 있습니다. 분석기는 개인 Content Log 경로를 필수 인수로 받으며 원본을 수정하지 않습니다. 재실행하려면 tools를 별도 임시 작업 폴더에 복사하고 node analyze-v160-three.mjs --log <개인로그> --memory <메모리CSV> --closed를 실행하세요. 결과는 분석기 옆runtime-v160-three 아래 새 폴더에 만들어집니다. write-memory-windows.mjs와 write-measurement-summary.mjs는 출력 폴더, 메모리CSV, 출력파일 경로를 명시하여 두 구간을 재집계합니다. 공개 sampler JSON은 종료상태를 재현하기에 필요한 필드를 보존합니다.

qa-probe-fragment.txt는 QA복사본에만 덧붙인 관찰 코드입니다. 배포BP나 기존 월드에 적용하라는 지시가 아닙니다. FPS 측정 제한의 이전 진단은 metrics-capability-summary.json, 마지막 오버레이 시도는 final-cleanup-observations.json을 확인하세요.
