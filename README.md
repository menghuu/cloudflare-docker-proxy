# cloudflare-docker-proxy

![deploy](https://github.com/menghuu/cloudflare-docker-proxy/actions/workflows/deploy.yaml/badge.svg)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/menghuu/cloudflare-docker-proxy)

## 部署

1. ~~点击 "Deploy With Workers" 按钮（没有测试过）~~
2. fork 后添加 cloudflare 的 `CF_API_TOKEN`, `CF_ACCOUNT_ID` 以及 `CF_BASE_DOMAIN` 到 github 的 action 配置中。使用 github action 来自动部署
3. 自行修改配置选项后，拷贝到 cloudflare 的 worker 的代码编辑中

## 一些配置项解释

配置项位于 [wrangler.toml](./wrangler.toml) 和 `.dev.vars`(主要用于本地开发使用)

- `.dev.vars` 文件定义了用于本地开发(`npx wrangler dev`)时使用的环境变量
- `staging` 阶段是指：`npx wrangler deploy --env=staging` 会自动创建一个新的 cloudflare worker 项目，并用这个项目来做线上的测试
- 如果使用 github action，会使用 `production` 阶段的配置
- 配置选项中的 `routes` 或者 `route` 中配置成例子中的那样需要满足：
  - 将域名修改成你托管在 cloudflare 中的域名。
  - 需要保持域名最前面的前缀（也就是 `hub`/`gcr` 等子域名）是和 [index.js](./src/index.js) 中的代码保持一致
- `FORWARD_TOKEN` 如果为 true（默认为 true），则会使用 cloudflare 来转发 token 申请；否则的话，使用本地 IP 申请
- 如果使用 github action 部署，请一定要将 `CF_BASE_DOMAIN` 设置成你自己托管在 cloudflare 中的域名
  - 貌似 `https://auth.docker.io/token` 可以正常访问
- 其他的配置选项基本上无需更改

## 感谢

初始版本来自：[ciiiii/cloudflare-docker-proxy](https://github.com/ciiiii/cloudflare-docker-proxy)
