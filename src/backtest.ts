import assetRotationBacktest from '../data/asset-rotation/backtest.json';
import rotationBacktest from '../data/rotation/backtest.json';

export type AnnualReturn = {
  year: number;
  returnRate: number;
  maxDrawdown: number;
  trades: number;
  availableAssets: number;
  yearEndHolding: string;
};

export const annualReturns: AnnualReturn[] = rotationBacktest.annualReturns;
export const backtestSummary = rotationBacktest.summary;
export const assetRotationAnnualReturns: AnnualReturn[] = assetRotationBacktest.annualReturns;
export const assetRotationBacktestSummary = assetRotationBacktest.summary;

export const assetRotationVideoBenchmark = {
  cumulativeReturn: 249.89,
  annualizedReturn: 26.22,
  currentDrawdown: -15.95,
  worstDrawdown: -21.05,
  calmarRatio: 0.83,
  sharpeRatio: 0.91,
};
