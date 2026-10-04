# 경기지역화폐 가맹점 지도

경기도 31개 시·군의 **경기지역화폐 가맹점**을 지도에서 찾아볼 수 있는 웹 사이트입니다.
지역과 업종으로 가맹점을 좁히고, 마음에 드는 곳은 바로 네이버 지도에서 확인할 수 있습니다.

- 데이터 출처: [경기데이터드림 - 경기지역화폐 가맹점 현황](https://data.gg.go.kr) (매일 03:00 KST 자동 갱신)
- 지도: [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org), 마커 클러스터링 [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster)

## 주요 기능

| 기능 | 설명 |
|---|---|
| 지역 선택 | 31개 시·군 중 선택 (시·군별 가맹점 수 표시) |
| 가맹점 유형 필터 | 드롭다운 + 검색. 클릭하면 전체 유형이 건수순으로 펼쳐지고, 입력하면 일치하는 유형만 표시 (↑↓·Enter·Esc 지원) |
| 상호 검색 | 상호명 또는 주소로 검색 |
| 지도 연동 목록 | 좌측 목록에는 **현재 지도 화면 안의 가맹점만** 표시되며, 지도를 이동·확대하면 즉시 갱신 |
| 위치 하이라이트 | 목록의 가맹점에 마우스를 올리면 지도에 위치가 빨간 점으로 강조, 클릭하면 해당 마커로 이동 |
| 네이버 지도 연결 | 목록·지도 팝업의 가맹점 이름을 클릭하면 네이버 지도에서 `시군명 상호명`으로 검색 |

휴업·폐업 가맹점과 좌표가 없는 가맹점은 제외됩니다.

## 구조

별도 백엔드 없이 동작하는 정적 사이트입니다. API 인증키는 GitHub Actions에서만 사용되어 브라우저에 노출되지 않습니다.

```
GitHub Actions (push / 매일 03:00 KST / 수동 실행)
  └─ scripts/fetch-data.js  경기데이터드림 API → public/data/{시군}.json, meta.json
  └─ public/ 를 GitHub Pages 로 배포
브라우저
  └─ public/index.html, app.js 가 선택한 시·군의 JSON 만 내려받아 지도에 표시
```

```
.
├── .github/workflows/deploy.yml  데이터 수집 + GitHub Pages 배포
├── scripts/fetch-data.js         API 수집·정제 (페이지 병렬 요청, 재시도, 업종명 정규화)
├── public/
│   ├── index.html
│   ├── app.js                    지도·필터·목록 로직
│   ├── style.css
│   └── data/                     수집 결과 (git 미포함, 빌드 시 생성)
└── server.js                     로컬 미리보기용 정적 서버
```

시·군 JSON은 용량을 줄이기 위해 `types`(업종명 목록)와 `stores`(`[상호, 업종 index, 주소, 위도, 경도]` 배열)로 저장합니다.

## 로컬 실행

Node.js 22 이상이 필요하며 외부 패키지는 없습니다.

```bash
cp .env.example .env    # GG_API_KEY 입력 (data.gg.go.kr 에서 무료 발급)
npm run fetch-data      # public/data/ 생성 (약 30초)
npm start               # http://localhost:3000
```

인증키가 없으면 시·군별 샘플 5건만 수집됩니다.

## 배포 (GitHub Pages)

1. 저장소 **Settings → Secrets and variables → Actions** 에 `GG_API_KEY` 등록
2. **Settings → Pages → Source** 를 `GitHub Actions` 로 설정
3. `main` 에 push 하거나 **Actions → Fetch data & deploy → Run workflow** 실행
