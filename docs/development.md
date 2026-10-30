# 本地开发与验证

工程约束见[仓库说明](../AGENTS.md)，产品与技术边界分别见[产品基线](product-baseline.md)和[架构设计](architecture.md)。本文只保留当前操作方法，阶段过程与验收证据见[归档](archive/README.md)。

## 环境与启动

Node版本以[.node-version](../.node-version)为准，pnpm以[package.json](../package.json)为准，依赖以锁文件为准；当前为Node24.15.0、pnpm9.14.2、PostgreSQL18.4。使用对应Node；宿主pnpm包装器选择其他运行时时，使用`corepack pnpm`。

首次准备新工程：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm env:init
docker compose config --quiet --no-env-resolution
docker compose up -d --wait postgres
corepack pnpm db:migrate
corepack pnpm dev
```

`env:init`创建本地开发、测试、Docker配置，已有文件不覆盖，并仅补齐缺失配置。凭据文件只供当前用户读取，不输出其内容或展开后的Compose配置。`.env.example`仅说明字段，不能作为正式凭据。

| 用途           | Web / API          | 数据库                        |
| -------------- | ------------------ | ----------------------------- |
| 开发           | Vite5178 / API8791 | loopback55439 / tuyile_dev    |
| 自动浏览器测试 | Web5180 / API8793  | loopback55440 / tuyile_test   |
| 编译产物验证   | API8794            | loopback55440 / tuyile_test   |
| Docker验收     | API与静态Web8792   | loopback55441 / tuyile_docker |

使用配置中的`APP_ORIGIN`，不混用localhost与127.0.0.1。所有本地服务只绑定loopback。`api:dev`、`web:dev`、`worker:dev`可分别启动；避免同时运行两份Worker或占用相同端口。Ctrl-C只关闭本次启动的进程，不操作旧项目LaunchAgent。

开发通常使用Vite。需要编译版时运行`corepack pnpm build`，再分别运行`corepack pnpm start`和`corepack pnpm worker:start`；直接访问API静态站点时，`APP_ORIGIN`必须与该浏览器入口一致。已有静态站点正在服务时，先隔离构建并验证，再更新入口、保留旧hash资源，避免构建清空正在使用的dist。

原工程只作参考，禁止在其目录构建或复制其.env、数据、dist、node_modules。不得以尚未上线为由清空开发库、删除运行卷或改写已应用迁移。

## 账号与密钥

没有默认账号、默认密码或匿名初始化接口。仅首次初始化，通过终端静默输入或密码管理器注入`ADMIN_USERNAME`、`ADMIN_PASSWORD`，运行`corepack pnpm admin:init`；密码12–128字符。已有账号时拒绝重复初始化。不要把密码放入命令历史、共享日志或Git，使用后清除临时环境变量。

管理员在页面创建member并通过自己的渠道交付一次性激活链接；激活链接24小时、重置链接1小时。token位于fragment，页面读取后从地址栏清除，仅服务端摘要持久化。重新生成链接使旧链接和旧密码失效，使用后返回登录。

管理员恢复：注入`ADMIN_USERNAME`与新的`ADMIN_RECOVERY_FILE`路径，运行`corepack pnpm admin:recover`。命令只恢复已启用管理员，撤销旧会话/执行授权，将一小时链接写入新建的0600文件，既有文件不覆盖；使用后清理。普通成员通过管理员页面重置。

账户菜单提供修改密码弹窗与退出。普通退出仅撤销当前会话；停用、修改/重置密码撤销全部会话及后续执行授权。会话固定7天，Cookie使用HttpOnly、SameSite=Strict，正式HTTPS同时使用Secure。登录限流为每规范化账号10次/15分钟，公开认证操作每直接连接地址100次/15分钟；测试使用随机账号，不放宽应用限流。

`APP_MASTER_KEY`为32字节十六进制密钥，用于AES-256-GCM加密Provider Key。它与数据库/图片卷分开备份，丢失后无法解密旧配置。`STORAGE_DIR`由API/Worker共享，production要求绝对路径。不同数据库不能共用图片目录，详见[运行与恢复](operations.md)。

## 数据库与配置

PostgreSQL初始化分别建立migrator和runtime角色：前者拥有tuyile schema，后者只有schema usage和业务表DML，不能改schema或迁移记录。迁移显式执行并校验checksum；API/Worker只检查schema兼容性和运行身份，发现缺失、不兼容或过度授权即拒绝启动。当前迁移1—13，实际版本以[migrations](../migrations)和启动校验为准。

模型服务通过命名连接管理Base URL和加密Key，从GET /models取得候选，也可手动登记；对话/图片分别发布开放池并指定默认项。目录刷新不自动改动开放范围，能力由管理员声明，已接受任务绑定不可变版本。普通用户只收到允许模型与能力，不收到地址或Key；个人策略按池条目ID与全局开放池取交集。

自动测试使用明确的fake Provider，输出合成图片并经过真实API、Worker、PostgreSQL、解码、文件与额度链路。production禁止fake。新增真实模型调用须有对应授权，不能用fake证明真实服务兼容性。

## 自动验证

先启动专用测试数据库：

```sh
docker compose --env-file .env.test -p tuyile-test up -d --wait postgres
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm test:runtime
corepack pnpm test:recovery
```

`build`会写入dist，运行前确认不会破坏正在使用的静态站点。验证范围如下：

| 检查        | 重点                                                           |
| ----------- | -------------------------------------------------------------- |
| unit        | 领域规则、能力/规格、预算及依赖边界                            |
| integration | 真实PG事务、权限、并发准入、额度/引用/撤销竞争、迁移与运行角色 |
| e2e         | 账号与隔离、后台创作、画布、Agent、图库/收藏、模型池及账户弹窗 |
| runtime     | 编译API/Worker、私有文件、重启/中断、单Worker及正常关闭        |
| recovery    | 成套备份、新卷恢复、哈希/关系/额度、真实Nginx HTTPS            |

数据库测试必须串行，共用`.codex-temp/database-tests.lock`。reset/seed仅允许loopback55440的`tuyile_test`，不得指向开发或Docker验收库。强制中断留下锁时先确认没有存活测试进程，再处理锁；不能靠删锁绕过并发守卫。

e2e自行启动/关闭测试服务，凭据随机，截图和trace被忽略。界面验收以1440/1920桌面为主，保留已有390px历史回归，不新增手机专项。浏览器几何检查应等真实布局动画结束，不以固定sleep或过渡中的跨帧测量冒充稳定布局。

恢复演练需要Docker Desktop、OpenSSL及Chromium，会暂时停止再恢复原专用测试PG，只清理本次随机新卷，不改开发库。详细失败与中断清理见[运行手册](operations.md)。

## Docker与生产浏览器验证

```sh
docker compose --env-file .env.docker -p tuyile-docker config --quiet --no-env-resolution
docker compose --env-file .env.docker -p tuyile-docker --profile app up -d --build --wait
corepack pnpm test:docker
docker compose --env-file .env.docker -p tuyile-docker --profile app stop api worker
```

Docker使用独立库、图片卷和合成账号；验收脚本不清空已有数据，不使用开发库。容器以非root运行，API/Worker不接收迁移密码；本地Compose为development HTTP，production要求HTTPS Origin。停止或down保留卷，不使用`-v`。

标准控件由Ant Design提供，动态样式传递页面nonce，CSP不放开任意内联脚本。[补丁说明](../patches/README.md)记录底层滚动条/弹窗样式nonce修正；改动相关组件时要验证构建版CSP、滚动锁、关闭动画及焦点，而不只验证Vite。

CI复用这些合成验证，不执行公开部署。远程CI是否通过以其实际记录为准；本地通过不等于远程已运行。日志、截图、备份、凭据和生成素材留在忽略目录或运行卷，不进入Git。
