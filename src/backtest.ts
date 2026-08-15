export type AnnualReturn = {
  year: number;
  returnRate: number;
  maxDrawdown: number;
  trades: number;
  availableAssets: number;
  yearEndHolding: string;
};

export const annualReturns: AnnualReturn[] = [
  { year: 2016, returnRate: 17.09, maxDrawdown: -10.93, trades: 44, availableAssets: 6, yearEndHolding: '黄金ETF' },
  { year: 2017, returnRate: 11.68, maxDrawdown: -6.54, trades: 76, availableAssets: 6, yearEndHolding: '恒生ETF' },
  { year: 2018, returnRate: -13.23, maxDrawdown: -24.80, trades: 66, availableAssets: 6, yearEndHolding: '黄金ETF' },
  { year: 2019, returnRate: 35.16, maxDrawdown: -10.72, trades: 72, availableAssets: 6, yearEndHolding: '沪深300' },
  { year: 2020, returnRate: 40.10, maxDrawdown: -23.42, trades: 58, availableAssets: 6, yearEndHolding: '创业板50' },
  { year: 2021, returnRate: -9.71, maxDrawdown: -22.45, trades: 70, availableAssets: 6, yearEndHolding: '纳指ETF' },
  { year: 2022, returnRate: 5.70, maxDrawdown: -19.61, trades: 54, availableAssets: 7, yearEndHolding: '恒生ETF' },
  { year: 2023, returnRate: 8.05, maxDrawdown: -14.41, trades: 67, availableAssets: 8, yearEndHolding: '创业板50' },
  { year: 2024, returnRate: 20.10, maxDrawdown: -31.85, trades: 73, availableAssets: 8, yearEndHolding: '恒生ETF' },
  { year: 2025, returnRate: 89.91, maxDrawdown: -13.80, trades: 55, availableAssets: 8, yearEndHolding: '科创100' },
];

export const backtestSummary = {
  cumulativeReturn: 405.35,
  annualizedReturn: 17.66,
  positiveYears: 8,
  worstDrawdown: -31.85,
};
