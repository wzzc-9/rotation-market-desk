export type AnnualReturn = {
  year: number;
  returnRate: number;
  maxDrawdown: number;
  trades: number;
  availableAssets: number;
  yearEndHolding: string;
};

export const assetRotationVideoBenchmark = {
  cumulativeReturn: 249.89,
  annualizedReturn: 26.22,
  currentDrawdown: -15.95,
  worstDrawdown: -21.05,
  calmarRatio: 0.83,
  sharpeRatio: 0.91,
};

export const dualEtfVideoBenchmark = {
  cumulativeReturn: 522.8,
  annualizedReturn: 31.53,
  currentDrawdown: -15.43,
  worstDrawdown: -20.53,
  calmarRatio: 1.11,
  sharpeRatio: 1.07,
};
