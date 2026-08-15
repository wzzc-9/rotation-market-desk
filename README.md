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

开发环境由 Vite 将 `/api` 转发至 Fastify，浏览器不会直接访问第三方行情接口。

## 数据说明

- 当前看盘数据源：腾讯证券公开行情接口
- 价格类型：前复权日线
- 信号时点：收盘后
- 历史回测：本地保存的 2015—2025 年前复权数据

公开网页行情接口可能限流或调整。正式交易应更换为具备授权和稳定服务协议的行情供应商。
