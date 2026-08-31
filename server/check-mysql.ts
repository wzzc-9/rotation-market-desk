import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeMysqlStore, initializeMysqlStore, mysqlStoreStats, readMysqlDocument } from './mysql-store.js';

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  });
}

process.env.DB_HYDRATE_FILES = '0';
if (!await initializeMysqlStore()) throw new Error('缺少 MySQL 配置');

const dataDirectory = resolve(process.cwd(), 'data');
const documents = jsonFiles(dataDirectory).filter((path) => !path.endsWith('combinations.json'));
const mismatches = documents.filter((path) => readMysqlDocument(path) !== readFileSync(path, 'utf8'));
const stats = await mysqlStoreStats();
const incompleteRuns = stats?.runs.filter((run) => Number(run.total_combinations) !== Number(run.stored_combinations)) ?? [];

console.log(JSON.stringify({
  localDocuments: documents.length,
  storedDocuments: stats?.documents ?? 0,
  documentMismatches: mismatches.map((path) => path.replace(process.cwd(), '').replace(/^[/\\]/, '')),
  activeRuns: stats?.runs ?? [],
  incompleteRuns,
  valid: mismatches.length === 0 && incompleteRuns.length === 0 && documents.length === stats?.documents,
}, null, 2));

await closeMysqlStore();
if (mismatches.length || incompleteRuns.length || documents.length !== stats?.documents) process.exitCode = 1;
