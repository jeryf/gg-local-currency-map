# 경기지역화폐 가맹점 지도

경기데이터드림 [경기지역화폐 가맹점 현황](https://data.gg.go.kr) API를 지도(Leaflet + OpenStreetMap)로 보여주는 웹 사이트.

- 좌측에서 지역(시·군), 가맹점 유형, 상호 검색, 지도 영역 내 필터
- 목록에 마우스를 올리면 지도에 위치 하이라이트, 클릭 시 해당 마커로 이동
- 가맹점 이름 클릭 시 네이버 검색

## 실행

```bash
cp .env.example .env   # GG_API_KEY 입력 (data.gg.go.kr 에서 무료 발급)
npm start              # http://localhost:3000
```

인증키가 없으면 시군별 샘플 5건만 조회된다. 시군 데이터는 `.cache/`에 하루 동안 캐시된다.
