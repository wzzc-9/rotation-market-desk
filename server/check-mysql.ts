import { resolve } from 'node:path';
import { closeMysqlStore, initializeMysqlStore, listMysqlDocuments, mysqlSchemaCommentStats, mysqlStoreStats, readMysqlDocument } from './mysql-store.js';

if (!await initializeMysqlStore()) throw new Error('缺少 MySQL 配置');

const dataDirectory = resolve(process.cwd(), 'data');
const documentKeys = listMysqlDocuments(dataDirectory);
const invalidDocuments = documentKeys.filter((key) => {
  try {
    JSON.parse(readMysqlDocument(resolve(process.cwd(), key)) ?? '');
    return false;
  } catch {
    return true;
  }
});
const requiredDocuments = [
  'data/rotation/config.json',
  'data/rotation/combination-config.json',
  'data/rotation/backtest.json',
  'data/asset-rotation/config.json',
  'data/asset-rotation/combination-config.json',
  'data/asset-rotation/backtest.json',
  'data/dual-etf/config.json',
  'data/dual-etf/backtest.json',
];
const missingDocuments = requiredDocuments.filter((key) => !documentKeys.includes(key));
const stats = await mysqlStoreStats();
const schemaComments = await mysqlSchemaCommentStats();
const incompleteRuns = stats?.runs.filter((run) => Number(run.total_combinations) !== Number(run.stored_combinations)) ?? [];
const schemaCommentsValid = schemaComments !== null
  && schemaComments.tableMismatches.length === 0
  && schemaComments.columnMismatches.length === 0;

console.log(JSON.stringify({
  storedDocuments: stats?.documents ?? 0,
  invalidDocuments,
  missingDocuments,
  activeRuns: stats?.runs ?? [],
  incompleteRuns,
  schemaComments,
  valid: invalidDocuments.length === 0 && missingDocuments.length === 0 && incompleteRuns.length === 0 && schemaCommentsValid,
}, null, 2));

await closeMysqlStore();
if (invalidDocuments.length || missingDocuments.length || incompleteRuns.length || !schemaCommentsValid) process.exitCode = 1;
