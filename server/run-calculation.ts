import { closeMysqlStore, initializeMysqlStore } from './mysql-store.js';
import { runDatabaseCalculationTask, type DatabaseCalculationTask } from './market-service.js';

const task = process.argv[2] as DatabaseCalculationTask | undefined;
const allowedTasks = new Set<DatabaseCalculationTask>([
  'rotation-history', 'rotation-backtest', 'rotation-optimize',
  'asset-history', 'asset-backtest', 'asset-optimize',
  'dual-history', 'dual-backtest',
]);

if (!task || !allowedTasks.has(task)) throw new Error('缺少或不支持的数据库计算任务');
if (!await initializeMysqlStore()) throw new Error('缺少 MySQL 配置');

try {
  console.log(JSON.stringify(await runDatabaseCalculationTask(task), null, 2));
} finally {
  await closeMysqlStore();
}
