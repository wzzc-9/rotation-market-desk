import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeMysqlStore, importCombinationFile, importJsonDocument, initializeMysqlStore, mysqlStoreStats } from './mysql-store.js';

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  });
}

process.env.DB_HYDRATE_FILES = '0';
const enabled = await initializeMysqlStore();
if (!enabled) throw new Error('缺少 DB_HOST、DB_USER 等 MySQL 配置');

const dataDirectory = resolve(process.cwd(), 'data');
const files = jsonFiles(dataDirectory);
const combinationFiles = new Set([
  resolve(dataDirectory, 'rotation', 'combinations.json'),
  resolve(dataDirectory, 'asset-rotation', 'combinations.json'),
]);
const documents = files.filter((path) => !combinationFiles.has(path));

let documentIndex = 0;
for (const path of documents) {
  await importJsonDocument(path);
  documentIndex += 1;
  if (documentIndex % 10 === 0 || documentIndex === documents.length) {
    console.log(`JSON 文档迁移 ${documentIndex}/${documents.length}`);
  }
}

for (const [strategy, path] of [
  ['rotation', resolve(dataDirectory, 'rotation', 'combinations.json')],
  ['asset-rotation', resolve(dataDirectory, 'asset-rotation', 'combinations.json')],
] as const) {
  console.log(`开始迁移 ${strategy} 组合排名`);
  const result = await importCombinationFile(path, strategy, (completed, total) => {
    if (completed === total || completed % 10_000 === 0) console.log(`${strategy} 组合迁移 ${completed}/${total}`);
  });
  console.log(`${strategy} 组合迁移完成：${result.totalCombinations} 条${result.reused ? '（复用已有版本）' : ''}`);
}

console.log(JSON.stringify(await mysqlStoreStats(), null, 2));
await closeMysqlStore();
