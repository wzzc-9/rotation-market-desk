import { resolve } from 'node:path';
import {
  getAssetRotationSnapshot,
  getAssetRotationTop1Snapshot,
  getBullPointSnapshot,
  getDualEtfSnapshot,
  getIndustryMa20Snapshot,
  getKdjTurningPointSnapshot,
  getMacdConfluenceSnapshot,
  getMacdKdjSnapshot,
  getMacdPullbackSnapshot,
  getMa5ResonanceSnapshot,
  getRotationSnapshot,
  getVolumeSnapshot,
  isChinaTradingDay,
} from './market-service.js';
import { flushMysqlWrites, queueMysqlObjectWrite, readMysqlObject } from './mysql-store.js';

type SchedulerLogger = {
  info: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
};

type CalculationTask = {
  id: string;
  label: string;
  run: () => Promise<unknown>;
};

export type AfterCloseTaskResult = {
  id: string;
  label: string;
  status: 'completed' | 'failed';
  finishedAt: string;
  error?: string;
};

export type AfterCloseSchedulerStatus = {
  enabled: boolean;
  scheduledTime: string;
  timeZone: 'Asia/Shanghai';
  state: 'waiting' | 'running' | 'completed' | 'completed_with_errors' | 'skipped' | 'failed' | 'disabled';
  tradingDate?: string;
  updatedAt: string;
  reason?: string;
  tasks: AfterCloseTaskResult[];
};

export type AfterCloseScheduler = {
  stop: () => void;
};

const statePath = resolve(process.cwd(), 'data', 'automation', 'after-close-status.json');
const defaultScheduleTime = '15:15';
const chinaTimeZone = 'Asia/Shanghai' as const;
let timer: NodeJS.Timeout | null = null;
let runningCalculation: Promise<AfterCloseSchedulerStatus> | null = null;
let currentStatus: AfterCloseSchedulerStatus = {
  enabled: true,
  scheduledTime: defaultScheduleTime,
  timeZone: chinaTimeZone,
  state: 'waiting',
  updatedAt: new Date().toISOString(),
  tasks: [],
};

function configuredScheduleTime() {
  const value = String(process.env.AUTO_CALCULATION_TIME ?? defaultScheduleTime).trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : defaultScheduleTime;
}

function isSchedulerEnabled() {
  return !['0', 'false', 'off', 'no'].includes(String(process.env.AUTO_CALCULATION_ENABLED ?? '1').trim().toLowerCase());
}

function shanghaiDateTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: chinaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  return {
    date,
    dateCode: date.replaceAll('-', ''),
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function scheduleMinutes(scheduleTime: string) {
  const [hour, minute] = scheduleTime.split(':').map(Number);
  return hour * 60 + minute;
}

function millisecondsUntilNextRun(scheduleTime: string, now = new Date()) {
  const shanghai = shanghaiDateTime(now);
  const target = Date.parse(`${shanghai.date}T${scheduleTime}:00+08:00`);
  return Math.max(1_000, (target > now.getTime() ? target : target + 24 * 60 * 60 * 1_000) - now.getTime());
}

function safeStatus(value: unknown, enabled: boolean, scheduledTime: string): AfterCloseSchedulerStatus | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AfterCloseSchedulerStatus>;
  if (!Array.isArray(record.tasks) || typeof record.updatedAt !== 'string') return null;
  const validTasks = record.tasks.every((task) => task
    && typeof task.id === 'string'
    && typeof task.label === 'string'
    && (task.status === 'completed' || task.status === 'failed')
    && typeof task.finishedAt === 'string');
  if (!validTasks) return null;
  return {
    enabled,
    scheduledTime,
    timeZone: chinaTimeZone,
    state: record.state === 'completed' || record.state === 'completed_with_errors' || record.state === 'skipped' || record.state === 'failed' || record.state === 'running' ? record.state : 'waiting',
    tradingDate: typeof record.tradingDate === 'string' ? record.tradingDate : undefined,
    updatedAt: record.updatedAt,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    tasks: record.tasks,
  };
}

function loadStoredStatus(enabled: boolean, scheduledTime: string) {
  const content = readMysqlObject(statePath);
  if (!content) return;
  try {
    const stored = safeStatus(JSON.parse(content), enabled, scheduledTime);
    if (stored) currentStatus = stored;
  } catch {
    // A malformed old status must never block the next after-close calculation.
  }
}

async function persistStatus(logger: SchedulerLogger) {
  try {
    await queueMysqlObjectWrite(statePath, `${JSON.stringify(currentStatus, null, 2)}\n`);
    await flushMysqlWrites();
  } catch (error) {
    logger.error('收盘后定时任务状态写入失败', { error: error instanceof Error ? error.message : String(error) });
  }
}

function dailyTasks(date: string): CalculationTask[] {
  return [
    { id: 'macd-confluence', label: 'MACD 金叉共振', run: () => getMacdConfluenceSnapshot(true, date) },
    { id: 'macd-pullback', label: 'MACD 零轴回踩', run: () => getMacdPullbackSnapshot(true, date) },
    { id: 'macd-kdj', label: 'MACD + KDJ 共振', run: () => getMacdKdjSnapshot(true, date) },
    { id: 'kdj-turning-point', label: 'KDJ 低位拐点', run: () => getKdjTurningPointSnapshot(true, date) },
    { id: 'volume-signals', label: '量价三信号', run: () => getVolumeSnapshot(true, date) },
    { id: 'ma5-resonance', label: '5 日线回踩共振', run: () => getMa5ResonanceSnapshot(true, date) },
    { id: 'bull-points', label: '多空趋势多点', run: () => getBullPointSnapshot(true, date) },
    { id: 'rotation', label: '宽基 ETF 动量轮动（日度）', run: () => getRotationSnapshot(true) },
    { id: 'industry-ma20', label: '行业 ETF MA20（日度）', run: () => getIndustryMa20Snapshot(true) },
    { id: 'dual-etf', label: '双 ETF 动量轮动（日度）', run: () => getDualEtfSnapshot(true) },
  ];
}

function weeklyTasks(): CalculationTask[] {
  return [
    { id: 'asset-rotation', label: '全球大类资产 ETF 轮动（周度）', run: () => getAssetRotationSnapshot(true) },
    { id: 'asset-rotation-top1', label: '全球大类资产 ETF 轮动只持第 1 名（周度）', run: () => getAssetRotationTop1Snapshot(true) },
  ];
}

function completedToday(date: string) {
  return currentStatus.tradingDate === date && currentStatus.state === 'completed';
}

async function executeAfterCloseCalculations(logger: SchedulerLogger, now = new Date()): Promise<AfterCloseSchedulerStatus> {
  const shanghai = shanghaiDateTime(now);
  if (shanghai.weekday === 0 || shanghai.weekday === 6) {
    currentStatus = {
      ...currentStatus,
      state: 'skipped',
      tradingDate: shanghai.dateCode,
      reason: '周末不计算',
      updatedAt: new Date().toISOString(),
      tasks: [],
    };
    await persistStatus(logger);
    logger.info('收盘后定时任务跳过周末', { tradingDate: shanghai.dateCode });
    return currentStatus;
  }

  let isTradingDay: boolean;
  try {
    isTradingDay = await isChinaTradingDay(shanghai.dateCode);
  } catch (error) {
    currentStatus = {
      ...currentStatus,
      state: 'failed',
      tradingDate: shanghai.dateCode,
      reason: '交易日校验失败',
      updatedAt: new Date().toISOString(),
      tasks: [],
    };
    await persistStatus(logger);
    logger.error('收盘后定时任务无法校验交易日', { error: error instanceof Error ? error.message : String(error) });
    return currentStatus;
  }

  if (!isTradingDay) {
    currentStatus = {
      ...currentStatus,
      state: 'skipped',
      tradingDate: shanghai.dateCode,
      reason: '交易所休市',
      updatedAt: new Date().toISOString(),
      tasks: [],
    };
    await persistStatus(logger);
    logger.info('收盘后定时任务跳过休市日', { tradingDate: shanghai.dateCode });
    return currentStatus;
  }

  const tasks = [...dailyTasks(shanghai.dateCode), ...(shanghai.weekday === 5 ? weeklyTasks() : [])];
  const previousTasks = currentStatus.tradingDate === shanghai.dateCode ? currentStatus.tasks : [];
  const completedTaskIds = new Set(previousTasks.filter((task) => task.status === 'completed').map((task) => task.id));
  const taskResults = previousTasks.filter((task) => tasks.some((candidate) => candidate.id === task.id));
  currentStatus = {
    ...currentStatus,
    state: 'running',
    tradingDate: shanghai.dateCode,
    reason: undefined,
    updatedAt: new Date().toISOString(),
    tasks: taskResults,
  };
  await persistStatus(logger);
  logger.info('收盘后定时任务开始', { tradingDate: shanghai.dateCode, taskCount: tasks.length });

  for (const task of tasks) {
    if (completedTaskIds.has(task.id)) continue;
    try {
      await task.run();
      const result: AfterCloseTaskResult = { id: task.id, label: task.label, status: 'completed', finishedAt: new Date().toISOString() };
      const previousIndex = currentStatus.tasks.findIndex((item) => item.id === task.id);
      if (previousIndex >= 0) currentStatus.tasks[previousIndex] = result;
      else currentStatus.tasks.push(result);
      currentStatus.updatedAt = result.finishedAt;
      await persistStatus(logger);
      logger.info('收盘后定时任务完成', { tradingDate: shanghai.dateCode, task: task.id });
    } catch (error) {
      const result: AfterCloseTaskResult = {
        id: task.id,
        label: task.label,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      const previousIndex = currentStatus.tasks.findIndex((item) => item.id === task.id);
      if (previousIndex >= 0) currentStatus.tasks[previousIndex] = result;
      else currentStatus.tasks.push(result);
      currentStatus.updatedAt = result.finishedAt;
      await persistStatus(logger);
      logger.error('收盘后定时任务失败，继续执行下一项', { tradingDate: shanghai.dateCode, task: task.id, error: result.error });
    }
  }

  const failedCount = currentStatus.tasks.filter((task) => task.status === 'failed').length;
  currentStatus = {
    ...currentStatus,
    state: failedCount ? 'completed_with_errors' : 'completed',
    reason: failedCount ? `${failedCount} 项计算失败` : undefined,
    updatedAt: new Date().toISOString(),
  };
  await persistStatus(logger);
  logger.info('收盘后定时任务结束', { tradingDate: shanghai.dateCode, failedCount });
  return currentStatus;
}

export async function runAfterCloseCalculations(logger: SchedulerLogger, now = new Date()) {
  if (runningCalculation) return runningCalculation;
  runningCalculation = executeAfterCloseCalculations(logger, now);
  try {
    return await runningCalculation;
  } finally {
    runningCalculation = null;
  }
}

export function getAfterCloseSchedulerStatus() {
  return structuredClone(currentStatus);
}

export async function startAfterCloseScheduler(logger: SchedulerLogger): Promise<AfterCloseScheduler> {
  const enabled = isSchedulerEnabled();
  const scheduledTime = configuredScheduleTime();
  loadStoredStatus(enabled, scheduledTime);
  currentStatus = { ...currentStatus, enabled, scheduledTime, timeZone: chinaTimeZone };
  if (!enabled) {
    currentStatus = { ...currentStatus, state: 'disabled', reason: 'AUTO_CALCULATION_ENABLED=0', updatedAt: new Date().toISOString() };
    await persistStatus(logger);
    logger.info('收盘后定时任务已禁用');
    return { stop: () => undefined };
  }

  const scheduleNextRun = () => {
    const delay = millisecondsUntilNextRun(scheduledTime);
    timer = setTimeout(async () => {
      await runAfterCloseCalculations(logger);
      scheduleNextRun();
    }, delay);
    timer.unref();
  };
  scheduleNextRun();

  const now = new Date();
  const shanghai = shanghaiDateTime(now);
  if (shanghai.minutes >= scheduleMinutes(scheduledTime) && !completedToday(shanghai.dateCode)) {
    void runAfterCloseCalculations(logger, now);
  }
  logger.info('收盘后定时任务已启动', { scheduledTime, timeZone: chinaTimeZone });
  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
