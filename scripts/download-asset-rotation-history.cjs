const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', 'asset-rotation-config.json'), 'utf8'));
const symbols = config.symbols;
const historyPath = path.join(projectRoot, 'data', 'asset-rotation-history.json');
const existing = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : {};
const onlyMissing = process.env.ASSET_ROTATION_ONLY_MISSING === '1';
const ranges = [
  ['2016-01-01', '2017-12-31'],
  ['2018-01-01', '2019-12-31'],
  ['2020-01-01', '2021-12-31'],
  ['2022-01-01', '2023-12-31'],
  ['2024-01-01', '2025-12-31'],
  ['2026-01-01', '2026-12-31'],
];

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
}

(async () => {
  const result = { ...existing };
  for (const { marketCode, code, name } of symbols) {
    if (onlyMissing && Array.isArray(existing[code]?.rows) && existing[code].rows.length > 0) {
      console.log(`${code}: reuse ${existing[code].rows.length} local rows`);
      continue;
    }
    const rows = new Map();
    for (const [start, end] of ranges) {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${marketCode},day,${start},${end},640,qfq`;
      const payload = await getJson(url);
      const block = payload.data?.[marketCode];
      for (const row of block?.qfqday ?? block?.day ?? []) rows.set(row[0], row);
    }
    const merged = [...rows.values()].sort((left, right) => left[0].localeCompare(right[0]));
    result[code] = { code, name, rows: merged };
    console.log(`${code}: ${merged.length} rows, ${merged[0]?.[0]} to ${merged.at(-1)?.[0]}`);
  }
  const temporaryPath = `${historyPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(result)}\n`, 'utf8');
  fs.renameSync(temporaryPath, historyPath);
})();
