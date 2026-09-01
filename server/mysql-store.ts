import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { createRelationalSchema, deleteRelationalObject, loadRelationalObjects, migrateLegacyDocuments, persistRelationalObject, relationalSchemaComments } from './relational-store.js';

type CombinationStrategy = 'rotation' | 'asset-rotation';

export type MysqlCombinationFilters = {
  size?: number;
  tenYearDrawdown?: number;
  fiveYearDrawdown?: number;
  currentYearDrawdown?: number;
  codes?: string[];
};

type CombinationSort = 'score' | 'ten-year' | 'five-year' | 'current-year';
type CombinationDirection = 'asc' | 'desc';

type StoredCombination = {
  id: string;
  size: number;
  codes: string[];
  assetClasses: string[];
  tenYearReturn: number;
  earlyFiveYearReturn: number;
  fiveYearReturn: number;
  tenYearAnnualizedReturn: number;
  earlyFiveYearAnnualizedReturn: number;
  fiveYearAnnualizedReturn: number;
  tenYearMaxDrawdown: number;
  earlyFiveYearMaxDrawdown: number;
  fiveYearMaxDrawdown: number;
  rollingTwelveMonthReturnP10: number;
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
const objectCache = new Map<string, string>();
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
  ...relationalSchemaComments,
  combination_runs: {
    table: 'ETF组合排名计算批次表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '计算批次主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '策略编码' },
      source_version: { definition: 'VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '源组合文件版本' },
      source_hash: { definition: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '源组合文件SHA-256哈希' },
      generated_at: { definition: 'DATETIME(3) NOT NULL', comment: '组合数据生成时间' },
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
      ten_year_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年累计收益率，单位百分比' },
      early_five_year_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '2016至2020年累计收益率，单位百分比' },
      five_year_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近5年累计收益率，单位百分比' },
      ten_year_annualized_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年年化收益率，单位百分比' },
      early_five_year_annualized_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '2016至2020年年化收益率，单位百分比' },
      five_year_annualized_return: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近5年年化收益率，单位百分比' },
      ten_year_max_drawdown: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年最大回撤，单位百分比' },
      early_five_year_max_drawdown: { definition: 'DECIMAL(18,6) NOT NULL', comment: '2016至2020年最大回撤，单位百分比' },
      five_year_max_drawdown: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近5年最大回撤，单位百分比' },
      rolling_twelve_month_return_p10: { definition: 'DECIMAL(18,6) NOT NULL', comment: '近10年滚动252交易日收益的第10百分位，单位百分比' },
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
  combination_run_rules: {
    table: 'ETF组合批次交易规则表',
    columns: {
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属组合计算批次主键' },
      frequency: { definition: 'VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '调仓频率：daily或weekly' },
      momentum_period: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '动量计算交易日数' },
      moving_average_period: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '趋势均线交易日数' },
      hold_rank_limit: { definition: 'SMALLINT UNSIGNED NULL', comment: '继续持有所允许的最低排名' },
      minimum_pool_size: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '参与组合枚举的最少ETF数量' },
    },
  },
  combination_run_periods: {
    table: 'ETF组合批次回测区间表',
    columns: {
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属组合计算批次主键' },
      period_type: { definition: 'VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '区间类型：tenYear、earlyFiveYear、fiveYear或currentYear' },
      period_year: { definition: 'SMALLINT UNSIGNED NULL', comment: '当年区间对应年份，长期区间为空' },
      start_date: { definition: 'DATE NOT NULL', comment: '回测区间起始交易日' },
      end_date: { definition: 'DATE NOT NULL', comment: '回测区间结束交易日' },
    },
  },
  combination_run_universe: {
    table: 'ETF组合批次候选标的表',
    columns: {
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属组合计算批次主键' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '候选ETF代码' },
      etf_name: { definition: 'VARCHAR(100) NOT NULL', comment: '计算时使用的ETF名称' },
      asset_class: { definition: 'VARCHAR(32) NOT NULL', comment: '计算时使用的资产类别' },
      first_date: { definition: 'DATE NOT NULL', comment: '候选ETF可用行情首日' },
      last_date: { definition: 'DATE NOT NULL', comment: '候选ETF可用行情末日' },
      display_order: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '候选ETF原始顺序' },
    },
  },
  combination_scoring: {
    table: 'ETF组合批次综合评分公式表',
    columns: {
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属组合计算批次主键' },
      formula: { definition: 'VARCHAR(500) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '标准化加权综合评分公式' },
    },
  },
  combination_score_metrics: {
    table: 'ETF组合批次评分总体参数表',
    columns: {
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属组合计算批次主键' },
      metric_code: { definition: 'VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '参与标准化的指标编码' },
      mean_value: { definition: 'DECIMAL(20,8) NOT NULL', comment: '该指标在全部组合中的均值' },
      standard_deviation: { definition: 'DECIMAL(20,8) NOT NULL', comment: '该指标在全部组合中的标准差' },
    },
  },
  combination_result_etfs: {
    table: 'ETF组合结果成员表',
    columns: {
      result_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属组合结果主键' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '组合包含的ETF代码' },
      display_order: { definition: 'TINYINT UNSIGNED NOT NULL', comment: 'ETF在组合中的原始顺序' },
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

async function hasColumn(connection: PoolConnection | Pool, table: string, column: string) {
  const [rows] = await connection.query<Array<RowDataPacket & { total: number }>>(
    'SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    [table, column],
  );
  return Number(rows[0]?.total) > 0;
}

async function saveCombinationRelations(connection: PoolConnection | Pool, runId: number, record: Pick<CombinationFile, 'rule' | 'periods' | 'universe' | 'scoring'>) {
  const rule = (record.rule ?? {}) as Record<string, unknown>;
  await connection.execute('DELETE FROM combination_run_rules WHERE run_id=?', [runId]);
  if (rule.frequency) {
    await connection.execute(`INSERT INTO combination_run_rules (run_id, frequency, momentum_period, moving_average_period, hold_rank_limit, minimum_pool_size) VALUES (?, ?, ?, ?, ?, ?)`,
      [runId, String(rule.frequency), Number(rule.momentumPeriod), Number(rule.movingAveragePeriod), rule.holdRankLimit == null ? null : Number(rule.holdRankLimit), Number(rule.minimumPoolSize)]);
  }
  await connection.execute('DELETE FROM combination_run_periods WHERE run_id=?', [runId]);
  for (const [periodType, value] of Object.entries(record.periods as Record<string, any>)) {
    await connection.execute('INSERT INTO combination_run_periods (run_id, period_type, period_year, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
      [runId, periodType, value.year ?? null, value.start, value.end]);
  }
  await connection.execute('DELETE FROM combination_run_universe WHERE run_id=?', [runId]);
  const universe = record.universe as Array<Record<string, unknown>>;
  if (universe.length) {
    const placeholders = universe.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
    await connection.query(`INSERT INTO combination_run_universe (run_id, etf_code, etf_name, asset_class, first_date, last_date, display_order) VALUES ${placeholders}`,
      universe.flatMap((item, index) => [runId, item.code, item.name, item.assetClass, item.firstDate, item.lastDate, index]));
  }
  const scoring = record.scoring as Record<string, any>;
  await connection.execute('DELETE FROM combination_scoring WHERE run_id=?', [runId]);
  await connection.execute('INSERT INTO combination_scoring (run_id, formula) VALUES (?, ?)', [runId, scoring.formula]);
  await connection.execute('DELETE FROM combination_score_metrics WHERE run_id=?', [runId]);
  const metrics = Object.entries(scoring.population ?? {}) as Array<[string, { mean: number; standardDeviation: number }]>;
  if (metrics.length) {
    const placeholders = metrics.map(() => '(?, ?, ?, ?)').join(',');
    await connection.query(`INSERT INTO combination_score_metrics (run_id, metric_code, mean_value, standard_deviation) VALUES ${placeholders}`,
      metrics.flatMap(([code, value]) => [runId, code, value.mean, value.standardDeviation]));
  }
}

async function normalizeCombinationRelations(connection: PoolConnection | Pool) {
  const hasLegacyRunColumns = await hasColumn(connection, 'combination_runs', 'periods_json');
  const hasLegacyResultColumns = await hasColumn(connection, 'combination_results', 'codes_json');
  if (hasLegacyRunColumns) {
    const [runs] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
      'SELECT id, rule_json, periods_json, universe_json, scoring_json FROM combination_runs',
    );
    for (const row of runs) {
      await saveCombinationRelations(connection, Number(row.id), {
        rule: row.rule_json === null ? undefined : jsonValue(row.rule_json),
        periods: jsonValue(row.periods_json),
        universe: jsonValue(row.universe_json),
        scoring: jsonValue(row.scoring_json),
      });
    }
  }
  if (hasLegacyResultColumns) {
    let cursor = 0;
    while (true) {
      const [rows] = await connection.query<Array<RowDataPacket & { id: number; codes_json: unknown }>>(
        'SELECT id, codes_json FROM combination_results WHERE id > ? ORDER BY id LIMIT 5000', [cursor],
      );
      if (!rows.length) break;
      const members = rows.flatMap((row) => jsonValue<string[]>(row.codes_json).map((code, index) => [row.id, code, index]));
      for (let index = 0; index < members.length; index += 5000) {
        const batch = members.slice(index, index + 5000);
        const placeholders = batch.map(() => '(?, ?, ?)').join(',');
        await connection.query(`INSERT INTO combination_result_etfs (result_id, etf_code, display_order) VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE display_order=VALUES(display_order)`, batch.flat());
      }
      cursor = Number(rows.at(-1)!.id);
    }
  }
  const [counts] = await connection.query<Array<RowDataPacket & { expected: number; actual: number }>>(
    `SELECT (SELECT COALESCE(SUM(etf_count),0) FROM combination_results) AS expected,
      (SELECT COUNT(*) FROM combination_result_etfs) AS actual`,
  );
  if (Number(counts[0].expected) !== Number(counts[0].actual)) throw new Error(`组合成员迁移不完整：期望 ${counts[0].expected}，实际 ${counts[0].actual}`);
  const resultColumns = (await Promise.all(['codes_json', 'asset_classes_json'].map(async (column) => await hasColumn(connection, 'combination_results', column) ? column : null))).filter(Boolean);
  if (resultColumns.length) await connection.query(`ALTER TABLE combination_results ${resultColumns.map((column) => `DROP COLUMN ${column}`).join(', ')}`);
  const runColumns = (await Promise.all(['rule_json', 'periods_json', 'universe_json', 'scoring_json'].map(async (column) => await hasColumn(connection, 'combination_runs', column) ? column : null))).filter(Boolean);
  if (runColumns.length) await connection.query(`ALTER TABLE combination_runs ${runColumns.map((column) => `DROP COLUMN ${column}`).join(', ')}`);
}

async function createSchema(connection: PoolConnection | Pool) {
  await createRelationalSchema(connection);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS combination_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '计算批次主键',
      strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '策略编码',
      source_version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '源组合文件版本',
      source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '源组合文件SHA-256哈希',
      generated_at DATETIME(3) NOT NULL COMMENT '组合数据生成时间',
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
      ten_year_return DECIMAL(18,6) NOT NULL COMMENT '近10年累计收益率，单位百分比',
      early_five_year_return DECIMAL(18,6) NOT NULL COMMENT '2016至2020年累计收益率，单位百分比',
      five_year_return DECIMAL(18,6) NOT NULL COMMENT '近5年累计收益率，单位百分比',
      ten_year_annualized_return DECIMAL(18,6) NOT NULL COMMENT '近10年年化收益率，单位百分比',
      early_five_year_annualized_return DECIMAL(18,6) NOT NULL COMMENT '2016至2020年年化收益率，单位百分比',
      five_year_annualized_return DECIMAL(18,6) NOT NULL COMMENT '近5年年化收益率，单位百分比',
      ten_year_max_drawdown DECIMAL(18,6) NOT NULL COMMENT '近10年最大回撤，单位百分比',
      early_five_year_max_drawdown DECIMAL(18,6) NOT NULL COMMENT '2016至2020年最大回撤，单位百分比',
      five_year_max_drawdown DECIMAL(18,6) NOT NULL COMMENT '近5年最大回撤，单位百分比',
      rolling_twelve_month_return_p10 DECIMAL(18,6) NOT NULL COMMENT '近10年滚动252交易日收益的第10百分位，单位百分比',
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
  const combinationResultAdditions: string[] = [];
  if (!(await hasColumn(connection, 'combination_results', 'early_five_year_return'))) combinationResultAdditions.push("ADD COLUMN early_five_year_return DECIMAL(18,6) NOT NULL DEFAULT 0 COMMENT '2016至2020年累计收益率，单位百分比'");
  if (!(await hasColumn(connection, 'combination_results', 'early_five_year_annualized_return'))) combinationResultAdditions.push("ADD COLUMN early_five_year_annualized_return DECIMAL(18,6) NOT NULL DEFAULT 0 COMMENT '2016至2020年年化收益率，单位百分比'");
  if (!(await hasColumn(connection, 'combination_results', 'early_five_year_max_drawdown'))) combinationResultAdditions.push("ADD COLUMN early_five_year_max_drawdown DECIMAL(18,6) NOT NULL DEFAULT 0 COMMENT '2016至2020年最大回撤，单位百分比'");
  if (!(await hasColumn(connection, 'combination_results', 'rolling_twelve_month_return_p10'))) combinationResultAdditions.push("ADD COLUMN rolling_twelve_month_return_p10 DECIMAL(18,6) NOT NULL DEFAULT 0 COMMENT '近10年滚动252交易日收益的第10百分位，单位百分比'");
  if (combinationResultAdditions.length) await connection.query(`ALTER TABLE combination_results ${combinationResultAdditions.join(', ')}`);
  await connection.query(`CREATE TABLE IF NOT EXISTS combination_run_rules (
    run_id BIGINT UNSIGNED NOT NULL COMMENT '所属组合计算批次主键', frequency VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '调仓频率：daily或weekly',
    momentum_period SMALLINT UNSIGNED NOT NULL COMMENT '动量计算交易日数', moving_average_period SMALLINT UNSIGNED NOT NULL COMMENT '趋势均线交易日数',
    hold_rank_limit SMALLINT UNSIGNED NULL COMMENT '继续持有所允许的最低排名', minimum_pool_size SMALLINT UNSIGNED NOT NULL COMMENT '参与组合枚举的最少ETF数量',
    PRIMARY KEY (run_id), CONSTRAINT fk_combination_rule_run FOREIGN KEY (run_id) REFERENCES combination_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合批次交易规则表'`);
  await connection.query(`CREATE TABLE IF NOT EXISTS combination_run_periods (
    run_id BIGINT UNSIGNED NOT NULL COMMENT '所属组合计算批次主键', period_type VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '区间类型：tenYear、earlyFiveYear、fiveYear或currentYear',
    period_year SMALLINT UNSIGNED NULL COMMENT '当年区间对应年份，长期区间为空', start_date DATE NOT NULL COMMENT '回测区间起始交易日', end_date DATE NOT NULL COMMENT '回测区间结束交易日',
    PRIMARY KEY (run_id, period_type), CONSTRAINT fk_combination_period_run FOREIGN KEY (run_id) REFERENCES combination_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合批次回测区间表'`);
  await connection.query(`CREATE TABLE IF NOT EXISTS combination_run_universe (
    run_id BIGINT UNSIGNED NOT NULL COMMENT '所属组合计算批次主键', etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '候选ETF代码', etf_name VARCHAR(100) NOT NULL COMMENT '计算时使用的ETF名称',
    asset_class VARCHAR(32) NOT NULL COMMENT '计算时使用的资产类别', first_date DATE NOT NULL COMMENT '候选ETF可用行情首日', last_date DATE NOT NULL COMMENT '候选ETF可用行情末日', display_order SMALLINT UNSIGNED NOT NULL COMMENT '候选ETF原始顺序',
    PRIMARY KEY (run_id, etf_code), UNIQUE KEY uk_combination_universe_order (run_id, display_order), CONSTRAINT fk_combination_universe_run FOREIGN KEY (run_id) REFERENCES combination_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合批次候选标的表'`);
  await connection.query(`CREATE TABLE IF NOT EXISTS combination_scoring (
    run_id BIGINT UNSIGNED NOT NULL COMMENT '所属组合计算批次主键', formula VARCHAR(500) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '标准化加权综合评分公式',
    PRIMARY KEY (run_id), CONSTRAINT fk_combination_scoring_run FOREIGN KEY (run_id) REFERENCES combination_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合批次综合评分公式表'`);
  await connection.query(`CREATE TABLE IF NOT EXISTS combination_score_metrics (
    run_id BIGINT UNSIGNED NOT NULL COMMENT '所属组合计算批次主键', metric_code VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '参与标准化的指标编码',
    mean_value DECIMAL(20,8) NOT NULL COMMENT '该指标在全部组合中的均值', standard_deviation DECIMAL(20,8) NOT NULL COMMENT '该指标在全部组合中的标准差',
    PRIMARY KEY (run_id, metric_code), CONSTRAINT fk_combination_metric_run FOREIGN KEY (run_id) REFERENCES combination_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合批次评分总体参数表'`);
  await connection.query(`CREATE TABLE IF NOT EXISTS combination_result_etfs (
    result_id BIGINT UNSIGNED NOT NULL COMMENT '所属组合结果主键', etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '组合包含的ETF代码',
    display_order TINYINT UNSIGNED NOT NULL COMMENT 'ETF在组合中的原始顺序', PRIMARY KEY (result_id, etf_code), UNIQUE KEY uk_combination_result_order (result_id, display_order),
    KEY idx_combination_member_etf (etf_code, result_id), CONSTRAINT fk_combination_member_result FOREIGN KEY (result_id) REFERENCES combination_results(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF组合结果成员表'`);
  await normalizeCombinationRelations(connection);
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
  await migrateLegacyDocuments(pool);
  const objects = await loadRelationalObjects(pool);
  for (const [key, content] of objects) objectCache.set(key, content);
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
  objectCache.clear();
}

function storageKey(path: string) {
  return relative(process.cwd(), path).replace(/\\/g, '/');
}

function trackWrite<T>(promise: Promise<T>) {
  pendingWrites.add(promise);
  void promise.finally(() => pendingWrites.delete(promise));
  return promise;
}

export function readMysqlObject(path: string) {
  return objectCache.get(storageKey(path)) ?? null;
}

export function listMysqlObjects(prefix: string) {
  const normalized = storageKey(prefix).replace(/\/$/, '') + '/';
  return [...objectCache.keys()].filter((key) => key.startsWith(normalized));
}

export type MysqlEtfDailyPrice = {
  etfCode: string;
  tradeDate: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};

export async function getMysqlEtfDailyPriceHistories(codes: string[]) {
  if (!pool) throw new Error('MySQL 尚未初始化');
  const normalizedCodes = [...new Set(codes.map((code) => code.trim()).filter((code) => /^\d{6}$/.test(code)))];
  const histories = new Map<string, MysqlEtfDailyPrice[]>();
  if (!normalizedCodes.length) return histories;
  await flushMysqlWrites();
  const [rows] = await pool.query<Array<RowDataPacket & {
    etf_code: string;
    trade_date: Date | string;
    open_price: number;
    close_price: number;
    high_price: number;
    low_price: number;
    volume: number;
  }>>(`SELECT etf_code, trade_date, open_price, close_price, high_price, low_price, volume
    FROM etf_daily_prices WHERE etf_code IN (?) ORDER BY etf_code, trade_date`, [normalizedCodes]);
  for (const row of rows) {
    const history = histories.get(row.etf_code) ?? [];
    history.push({
      etfCode: row.etf_code,
      tradeDate: mysqlDateString(row.trade_date),
      open: Number(row.open_price),
      close: Number(row.close_price),
      high: Number(row.high_price),
      low: Number(row.low_price),
      volume: Number(row.volume),
    });
    histories.set(row.etf_code, history);
  }
  return histories;
}

function updateCachedDailyPrices(prices: MysqlEtfDailyPrice[]) {
  const pricesByCode = new Map<string, Map<string, MysqlEtfDailyPrice>>();
  for (const price of prices) {
    const byDate = pricesByCode.get(price.etfCode) ?? new Map<string, MysqlEtfDailyPrice>();
    byDate.set(price.tradeDate, price);
    pricesByCode.set(price.etfCode, byDate);
  }
  for (const [key, content] of objectCache) {
    const code = /\/history\/(\d{6})\.json$/.exec(key)?.[1];
    const updates = code ? pricesByCode.get(code) : undefined;
    if (!updates) continue;
    const value = JSON.parse(content) as { rows?: Array<Array<string | number>> };
    const rows = Array.isArray(value.rows) ? [...value.rows] : [];
    const indexes = new Map(rows.map((row, index) => [String(row[0]), index]));
    for (const price of updates.values()) {
      const nextRow: Array<string | number> = [price.tradeDate, price.open, price.close, price.high, price.low, price.volume];
      const index = indexes.get(price.tradeDate);
      if (index === undefined) rows.push(nextRow);
      else rows[index] = nextRow;
    }
    rows.sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    objectCache.set(key, `${JSON.stringify({ ...value, rows }, null, 2)}\n`);
  }
}

export async function upsertMysqlEtfDailyPrices(prices: MysqlEtfDailyPrice[]) {
  if (!pool) throw new Error('MySQL 尚未初始化');
  if (!prices.length) return 0;
  await flushMysqlWrites();
  for (let offset = 0; offset < prices.length; offset += 500) {
    const batch = prices.slice(offset, offset + 500);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, NOW(3))').join(', ');
    const values = batch.flatMap((price) => [
      price.etfCode,
      price.tradeDate,
      price.open,
      price.close,
      price.high,
      price.low,
      price.volume,
    ]);
    await pool.execute(`INSERT INTO etf_daily_prices
      (etf_code, trade_date, open_price, close_price, high_price, low_price, volume, updated_at)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE open_price=VALUES(open_price), close_price=VALUES(close_price),
        high_price=VALUES(high_price), low_price=VALUES(low_price), volume=VALUES(volume), updated_at=NOW(3)`, values);
  }
  updateCachedDailyPrices(prices);
  return prices.length;
}

export function queueMysqlObjectWrite(path: string, content: string) {
  if (!pool) return Promise.resolve(false);
  JSON.parse(content);
  const key = storageKey(path);
  objectCache.set(key, content);
  return trackWrite(persistRelationalObject(pool, key, content).then(() => true));
}

export async function replaceMysqlObjects(objects: Array<{ path: string; content: string }>) {
  if (!pool) throw new Error('MySQL 尚未初始化');
  const records = objects.map(({ path, content }) => {
    JSON.parse(content);
    const key = storageKey(path);
    return { key, content };
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const record of records) await persistRelationalObject(connection, record.key, record.content);
    await connection.commit();
    for (const record of records) objectCache.set(record.key, record.content);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function queueMysqlObjectDelete(path: string) {
  if (!pool) return Promise.resolve(false);
  const key = storageKey(path);
  objectCache.delete(key);
  return trackWrite(deleteRelationalObject(pool, key).then(() => true));
}

export async function flushMysqlWrites() {
  while (pendingWrites.size) await Promise.all([...pendingWrites]);
}

function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function mysqlDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function mysqlDateString(value: string | Date) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

async function insertCombinationBatch(connection: PoolConnection, runId: number, items: StoredCombination[]) {
  if (!items.length) return;
  const columns = 23;
  const placeholders = items.map(() => `(${new Array(columns).fill('?').join(',')})`).join(',');
  const values = items.flatMap((item) => [
    runId,
    createHash('sha256').update(item.id).digest(),
    item.id,
    item.size,
    item.tenYearReturn,
    item.earlyFiveYearReturn,
    item.fiveYearReturn,
    item.tenYearAnnualizedReturn,
    item.earlyFiveYearAnnualizedReturn,
    item.fiveYearAnnualizedReturn,
    item.tenYearMaxDrawdown,
    item.earlyFiveYearMaxDrawdown,
    item.fiveYearMaxDrawdown,
    item.rollingTwelveMonthReturnP10,
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
      run_id, combination_hash, combination_key, etf_count,
      ten_year_return, early_five_year_return, five_year_return,
      ten_year_annualized_return, early_five_year_annualized_return, five_year_annualized_return,
      ten_year_max_drawdown, early_five_year_max_drawdown, five_year_max_drawdown, rolling_twelve_month_return_p10, ten_year_trades,
      current_year_return, current_year_max_drawdown, current_year_trades, current_holding,
      ten_year_rank, current_year_rank, composite_score, composite_rank
    ) VALUES ${placeholders}`,
    values,
  );
  const [storedRows] = await connection.query<Array<RowDataPacket & { id: number; combination_key: string }>>(
    'SELECT id, combination_key FROM combination_results WHERE run_id=? AND combination_key IN (?)', [runId, items.map((item) => item.id)],
  );
  const ids = new Map(storedRows.map((row) => [row.combination_key, row.id]));
  const members = items.flatMap((item) => item.codes.map((code, index) => [ids.get(item.id), code, index]));
  if (members.some((member) => member[0] === undefined)) throw new Error('组合结果成员关联失败');
  const memberPlaceholders = members.map(() => '(?, ?, ?)').join(',');
  await connection.query(`INSERT INTO combination_result_etfs (result_id, etf_code, display_order) VALUES ${memberPlaceholders}`, members.flat());
}

export async function importCombinationFile(
  path: string,
  expectedStrategy: CombinationStrategy,
  onProgress?: (completed: number, total: number) => void,
  documents: Array<{ path: string; content: string }> = [],
) {
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
        strategy_code, source_version, source_hash, generated_at,
        total_combinations, best_ten_year_id, best_current_year_id, best_composite_id,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'importing', NOW(3))`,
      [
        expectedStrategy,
        record.version,
        hash,
        mysqlDate(record.generatedAt),
        record.totalCombinations,
        record.bestTenYearId ?? null,
        record.bestCurrentYearId ?? null,
        record.bestCompositeId ?? null,
      ],
    );
    runId = insertResult.insertId;
    await saveCombinationRelations(pool, runId, record);
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
  const documentRecords = documents.map(({ path: documentPath, content: documentContent }) => {
    JSON.parse(documentContent);
    const key = storageKey(documentPath);
    return { key, content: documentContent };
  });
  const activationConnection = await pool.getConnection();
  try {
    await activationConnection.beginTransaction();
    for (const document of documentRecords) await persistRelationalObject(activationConnection, document.key, document.content);
    await activationConnection.execute(
      `INSERT INTO active_combination_runs (strategy_code, run_id, updated_at)
       VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE run_id = VALUES(run_id), updated_at = NOW(3)`,
      [expectedStrategy, runId],
    );
    await activationConnection.commit();
    for (const document of documentRecords) objectCache.set(document.key, document.content);
  } catch (error) {
    await activationConnection.rollback();
    throw error;
  } finally {
    activationConnection.release();
  }
  return { runId, totalCombinations: record.totalCombinations, reused: Boolean(existing[0]) };
}

function normalizedFilters(filters: MysqlCombinationFilters) {
  const drawdown = (value?: number) => Number.isFinite(value) ? -Math.abs(Number(value)) : null;
  return {
    size: Number.isInteger(filters.size) && Number(filters.size) > 0 ? Number(filters.size) : null,
    tenYearDrawdown: drawdown(filters.tenYearDrawdown),
    fiveYearDrawdown: drawdown(filters.fiveYearDrawdown),
    currentYearDrawdown: drawdown(filters.currentYearDrawdown),
    codes: [...new Set((filters.codes ?? []).map((code) => String(code).trim()).filter((code) => /^\d{6}$/.test(code)))],
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
  const [rangeRows] = normalized.codes.length
    ? await pool.query<Array<RowDataPacket & { first_id: number; last_id: number }>>('SELECT MIN(id) AS first_id, MAX(id) AS last_id FROM combination_results WHERE run_id=?', [run.id])
    : [[]];
  const resultRange = rangeRows[0] ?? null;
  const joins: string[] = [];
  const joinParameters: unknown[] = [];
  normalized.codes.forEach((code, index) => {
    const alias = `member_filter_${index}`;
    joins.push(`INNER JOIN combination_result_etfs ${alias} ON ${alias}.result_id=combination_results.id AND ${alias}.etf_code=?${index === 0 ? ` AND ${alias}.result_id BETWEEN ? AND ?` : ''}`);
    joinParameters.push(code);
    if (index === 0) joinParameters.push(Number(resultRange?.first_id ?? 0), Number(resultRange?.last_id ?? 0));
  });
  const clauses = ['combination_results.run_id = ?'];
  const whereParameters: unknown[] = [run.id];
  if (normalized.size !== null) { clauses.push('etf_count = ?'); whereParameters.push(normalized.size); }
  if (normalized.tenYearDrawdown !== null) { clauses.push('ten_year_max_drawdown >= ?'); whereParameters.push(normalized.tenYearDrawdown); }
  if (normalized.fiveYearDrawdown !== null) { clauses.push('five_year_max_drawdown >= ?'); whereParameters.push(normalized.fiveYearDrawdown); }
  if (normalized.currentYearDrawdown !== null) { clauses.push('current_year_max_drawdown >= ?'); whereParameters.push(normalized.currentYearDrawdown); }
  const parameters = [...joinParameters, ...whereParameters];
  const from = `combination_results ${joins.join(' ')}`;
  const where = clauses.join(' AND ');
  const [counts] = await pool.query<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`,
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
  const rowSelection = `SELECT combination_results.* FROM ${from} WHERE ${where} ORDER BY ${orderBy}`;
  const [rows] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `${rowSelection} LIMIT ${normalizedPageSize} OFFSET ${offset}`,
    parameters,
  );
  let bestRow: (RowDataPacket & Record<string, unknown>) | null = rows[0] ?? null;
  if (totalCombinations > 0 && normalizedPage !== 1) {
    const [bestRows] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(`${rowSelection} LIMIT 1`, parameters);
    bestRow = bestRows[0] ?? null;
  }
  const resultIds = [...new Set([...rows, ...(bestRow ? [bestRow] : [])].map((row) => Number(row.id)))];
  const codeMap = new Map<number, string[]>();
  if (resultIds.length) {
    const [memberRows] = await pool.query<Array<RowDataPacket & { result_id: number; etf_code: string }>>(
      'SELECT result_id, etf_code FROM combination_result_etfs WHERE result_id IN (?) ORDER BY result_id, display_order', [resultIds],
    );
    for (const member of memberRows) {
      const codes = codeMap.get(Number(member.result_id)) ?? [];
      codes.push(member.etf_code);
      codeMap.set(Number(member.result_id), codes);
    }
  }
  const [periodRows] = await pool.query<Array<RowDataPacket & { period_type: string; period_year: number | null; start_date: Date | string; end_date: Date | string }>>(
    'SELECT * FROM combination_run_periods WHERE run_id=? ORDER BY period_type', [run.id],
  );
  const periods = Object.fromEntries(periodRows.map((period) => [period.period_type, {
    ...(period.period_year === null ? {} : { year: Number(period.period_year) }),
    start: mysqlDateString(period.start_date),
    end: mysqlDateString(period.end_date),
  }]));
  const [universeRows] = await pool.query<Array<RowDataPacket & { etf_code: string; etf_name: string; asset_class: string; first_date: Date | string; last_date: Date | string }>>(
    'SELECT * FROM combination_run_universe WHERE run_id=? ORDER BY display_order', [run.id],
  );
  const universe = universeRows.map((item) => ({ code: item.etf_code, name: item.etf_name, assetClass: item.asset_class,
    firstDate: mysqlDateString(item.first_date), lastDate: mysqlDateString(item.last_date) }));
  const assetClassByCode = new Map(universe.map((item) => [item.code, item.assetClass]));
  const [scoringRows] = await pool.query<Array<RowDataPacket & { formula: string }>>('SELECT formula FROM combination_scoring WHERE run_id=?', [run.id]);
  const [metricRows] = await pool.query<Array<RowDataPacket & { metric_code: string; mean_value: number; standard_deviation: number }>>(
    'SELECT * FROM combination_score_metrics WHERE run_id=? ORDER BY metric_code', [run.id],
  );
  const scoring = { formula: scoringRows[0]?.formula ?? '', population: Object.fromEntries(metricRows.map((metric) => [metric.metric_code, {
    mean: Number(metric.mean_value), standardDeviation: Number(metric.standard_deviation),
  }])) };
  const mapCombination = (row: RowDataPacket & Record<string, unknown>, displayRank: number) => ({
    id: String(row.combination_key),
    size: Number(row.etf_count),
    codes: codeMap.get(Number(row.id)) ?? [],
    assetClasses: [...new Set((codeMap.get(Number(row.id)) ?? []).map((code) => assetClassByCode.get(code)).filter((value): value is string => Boolean(value)))],
    tenYearReturn: Number(row.ten_year_return),
    earlyFiveYearReturn: Number(row.early_five_year_return),
    fiveYearReturn: Number(row.five_year_return),
    tenYearAnnualizedReturn: Number(row.ten_year_annualized_return),
    earlyFiveYearAnnualizedReturn: Number(row.early_five_year_annualized_return),
    fiveYearAnnualizedReturn: Number(row.five_year_annualized_return),
    tenYearMaxDrawdown: Number(row.ten_year_max_drawdown),
    earlyFiveYearMaxDrawdown: Number(row.early_five_year_max_drawdown),
    fiveYearMaxDrawdown: Number(row.five_year_max_drawdown),
    rollingTwelveMonthReturnP10: Number(row.rolling_twelve_month_return_p10),
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
  const best = bestRow ? mapCombination(bestRow, 1) : null;
  return {
    version: String(run.source_version),
    generatedAt: new Date(run.generated_at as string | Date).toISOString(),
    periods,
    universe,
    totalCombinations,
    allCombinations: Number(run.total_combinations),
    filters: normalized,
    scoring,
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
  const [legacyTables] = await pool.query<Array<RowDataPacket & { total: number }>>(
    "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_documents'",
  );
  const [legacyColumns] = await pool.query<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (
      (TABLE_NAME='combination_runs' AND COLUMN_NAME IN ('rule_json','periods_json','universe_json','scoring_json')) OR
      (TABLE_NAME='combination_results' AND COLUMN_NAME IN ('codes_json','asset_classes_json'))
    )`,
  );
  const [entityRows] = await pool.query<Array<RowDataPacket & Record<string, number>>>(`SELECT
    (SELECT COUNT(*) FROM strategies) AS strategies,
    (SELECT COUNT(*) FROM etfs) AS etfs,
    (SELECT COUNT(*) FROM etf_daily_prices) AS dailyPrices,
    (SELECT COUNT(*) FROM strategy_configs) AS strategyConfigs,
    (SELECT COUNT(*) FROM strategy_backtests) AS backtests,
    (SELECT COUNT(*) FROM strategy_backtest_years) AS backtestYears,
    (SELECT COUNT(*) FROM strategy_year_performance) AS yearPerformances,
    (SELECT COUNT(*) FROM strategy_equity_points) AS equityPoints,
    (SELECT COUNT(*) FROM strategy_trade_nodes) AS tradeNodes,
    (SELECT COUNT(*) FROM stock_scan_runs) AS scanRuns,
    (SELECT COUNT(*) FROM stock_scan_results) AS scanResults,
    (SELECT COUNT(*) FROM combination_result_etfs) AS combinationMembers`);
  const [runs] = await pool.query<Array<RowDataPacket & { strategy_code: string; total_combinations: number; stored_combinations: number }>>(
    `SELECT r.strategy_code, r.total_combinations, COUNT(c.id) AS stored_combinations FROM active_combination_runs a
     INNER JOIN combination_runs r ON r.id = a.run_id
     LEFT JOIN combination_results c ON c.run_id = r.id
     GROUP BY r.id, r.strategy_code, r.total_combinations ORDER BY r.strategy_code`,
  );
  return { objects: objectCache.size, legacyDocumentTables: Number(legacyTables[0]?.total ?? 0), legacyJsonColumns: Number(legacyColumns[0]?.total ?? 0), entityCounts: entityRows[0], runs };
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
