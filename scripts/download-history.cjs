const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const strategyDirectory = path.join(projectRoot, 'data', 'rotation');
const historyDirectory = path.join(strategyDirectory, 'history');
const config = JSON.parse(fs.readFileSync(path.join(strategyDirectory, 'config.json'), 'utf8'));
const symbols = config.symbols;
const legacyHistoryPath = path.join(projectRoot, 'data', 'history-consolidated.json');
const onlyMissing = process.env.ROTATION_ONLY_MISSING === '1';
const ranges = [
  ['2015-01-01', '2016-12-31'],
  ['2017-01-01', '2018-12-31'],
  ['2019-01-01', '2020-12-31'],
  ['2021-01-01', '2022-12-31'],
  ['2023-01-01', '2024-12-31'],
  ['2025-01-01', '2026-12-31'],
];

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

function historyPathFor(code) {
  return path.join(historyDirectory, `${code}.json`);
}

function writeHistory(record) {
  const outputPath = historyPathFor(record.code);
  const temporaryPath = `${outputPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, 'utf8');
  fs.renameSync(temporaryPath, outputPath);
}

function readHistory(code) {
  const inputPath = historyPathFor(code);
  if (!fs.existsSync(inputPath)) return null;
  const record = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (record.code !== code || !Array.isArray(record.rows)) throw new Error(`${inputPath} 历史行情格式无效`);
  return record;
}

function migrateLegacyHistory() {
  if (!fs.existsSync(legacyHistoryPath)) return;
  const legacy = JSON.parse(fs.readFileSync(legacyHistoryPath, 'utf8'));
  let migrated = 0;
  for (const [code, record] of Object.entries(legacy)) {
    if (!/^\d{6}$/.test(code) || record?.code !== code || !Array.isArray(record.rows)) throw new Error(`旧历史文件中的 ${code} 数据格式无效`);
    if (!readHistory(code)) {
      writeHistory(record);
      migrated += 1;
    }
  }
  fs.unlinkSync(legacyHistoryPath);
  console.log(`migrated ${migrated} ETF histories to ${historyDirectory}`);
}

(async () => {
  fs.mkdirSync(historyDirectory, { recursive: true });
  migrateLegacyHistory();
  for (const { marketCode, code, name } of symbols) {
    const existing = readHistory(code);
    if (onlyMissing && existing?.rows.length > 0) {
      console.log(`${code}: reuse ${existing.rows.length} local rows`);
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
    writeHistory({ code, name, rows: merged });
    console.log(`${code}: ${merged.length} rows, ${merged[0]?.[0]} to ${merged.at(-1)?.[0]}`);
  }
})();
