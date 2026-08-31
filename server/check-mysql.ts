import { resolve } from 'node:path';
import { closeMysqlStore, initializeMysqlStore, listMysqlObjects, mysqlSchemaCommentStats, mysqlStoreStats, readMysqlObject } from './mysql-store.js';

if (!await initializeMysqlStore()) throw new Error('缺少 MySQL 配置');

const dataDirectory = resolve(process.cwd(), 'data');
const objectKeys = listMysqlObjects(dataDirectory);
const invalidObjects = objectKeys.filter((key) => {
  try {
    JSON.parse(readMysqlObject(resolve(process.cwd(), key)) ?? '');
    return false;
  } catch {
    return true;
  }
});
const requiredObjects = [
  'data/rotation/config.json',
  'data/rotation/combination-config.json',
  'data/rotation/backtest.json',
  'data/asset-rotation/config.json',
  'data/asset-rotation/combination-config.json',
  'data/asset-rotation/backtest.json',
  'data/dual-etf/config.json',
  'data/dual-etf/backtest.json',
];
const missingObjects = requiredObjects.filter((key) => !objectKeys.includes(key));
const stats = await mysqlStoreStats();
const schemaComments = await mysqlSchemaCommentStats();
const incompleteRuns = stats?.runs.filter((run) => Number(run.total_combinations) !== Number(run.stored_combinations)) ?? [];
const schemaCommentsValid = schemaComments !== null
  && schemaComments.tableMismatches.length === 0
  && schemaComments.columnMismatches.length === 0;

console.log(JSON.stringify({
  serializedBusinessObjects: stats?.objects ?? 0,
  invalidObjects,
  missingObjects,
  legacyDocumentTables: stats?.legacyDocumentTables ?? 0,
  legacyJsonColumns: stats?.legacyJsonColumns ?? 0,
  entityCounts: stats?.entityCounts ?? null,
  activeRuns: stats?.runs ?? [],
  incompleteRuns,
  schemaComments,
  valid: invalidObjects.length === 0 && missingObjects.length === 0 && (stats?.legacyDocumentTables ?? 1) === 0 && (stats?.legacyJsonColumns ?? 1) === 0 && incompleteRuns.length === 0 && schemaCommentsValid,
}, null, 2));

await closeMysqlStore();
if (invalidObjects.length || missingObjects.length || (stats?.legacyDocumentTables ?? 1) !== 0 || (stats?.legacyJsonColumns ?? 1) !== 0 || incompleteRuns.length || !schemaCommentsValid) process.exitCode = 1;
