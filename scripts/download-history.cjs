const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const symbols = [
  ['sh512100', '512100', '中证1000'],
  ['sz159949', '159949', '创业板50'],
  ['sh518880', '518880', '黄金ETF'],
  ['sh513100', '513100', '纳指ETF'],
  ['sz159920', '159920', '恒生ETF'],
  ['sz159628', '159628', '国证2000'],
  ['sh510300', '510300', '沪深300'],
  ['sh588120', '588120', '科创100'],
];

const ranges = [
  ['2015-01-01', '2016-12-31'],
  ['2017-01-01', '2018-12-31'],
  ['2019-01-01', '2020-12-31'],
  ['2021-01-01', '2022-12-31'],
  ['2023-01-01', '2024-12-31'],
  ['2025-01-01', '2025-12-31'],
];

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    }
  }
}

(async () => {
  const result = {};
  for (const [marketCode, code, name] of symbols) {
    const rows = new Map();
    for (const [start, end] of ranges) {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${marketCode},day,${start},${end},640,qfq`;
      const payload = await getJson(url);
      const block = payload.data?.[marketCode];
      const klines = block?.qfqday || block?.day || [];
      for (const row of klines) rows.set(row[0], row);
    }
    const merged = [...rows.values()].sort((a, b) => a[0].localeCompare(b[0]));
    result[code] = { code, name, rows: merged };
    console.log(`${code}: ${merged.length} rows, ${merged[0]?.[0]} to ${merged.at(-1)?.[0]}`);
  }
  fs.writeFileSync(path.join(projectRoot, 'data', 'history-consolidated.json'), JSON.stringify(result));
})();
