import { createHash } from 'node:crypto';

export function strategyPoolHash(symbols: Array<{ code: string }>) {
  const signature = [...new Set(symbols.map((symbol) => symbol.code.trim()))].sort().join(',');
  return createHash('sha256').update(signature).digest('hex');
}
