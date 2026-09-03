import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type Database = Pool | PoolConnection;

export type RelationalSchemaComment = {
  table: string;
  columns: Record<string, { definition: string; comment: string }>;
};

export const relationalSchemaComments: Record<string, RelationalSchemaComment> = {
  strategies: {
    table: '交易策略定义表',
    columns: {
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '策略唯一编码' },
      strategy_name: { definition: 'VARCHAR(80) NOT NULL', comment: '策略显示名称' },
      strategy_type: { definition: 'VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '策略类型：index_rotation或stock_scan' },
      description: { definition: 'VARCHAR(255) NULL', comment: '策略用途说明' },
      created_at: { definition: 'DATETIME(3) NOT NULL', comment: '策略记录创建时间' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '策略记录更新时间' },
    },
  },
  etfs: {
    table: 'ETF基础信息表',
    columns: {
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: 'ETF六位交易代码' },
      market_code: { definition: 'VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '带交易所前缀的行情代码' },
      etf_name: { definition: 'VARCHAR(100) NOT NULL', comment: 'ETF名称' },
      category: { definition: 'VARCHAR(32) NULL', comment: '资产分类，如A股宽基、海外指数、商品或债券' },
      created_at: { definition: 'DATETIME(3) NOT NULL', comment: 'ETF记录创建时间' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: 'ETF记录更新时间' },
    },
  },
  strategy_configs: {
    table: '指数策略配置版本表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '配置主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '所属指数策略编码' },
      config_kind: { definition: 'VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '配置用途：rotation_pool或combination_pool' },
      config_state: { definition: 'VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '配置状态：active或pending' },
      version: { definition: 'INT UNSIGNED NOT NULL', comment: '配置版本号' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '配置业务更新时间' },
    },
  },
  strategy_config_etfs: {
    table: '指数策略配置ETF成员表',
    columns: {
      config_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属配置主键' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: 'ETF六位交易代码' },
      display_order: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: 'ETF在标的池中的显示顺序' },
    },
  },
  strategy_saved_pools: {
    table: '用户命名保存的指数策略轮动标的池表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '已保存标的池主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '所属指数策略编码' },
      pool_name: { definition: 'VARCHAR(40) NOT NULL', comment: '用户为标的池设置的名称' },
      created_at: { definition: 'DATETIME(3) NOT NULL', comment: '标的池首次保存时间' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '标的池最近覆盖保存时间' },
    },
  },
  strategy_saved_pool_etfs: {
    table: '用户命名保存的轮动标的池ETF成员表',
    columns: {
      saved_pool_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属已保存标的池主键' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '标的池包含的ETF六位交易代码' },
      display_order: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: 'ETF在已保存标的池中的显示顺序' },
    },
  },
  strategy_history_etfs: {
    table: '策略可用ETF历史行情清单表',
    columns: {
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '使用该历史行情的指数策略编码' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: 'ETF六位交易代码' },
      display_name: { definition: 'VARCHAR(100) NOT NULL', comment: '生成历史数据时使用的ETF名称' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '历史行情最近同步时间' },
    },
  },
  etf_daily_prices: {
    table: 'ETF前复权日线行情表',
    columns: {
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: 'ETF六位交易代码' },
      trade_date: { definition: 'DATE NOT NULL', comment: '交易日期' },
      open_price: { definition: 'DECIMAL(20,8) NOT NULL', comment: '前复权开盘价' },
      close_price: { definition: 'DECIMAL(20,8) NOT NULL', comment: '前复权收盘价' },
      high_price: { definition: 'DECIMAL(20,8) NOT NULL', comment: '前复权最高价' },
      low_price: { definition: 'DECIMAL(20,8) NOT NULL', comment: '前复权最低价' },
      volume: { definition: 'DECIMAL(24,4) NOT NULL', comment: '成交量' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '行情记录更新时间' },
    },
  },
  strategy_backtests: {
    table: '指数策略近十年回测汇总表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '回测主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '所属指数策略编码' },
      backtest_version: { definition: 'VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '回测算法版本' },
      config_version: { definition: 'INT UNSIGNED NOT NULL', comment: '回测使用的标的池配置版本' },
      generated_at: { definition: 'DATETIME(3) NOT NULL', comment: '回测生成时间' },
      start_date: { definition: 'DATE NOT NULL', comment: '回测起始交易日' },
      end_date: { definition: 'DATE NOT NULL', comment: '回测结束交易日' },
      cumulative_return: { definition: 'DECIMAL(20,8) NOT NULL', comment: '回测累计收益率，单位百分比' },
      annualized_return: { definition: 'DECIMAL(20,8) NOT NULL', comment: '回测年化收益率，单位百分比' },
      positive_years: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '正收益年份数量' },
      worst_drawdown: { definition: 'DECIMAL(20,8) NOT NULL', comment: '回测最大回撤，单位百分比' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '回测记录更新时间' },
    },
  },
  strategy_backtest_etfs: {
    table: '指数策略回测ETF快照表',
    columns: {
      backtest_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属回测主键' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '回测使用的ETF代码' },
      display_order: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: 'ETF在回测标的池中的顺序' },
    },
  },
  strategy_backtest_years: {
    table: '指数策略回测年度收益表',
    columns: {
      backtest_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属回测主键' },
      performance_year: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '收益所属年份' },
      return_rate: { definition: 'DECIMAL(20,8) NOT NULL', comment: '年度收益率，单位百分比' },
      max_drawdown: { definition: 'DECIMAL(20,8) NOT NULL', comment: '年度最大回撤，单位百分比' },
      trade_count: { definition: 'INT UNSIGNED NOT NULL', comment: '年度交易或调仓次数' },
      available_assets: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '当年满足上市条件的可用ETF数量' },
      year_end_holding: { definition: 'VARCHAR(100) NOT NULL', comment: '年末持仓ETF名称，空仓时为空字符串' },
    },
  },
  strategy_year_performance: {
    table: '指数策略年度实时表现汇总表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '年度表现主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '所属指数策略编码' },
      performance_year: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '统计年份' },
      performance_version: { definition: 'VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '年度表现计算版本' },
      config_version: { definition: 'INT UNSIGNED NOT NULL', comment: '计算使用的标的池配置版本' },
      provider: { definition: 'VARCHAR(80) NOT NULL', comment: '行情数据提供方' },
      calculated_at: { definition: 'DATETIME(3) NOT NULL', comment: '计算完成时间' },
      start_date: { definition: 'DATE NOT NULL', comment: '年度统计起始交易日' },
      last_trading_date: { definition: 'DATE NOT NULL', comment: '年度统计截至交易日' },
      cumulative_return: { definition: 'DECIMAL(20,8) NOT NULL', comment: '年内累计收益率，单位百分比' },
      current_holding: { definition: 'VARCHAR(100) NULL', comment: '当前持仓ETF名称，空仓时为空' },
      current_trade_return: { definition: 'DECIMAL(20,8) NULL', comment: '当前持仓单次收益率，单位百分比' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '年度表现记录更新时间' },
    },
  },
  strategy_year_etfs: {
    table: '指数策略年度表现ETF快照表',
    columns: {
      performance_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属年度表现主键' },
      etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '年度计算使用的ETF代码' },
      display_order: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: 'ETF在年度标的池中的顺序' },
    },
  },
  strategy_equity_points: {
    table: '指数策略年度收益曲线点表',
    columns: {
      performance_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属年度表现主键' },
      trade_date: { definition: 'DATE NOT NULL', comment: '收益曲线交易日期' },
      return_rate: { definition: 'DECIMAL(20,8) NOT NULL', comment: '截至该日累计收益率，单位百分比' },
    },
  },
  strategy_trade_nodes: {
    table: '指数策略年度交易操作节点表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '操作节点主键' },
      performance_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属年度表现主键' },
      node_order: { definition: 'SMALLINT UNSIGNED NOT NULL', comment: '操作节点时间顺序' },
      trade_date: { definition: 'DATE NOT NULL', comment: '产生操作信号的交易日期' },
      action_type: { definition: 'VARCHAR(16) NOT NULL', comment: '操作类型：买入、轮换或清仓' },
      from_etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '操作前持仓ETF代码' },
      from_etf_name: { definition: 'VARCHAR(100) NULL', comment: '操作前持仓ETF名称' },
      to_etf_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL', comment: '操作后持仓ETF代码' },
      to_etf_name: { definition: 'VARCHAR(100) NULL', comment: '操作后持仓ETF名称' },
      reason: { definition: 'VARCHAR(500) NOT NULL', comment: '触发本次操作的规则说明' },
      trade_return: { definition: 'DECIMAL(20,8) NULL', comment: '本次已结束持仓收益率，单位百分比' },
      cumulative_return: { definition: 'DECIMAL(20,8) NOT NULL', comment: '操作发生时累计收益率，单位百分比' },
    },
  },
  stock_scan_runs: {
    table: '个股策略扫描批次表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '扫描批次主键' },
      strategy_code: { definition: 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '所属个股扫描策略编码' },
      scan_version: { definition: 'VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '扫描算法版本' },
      storage_date: { definition: 'DATE NOT NULL', comment: '页面查询和持久化使用的交易日期' },
      provider: { definition: 'VARCHAR(80) NOT NULL', comment: '行情数据提供方' },
      fetched_at: { definition: 'DATETIME(3) NOT NULL', comment: '行情获取完成时间' },
      last_trading_date: { definition: 'DATE NOT NULL', comment: '扫描使用的实际交易日' },
      cached: { definition: 'TINYINT(1) NOT NULL', comment: '保存时是否来自缓存' },
      scanned_count: { definition: 'INT UNSIGNED NOT NULL', comment: '参与扫描的证券数量' },
      excluded_count: { definition: 'INT UNSIGNED NOT NULL', comment: '扫描前排除的证券数量' },
      first_cross_count: { definition: 'INT UNSIGNED NULL', comment: 'MACD首次金叉数量' },
      low_cross_count: { definition: 'INT UNSIGNED NULL', comment: 'MACD与KDJ低位双金叉数量' },
      divergence_count: { definition: 'INT UNSIGNED NULL', comment: '底背离共振数量' },
      breakout_count: { definition: 'INT UNSIGNED NULL', comment: '量价同步突破数量' },
      support_count: { definition: 'INT UNSIGNED NULL', comment: '量能共振支撑数量' },
      pullback_count: { definition: 'INT UNSIGNED NULL', comment: '缩量回踩蓄力数量' },
      updated_at: { definition: 'DATETIME(3) NOT NULL', comment: '扫描批次更新时间' },
    },
  },
  stock_scan_results: {
    table: '个股策略扫描结果明细表',
    columns: {
      id: { definition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', comment: '扫描结果主键' },
      run_id: { definition: 'BIGINT UNSIGNED NOT NULL', comment: '所属扫描批次主键' },
      result_order: { definition: 'INT UNSIGNED NOT NULL', comment: '结果在页面中的原始顺序' },
      security_code: { definition: 'CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL', comment: '股票六位交易代码' },
      security_name: { definition: 'VARCHAR(100) NOT NULL', comment: '股票名称' },
      close_price: { definition: 'DECIMAL(20,8) NOT NULL', comment: '信号日收盘价' },
      change_rate: { definition: 'DECIMAL(20,8) NOT NULL', comment: '信号日涨跌幅，单位百分比' },
      current_price: { definition: 'DECIMAL(20,8) NULL', comment: '历史查询时补充的当前价格' },
      change_since_signal: { definition: 'DECIMAL(20,8) NULL', comment: '信号日至今涨跌幅，单位百分比' },
      dif_value: { definition: 'DECIMAL(20,8) NULL', comment: 'MACD DIF指标值' },
      dea_value: { definition: 'DECIMAL(20,8) NULL', comment: 'MACD DEA指标值' },
      histogram_value: { definition: 'DECIMAL(20,8) NULL', comment: 'MACD柱值' },
      histogram_change: { definition: 'DECIMAL(20,8) NULL', comment: 'MACD柱变化值' },
      ma20: { definition: 'DECIMAL(20,8) NULL', comment: '20日均价' },
      ma25: { definition: 'DECIMAL(20,8) NULL', comment: '25日均价' },
      support_distance: { definition: 'DECIMAL(20,8) NULL', comment: '价格到均线支撑的距离，单位百分比' },
      pullback_rate: { definition: 'DECIMAL(20,8) NULL', comment: '阶段回踩幅度，单位百分比' },
      volume_ratio: { definition: 'DECIMAL(20,8) NULL', comment: '成交量比例' },
      cross_days_ago: { definition: 'SMALLINT NULL', comment: 'MACD交叉距信号日的交易日数' },
      score: { definition: 'DECIMAL(20,8) NULL', comment: '策略内部评分' },
      k_value: { definition: 'DECIMAL(20,8) NULL', comment: 'KDJ K值' },
      d_value: { definition: 'DECIMAL(20,8) NULL', comment: 'KDJ D值' },
      j_value: { definition: 'DECIMAL(20,8) NULL', comment: 'KDJ J值' },
      kdj_cross_days_ago: { definition: 'SMALLINT NULL', comment: 'KDJ交叉距信号日的交易日数' },
      divergence: { definition: 'TINYINT(1) NULL', comment: '是否出现底背离' },
      volume_ma5: { definition: 'DECIMAL(24,4) NULL', comment: '5日成交量均值' },
      volume_ma60: { definition: 'DECIMAL(24,4) NULL', comment: '60日成交量均值' },
      price_cross_days_ago: { definition: 'SMALLINT NULL', comment: '价格突破距信号日的交易日数' },
      volume_cross_days_ago: { definition: 'SMALLINT NULL', comment: '量能突破距信号日的交易日数' },
      var1_value: { definition: 'DECIMAL(20,8) NULL', comment: '多空指标VAR1当前值' },
      trend_line: { definition: 'DECIMAL(20,8) NULL', comment: '多空指标趋势线当前值' },
      previous_var1: { definition: 'DECIMAL(20,8) NULL', comment: '多空指标VAR1前一日值' },
      previous_trend_line: { definition: 'DECIMAL(20,8) NULL', comment: '多空指标趋势线前一日值' },
      cross_spread: { definition: 'DECIMAL(20,8) NULL', comment: '多空指标交叉后的差值' },
      signal_type: { definition: 'VARCHAR(40) NOT NULL', comment: '策略产生的信号类型' },
    },
  },
};

const strategyDefinitions = [
  ['rotation', '宽基20日动量轮动', 'index_rotation', '宽基、海外、商品ETF日频轮动'],
  ['asset-rotation', '全球大类资产ETF轮动', 'index_rotation', 'A股、港股、美股、黄金和国债ETF周频轮动'],
  ['dual-etf', '双ETF动量轮动', 'index_rotation', '双ETF二十日动量日频轮动'],
  ['macd', 'MACD共振', 'stock_scan', 'MACD首次金叉与多头延续扫描'],
  ['macd-pullback', 'MACD零轴回踩', 'stock_scan', 'MACD趋势后的回踩买点扫描'],
  ['macd-kdj', 'MACD与KDJ共振', 'stock_scan', 'MACD和KDJ低位双金叉扫描'],
  ['volume', '量价三信号', 'stock_scan', '量价突破、支撑和回踩扫描'],
  ['bull-point', '多空趋势多点', 'stock_scan', '同花顺风格多空趋势多点扫描'],
] as const;

export async function createRelationalSchema(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS strategies (
    strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '策略唯一编码',
    strategy_name VARCHAR(80) NOT NULL COMMENT '策略显示名称',
    strategy_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '策略类型：index_rotation或stock_scan',
    description VARCHAR(255) NULL COMMENT '策略用途说明',
    created_at DATETIME(3) NOT NULL COMMENT '策略记录创建时间',
    updated_at DATETIME(3) NOT NULL COMMENT '策略记录更新时间',
    PRIMARY KEY (strategy_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交易策略定义表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS etfs (
    etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ETF六位交易代码',
    market_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '带交易所前缀的行情代码',
    etf_name VARCHAR(100) NOT NULL COMMENT 'ETF名称', category VARCHAR(32) NULL COMMENT '资产分类，如A股宽基、海外指数、商品或债券',
    created_at DATETIME(3) NOT NULL COMMENT 'ETF记录创建时间', updated_at DATETIME(3) NOT NULL COMMENT 'ETF记录更新时间',
    PRIMARY KEY (etf_code), KEY idx_etf_name (etf_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF基础信息表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_configs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '配置主键', strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属指数策略编码',
    config_kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '配置用途：rotation_pool或combination_pool',
    config_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '配置状态：active或pending', version INT UNSIGNED NOT NULL COMMENT '配置版本号',
    updated_at DATETIME(3) NOT NULL COMMENT '配置业务更新时间', PRIMARY KEY (id), UNIQUE KEY uk_strategy_config (strategy_code, config_kind, config_state),
    CONSTRAINT fk_strategy_config_strategy FOREIGN KEY (strategy_code) REFERENCES strategies(strategy_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略配置版本表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_config_etfs (
    config_id BIGINT UNSIGNED NOT NULL COMMENT '所属配置主键', etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ETF六位交易代码',
    display_order SMALLINT UNSIGNED NOT NULL COMMENT 'ETF在标的池中的显示顺序', PRIMARY KEY (config_id, etf_code), UNIQUE KEY uk_config_order (config_id, display_order),
    CONSTRAINT fk_config_etf_config FOREIGN KEY (config_id) REFERENCES strategy_configs(id) ON DELETE CASCADE,
    CONSTRAINT fk_config_etf_etf FOREIGN KEY (etf_code) REFERENCES etfs(etf_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略配置ETF成员表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_saved_pools (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '已保存标的池主键',
    strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属指数策略编码',
    pool_name VARCHAR(40) NOT NULL COMMENT '用户为标的池设置的名称',
    created_at DATETIME(3) NOT NULL COMMENT '标的池首次保存时间', updated_at DATETIME(3) NOT NULL COMMENT '标的池最近覆盖保存时间',
    PRIMARY KEY (id), UNIQUE KEY uk_saved_pool_name (strategy_code, pool_name), KEY idx_saved_pool_updated (strategy_code, updated_at),
    CONSTRAINT fk_saved_pool_strategy FOREIGN KEY (strategy_code) REFERENCES strategies(strategy_code) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户命名保存的指数策略轮动标的池表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_saved_pool_etfs (
    saved_pool_id BIGINT UNSIGNED NOT NULL COMMENT '所属已保存标的池主键',
    etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '标的池包含的ETF六位交易代码',
    display_order SMALLINT UNSIGNED NOT NULL COMMENT 'ETF在已保存标的池中的显示顺序',
    PRIMARY KEY (saved_pool_id, etf_code), UNIQUE KEY uk_saved_pool_etf_order (saved_pool_id, display_order),
    CONSTRAINT fk_saved_pool_etf_pool FOREIGN KEY (saved_pool_id) REFERENCES strategy_saved_pools(id) ON DELETE CASCADE,
    CONSTRAINT fk_saved_pool_etf_etf FOREIGN KEY (etf_code) REFERENCES etfs(etf_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户命名保存的轮动标的池ETF成员表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_history_etfs (
    strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '使用该历史行情的指数策略编码', etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ETF六位交易代码',
    display_name VARCHAR(100) NOT NULL COMMENT '生成历史数据时使用的ETF名称', updated_at DATETIME(3) NOT NULL COMMENT '历史行情最近同步时间', PRIMARY KEY (strategy_code, etf_code),
    CONSTRAINT fk_history_strategy FOREIGN KEY (strategy_code) REFERENCES strategies(strategy_code), CONSTRAINT fk_history_etf FOREIGN KEY (etf_code) REFERENCES etfs(etf_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='策略可用ETF历史行情清单表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS etf_daily_prices (
    etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ETF六位交易代码', trade_date DATE NOT NULL COMMENT '交易日期',
    open_price DECIMAL(20,8) NOT NULL COMMENT '前复权开盘价', close_price DECIMAL(20,8) NOT NULL COMMENT '前复权收盘价', high_price DECIMAL(20,8) NOT NULL COMMENT '前复权最高价',
    low_price DECIMAL(20,8) NOT NULL COMMENT '前复权最低价', volume DECIMAL(24,4) NOT NULL COMMENT '成交量', updated_at DATETIME(3) NOT NULL COMMENT '行情记录更新时间',
    PRIMARY KEY (etf_code, trade_date), KEY idx_etf_trade_date (trade_date), CONSTRAINT fk_daily_price_etf FOREIGN KEY (etf_code) REFERENCES etfs(etf_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETF前复权日线行情表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_backtests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '回测主键', strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属指数策略编码',
    backtest_version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '回测算法版本', config_version INT UNSIGNED NOT NULL COMMENT '回测使用的标的池配置版本',
    generated_at DATETIME(3) NOT NULL COMMENT '回测生成时间', start_date DATE NOT NULL COMMENT '回测起始交易日', end_date DATE NOT NULL COMMENT '回测结束交易日',
    cumulative_return DECIMAL(20,8) NOT NULL COMMENT '回测累计收益率，单位百分比', annualized_return DECIMAL(20,8) NOT NULL COMMENT '回测年化收益率，单位百分比',
    positive_years SMALLINT UNSIGNED NOT NULL COMMENT '正收益年份数量', worst_drawdown DECIMAL(20,8) NOT NULL COMMENT '回测最大回撤，单位百分比', updated_at DATETIME(3) NOT NULL COMMENT '回测记录更新时间',
    PRIMARY KEY (id), UNIQUE KEY uk_strategy_backtest (strategy_code), CONSTRAINT fk_backtest_strategy FOREIGN KEY (strategy_code) REFERENCES strategies(strategy_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略近十年回测汇总表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_backtest_etfs (
    backtest_id BIGINT UNSIGNED NOT NULL COMMENT '所属回测主键', etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '回测使用的ETF代码',
    display_order SMALLINT UNSIGNED NOT NULL COMMENT 'ETF在回测标的池中的顺序', PRIMARY KEY (backtest_id, etf_code), UNIQUE KEY uk_backtest_etf_order (backtest_id, display_order),
    CONSTRAINT fk_backtest_etf_backtest FOREIGN KEY (backtest_id) REFERENCES strategy_backtests(id) ON DELETE CASCADE, CONSTRAINT fk_backtest_etf_etf FOREIGN KEY (etf_code) REFERENCES etfs(etf_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略回测ETF快照表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_backtest_years (
    backtest_id BIGINT UNSIGNED NOT NULL COMMENT '所属回测主键', performance_year SMALLINT UNSIGNED NOT NULL COMMENT '收益所属年份',
    return_rate DECIMAL(20,8) NOT NULL COMMENT '年度收益率，单位百分比', max_drawdown DECIMAL(20,8) NOT NULL COMMENT '年度最大回撤，单位百分比', trade_count INT UNSIGNED NOT NULL COMMENT '年度交易或调仓次数',
    available_assets SMALLINT UNSIGNED NOT NULL COMMENT '当年满足上市条件的可用ETF数量', year_end_holding VARCHAR(100) NOT NULL COMMENT '年末持仓ETF名称，空仓时为空字符串', PRIMARY KEY (backtest_id, performance_year),
    CONSTRAINT fk_backtest_year_backtest FOREIGN KEY (backtest_id) REFERENCES strategy_backtests(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略回测年度收益表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_year_performance (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '年度表现主键', strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属指数策略编码', performance_year SMALLINT UNSIGNED NOT NULL COMMENT '统计年份',
    performance_version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '年度表现计算版本', config_version INT UNSIGNED NOT NULL COMMENT '计算使用的标的池配置版本', provider VARCHAR(80) NOT NULL COMMENT '行情数据提供方',
    calculated_at DATETIME(3) NOT NULL COMMENT '计算完成时间', start_date DATE NOT NULL COMMENT '年度统计起始交易日', last_trading_date DATE NOT NULL COMMENT '年度统计截至交易日',
    cumulative_return DECIMAL(20,8) NOT NULL COMMENT '年内累计收益率，单位百分比', current_holding VARCHAR(100) NULL COMMENT '当前持仓ETF名称，空仓时为空',
    current_trade_return DECIMAL(20,8) NULL COMMENT '当前持仓单次收益率，单位百分比', updated_at DATETIME(3) NOT NULL COMMENT '年度表现记录更新时间', PRIMARY KEY (id),
    UNIQUE KEY uk_strategy_year (strategy_code, performance_year), CONSTRAINT fk_year_performance_strategy FOREIGN KEY (strategy_code) REFERENCES strategies(strategy_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略年度实时表现汇总表'`);
  const [holdingColumns] = await db.query<Array<RowDataPacket & { DATA_TYPE: string; CHARACTER_MAXIMUM_LENGTH: number; CHARACTER_SET_NAME: string }>>(
    `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, CHARACTER_SET_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='strategy_year_performance' AND COLUMN_NAME='current_holding'`,
  );
  const holdingColumn = holdingColumns[0];
  if (holdingColumn?.DATA_TYPE !== 'varchar' || Number(holdingColumn.CHARACTER_MAXIMUM_LENGTH) !== 100 || holdingColumn.CHARACTER_SET_NAME !== 'utf8mb4') {
    await db.query("ALTER TABLE strategy_year_performance MODIFY current_holding VARCHAR(100) NULL COMMENT '当前持仓ETF名称，空仓时为空'");
  }
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_year_etfs (
    performance_id BIGINT UNSIGNED NOT NULL COMMENT '所属年度表现主键', etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '年度计算使用的ETF代码',
    display_order SMALLINT UNSIGNED NOT NULL COMMENT 'ETF在年度标的池中的顺序', PRIMARY KEY (performance_id, etf_code), UNIQUE KEY uk_year_etf_order (performance_id, display_order),
    CONSTRAINT fk_year_etf_performance FOREIGN KEY (performance_id) REFERENCES strategy_year_performance(id) ON DELETE CASCADE, CONSTRAINT fk_year_etf_etf FOREIGN KEY (etf_code) REFERENCES etfs(etf_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略年度表现ETF快照表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_equity_points (
    performance_id BIGINT UNSIGNED NOT NULL COMMENT '所属年度表现主键', trade_date DATE NOT NULL COMMENT '收益曲线交易日期', return_rate DECIMAL(20,8) NOT NULL COMMENT '截至该日累计收益率，单位百分比',
    PRIMARY KEY (performance_id, trade_date), CONSTRAINT fk_equity_performance FOREIGN KEY (performance_id) REFERENCES strategy_year_performance(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略年度收益曲线点表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS strategy_trade_nodes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '操作节点主键', performance_id BIGINT UNSIGNED NOT NULL COMMENT '所属年度表现主键', node_order SMALLINT UNSIGNED NOT NULL COMMENT '操作节点时间顺序',
    trade_date DATE NOT NULL COMMENT '产生操作信号的交易日期', action_type VARCHAR(16) NOT NULL COMMENT '操作类型：买入、轮换或清仓', from_etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '操作前持仓ETF代码',
    from_etf_name VARCHAR(100) NULL COMMENT '操作前持仓ETF名称', to_etf_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '操作后持仓ETF代码', to_etf_name VARCHAR(100) NULL COMMENT '操作后持仓ETF名称',
    reason VARCHAR(500) NOT NULL COMMENT '触发本次操作的规则说明', trade_return DECIMAL(20,8) NULL COMMENT '本次已结束持仓收益率，单位百分比', cumulative_return DECIMAL(20,8) NOT NULL COMMENT '操作发生时累计收益率，单位百分比',
    PRIMARY KEY (id), UNIQUE KEY uk_trade_node_order (performance_id, node_order), KEY idx_trade_node_date (performance_id, trade_date),
    CONSTRAINT fk_trade_node_performance FOREIGN KEY (performance_id) REFERENCES strategy_year_performance(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指数策略年度交易操作节点表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS stock_scan_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '扫描批次主键', strategy_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属个股扫描策略编码', scan_version VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '扫描算法版本',
    storage_date DATE NOT NULL COMMENT '页面查询和持久化使用的交易日期', provider VARCHAR(80) NOT NULL COMMENT '行情数据提供方', fetched_at DATETIME(3) NOT NULL COMMENT '行情获取完成时间', last_trading_date DATE NOT NULL COMMENT '扫描使用的实际交易日',
    cached TINYINT(1) NOT NULL COMMENT '保存时是否来自缓存', scanned_count INT UNSIGNED NOT NULL COMMENT '参与扫描的证券数量', excluded_count INT UNSIGNED NOT NULL COMMENT '扫描前排除的证券数量',
    first_cross_count INT UNSIGNED NULL COMMENT 'MACD首次金叉数量', low_cross_count INT UNSIGNED NULL COMMENT 'MACD与KDJ低位双金叉数量', divergence_count INT UNSIGNED NULL COMMENT '底背离共振数量',
    breakout_count INT UNSIGNED NULL COMMENT '量价同步突破数量', support_count INT UNSIGNED NULL COMMENT '量能共振支撑数量', pullback_count INT UNSIGNED NULL COMMENT '缩量回踩蓄力数量', updated_at DATETIME(3) NOT NULL COMMENT '扫描批次更新时间',
    PRIMARY KEY (id), UNIQUE KEY uk_scan_strategy_date (strategy_code, storage_date), CONSTRAINT fk_scan_run_strategy FOREIGN KEY (strategy_code) REFERENCES strategies(strategy_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='个股策略扫描批次表'`);
  await db.query(`CREATE TABLE IF NOT EXISTS stock_scan_results (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '扫描结果主键', run_id BIGINT UNSIGNED NOT NULL COMMENT '所属扫描批次主键', result_order INT UNSIGNED NOT NULL COMMENT '结果在页面中的原始顺序',
    security_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '股票六位交易代码', security_name VARCHAR(100) NOT NULL COMMENT '股票名称', close_price DECIMAL(20,8) NOT NULL COMMENT '信号日收盘价', change_rate DECIMAL(20,8) NOT NULL COMMENT '信号日涨跌幅，单位百分比',
    current_price DECIMAL(20,8) NULL COMMENT '历史查询时补充的当前价格', change_since_signal DECIMAL(20,8) NULL COMMENT '信号日至今涨跌幅，单位百分比', dif_value DECIMAL(20,8) NULL COMMENT 'MACD DIF指标值', dea_value DECIMAL(20,8) NULL COMMENT 'MACD DEA指标值',
    histogram_value DECIMAL(20,8) NULL COMMENT 'MACD柱值', histogram_change DECIMAL(20,8) NULL COMMENT 'MACD柱变化值', ma20 DECIMAL(20,8) NULL COMMENT '20日均价', ma25 DECIMAL(20,8) NULL COMMENT '25日均价',
    support_distance DECIMAL(20,8) NULL COMMENT '价格到均线支撑的距离，单位百分比', pullback_rate DECIMAL(20,8) NULL COMMENT '阶段回踩幅度，单位百分比', volume_ratio DECIMAL(20,8) NULL COMMENT '成交量比例', cross_days_ago SMALLINT NULL COMMENT 'MACD交叉距信号日的交易日数',
    score DECIMAL(20,8) NULL COMMENT '策略内部评分', k_value DECIMAL(20,8) NULL COMMENT 'KDJ K值', d_value DECIMAL(20,8) NULL COMMENT 'KDJ D值', j_value DECIMAL(20,8) NULL COMMENT 'KDJ J值', kdj_cross_days_ago SMALLINT NULL COMMENT 'KDJ交叉距信号日的交易日数', divergence TINYINT(1) NULL COMMENT '是否出现底背离',
    volume_ma5 DECIMAL(24,4) NULL COMMENT '5日成交量均值', volume_ma60 DECIMAL(24,4) NULL COMMENT '60日成交量均值', price_cross_days_ago SMALLINT NULL COMMENT '价格突破距信号日的交易日数', volume_cross_days_ago SMALLINT NULL COMMENT '量能突破距信号日的交易日数',
    var1_value DECIMAL(20,8) NULL COMMENT '多空指标VAR1当前值', trend_line DECIMAL(20,8) NULL COMMENT '多空指标趋势线当前值', previous_var1 DECIMAL(20,8) NULL COMMENT '多空指标VAR1前一日值', previous_trend_line DECIMAL(20,8) NULL COMMENT '多空指标趋势线前一日值',
    cross_spread DECIMAL(20,8) NULL COMMENT '多空指标交叉后的差值', signal_type VARCHAR(40) NOT NULL COMMENT '策略产生的信号类型', PRIMARY KEY (id), UNIQUE KEY uk_scan_result_order (run_id, result_order), KEY idx_scan_security (run_id, security_code),
    CONSTRAINT fk_scan_result_run FOREIGN KEY (run_id) REFERENCES stock_scan_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='个股策略扫描结果明细表'`);
  for (const definition of strategyDefinitions) {
    await db.execute(`INSERT INTO strategies (strategy_code, strategy_name, strategy_type, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE strategy_name=VALUES(strategy_name), strategy_type=VALUES(strategy_type), description=VALUES(description), updated_at=NOW(3)`, [...definition]);
  }
}

function dateValue(value: unknown) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').slice(0, 10);
}

function dateTimeValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function jsonText(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function configPath(key: string) {
  const match = /^data\/(rotation|asset-rotation|dual-etf)\/(config|pending-config|combination-config|combination-pending-config)\.json$/.exec(key);
  if (!match) return null;
  return {
    strategy: match[1],
    kind: match[2].startsWith('combination') ? 'combination_pool' : 'rotation_pool',
    state: match[2].includes('pending') ? 'pending' : 'active',
  };
}

function historyPath(key: string) {
  const match = /^data\/(rotation|asset-rotation|dual-etf)\/history\/(\d{6})\.json$/.exec(key);
  return match ? { strategy: match[1], code: match[2] } : null;
}

function backtestPath(key: string) {
  const match = /^data\/(rotation|asset-rotation|dual-etf)\/backtest\.json$/.exec(key);
  return match?.[1] ?? null;
}

function yearPath(key: string) {
  const match = /^data\/(rotation|asset-rotation|dual-etf)\/year-performance\/(\d{4})\.json$/.exec(key);
  return match ? { strategy: match[1], year: Number(match[2]) } : null;
}

const scanFolders: Record<string, string> = {
  'macd-snapshots': 'macd',
  'macd-pullback-snapshots': 'macd-pullback',
  'macd-kdj-snapshots': 'macd-kdj',
  'volume-snapshots': 'volume',
  'bull-point-snapshots': 'bull-point',
};

function scanPath(key: string) {
  const match = /^data\/([^/]+)\/(\d{4})(\d{2})(\d{2})\.json$/.exec(key);
  const strategy = match ? scanFolders[match[1]] : null;
  return match && strategy ? { strategy, date: `${match[2]}-${match[3]}-${match[4]}` } : null;
}

async function upsertEtf(db: Database, symbol: Record<string, unknown>) {
  const code = String(symbol.code ?? symbol.etfCode ?? '');
  if (!/^\d{6}$/.test(code)) throw new Error(`无效ETF代码：${code}`);
  const name = String(symbol.name ?? symbol.etfName ?? code);
  const marketCode = symbol.marketCode ? String(symbol.marketCode) : null;
  const category = symbol.category ? String(symbol.category) : null;
  await db.execute(`INSERT INTO etfs (etf_code, market_code, etf_name, category, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE market_code=COALESCE(VALUES(market_code), market_code), etf_name=VALUES(etf_name), category=COALESCE(VALUES(category), category), updated_at=NOW(3)`,
  [code, marketCode, name, category]);
}

async function insertRows(db: Database, sqlPrefix: string, columns: number, rows: unknown[][], batchSize = 500, sqlSuffix = '') {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const placeholders = batch.map(() => `(${new Array(columns).fill('?').join(',')})`).join(',');
    await db.query(`${sqlPrefix} ${placeholders}${sqlSuffix}`, batch.flat());
  }
}

async function saveConfig(db: Database, key: string, value: any) {
  const path = configPath(key)!;
  for (const symbol of value.symbols ?? []) await upsertEtf(db, symbol);
  await db.execute(`INSERT INTO strategy_configs (strategy_code, config_kind, config_state, version, updated_at) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE version=VALUES(version), updated_at=VALUES(updated_at)`, [path.strategy, path.kind, path.state, value.version, new Date(value.updatedAt)]);
  const [rows] = await db.query<Array<RowDataPacket & { id: number }>>('SELECT id FROM strategy_configs WHERE strategy_code=? AND config_kind=? AND config_state=?', [path.strategy, path.kind, path.state]);
  const id = rows[0].id;
  await db.execute('DELETE FROM strategy_config_etfs WHERE config_id=?', [id]);
  await insertRows(db, 'INSERT INTO strategy_config_etfs (config_id, etf_code, display_order) VALUES', 3,
    (value.symbols ?? []).map((symbol: any, index: number) => [id, symbol.code, index]));
}

async function saveHistory(db: Database, key: string, value: any) {
  const path = historyPath(key)!;
  await upsertEtf(db, { code: path.code, name: value.name ?? path.code });
  await db.execute(`INSERT INTO strategy_history_etfs (strategy_code, etf_code, display_name, updated_at) VALUES (?, ?, ?, NOW(3))
    ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), updated_at=NOW(3)`, [path.strategy, path.code, String(value.name ?? path.code)]);
  await insertRows(db, `INSERT INTO etf_daily_prices (etf_code, trade_date, open_price, close_price, high_price, low_price, volume, updated_at) VALUES`, 8,
    (value.rows ?? []).map((row: unknown[]) => [path.code, row[0], row[1], row[2], row[3], row[4], row[5], new Date()]), 400,
    ` ON DUPLICATE KEY UPDATE open_price=VALUES(open_price), close_price=VALUES(close_price), high_price=VALUES(high_price), low_price=VALUES(low_price), volume=VALUES(volume), updated_at=NOW(3)`);
}

async function saveBacktest(db: Database, key: string, value: any) {
  const strategy = backtestPath(key)!;
  for (const symbol of value.symbols ?? []) await upsertEtf(db, symbol);
  await db.execute(`INSERT INTO strategy_backtests (strategy_code, backtest_version, config_version, generated_at, start_date, end_date, cumulative_return, annualized_return, positive_years, worst_drawdown, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE backtest_version=VALUES(backtest_version), config_version=VALUES(config_version), generated_at=VALUES(generated_at), start_date=VALUES(start_date), end_date=VALUES(end_date),
    cumulative_return=VALUES(cumulative_return), annualized_return=VALUES(annualized_return), positive_years=VALUES(positive_years), worst_drawdown=VALUES(worst_drawdown), updated_at=NOW(3)`,
  [strategy, value.version, value.configVersion, new Date(value.generatedAt), value.period.start, value.period.end, value.summary.cumulativeReturn, value.summary.annualizedReturn, value.summary.positiveYears, value.summary.worstDrawdown]);
  const [rows] = await db.query<Array<RowDataPacket & { id: number }>>('SELECT id FROM strategy_backtests WHERE strategy_code=?', [strategy]);
  const id = rows[0].id;
  await db.execute('DELETE FROM strategy_backtest_etfs WHERE backtest_id=?', [id]);
  await db.execute('DELETE FROM strategy_backtest_years WHERE backtest_id=?', [id]);
  await insertRows(db, 'INSERT INTO strategy_backtest_etfs (backtest_id, etf_code, display_order) VALUES', 3,
    (value.symbols ?? []).map((symbol: any, index: number) => [id, symbol.code, index]));
  await insertRows(db, 'INSERT INTO strategy_backtest_years (backtest_id, performance_year, return_rate, max_drawdown, trade_count, available_assets, year_end_holding) VALUES', 7,
    (value.annualReturns ?? []).map((item: any) => [id, item.year, item.returnRate, item.maxDrawdown, item.trades, item.availableAssets, item.yearEndHolding ?? '']));
}

async function saveYearPerformance(db: Database, key: string, value: any) {
  const path = yearPath(key)!;
  for (const symbol of value.symbols ?? []) await upsertEtf(db, symbol);
  await db.execute(`INSERT INTO strategy_year_performance (strategy_code, performance_year, performance_version, config_version, provider, calculated_at, start_date, last_trading_date, cumulative_return, current_holding, current_trade_return, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE performance_version=VALUES(performance_version), config_version=VALUES(config_version), provider=VALUES(provider), calculated_at=VALUES(calculated_at),
    start_date=VALUES(start_date), last_trading_date=VALUES(last_trading_date), cumulative_return=VALUES(cumulative_return), current_holding=VALUES(current_holding), current_trade_return=VALUES(current_trade_return), updated_at=NOW(3)`,
  [path.strategy, path.year, value.version, value.configVersion, value.provider, new Date(value.calculatedAt), value.startDate, value.lastTradingDate, value.cumulativeReturn, value.currentHolding, value.currentTradeReturn]);
  const [rows] = await db.query<Array<RowDataPacket & { id: number }>>('SELECT id FROM strategy_year_performance WHERE strategy_code=? AND performance_year=?', [path.strategy, path.year]);
  const id = rows[0].id;
  await db.execute('DELETE FROM strategy_year_etfs WHERE performance_id=?', [id]);
  await db.execute('DELETE FROM strategy_equity_points WHERE performance_id=?', [id]);
  await db.execute('DELETE FROM strategy_trade_nodes WHERE performance_id=?', [id]);
  await insertRows(db, 'INSERT INTO strategy_year_etfs (performance_id, etf_code, display_order) VALUES', 3,
    (value.symbols ?? []).map((symbol: any, index: number) => [id, symbol.code, index]));
  await insertRows(db, 'INSERT INTO strategy_equity_points (performance_id, trade_date, return_rate) VALUES', 3,
    (value.equityCurve ?? []).map((item: any) => [id, item.date, item.returnRate]));
  await insertRows(db, `INSERT INTO strategy_trade_nodes (performance_id, node_order, trade_date, action_type, from_etf_code, from_etf_name, to_etf_code, to_etf_name, reason, trade_return, cumulative_return) VALUES`, 11,
    (value.nodes ?? []).map((item: any, index: number) => [id, index, item.date, item.action, item.fromCode, item.fromName, item.toCode, item.toName, item.reason, item.tradeReturn, item.cumulativeReturn]));
}

const signalFields = [
  'code', 'name', 'close', 'change', 'currentPrice', 'changeSinceSignal', 'dif', 'dea', 'histogram', 'histogramChange', 'ma20', 'ma25', 'supportDistance', 'pullback', 'volumeRatio', 'crossDaysAgo',
  'score', 'k', 'd', 'j', 'kdjCrossDaysAgo', 'divergence', 'volumeMa5', 'volumeMa60', 'priceCrossDaysAgo', 'volumeCrossDaysAgo', 'var1', 'trendLine', 'previousVar1', 'previousTrendLine', 'crossSpread', 'signal',
] as const;

async function saveScan(db: Database, key: string, value: any) {
  const path = scanPath(key)!;
  await db.execute(`INSERT INTO stock_scan_runs (strategy_code, scan_version, storage_date, provider, fetched_at, last_trading_date, cached, scanned_count, excluded_count, first_cross_count, low_cross_count, divergence_count, breakout_count, support_count, pullback_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE scan_version=VALUES(scan_version), provider=VALUES(provider), fetched_at=VALUES(fetched_at), last_trading_date=VALUES(last_trading_date), cached=VALUES(cached),
    scanned_count=VALUES(scanned_count), excluded_count=VALUES(excluded_count), first_cross_count=VALUES(first_cross_count), low_cross_count=VALUES(low_cross_count), divergence_count=VALUES(divergence_count), breakout_count=VALUES(breakout_count), support_count=VALUES(support_count), pullback_count=VALUES(pullback_count), updated_at=NOW(3)`,
  [path.strategy, value.version, path.date, value.provider, new Date(value.fetchedAt), value.lastTradingDate, value.cached ? 1 : 0, value.scannedCount, value.excludedCount, value.firstCrossCount ?? null, value.lowCrossCount ?? null, value.divergenceCount ?? null, value.breakoutCount ?? null, value.supportCount ?? null, value.pullbackCount ?? null]);
  const [rows] = await db.query<Array<RowDataPacket & { id: number }>>('SELECT id FROM stock_scan_runs WHERE strategy_code=? AND storage_date=?', [path.strategy, path.date]);
  const id = rows[0].id;
  await db.execute('DELETE FROM stock_scan_results WHERE run_id=?', [id]);
  const columns = `run_id, result_order, security_code, security_name, close_price, change_rate, current_price, change_since_signal, dif_value, dea_value, histogram_value, histogram_change, ma20, ma25, support_distance, pullback_rate, volume_ratio, cross_days_ago, score, k_value, d_value, j_value, kdj_cross_days_ago, divergence, volume_ma5, volume_ma60, price_cross_days_ago, volume_cross_days_ago, var1_value, trend_line, previous_var1, previous_trend_line, cross_spread, signal_type`;
  await insertRows(db, `INSERT INTO stock_scan_results (${columns}) VALUES`, 34, (value.signals ?? []).map((signal: any, index: number) => [
    id, index, ...signalFields.map((field) => field === 'divergence' ? (signal[field] == null ? null : signal[field] ? 1 : 0) : signal[field] ?? null),
  ]), 300);
}

export async function persistRelationalObject(db: Database, key: string, content: string) {
  const value = JSON.parse(content);
  if (configPath(key)) return saveConfig(db, key, value);
  if (historyPath(key)) return saveHistory(db, key, value);
  if (backtestPath(key)) return saveBacktest(db, key, value);
  if (yearPath(key)) return saveYearPerformance(db, key, value);
  if (scanPath(key)) return saveScan(db, key, value);
  throw new Error(`没有对应关系表的数据类型：${key}`);
}

export async function deleteRelationalObject(db: Database, key: string) {
  const config = configPath(key);
  if (config) return db.execute('DELETE FROM strategy_configs WHERE strategy_code=? AND config_kind=? AND config_state=?', [config.strategy, config.kind, config.state]);
  const history = historyPath(key);
  if (history) return db.execute('DELETE FROM strategy_history_etfs WHERE strategy_code=? AND etf_code=?', [history.strategy, history.code]);
  const backtest = backtestPath(key);
  if (backtest) return db.execute('DELETE FROM strategy_backtests WHERE strategy_code=?', [backtest]);
  const year = yearPath(key);
  if (year) return db.execute('DELETE FROM strategy_year_performance WHERE strategy_code=? AND performance_year=?', [year.strategy, year.year]);
  const scan = scanPath(key);
  if (scan) return db.execute('DELETE FROM stock_scan_runs WHERE strategy_code=? AND storage_date=?', [scan.strategy, scan.date]);
  throw new Error(`没有对应关系表的数据类型：${key}`);
}

export async function loadRelationalObjects(db: Database) {
  const objects = new Map<string, string>();
  const [configs] = await db.query<Array<RowDataPacket & Record<string, any>>>(`SELECT c.*, e.etf_code, e.market_code, e.etf_name, e.category, m.display_order
    FROM strategy_configs c LEFT JOIN strategy_config_etfs m ON m.config_id=c.id LEFT JOIN etfs e ON e.etf_code=m.etf_code ORDER BY c.id, m.display_order`);
  const configGroups = new Map<number, any>();
  for (const row of configs) {
    const group = configGroups.get(row.id) ?? { row, symbols: [] };
    if (row.etf_code) group.symbols.push({ marketCode: row.market_code, code: row.etf_code, name: row.etf_name, category: row.category });
    configGroups.set(row.id, group);
  }
  for (const { row, symbols } of configGroups.values()) {
    const file = row.config_kind === 'combination_pool' ? (row.config_state === 'pending' ? 'combination-pending-config' : 'combination-config') : (row.config_state === 'pending' ? 'pending-config' : 'config');
    objects.set(`data/${row.strategy_code}/${file}.json`, jsonText({ version: Number(row.version), updatedAt: dateTimeValue(row.updated_at), symbols }));
  }
  const [historyLinks] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT strategy_code, etf_code, display_name FROM strategy_history_etfs ORDER BY strategy_code, etf_code');
  const historyCodes = [...new Set(historyLinks.map((row) => String(row.etf_code)))];
  const pricesByCode = new Map<string, string[][]>();
  if (historyCodes.length) {
    const [prices] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM etf_daily_prices WHERE etf_code IN (?) ORDER BY etf_code, trade_date', [historyCodes]);
    for (const row of prices) {
      const values = pricesByCode.get(row.etf_code) ?? [];
      values.push([dateValue(row.trade_date), String(row.open_price), String(row.close_price), String(row.high_price), String(row.low_price), String(row.volume)]);
      pricesByCode.set(row.etf_code, values);
    }
  }
  for (const row of historyLinks) objects.set(`data/${row.strategy_code}/history/${row.etf_code}.json`, jsonText({ code: row.etf_code, name: row.display_name, rows: pricesByCode.get(row.etf_code) ?? [] }));
  const [backtests] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM strategy_backtests ORDER BY id');
  for (const row of backtests) {
    const [symbols] = await db.query<Array<RowDataPacket & Record<string, any>>>(`SELECT e.market_code, e.etf_code, e.etf_name, e.category FROM strategy_backtest_etfs m INNER JOIN etfs e ON e.etf_code=m.etf_code WHERE m.backtest_id=? ORDER BY m.display_order`, [row.id]);
    const [years] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM strategy_backtest_years WHERE backtest_id=? ORDER BY performance_year', [row.id]);
    objects.set(`data/${row.strategy_code}/backtest.json`, jsonText({ version: row.backtest_version, strategy: row.strategy_code, configVersion: Number(row.config_version),
      symbols: symbols.map((item) => ({ marketCode: item.market_code, code: item.etf_code, name: item.etf_name, category: item.category })), generatedAt: dateTimeValue(row.generated_at),
      period: { start: dateValue(row.start_date), end: dateValue(row.end_date) }, annualReturns: years.map((item) => ({ year: Number(item.performance_year), returnRate: Number(item.return_rate), maxDrawdown: Number(item.max_drawdown), trades: Number(item.trade_count), availableAssets: Number(item.available_assets), yearEndHolding: item.year_end_holding })),
      summary: { cumulativeReturn: Number(row.cumulative_return), annualizedReturn: Number(row.annualized_return), positiveYears: Number(row.positive_years), worstDrawdown: Number(row.worst_drawdown) } }));
  }
  const [performances] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM strategy_year_performance ORDER BY strategy_code, performance_year');
  for (const row of performances) {
    const [symbols] = await db.query<Array<RowDataPacket & Record<string, any>>>(`SELECT e.market_code, e.etf_code, e.etf_name, e.category FROM strategy_year_etfs m INNER JOIN etfs e ON e.etf_code=m.etf_code WHERE m.performance_id=? ORDER BY m.display_order`, [row.id]);
    const [points] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM strategy_equity_points WHERE performance_id=? ORDER BY trade_date', [row.id]);
    const [nodes] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM strategy_trade_nodes WHERE performance_id=? ORDER BY node_order', [row.id]);
    const value = { version: row.performance_version, strategy: row.strategy_code, configVersion: Number(row.config_version), symbols: symbols.map((item) => ({ marketCode: item.market_code, code: item.etf_code, name: item.etf_name, category: item.category })),
      provider: row.provider, calculatedAt: dateTimeValue(row.calculated_at), year: Number(row.performance_year), startDate: dateValue(row.start_date), lastTradingDate: dateValue(row.last_trading_date), cumulativeReturn: Number(row.cumulative_return), nodeCount: nodes.length,
      currentHolding: row.current_holding, currentTradeReturn: row.current_trade_return === null ? null : Number(row.current_trade_return), equityCurve: points.map((item) => ({ date: dateValue(item.trade_date), returnRate: Number(item.return_rate) })),
      nodes: nodes.map((item) => ({ date: dateValue(item.trade_date), action: item.action_type, fromCode: item.from_etf_code, fromName: item.from_etf_name, toCode: item.to_etf_code, toName: item.to_etf_name, reason: item.reason, tradeReturn: item.trade_return === null ? null : Number(item.trade_return), cumulativeReturn: Number(item.cumulative_return) })) };
    objects.set(`data/${row.strategy_code}/year-performance/${row.performance_year}.json`, jsonText(value));
  }
  const [runs] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM stock_scan_runs ORDER BY strategy_code, storage_date');
  const folderByStrategy = Object.fromEntries(Object.entries(scanFolders).map(([folder, strategy]) => [strategy, folder]));
  for (const row of runs) {
    const [signals] = await db.query<Array<RowDataPacket & Record<string, any>>>('SELECT * FROM stock_scan_results WHERE run_id=? ORDER BY result_order', [row.id]);
    const mappedSignals = signals.map((item) => {
      const source = [item.security_code, item.security_name, item.close_price, item.change_rate, item.current_price, item.change_since_signal, item.dif_value, item.dea_value, item.histogram_value, item.histogram_change, item.ma20, item.ma25, item.support_distance, item.pullback_rate, item.volume_ratio, item.cross_days_ago, item.score, item.k_value, item.d_value, item.j_value, item.kdj_cross_days_ago, item.divergence, item.volume_ma5, item.volume_ma60, item.price_cross_days_ago, item.volume_cross_days_ago, item.var1_value, item.trend_line, item.previous_var1, item.previous_trend_line, item.cross_spread, item.signal_type];
      return Object.fromEntries(signalFields.map((field, index) => [field, source[index]]).filter(([, value]) => value !== null).map(([field, value]) => [field, field === 'divergence' ? Boolean(value) : typeof value === 'number' ? Number(value) : value]));
    });
    const value: Record<string, unknown> = { signals: mappedSignals, storageDate: dateValue(row.storage_date).replace(/-/g, ''), provider: row.provider, fetchedAt: dateTimeValue(row.fetched_at), lastTradingDate: dateValue(row.last_trading_date), cached: Boolean(row.cached), scannedCount: Number(row.scanned_count), excludedCount: Number(row.excluded_count) };
    for (const [field, column] of [['firstCrossCount', 'first_cross_count'], ['lowCrossCount', 'low_cross_count'], ['divergenceCount', 'divergence_count'], ['breakoutCount', 'breakout_count'], ['supportCount', 'support_count'], ['pullbackCount', 'pullback_count']] as const) if (row[column] !== null) value[field] = Number(row[column]);
    value.version = row.scan_version;
    const compactDate = dateValue(row.storage_date).replace(/-/g, '');
    objects.set(`data/${folderByStrategy[row.strategy_code]}/${compactDate}.json`, jsonText(value));
  }
  return objects;
}

export async function migrateLegacyDocuments(db: Pool) {
  const [tables] = await db.query<Array<RowDataPacket & { total: number }>>(`SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_documents'`);
  if (!Number(tables[0]?.total)) return { migrated: 0, dropped: false };
  const [rows] = await db.query<Array<RowDataPacket & { document_key: string; payload: string }>>('SELECT document_key, payload FROM app_documents ORDER BY document_key');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const row of rows) await persistRelationalObject(connection, row.document_key, row.payload);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const reconstructed = await loadRelationalObjects(db);
  const missing = rows.map((row) => row.document_key).filter((key) => !reconstructed.has(key));
  if (missing.length) throw new Error(`关系表迁移后缺少 ${missing.length} 个对象：${missing.join(', ')}`);
  for (const row of rows) {
    const before = JSON.parse(row.payload);
    const after = JSON.parse(reconstructed.get(row.document_key)!);
    if (configPath(row.document_key)) {
      const beforeCodes = (before.symbols ?? []).map((item: any) => item.code).join(',');
      const afterCodes = (after.symbols ?? []).map((item: any) => item.code).join(',');
      if (Number(before.version) !== Number(after.version) || beforeCodes !== afterCodes) throw new Error(`配置迁移校验失败：${row.document_key}`);
    } else if (historyPath(row.document_key)) {
      const dates = new Set((after.rows ?? []).map((item: unknown[]) => item[0]));
      if ((before.rows ?? []).some((item: unknown[]) => !dates.has(item[0]))) throw new Error(`行情迁移缺少交易日：${row.document_key}`);
    } else if (backtestPath(row.document_key)) {
      if (before.version !== after.version || before.configVersion !== after.configVersion || before.annualReturns?.length !== after.annualReturns?.length) throw new Error(`回测迁移校验失败：${row.document_key}`);
    } else if (yearPath(row.document_key)) {
      if (before.configVersion !== after.configVersion || before.nodes?.length !== after.nodes?.length || before.equityCurve?.length !== after.equityCurve?.length) throw new Error(`年度表现迁移校验失败：${row.document_key}`);
    } else if (scanPath(row.document_key)) {
      if (before.version !== after.version || before.signals?.length !== after.signals?.length || before.scannedCount !== after.scannedCount || before.excludedCount !== after.excludedCount) throw new Error(`扫描结果迁移校验失败：${row.document_key}`);
    }
  }
  await db.query('DROP TABLE app_documents');
  return { migrated: rows.length, dropped: true };
}
