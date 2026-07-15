# 쉬운 차용증 (easy-loan-note)

친구·지인 사이에서 쓰는 **모바일 차용증 작성 + 손가락 서명 PWA**.
서버 없이 브라우저 안에서만 동작하고, 입력한 개인정보·서명은 외부로 전송되지 않는다.

## 링크 / 위치
- **라이브:** https://sh4sh-ux.github.io/easy-loan-note/ (GitHub Pages, main 브랜치 자동 배포)
- **저장소:** git@github.com:sh4sh-ux/easy-loan-note.git (SSH) / https://github.com/sh4sh-ux/easy-loan-note (HTTPS)
- **소유자:** 조상현 — 혼자 사용하며 친구들에게 링크 공유

## 파일 구조 (정적 사이트, 빌드 도구 없음)
```
index.html          — 화면 구조 (6단계 마법사: 당사자·금액·상환·확인·서명·완료)
app.js              — 전체 로직 (계약서 생성, 서명, PDF·이미지, 보관함, 감사기록)
style.css           — 스타일 (더치페이 앱과 같은 디자인 토큰: #F7F7F8 배경, #0071E3 블루, SF Pro)
service-worker.js   — PWA 오프라인 캐시
manifest.json       — PWA 매니페스트
icons/              — 앱 아이콘
```

## 로컬 미리보기
```bash
python3 -m http.server 8000    # 저장소 폴더에서 실행 → http://localhost:8000
```

## 배포 방법
main 브랜치에 push하면 GitHub Pages가 자동 반영(약 10~60초).
```bash
git add index.html app.js style.css service-worker.js
git commit -m "vXX: 설명"
git push origin main
```

## ⚠️ 버전 올리기 규칙 (매우 중요)
코드를 고칠 때마다 **세 곳의 버전을 함께** 올려야 사용자에게 반영된다:
1. `index.html` 의 `style.css?v=N` 과 `app.js?v=N`
2. `service-worker.js` 의 `CACHE_VERSION` (예: `easy-loan-note-v15-...`)
3. `service-worker.js` APP_SHELL 안의 `./style.css?v=N`, `./app.js?v=N`

현재 버전: **v15**. (다음에 고치면 v16으로)

## ⚠️ 서비스워커 캐시 — 새로고침 두 번
cache-first 방식이라, 배포 후 기존 사용자는 **첫 새로고침엔 이전 버전, 한 번 더 새로고침해야 새 버전**이 뜬다.
로컬 테스트 시에도 서비스워커 unregister + caches.delete 후 새로고침해야 최신 코드가 로드된다.

## 핵심 기능 요약
- 6단계 마법사 + 단계별 검증, 상단 탭 클릭 이동
- 무이자/이자·일시/분할상환 조건별 계약 문구 자동 생성 (조항 번호 자동)
- 손가락 서명: 데스크탑은 칸에 직접, **모바일은 탭하면 전체화면 가로 서명창**
- PDF 저장(자체 생성, 조항 단위 페이지), 이미지(PNG) 저장, 인쇄, HTML·JSON 백업
- 첨부자료(신분증 사진 등, 기기 내 저장), 계약 보관함(완료 계약 자동 저장/불러오기)
- 전자서명 진행 기록(감사 로그) + SHA-256 문서 확인값 — 완료 화면 토글로 포함/미포함
- 주소: 카카오(다음) 우편번호 검색 + 상세주소 입력 → 계약서에 결합 표기

## 작업 시 주의점 (과거에 실제로 겪은 함정)
- **서명 캔버스:** 숨겨진(크기 0) 캔버스를 리사이즈하면 저장된 서명이 손상됨 → `resizeSignatureCanvas`의 크기 가드 유지.
- **이미지/PDF 내보내기:** SVG `foreignObject`로 렌더 → 캔버스 합성 방식. Chromium에서 blob URL은 캔버스를 오염시키므로 **data URL** 사용. 중첩 `<img>`(서명·첨부)는 색상 마커 플레이스홀더로 위치를 찾아 직접 합성한다.
- **주소검색(daum):** 외부 스크립트(t1.daumcdn.net)라 인터넷 필요. 오프라인이면 안내 후 직접 입력. `openPostcodeSearch()` 하나로 처리(중복 금지).
- **문서 확인값(해시):** 서명·별첨·감사기록까지 포함해 계산. 완료 후 내용을 수정하면 무효화되고 재완료 시 재계산.

## 일하는 규칙
- 코드 변경 전 **계획을 먼저 말하고 확인받기** (특히 큰 변경).
- 시각적 변경은 **브라우저로 확인(스크린샷)한 뒤 push**.
- 커밋은 변경한 파일만 명시적으로 add (`git add -A` 지양).
- 커밋 메시지는 `vXX: 요약` 형식.
