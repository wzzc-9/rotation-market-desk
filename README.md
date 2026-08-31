# 轮动看盘台

React + TypeScript + ECharts 前端，Fastify + TypeScript 行情代理。

## 启动

```powershell
npm install
npm run dev
```

- 前端：http://127.0.0.1:4173
- 后端：http://127.0.0.1:3001

`npm run dev` 会同时启动前后端。浏览器加载时会请求后端获取宽基轮动标的池的真实前复权日线，并重新计算 MA20、动量排名和交易信号。

## MySQL 5.7

后端使用 MySQL 作为唯一运行数据源，必须配置 `DB_*` 环境变量。复制 `.env.example` 中的变量到本机 `.env.mysql.local`，线上则配置到 Render 环境变量：

```text
DB_HOST=数据库地址
DB_PORT=3306
DB_USER=数据库账号
DB_PASSWORD=数据库密码
DB_NAME=rotation_market_desk
DB_SSL=0
```

重新计算后可检查文档内容和组合行数：

```powershell
pnpm run db:check
```

- `app_documents`：配置、ETF 历史行情、回测、年度收益和策略快照；正文使用 `LONGTEXT` 原样保存并在写入前校验 JSON。
- `combination_runs`：策略一、策略二每次组合计算的版本和统计参数。
- `combination_results`：拆分后的组合排名明细，页面筛选、排序和分页直接执行 SQL。
- `active_combination_runs`：每个策略当前对外提供的完整组合版本；新版本全部写完后才切换。

服务使用 MySQL 作为唯一运行数据源；未配置数据库时会拒绝启动。行情下载、回测和组合优化在系统临时目录执行，成功后写回数据库，不会改动项目内的 JSON 文件。组合排名接口直接查询 MySQL，不读取大型 `combinations.json`。

生产环境可通过 `VITE_API_BASE_URL` 指定独立后端地址。本地开发不设置该变量时继续使用 Vite 的 `/api` 代理；GitHub Pages 构建已配置为请求 `https://rotation-market-desk.onrender.com`。Render 后端默认允许 `https://wzzc-9.github.io` 跨域访问，其他前端域名可通过后端环境变量 `CORS_ORIGINS` 追加，多个地址使用英文逗号分隔。

## 接口

- `GET /api/health`：代理健康检查
- `GET /api/strategy/rotation`：读取 30 秒缓存
- `GET /api/strategy/rotation?refresh=1`：强制重新获取上游行情
- `POST /api/strategy/rotation/symbols`：将 ETF 加入策略 1 待应用标的池
- `DELETE /api/strategy/rotation/symbols/:code`：将 ETF 移出策略 1 待应用标的池
- `PUT /api/strategy/rotation/symbols`：用指定组合替换策略 1 待应用标的池
- `POST /api/strategy/rotation/recalculate`：应用策略 1 标的池变更并重算行情、近 10 年回测和今年操作节点
- `GET /api/strategy/rotation/combinations`：分页读取策略 1 全组合回测，支持综合得分、近 10 年收益和今年收益正倒序
- `GET /api/strategy/asset-rotation`：读取全球大类资产 ETF 周度轮动结果
- `GET /api/strategy/asset-rotation/combinations`：分页读取策略 2 全组合回测，支持综合得分、近 10 年收益和今年收益正倒序
- `GET /api/strategy/asset-rotation?refresh=1`：强制刷新动态标的池并重算 20 日涨幅、MA28 和今年交易节点
- `POST /api/strategy/asset-rotation/symbols`：加入 ETF，并重算近 10 年回测和今年操作节点
- `DELETE /api/strategy/asset-rotation/symbols/:code`：移出 ETF，并重算近 10 年回测和今年操作节点
- `GET /api/strategy/dual-etf`：读取双 ETF 20 日动量轮动结果
- `GET /api/strategy/dual-etf?refresh=1`：强制刷新动态标的池并重算 20 日涨幅、MA20 和今年交易节点
- `POST /api/strategy/dual-etf/symbols`：加入 ETF，并重算近 10 年回测和今年操作节点
- `DELETE /api/strategy/dual-etf/symbols/:code`：移出 ETF，并重算近 10 年回测和今年操作节点
- `GET /api/etfs/search?q=关键词`：按名称或代码搜索沪深 ETF
- `GET /api/strategy/macd-confluence`：读取全市场 MACD（10，20，7）候选，缓存 6 小时
- `GET /api/strategy/macd-confluence?refresh=1`：强制重新扫描
- `GET /api/strategy/macd-confluence?date=YYYYMMDD`：读取指定日期的本地 MACD 快照
- `GET /api/strategy/macd-confluence/dates`：列出已保存的本地快照日期
- `GET /api/strategy/macd-kdj`：读取 MACD（12，26，9）+ KDJ（9，3，3）低位双金叉共振候选
- `GET /api/strategy/macd-kdj?date=YYYYMMDD`：读取指定日期的本地共振快照
- `GET /api/strategy/macd-kdj/dates`：列出已保存的共振快照日期
- `GET /api/strategy/volume-signals`：读取 MA25 与量均线 5 / 60 的量价三信号候选
- `GET /api/strategy/volume-signals?date=YYYYMMDD`：读取或计算指定日期的量价三信号快照
- `GET /api/strategy/volume-signals/dates`：列出已保存的量价三信号快照日期
- `GET /api/strategy/bull-points`：读取目标交易日新出现的多空趋势“多点”
- `GET /api/strategy/bull-points?date=YYYYMMDD`：读取或计算指定日期的多点快照
- `GET /api/strategy/bull-points/dates`：列出已保存的多点快照日期

开发环境由 Vite 将 `/api` 转发至 Fastify，浏览器不会直接访问第三方行情接口。

## 数据说明

- 当前看盘数据源：腾讯证券公开行情接口
- 三个指数策略的标的池均存储在 MySQL，页面支持按名称或代码搜索、加入和移出 ETF
- 全球大类资产轮动规则：每周按 20 日涨幅排名；第 1 名且站上 MA28 买入，持仓跌出前 2 或跌破 MA28 时卖出或切换，全部不满足时空仓
- 全球大类资产策略的标的池、ETF 历史行情、近 10 年回测和年度操作节点均存储在 MySQL；可运行 `pnpm run history:asset:download` 更新历史，运行 `pnpm run backtest:asset` 复算
- 策略 2 全组合结果拆分存储在 `combination_runs` 与 `combination_results`；候选全集取自数据库历史行情，完整枚举 3 只以上组合；运行 `pnpm run optimize:asset` 可在临时目录重新计算并原子切换生效版本
- 宽基 20 日动量轮动策略的动态标的池、独立组合池、历史行情、回测和年度操作节点均存储在 MySQL；运行 `pnpm run optimize:rotation` 可重新计算全组合排名
- 双 ETF 20 日动量轮动规则：每日比较标的近 20 个交易日涨跌幅，只持有排名第 1 且收盘价站上 MA20 的 ETF；第 1 名变化时切换，领先 ETF 跌破 MA20 时空仓；收盘产生信号，下一交易日承接收益
- 双 ETF 策略的标的池、历史行情、近 10 年回测和年度操作节点均存储在 MySQL；可运行 `pnpm run history:dual:download` 更新历史，运行 `pnpm run backtest:dual` 复算
- MACD 策略扫描数据源：Tushare 日线接口；需要在 `.env.local` 配置 `TUSHARE_TOKEN`
- MACD 系列策略快照存储在 MySQL；指定历史交易日记录不存在时自动计算并保存
- 量价三信号和多空趋势多点快照均存储在 MySQL
- 快照日期始终使用实际交易日；周末或节假日访问时自动读取上一个交易日，不生成非交易日 JSON
- 价格类型：前复权日线
- 信号时点：收盘后
- 历史回测：本地保存的 2015—2025 年前复权数据

公开网页行情接口可能限流或调整。正式交易应更换为具备授权和稳定服务协议的行情供应商。
