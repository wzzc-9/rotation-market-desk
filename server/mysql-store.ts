import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';

type CombinationStrategy = 'rotation' | 'asset-rotation';

export type MysqlCombinationFilters = {
  size?: number;
  tenYearDrawdown?: number;
  fiveYearDrawdown?: number;
  currentYearDrawdown?: number;
};

type CombinationSort = 'score' | 'ten-year' | 'five-year' | 'current-year';
type CombinationDirection = 'asc' | 'desc';

type StoredCombination = {
  id: string;
  size: number;
  codes: string[];
  assetClasses: string[];
  tenYearReturn: number;
  fiveYearReturn: number;
  tenYearAnnualizedReturn: number;
  fiveYearAnnualizedReturn: number;
  tenYearMaxDrawdown: number;
  fiveYearMaxDrawdown: number;
  tenYearTrades: number;
  currentYearReturn: number;
  currentYearMaxDrawdown: number;
  currentYearTrades: number;
  currentHolding: string | null;
  tenYearRank: number;
  currentYearRank: number;
  compositeScore: number;
  compositeRank: number;
};

type CombinationFile = {
  version: string;
  strategy: CombinationStrategy;
  generatedAt: string;
  rule?: unknown;
  periods: unknown;
  universe: unknown[];
  totalCombinations: number;
  bestTenYearId?: string;
  bestCurrentYearId?: string;
  bestCompositeId?: string;
  scoring: unknown;
  combinations: StoredCombination[];
};

type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

let pool: Pool | null = null;
let initialized = false;
const documentCache = new Map<string, string>();
const pendingWrites = new Set<Promise<unknown>>();

function loadEnvironmentFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([^#=\s]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function databaseConfig(): MysqlConfig | null {
  loadEnvironmentFile(resolve(process.cwd(), '.env.local'));
  loadEnvironmentFile(resolve(process.cwd(), '.env.mysql.local'));
  const host = String(process.env.DB_HOST ?? '').trim();
  const user = String(process.env.DB_USER ?? '').trim();
  if (!host || !user) return null;
  const database = String(process.env.DB_NAME ?? 'rotation_market_desk').trim();
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('DB_NAME 只能包含字母、数字和下划线');
  return {
    host,
    port: Number(process.env.DB_PORT ?? 3306),
    user,
    password: String(process.env.DB_PASSWORD ?? ''),
    database,
    ssl: process.env.DB_SSL === '1',
  };
}

const wait = (milliseconds: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function createBootstrapConnection(config: MysqlConfig, ssl: { rejectUnauthorized: boolean } | undefined) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        ssl,
        connectTimeout: 15_000,
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 1_000);
    }
  }
  throw lastError;
}

type SchemaComment = {
  table: string;
  columns: Record<string, { definition: string; comment: string }>;
};

const schemaComments: Record<string, SchemaComment> = {
  app_documents: {
    table: 'JSON文档持久化表',
    columns: {
      document_key: { definition: 'VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '文档相对项目根目录的唯一路径' },
      category: { definition: 'VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '文档分类' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '所属策略编码，无归属时为空' },
      document_date: { definition: 'DATE NULL', comment: '文档对应的交易日期，无日期时为空' },
      content_hash: { definition: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '文档内容的SHA-256哈希' },
      payload: { definition: 'LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL', comment: '原始JSON文档内容' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '最后更新时间' },
    },
  },
  combination_runs: {
    table: 'ETF组合排名计算批次表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '计算批次主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '策略编码' },
      source_version: { definition: 'VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '源组合文件版本' },
      source_hash: { definition: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '源组合文件SHA-256哈希' },
      generated_at: { definition: 'DATETIME(3) NOT NULL', comment: '组合数据生成时间' },
      rule_json: { definition: 'JSON NULL', comment: '交易规则配置' },
      periods_json: { definition: 'JSON NOT NULL', comment: '回测区间配置' },
      universe_json: { definition: 'JSON NOT NULL', comment: '参与计算的ETF标的池' },
      scoring_json: { definition: 'JSON NOT NULL', comment: '综合得分计算配置' },
      total_combinations: { definition: 'INT UNSIGNED NOT NULL', comment: '该批次组合总数' },
      best_ten_year_id: { definition: 'VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '近10年收益最高的组合编码' },
      best_current_year_id: { definition: 'VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '当年收益最高的组合编码' },
      best_composite_id: { definition: 'VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '综合得分最高的组合编码' },
      status: { definition: 'VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '导入状态：importing、completed或failed' },
      created_at: { definition: 'DATETIME(3) NOT NULL', comment: '批次创建时间' },
      completed_at: { definition: 'DATETIME(3) NULL', comment: '批次完成时间，未完成时为空' },
    },
  },
  active_combination_runs: {
    table: '各策略当前生效的组合计算批次表',
    columns: {
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '策略编码' },
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '当前生效的计算批次主键' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '生效批次切换时间' },
    },
  },
  combination_results: {
    table: 'ETF组合排名计算结果明细表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '组合结果主键' },
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属计算批次主键' },
      combination_hash: { definition: 'BINARY(32) NOT NULL', comment: '组合编码的SHA-256二进制哈希' },
      combination_key: { definition: 'VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: 'ETF代码拼接形成的组合编码' },
      etf_count: { definition: 'TINYINT UNSIGNED NOT NULL', comment: '组合包含的ETF数量' },
      codes_json: { definition: 'JSON NOT NULL', comment: '组合包含的ETF代码列表' },
      asset_classes_json: { definition: 'JSON NOT NULL', comment: '组合覆盖的资产类别列表' },
      ten_year_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年累计收益率，单位百分比' },
      five_year_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近5年累计收益率，单位百分比' },
      ten_year_annualized_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年年化收益率，单位百分比' },
      five_year_annualized_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近5年年化收益率，单位百分比' },
      ten_year_max_drawdown: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年最大回撤，单位百分比' },
      five_year_max_drawdown: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近5年最大回撤，单位百分比' },
      ten_year_trades: { definition: 'INT UNSIGNED NOT NULL', comment: '近10年交易或调仓次数' },
      current_year_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '当年累计收益率，单位百分比' },
      current_year_max_drawdown: { definition: 'DECIMAL(18,6) NOT NULL', comment: '当年最大回撤，单位百分比' },
      current_year_trades: { definition: 'INT UNSIGNED NOT NULL', comment: '当年交易或调仓次数' },
      current_holding: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '当前持仓ETF代码，空仓时为空' },
      ten_year_rank: { definition: 'INT UNSIGNED NOT NULL', comment: '近10年收益排名' },
      current_year_rank: { definition: 'INT UNSIGNED NOT NULL', comment: '当年收益排名' },
      composite_score: { definition: 'DECIMAL(18,6) NOT NULL', comment: '标准化加权后的综合得分' },
      composite_rank: { definition: 'INT UNSIGNED NOT NULL', comment: '综合得分排名' },
    },
  },
};

function sqlComment(value: string) {
  return value.replace(/'/g, "''");
}

async function ensureSchemaComments(connection: PoolConnection | Pool) {
  const [tableRows] = await connection.query<Array<RowDataPacket & { TABLE_NAME: string; TABLE_COMMENT: string }>>(
    `SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [Object.keys(schemaComments)],
  );
  const [columnRows] = await connection.query<Array<RowDataPacket & { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_COMMENT: string }>>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [Object.keys(schemaComments)],
  );
  const existingTableComments = new Map(tableRows.map((row) => [row.TABLE_NAME, row.TABLE_COMMENT]));
  const existingColumnComments = new Map(columnRows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row.COLUMN_COMMENT]));
  for (const [tableName, table] of Object.entries(schemaComments)) {
    const changes: string[] = [];
    if (existingTableComments.get(tableName) !== table.table) changes.push(`COMMENT = '${sqlComment(table.table)}'`);
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (existingColumnComments.get(`${tableName}.${columnName}`) !== column.comment) {
        changes.push(`MODIFY COLUMN \`${columnName}\` ${column.definition} COMMENT '${sqlComment(column.comment)}'`);
      }
    }
    if (changes.length) await connection.query(`ALTER TABLE \`${tableName}\` ${changes.join(', ')}`);
  }
}

async function createSchema(connection: PoolConnection | Pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_documents (
      document_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文档相对项目根目录的唯一路径',
      category VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文档分类',
      strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '所属策略编码，无归属时为空',
      document_date DATE NULL COMMENT '文档对应的交易日期，无日期时为空',
      content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文档内容的SHA-256哈希',
      payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '原始JSON文档内容',
      updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间',
      PRIMARY KEY (document_key),
      KEY idx_document_category (category, strategy_code, document_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='JSON文档持久化表'
  `);
  const [payloadColumns] = await connection.query<Array<RowDataPacket & { DATA_TYPE: string }>>(
    `SELECT DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_documents' AND COLUMN_NAME = 'payload'`,
  );
  if (payloadColumns[0]?.DATA_TYPE.toLowerCase() !== 'longtext') {
    await connection.query("ALTER TABLE app_documents MODIFY payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '原始JSON文档内容'");
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS combination_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '计算批次主键',
      strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '策略编码',
      source_version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '源组合文件版本',
      source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '源组合文件SHA-256哈希',
      generated_at DATETIME(3) NOT NULL COMMENT '组合数据生成时间',
      rule_json JSON NULL COMMENT '交易规则配置',
      periods_json JSON NOT NULL COMMENT '回测区间配置',
      universe_json JSON NOT NULL COMMENT '参与计算的ETF标的池',
      scoring_json JSON NOT NULL COMMENT '综合得分计算配置',
      total_combinations INT UNSIGNED NOT NULL COMMENT '该批次组合总数',
      best_ten_year_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '近10年收益最高的组合编码',
      best_current_year_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '当年收益最高的组合编码',
      best_composite_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '综合得分最高的组合编码',
      status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '导入状态：importing、completed或failed',
      created_at DATETIME(3) NOT NULL COMMENT '批次创建时间',
      completed_at DATETIME(3) NULL COMMENT '批次完成时间，未完成时为空',
      PRIMARY KEY (id),
      UNIQUE KEY uk_combination_run_source (strategy_code, source_hash),
      KEY idx_combination_run_status (strategy_code, status, completed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合排名计算批次表'
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS active_combination_runs (
      strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '策略编码',
      run_id BIGINT UNSIGNED NOT NULL COMMENT '当前生效的计算批次主键',
      updated_at DATETIME(3) NOT NULL COMMENT '生效批次切换时间',
      PRIMARY KEY (strategy_code),
      KEY idx_active_combination_run (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='各策略当前生效的组合计算批次表'
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS combination_results (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '组合结果主键',
      run_id BIGINT UNSIGNED NOT NULL COMMENT '所属计算批次主键',
      combination_hash BINARY(32) NOT NULL COMMENT '组合编码的SHA-256二进制哈希',
      combination_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ETF代码拼接形成的组合编码',
      etf_count TINYINT UNSIGNED NOT NULL COMMENT '组合包含的ETF数量',
      codes_json JSON NOT NULL COMMENT '组合包含的ETF代码列表',
      asset_classes_json JSON NOT NULL COMMENT '组合覆盖的资产类别列表',
      ten_year_return DECIMAL(18,6) NOT NULL COMMENT '近10年累计收益率，单位百分比',
      five_year_return DECIMAL(18,6) NOT NULL COMMENT '近5年累计收益率，单位百分比',
      ten_year_annualized_return DECIMAL(18,6) NOT NULL COMMENT '近10年年化收益率，单位百分比',
      five_year_annualized_return DECIMAL(18,6) NOT NULL COMMENT '近5年年化收益率，单位百分比',
      ten_year_max_drawdown DECIMAL(18,6) NOT NULL COMMENT '近10年最大回撤，单位百分比',
      five_year_max_drawdown DECIMAL(18,6) NOT NULL COMMENT '近5年最大回撤，单位百分比',
      ten_year_trades INT UNSIGNED NOT NULL COMMENT '近10年交易或调仓次数',
      current_year_return DECIMAL(18,6) NOT NULL COMMENT '当年累计收益率，单位百分比',
      current_year_max_drawdown DECIMAL(18,6) NOT NULL COMMENT '当年最大回撤，单位百分比',
      current_year_trades INT UNSIGNED NOT NULL COMMENT '当年交易或调仓次数',
      current_holding CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '当前持仓ETF代码，空仓时为空',
      ten_year_rank INT UNSIGNED NOT NULL COMMENT '近10年收益排名',
      current_year_rank INT UNSIGNED NOT NULL COMMENT '当年收益排名',
      composite_score DECIMAL(18,6) NOT NULL COMMENT '标准化加权后的综合得分',
      composite_rank INT UNSIGNED NOT NULL COMMENT '综合得分排名',
      PRIMARY KEY (id),
      UNIQUE KEY uk_combination_result (run_id, combination_hash),
      KEY idx_combination_score (run_id, composite_score),
      KEY idx_combination_size_score (run_id, etf_count, composite_score),
      KEY idx_combination_ten_drawdown (run_id, ten_year_max_drawdown),
      KEY idx_combination_five_drawdown (run_id, five_year_max_drawdown),
      KEY idx_combination_current_drawdown (run_id, current_year_max_drawdown),
      KEY idx_combination_ten_return (run_id, ten_year_return),
      KEY idx_combination_five_return (run_id, five_year_return),
      KEY idx_combination_current_return (run_id, current_year_return)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合排名计算结果明细表'
  `);
  await ensureSchemaComments(connection);
}

export async function initializeMysqlStore() {
  if (initialized) return Boolean(pool);
  initialized = true;
  const config = databaseConfig();
  if (!config) return false;
  const ssl = config.ssl ? { rejectUnauthorized: false } : undefined;
  const bootstrap = await createBootstrapConnection(config, ssl);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl,
    waitForConnections: true,
    connectionLimit: Math.max(2, Number(process.env.DB_POOL_SIZE ?? 6)),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    decimalNumbers: true,
  });
  await createSchema(pool);
  const [rows] = await pool.query<Array<RowDataPacket & { document_key: string; payload_text: string }>>(
    'SELECT document_key, payload AS payload_text FROM app_documents',
  );
  for (const row of rows) documentCache.set(row.document_key, row.payload_text);
  if (process.env.DB_HYDRATE_FILES !== '0') hydrateMysqlDocumentsToDisk();
  return true;
}

export function isMysqlEnabled() {
  return Boolean(pool);
}

export async function closeMysqlStore() {
  await flushMysqlWrites();
  if (pool) await pool.end();
  pool = null;
  initialized = false;
  documentCache.clear();
}

function documentKey(path: string) {
  return relative(process.cwd(), path).replace(/\\/g, '/');
}

export function hydrateMysqlDocumentsToDisk() {
  const dataDirectory = resolve(process.cwd(), 'data');
  for (const [key, content] of documentCache) {
    if (!key.startsWith('data/')) continue;
    const path = resolve(process.cwd(), key);
    const relativeToData = relative(dataDirectory, path);
    if (relativeToData.startsWith('..') || relativeToData.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) continue;
    if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
}

function documentMetadata(key: string) {
  const parts = key.split('/');
  const file = parts.at(-1) ?? '';
  const strategy = parts[1] === 'rotation' || parts[1] === 'asset-rotation' || parts[1] === 'dual-etf' ? parts[1] : null;
  const category = parts.includes('history')
    ? 'history'
    : parts.includes('year-performance')
      ? 'year-performance'
      : file === 'config.json' || file.includes('config')
        ? 'config'
        : file === 'backtest.json'
          ? 'backtest'
          : parts[1]?.endsWith('-snapshots')
            ? parts[1]
            : 'document';
  const dateMatch = /^(\d{4})(\d{2})(\d{2})\.json$/.exec(file);
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  return { category, strategy, date };
}

function trackWrite<T>(promise: Promise<T>) {
  pendingWrites.add(promise);
  void promise.finally(() => pendingWrites.delete(promise));
  return promise;
}

export function readMysqlDocument(path: string) {
  return documentCache.get(documentKey(path)) ?? null;
}

export function listMysqlDocuments(prefix: string) {
  const normalized = documentKey(prefix).replace(/\/$/, '') + '/';
  return [...documentCache.keys()].filter((key) => key.startsWith(normalized));
}

export function queueMysqlDocumentWrite(path: string, content: string) {
  if (!pool) return Promise.resolve(false);
  JSON.parse(content);
  const key = documentKey(path);
  const metadata = documentMetadata(key);
  const hash = createHash('sha256').update(content).digest('hex');
  documentCache.set(key, content);
  return trackWrite(pool.execute(
    `INSERT INTO app_documents
      (document_key, category, strategy_code, document_date, content_hash, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE
      category = VALUES(category), strategy_code = VALUES(strategy_code), document_date = VALUES(document_date),
      content_hash = VALUES(content_hash), payload = VALUES(payload), updated_at = NOW(3)`,
    [key, metadata.category, metadata.strategy, metadata.date, hash, content],
  ).then(() => true));
}

export function queueMysqlDocumentDelete(path: string) {
  if (!pool) return Promise.resolve(false);
  const key = documentKey(path);
  documentCache.delete(key);
  return trackWrite(pool.execute('DELETE FROM app_documents WHERE document_key = ?', [key]).then(() => true));
}

export async function flushMysqlWrites() {
  while (pendingWrites.size) await Promise.all([...pendingWrites]);
}

export async function importJsonDocument(path: string) {
  if (!pool) throw new Error('MySQL 尚未初始化');
  await queueMysqlDocumentWrite(path, readFileSync(path, 'utf8'));
}

function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function mysqlDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function insertCombinationBatch(connection: PoolConnection, runId: number, items: StoredCombination[]) {
  if (!items.length) return;
  const columns = 21;
  const placeholders = items.map(() => `(${new Array(columns).fill('?').join(',')})`).join(',');
  const values = items.flatMap((item) => [
    runId,
    createHash('sha256').update(item.id).digest(),
    item.id,
    item.size,
    JSON.stringify(item.codes),
    JSON.stringify(item.assetClasses),
    item.tenYearReturn,
    item.fiveYearReturn,
    item.tenYearAnnualizedReturn,
    item.fiveYearAnnualizedReturn,
    item.tenYearMaxDrawdown,
    item.fiveYearMaxDrawdown,
    item.tenYearTrades,
    item.currentYearReturn,
    item.currentYearMaxDrawdown,
    item.currentYearTrades,
    item.currentHolding,
    item.tenYearRank,
    item.currentYearRank,
    item.compositeScore,
    item.compositeRank,
  ]);
  await connection.query(
    `INSERT INTO combination_results (
      run_id, combination_hash, combination_key, etf_count, codes_json, asset_classes_json,
      ten_year_return, five_year_return, ten_year_annualized_return, five_year_annualized_return,
      ten_year_max_drawdown, five_year_max_drawdown, ten_year_trades,
      current_year_return, current_year_max_drawdown, current_year_trades, current_holding,
      ten_year_rank, current_year_rank, composite_score, composite_rank
    ) VALUES ${placeholders}`,
    values,
  );
}

export async function importCombinationFile(path: string, expectedStrategy: CombinationStrategy, onProgress?: (completed: number, total: number) => void) {
  if (!pool) throw new Error('MySQL 尚未初始化');
  const content = readFileSync(path, 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  const record = JSON.parse(content) as CombinationFile;
  if (record.strategy !== expectedStrategy || !Array.isArray(record.combinations)) throw new Error(`${path} 不是有效的组合排名文件`);
  const [existing] = await pool.query<Array<RowDataPacket & { id: number; status: string }>>(
    'SELECT id, status FROM combination_runs WHERE strategy_code = ? AND source_hash = ? LIMIT 1',
    [expectedStrategy, hash],
  );
  let runId = existing[0]?.id;
  if (!runId) {
    const [insertResult] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO combination_runs (
        strategy_code, source_version, source_hash, generated_at, rule_json, periods_json, universe_json,
        scoring_json, total_combinations, best_ten_year_id, best_current_year_id, best_composite_id,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importing', NOW(3))`,
      [
        expectedStrategy,
        record.version,
        hash,
        mysqlDate(record.generatedAt),
        record.rule === undefined ? null : JSON.stringify(record.rule),
        JSON.stringify(record.periods),
        JSON.stringify(record.universe),
        JSON.stringify(record.scoring),
        record.totalCombinations,
        record.bestTenYearId ?? null,
        record.bestCurrentYearId ?? null,
        record.bestCompositeId ?? null,
      ],
    );
    runId = insertResult.insertId;
    const connection = await pool.getConnection();
    try {
      const batchSize = 500;
      for (let index = 0; index < record.combinations.length; index += batchSize) {
        await insertCombinationBatch(connection, runId, record.combinations.slice(index, index + batchSize));
        onProgress?.(Math.min(index + batchSize, record.combinations.length), record.combinations.length);
      }
      await connection.execute(
        "UPDATE combination_runs SET status = 'completed', completed_at = NOW(3) WHERE id = ?",
        [runId],
      );
    } catch (error) {
      await connection.execute("UPDATE combination_runs SET status = 'failed' WHERE id = ?", [runId]);
      throw error;
    } finally {
      connection.release();
    }
  } else if (existing[0].status !== 'completed') {
    throw new Error(`${expectedStrategy} 已存在未完成的相同组合导入，请先清理失败任务`);
  }
  await pool.execute(
    `INSERT INTO active_combination_runs (strategy_code, run_id, updated_at)
     VALUES (?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE run_id = VALUES(run_id), updated_at = NOW(3)`,
    [expectedStrategy, runId],
  );
  return { runId, totalCombinations: record.totalCombinations, reused: Boolean(existing[0]) };
}

function normalizedFilters(filters: MysqlCombinationFilters) {
  const drawdown = (value?: number) => Number.isFinite(value) ? -Math.abs(Number(value)) : null;
  return {
    size: Number.isInteger(filters.size) && Number(filters.size) > 0 ? Number(filters.size) : null,
    tenYearDrawdown: drawdown(filters.tenYearDrawdown),
    fiveYearDrawdown: drawdown(filters.fiveYearDrawdown),
    currentYearDrawdown: drawdown(filters.currentYearDrawdown),
  };
}

export async function getMysqlCombinationPage(
  strategy: CombinationStrategy,
  sort: CombinationSort,
  direction: CombinationDirection,
  page: number,
  pageSize: number,
  filters: MysqlCombinationFilters,
) {
  if (!pool) return null;
  const [runs] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT r.* FROM active_combination_runs a
     INNER JOIN combination_runs r ON r.id = a.run_id
     WHERE a.strategy_code = ? AND r.status = 'completed' LIMIT 1`,
    [strategy],
  );
  const run = runs[0];
  if (!run) return null;
  const normalized = normalizedFilters(filters);
  const clauses = ['run_id = ?'];
  const parameters: unknown[] = [run.id];
  if (normalized.size !== null) { clauses.push('etf_count = ?'); parameters.push(normalized.size); }
  if (normalized.tenYearDrawdown !== null) { clauses.push('ten_year_max_drawdown >= ?'); parameters.push(normalized.tenYearDrawdown); }
  if (normalized.fiveYearDrawdown !== null) { clauses.push('five_year_max_drawdown >= ?'); parameters.push(normalized.fiveYearDrawdown); }
  if (normalized.currentYearDrawdown !== null) { clauses.push('current_year_max_drawdown >= ?'); parameters.push(normalized.currentYearDrawdown); }
  const where = clauses.join(' AND ');
  const [counts] = await pool.query<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM combination_results WHERE ${where}`,
    parameters,
  );
  const totalCombinations = Number(counts[0]?.total ?? 0);
  const normalizedPageSize = Math.min(Math.max(Math.trunc(pageSize) || 25, 10), 100);
  const totalPages = Math.max(Math.ceil(totalCombinations / normalizedPageSize), 1);
  const normalizedPage = Math.min(Math.max(Math.trunc(page) || 1, 1), totalPages);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const metric = sort === 'score'
    ? 'composite_score'
    : sort === 'current-year'
      ? 'current_year_return'
      : sort === 'five-year'
        ? 'five_year_return'
        : 'ten_year_return';
  const orderBy = `${metric} ${direction === 'asc' ? 'ASC' : 'DESC'}, combination_key ASC`;
  const rowSelection = `SELECT * FROM combination_results WHERE ${where} ORDER BY ${orderBy}`;
  const [rows] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `${rowSelection} LIMIT ${normalizedPageSize} OFFSET ${offset}`,
    parameters,
  );
  const mapCombination = (row: RowDataPacket & Record<string, unknown>, displayRank: number) => ({
    id: String(row.combination_key),
    size: Number(row.etf_count),
    codes: jsonValue<string[]>(row.codes_json),
    assetClasses: jsonValue<string[]>(row.asset_classes_json),
    tenYearReturn: Number(row.ten_year_return),
    fiveYearReturn: Number(row.five_year_return),
    tenYearAnnualizedReturn: Number(row.ten_year_annualized_return),
    fiveYearAnnualizedReturn: Number(row.five_year_annualized_return),
    tenYearMaxDrawdown: Number(row.ten_year_max_drawdown),
    fiveYearMaxDrawdown: Number(row.five_year_max_drawdown),
    tenYearTrades: Number(row.ten_year_trades),
    currentYearReturn: Number(row.current_year_return),
    currentYearMaxDrawdown: Number(row.current_year_max_drawdown),
    currentYearTrades: Number(row.current_year_trades),
    currentHolding: row.current_holding === null ? null : String(row.current_holding),
    tenYearRank: Number(row.ten_year_rank),
    currentYearRank: Number(row.current_year_rank),
    compositeScore: Number(row.composite_score),
    compositeRank: Number(row.composite_rank),
    displayRank,
  });
  const combinations = rows.map((row, index) => mapCombination(row, offset + index + 1));
  let best = combinations[0] ?? null;
  if (totalCombinations > 0 && normalizedPage !== 1) {
    const [bestRows] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(`${rowSelection} LIMIT 1`, parameters);
    best = bestRows[0] ? mapCombination(bestRows[0], 1) : null;
  }
  return {
    version: String(run.source_version),
    generatedAt: new Date(run.generated_at as string | Date).toISOString(),
    periods: jsonValue(run.periods_json),
    universe: jsonValue(run.universe_json),
    totalCombinations,
    allCombinations: Number(run.total_combinations),
    filters: normalized,
    scoring: jsonValue(run.scoring_json),
    sort,
    direction,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages,
    best,
    combinations,
  };
}

export async function mysqlStoreStats() {
  if (!pool) return null;
  const [documents] = await pool.query<Array<RowDataPacket & { total: number }>>('SELECT COUNT(*) AS total FROM app_documents');
  const [runs] = await pool.query<Array<RowDataPacket & { strategy_code: string; total_combinations: number; stored_combinations: number }>>(
    `SELECT r.strategy_code, r.total_combinations, COUNT(c.id) AS stored_combinations FROM active_combination_runs a
     INNER JOIN combination_runs r ON r.id = a.run_id
     LEFT JOIN combination_results c ON c.run_id = r.id
     GROUP BY r.id, r.strategy_code, r.total_combinations ORDER BY r.strategy_code`,
  );
  return { documents: Number(documents[0]?.total ?? 0), runs };
}

export async function mysqlSchemaCommentStats() {
  if (!pool) return null;
  const tableNames = Object.keys(schemaComments);
  const [tableRows] = await pool.query<Array<RowDataPacket & { TABLE_NAME: string; TABLE_COMMENT: string }>>(
    `SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [tableNames],
  );
  const [columnRows] = await pool.query<Array<RowDataPacket & { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_COMMENT: string }>>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [tableNames],
  );
  const tableCommentMap = new Map(tableRows.map((row) => [row.TABLE_NAME, row.TABLE_COMMENT]));
  const columnCommentMap = new Map(columnRows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row.COLUMN_COMMENT]));
  const tableMismatches = tableNames.filter((tableName) => tableCommentMap.get(tableName) !== schemaComments[tableName].table);
  const columnMismatches = Object.entries(schemaComments).flatMap(([tableName, table]) => Object.entries(table.columns)
    .filter(([columnName, column]) => columnCommentMap.get(`${tableName}.${columnName}`) !== column.comment)
    .map(([columnName]) => `${tableName}.${columnName}`));
  return {
    tables: tableNames.length,
    columns: Object.values(schemaComments).reduce((total, table) => total + Object.keys(table.columns).length, 0),
    tableMismatches,
    columnMismatches,
  };
}
