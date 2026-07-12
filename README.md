# 쉬운 차용증

친구·지인 사이에서 개인적으로 사용하는 모바일 차용증 작성 및 손가락 서명 웹앱입니다.

## 특징

- HTML, CSS, JavaScript만 사용하는 정적 웹앱
- 서버, 데이터베이스, 분석 스크립트 없음
- 개인정보와 서명 이미지는 외부로 전송하지 않음
- 작성 중 내용은 브라우저 `localStorage`에만 임시 저장
- 계약 완료 시 계약번호와 SHA-256 문서 확인값 생성
- 브라우저 인쇄 기능으로 PDF 저장
- 최종 HTML과 JSON 백업 저장
- GitHub Pages 하위 경로에서 작동하는 PWA 경로 구성

## 로컬 실행

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 열면 됩니다.

## GitHub Pages

저장소 Settings → Pages에서 Source를 `Deploy from a branch`, Branch를 `main`, Folder를 `/ (root)`로 선택합니다.

배포 주소는 다음 형식입니다.

```text
https://sh4sh-ux.github.io/easy-loan-note/
```

## 주의

이 앱은 법률 자문을 대체하지 않습니다. 금액이 크거나 담보·보증·분쟁 가능성이 있는 거래는 전문가 검토 또는 공증을 권장합니다. 이 앱은 연대보증 기능을 제공하지 않으며, 계약서가 곧바로 강제집행 가능한 공정증서인 것처럼 표현하지 않습니다.
