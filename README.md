# 轮动看盘台

React + TypeScript + ECharts 前端，Fastify + TypeScript 行情代理。

## 启动

```powershell
npm install
npm run dev
```

- 前端：http://127.0.0.1:4173
- 后端：http://127.0.0.1:3001

`npm run dev` 会同时启动前后端。浏览器每次完整刷新都会请求后端重新获取 8 个 ETF 的真实前复权日线，并重新计算 MA20、动量排名和交易信号。

## 接口

- `GET /api/health`：代理健康检查
- `GET /api/strategy/rotation`：读取 30 秒缓存
- `GET /api/strategy/rotation?refresh=1`：强制重新获取上游行情
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
- MACD 策略扫描数据源：Tushare 日线接口；需要在 `.env.local` 配置 `TUSHARE_TOKEN`
- MACD 系列策略快照位置：`data/*-snapshots/YYYYMMDD.json`；指定历史交易日文件不存在时自动计算并保存
- 量价三信号快照位置：`data/volume-snapshots/YYYYMMDD.json`
- 多空趋势多点快照位置：`data/bull-point-snapshots/YYYYMMDD.json`
- 快照日期始终使用实际交易日；周末或节假日访问时自动读取上一个交易日，不生成非交易日 JSON
- 价格类型：前复权日线
- 信号时点：收盘后
- 历史回测：本地保存的 2015—2025 年前复权数据

公开网页行情接口可能限流或调整。正式交易应更换为具备授权和稳定服务协议的行情供应商。
