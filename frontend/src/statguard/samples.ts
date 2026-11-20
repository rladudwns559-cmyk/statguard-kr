/** Real public CSVs bundled for one-click demos. Numbers are unchanged from the public sources. */
export type SamplePreset = { id: string; label: string; file: string; name: string; units: Record<string, string>; answer: string; source: string };

export const PRESETS: SamplePreset[] = [
  { id: 'seattle_daily', label: '★ 시애틀 일별 기상 365행 + 실제 GPT 답변', file: 'seattle_2023_daily.csv', name: '06_시애틀_2023_일별기상.csv', units: { 강수량: 'mm', 최고기온: '℃', 최저기온: '℃' },
    source: 'NOAA NCEI GHCN-Daily USW00024233, 2023 (0.1 단위 원자료를 10으로 나눔). 예시 답변은 벤치마크 v0.2 조건 A에서 gpt-6-luna가 실제로 쓴 답변의 수치 문장을 모은 것(12월 비율 문장은 앞부분을 줄임, 수치는 그대로)',
    answer: '2023년 시애틀의 일별 강수량을 모두 합한 연간 강수량은 888.4mm입니다. 2023년 일별 최고기온의 표본표준편차는 약 7.9℃입니다. 2023년 일 최고기온과 일 최저기온의 피어슨 상관계수는 약 0.86입니다. 2023년 일 최고기온의 최댓값은 8월 15일과 16일에 기록된 35.0℃입니다. 2023년 12월 강수량은 연간 합계의 약 24.25%입니다. 2023년 7월의 일 최고기온 31개를 평균하면 약 26.7℃입니다. 1월과 7월의 일 강수량 평균 차이에 대한 Welch t-검정의 양측 p값은 약 0.0007입니다.' },
  { id: 'seattle', label: '시애틀 강수량 (NOAA)', file: 'seattle_2023_precipitation.csv', name: '01_시애틀_2023_월별강수량.csv', units: { 강수량: 'mm' },
    source: 'NOAA NCEI Global Summary of the Month, USW00024233, 2023',
    answer: '2023년 시애틀의 연간 강수량 합계는 888.9mm입니다. 2023년 12월 강수량은 215.4mm로 가장 많았습니다. 2023년 1월 대비 2023년 12월 강수량은 약 174.4% 증가했습니다. 2023년 11월 강수량은 연간 강수량 합계의 약 18.5%를 차지합니다. 겨울철 강수량이 많은 것은 태평양 폭풍의 영향 때문입니다.' },
  { id: 'co2', label: '마우나로아 CO₂ (NOAA)', file: 'maunaloa_2024_co2.csv', name: '02_마우나로아_2024_월별CO2.csv', units: { 이산화탄소농도: 'ppm' },
    source: 'NOAA GML Mauna Loa monthly mean CO2, 2024',
    answer: '2024년 마우나로아의 월별 이산화탄소농도 평균은 424.6ppm입니다. 5월 이산화탄소농도는 426.90ppm으로 연중 높은 편입니다. 9월 이산화탄소농도는 421.03ppm이었습니다. 1월 대비 12월 이산화탄소농도는 0.61% 상승했습니다. 이 변화는 통계적으로 유의한 증가 추세입니다.' },
  { id: 'pop2', label: '대한민국 총인구 2022–23 (World Bank)', file: 'korea_2022_2023_population.csv', name: '03_대한민국_2022_2023_총인구.csv', units: { 총인구: '명' },
    source: 'World Bank WDI SP.POP.TOTL (CC BY 4.0)',
    answer: '2022년 대비 2023년 대한민국 총인구는 0.08% 증가했습니다. 2023년 총인구는 약 5,171만 명입니다. 2024년 총인구는 5,180만 명입니다.' },
  { id: 'korea10', label: '대한민국 인구·실업률 2014–23 (World Bank)', file: 'korea_2014_2023_population_unemployment.csv', name: '04_대한민국_2014_2023_인구_실업률.csv', units: { 총인구: '명', 실업률: '%' },
    source: 'World Bank WDI SP.POP.TOTL, SL.UEM.TOTL.ZS (CC BY 4.0)',
    answer: '2014년 대비 2023년 대한민국 총인구는 1.9% 증가했습니다. 2021년 대비 2022년 총인구는 0.19% 감소했습니다. 2014~2023년 실업률 평균은 3.6%입니다. 2020년 실업률은 3.931%였습니다. 2022년 실업률 하락은 고용 정책의 효과 때문입니다.' },
];
