# 공개 자료 출처와 정리 범위

확보일: 2026-10-23. 각 다운로드 원본의 URL·시각·크기·SHA-256과 셀 대응표는 프로젝트의 data/statguard_real_csv_v0.1/manifest.json에 있다. 업로드용 정리본 3개의 숫자 26개는 원본과 문자열 수준에서 동일하다.

| 자료 | 원본 및 설명 | 단위·정리 | 이용 조건 |
|---|---|---|---|
| NOAA NCEI GSOM, Seattle Tacoma Airport USW00024233, 2023 | [공식 데이터 검색](https://www.ncei.noaa.gov/access/search/data-search/global-summary-of-the-month), [요소 설명](https://www.ncei.noaa.gov/pub/data/cdo/documentation/gsom-gsoy_documentation.pdf) | PRCP는 월별 총 강수량. metric 요청의 mm 값 12개를 사용. 관측소·연월·PRCP 열 선택 및 한국어 열 이름 변경. 단위 재변환 없음 | NOAA 공개 데이터 이용 안내에 따라 출처 표시. [이용 안내](https://www.noaa.gov/office-education/outreach-communication/faq) |
| NOAA GML Mauna Loa monthly CO₂, 2024 | [공식 자료 안내](https://gml.noaa.gov/ccgg/trends/data.html), [원본 CSV](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv) | ppm. 2024년 average 열 12개 선택. 설명 주석 제거·한국어 열 이름 변경. deseasonalized 열과 혼합하지 않음. 선택 월들의 ndays 양수·sdev 비음수 확인 | 원본의 무료 공개·인용 요청에 따라 NOAA GML 및 자료 제공자에게 출처 표시. 월값의 단순 평균만 계산 |
| World Bank WDI SP.POP.TOTL, KOR, 2022·2023 | [공식 지표와 라이선스](https://data.worldbank.org/indicator/SP.POP.TOTL?locations=KR), [지표 정의](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.POP.TOTL) | 명. 연중 인구 추정치. 공식 country CSV ZIP의 본표에서 KOR·해당 지표 2022·2023 열만 추출하고 세로 표로 변환. 한국어 열 이름 변경. 원본 갱신일 2026-10-08 | CC BY 4.0. World Bank WDI 및 공식 페이지의 원출처 표기를 유지하고 정리·번역 사실 표시 |

출처 인용: NOAA/NCEI, Global Summary of the Month, USW00024233 (2023), 다운로드 2026-10-23. NOAA/GML, Xin Lan 및 Ralph Keeling/Scripps, Mauna Loa CO₂ monthly series (2024), 다운로드 2026-10-23. World Bank, World Development Indicators, SP.POP.TOTL, Korea, Rep. (2022–2023), CC BY 4.0, 다운로드 2026-10-23. World Bank 지표가 열거한 원출처는 UN·국가 통계기관 등이며 World Bank를 원관측기관으로 표현하지 않는다.

합성 자료로 대체하거나 누락값을 채우지 않았다. 개인정보가 없는 관측소 월별 집계와 국가 연도별 집계를 사용한다. 원본 보관 폴더에는 기관이 배포한 설명·공개 연락처 같은 메타데이터가 포함될 수 있다. 참여자에게 제공하는 CSV에는 위 계산용 집계 열만 있다.

이 검사는 범위를 정한 실제 자료에 대한 기능 점검이다. 임의의 공개 CSV 원본을 정리 없이 모두 읽는 기능을 검증한 것이 아니다. NOAA 설명 주석과 World Bank 안내행·가로형 연도표는 별도 정리했으며 기존 CSV parser는 변경하지 않았다. 모든 정리 과정을 셀 대응표로 남겼다. 자료는 이후 개정될 수 있으므로 재현에는 동봉 스냅샷을 사용한다.
