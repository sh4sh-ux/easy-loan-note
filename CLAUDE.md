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
icons/              — 앱 아이콘 (icon-source.svg가 원본; 512/192/180/32는 여기서 렌더링. 문서+금색 만년필+필기체 'Loan' 서명, 앱 블루 배경. 'Loan'은 Great Vibes(OFL) 폰트를 아웃라인화한 벡터 패스 — 재편집은 fonts로 다시 텍스트→패스 변환)
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
코드를 고칠 때마다 **네 곳의 버전을 함께** 올려야 사용자에게 반영된다:
1. `index.html` 의 `style.css?v=N` 과 `app.js?v=N`
2. `service-worker.js` 의 `CACHE_VERSION` (예: `easy-loan-note-v15-...`)
3. `service-worker.js` APP_SHELL 안의 `./style.css?v=N`, `./app.js?v=N`
4. `app.js` 상단의 `APP_VERSION`(예: `"v21"`) — 화면 좌상단 제목 옆 버전 칩에 표시됨

형식은 정수 하나씩 증가(v20 → v21 → v22 ...). 소수점(v2.0) 아님.
현재 버전: **v38**. (다음에 고치면 v39로)

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
- 주소: 카카오(다음) 우편번호 검색 + 상세주소 입력 → 계약서에 결합 표기 (건물명 괄호 포함, v18)
- **Dropbox 보관함 백업(v20)**: 보관함 화면에 Dropbox 연결(App folder/PKCE). 계약 완료 시 자동 업로드,
  앱 시작 시 다운로드→병합(같은 id는 savedAt 최신 우선), '지금 동기화' 수동 버튼. 삭제는 병합 없이 바로 푸시.
- **중간 저장·이어가기(v28)**: 입력 시 자동 저장(localStorage `draft:v3`) + 작성화면 '자동 저장됨 · HH:mm' 뱃지 +
  인트로 '이어서 작성' 카드(채권자·단계·저장시각). **다른 기기 이어가기**: 초안을 Dropbox `/easy-loan-note-draft.json`에
  자동 동기화(입력 4초 debounce 업로드, 앱 시작 시 원격이 더 최신이고 인트로 상태면 채택). 완료·초기화 시 원격 초안 삭제.
  **파일 이동**: '초안 파일로 저장'(type:easy-loan-note-draft) / '초안 파일 불러오기'로 Dropbox 없이도 전달·이어가기.
- **Dropbox 공유 링크(v37)**: 완료 화면 '공유 링크 만들기' — 계약 PDF를 Dropbox `/shared/<계약번호>-<시각>.pdf`(ASCII 경로)에
  업로드 후 `sharing/create_shared_link_with_settings`로 **만료 없는 링크** 생성. 기본으로 무작위 8자리 **비밀번호** 보호
  (`requested_visibility:password` + `link_password`, 혼동 문자 제외). 카톡 다운로드 기간 만료 문제 해결용 — 링크·비밀번호를
  따로 전달. 비밀번호 미지원 응답이면 공개 링크로 자동 폴백(경고 표시). `sharing.write` 스코프 필요 — 없으면 콘솔에서 켜고
  재연결 안내(missing_scope). 필요 없어지면 Dropbox `/shared` 폴더에서 파일 삭제 시 링크 차단.
- **공유 링크 개선(v38)**: (1) 비밀번호 **직접 설정** — 링크 생성 시 `prompt`로 제안값(자동 8자)을 채워 주고 원하는 값으로
  교체 가능(6자 이상, 비우면 공개+경고, 취소 시 중단). 비밀번호를 직접 넣으므로 v37의 '실패 시 공개 폴백'은 제거하고 오류를
  그대로 노출. (2) **링크 단축** — 생성된 Dropbox 링크를 무료 단축 서비스(is.gd→v.gd, CORS 지원)로 줄임(`shortenUrl`,
  최선 노력·실패 시 원본 링크 사용). 제3자 단축 서비스가 (비밀번호 걸린) 링크를 보게 되는 트레이드오프 있음. 경로 stamp에
  초(seconds) 추가로 동일 분 내 재생성 시 경로 충돌 방지.

## ⚠️ Dropbox 연동 메모 (v20)
- 인증: Authorization Code + PKCE (서버·client_secret 불필요). App Key는 사용자가 보관함 UI에 직접 입력.
- 스코프: **App folder** — API 경로 `/easy-loan-note-archive.json`은 실제 `/Apps/<앱>/`에 매핑됨. 경로는 ASCII만 사용(한글 헤더 문제 회피).
- Redirect URI: 앱 URL 자체(`location.origin + location.pathname`). Dropbox 콘솔에 등록 필요.
- localStorage 키: `easy-loan-note:dbx:{appkey|refresh|token|account|lastsync}`. refresh_token 있으면 연결된 것으로 간주.
- 병합은 union(id 기준) — 삭제 전파를 위해 삭제 시엔 다운로드 없이 로컬을 바로 업로드. 다기기 동시 편집 시 삭제가 되살아날 수 있는 한계 있음(현재는 단일 기기 위주라 수용).

## 작업 시 주의점 (과거에 실제로 겪은 함정)
- **서명 캔버스:** 숨겨진(크기 0) 캔버스를 리사이즈하면 저장된 서명이 손상됨 → `resizeSignatureCanvas`의 크기 가드 유지.
- **이미지/PDF 내보내기:** SVG `foreignObject`로 렌더 → 캔버스 합성 방식. Chromium에서 blob URL은 캔버스를 오염시키므로 **data URL** 사용. **서명**은 색상 마커 플레이스홀더로 위치를 찾아 합성. **별첨(첨부)은 v36부터 SVG/마커를 안 거치고 문서 렌더 후 캔버스에 `drawImage`로 직접 그린다** — SVG 중첩 img 렌더·DOM 측정·마커 탐지가 iOS Safari에서 불안정해 첨부가 우측으로 밀리고 마커가 남던 문제 근본 해결(캡션 `fillText`, 페이지 경계 회피 포함, 첨부 폭은 자연크기→콘텐츠폭 760-56 상한).
- **주소검색(daum):** 외부 스크립트(t1.daumcdn.net)라 인터넷 필요. 오프라인이면 안내 후 직접 입력. `openPostcodeSearch()` 하나로 처리(중복 금지).
- **문서 확인값(해시):** 서명·별첨·감사기록까지 포함해 계산. 완료 후 내용을 수정하면 무효화되고 재완료 시 재계산.

## 일하는 규칙
- 코드 변경 전 **계획을 먼저 말하고 확인받기** (특히 큰 변경).
- 시각적 변경은 **브라우저로 확인(스크린샷)한 뒤 push**.
- 커밋은 변경한 파일만 명시적으로 add (`git add -A` 지양).
- 커밋 메시지는 `vXX: 요약` 형식.
