# 本地开发与阶段验收

本工程与原项目运行目录、依赖、构建产物、数据库和配置完全分开。无需停止原服务。账号/工作区/项目基础已交付；阶段 2 已完成后台创作、私有文件和额度链路，并通过自查与独立 review。

## 环境与启动

固定 Node 24.15.0、pnpm 9.14.2 和 PostgreSQL 18.4。Node 版本见 `.node-version`，包管理器和精确依赖见 `package.json` 与锁文件。选择对应 Node 后执行；若本机 `pnpm` 包装器误选其他版本，统一用 `corepack pnpm`。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm env:init
docker compose config --quiet --no-env-resolution
docker compose up -d --wait postgres
corepack pnpm db:migrate
corepack pnpm dev
```

`env:init` 以仅当前用户可读权限创建随机本地数据库凭据，已有 `.env` / `.env.test` 不覆盖；不输出值。不要运行输出完整配置的 Compose 命令。`.env.example` 仅说明字段，不能作为正式凭据。数据库初始化只在新卷执行；改变角色密码后需受控修改现有数据库，不能误以为改环境文件即可更新旧卷，也不要删除已有卷解决问题。

| 用途 | 地址 / 数据库 | 数据隔离 |
| --- | --- | --- |
| 本地 Web | `http://127.0.0.1:5178` | Vite 代理到独立 API |
| 本地 API | `http://127.0.0.1:8791` | 开发库 `tuyile_dev`，PG `127.0.0.1:55439` |
| 浏览器测试 | Web 5180 / API 8793 | 测试库 `tuyile_test`，PG `127.0.0.1:55440` |
| Docker 本地整体验收 | `http://127.0.0.1:8792` | 独立 PG 55441 / tuyile_docker，Compose 项目 `tuyile-docker` 与独立图片卷 |

统一使用配置中的 `APP_ORIGIN` 地址访问；`localhost` 与 `127.0.0.1` 是不同 Origin，不混用。默认只绑定 loopback。Web/API/Worker 可通过 `web:dev` / `api:dev` / `worker:dev` 单独启动；Ctrl-C 关闭当前开发进程，不操作旧 LaunchAgent。

## 首个管理员与账号

没有默认账号或密码，也没有匿名初始化接口。仅首次初始化时，通过当前终端环境提供 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`，再执行 `corepack pnpm admin:init`；不要把密码写入命令历史、提交文件或共享日志。建议使用终端静默输入或密码管理器注入。密码要求 12–128 个字符，命令不输出密码；已有账号时拒绝重新初始化。用完清除当前终端的这两个环境变量。

部署侧管理员恢复沿用旧工程的受控能力：提供 `ADMIN_USERNAME` 和新建的 `ADMIN_RECOVERY_FILE` 路径，运行 `corepack pnpm admin:recover`。命令只允许恢复已启用的管理员，撤销旧密码/会话/执行授权，将一小时一次性重置链接写入权限 0600 的新文件，不在终端打印链接，也不提供 HTTP 恢复入口。文件存在时拒绝覆盖；交付并使用后清理私有文件。普通成员由管理员在页面重置。

管理员创建成员，复制一次性激活链接并通过自己的可信渠道交付。链接 token 使用 fragment，页面读取后从地址栏清除，只在内存使用；服务端仅存摘要。激活链接 24 小时，重置链接 1 小时；重新生成时旧链接和旧密码均失效，停用后链接失效。使用完回到登录，不自动创建会话。

会话 Cookie 为 HttpOnly、SameSite=Strict，正式 HTTPS 环境同时 Secure；固定 7 天到期。普通注销仅删除本设备会话；停用、密码修改/重置撤销全部会话并提高执行授权版本。重新启用不会恢复旧会话或旧任务授权。当前管理员不能停用自己；首版管理入口只创建 member。

登录按规范化账号最多 10 次 / 15 分钟，公开认证操作另按直接连接地址最多 100 次 / 15 分钟，数据库原子计数。反向代理地址不盲目信任客户端转发头；代理限流和可信代理设置在正式部署时核定。管理员列表与项目列表以 50 条普通分页读取，页面可加载更多；不引入事件游标。

## 数据库迁移与运行权限

PostgreSQL 初始化创建 `tuyile_migrator` 和 `tuyile_runtime`。前者拥有 `tuyile` schema，后者只有 schema usage 与业务表 DML，不能 CREATE/ALTER 业务 schema，也不能修改迁移记录。API/Worker 启动只检查 schema 版本和运行角色，不自动迁移；schema 缺失/不兼容或身份过度授权时拒绝启动。

版本化 SQL 在 `migrations/`，显式迁移按事务锁和 checksum 执行，重复执行不重复建表，已应用 SQL 被修改则拒绝。迁移 1 保存账号/工作区/项目；迁移 2 增加图片任务、调用记录、额度、配置版本、文件元数据和引用，不建立租约或事件平台。内容归属通过 workspace 外键与服务端上下文共同约束，管理员没有跨工作区查看项目的特权。

## API 与前端边界

| 接口 | 权限 / 行为 |
| --- | --- |
| `GET /api/health`、`GET /api/ready` | 进程存活与 schema/运行身份检查，不含私有数据 |
| `POST /api/auth/login`、`activate`、`reset` | 登录或一次性 token 兑付；Origin/JSON 与限流校验 |
| `GET /api/auth/me` | 当前用户、个人工作区和 CSRF token |
| `POST /api/auth/logout`、`password` | 当前设备注销 / 全设备改密撤销 |
| `GET/POST /api/projects`、`GET /api/projects/:id` | 仅当前工作区的项目列表（offset 分页）、创建和详情 |
| `GET/POST /api/admin/users` | 管理员分页读取脱敏账号或创建成员 |
| `POST /api/admin/users/:id/reset`、`enabled` | 管理员重置/激活链接和启停 |

共享 DTO/校验在 contracts，业务用例在 core，事务 SQL、加密与配置在 infrastructure，入口显式组合。错误返回稳定 code/requestId，不返回 SQL、密码摘要或原始错误。所有写请求校验精确 Origin 和 JSON；已登录写请求还需 CSRF token。无匿名内容访问，角色不足 403，跨账号资源 404，响应不缓存。

前端显式 API 客户端，不修改全局 fetch；用户/项目/CSRF 数据不写浏览器持久存储。仅侧栏折叠偏好持久化。会话改变通过无内容的跨标签通知刷新，避免同浏览器切账号后残留旧页面。保留工程蓝配色及侧栏比例，复用与重新实现的来源见 [来源说明](../THIRD_PARTY_NOTICES.md)。

## 验证

```sh
docker compose --env-file .env.test -p tuyile-test up -d --wait postgres
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm test:runtime
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

集成与浏览器测试会清空合成测试库，必须串行；共同启动脚本以本地排他锁拒绝两组同时运行。若强制中断留下锁文件，先核对没有存活测试进程，再移除 `.codex-temp/database-tests.lock`。脚本核对目标为 loopback 55440 的 `tuyile_test`，否则拒绝重置。浏览器测试自行启动/关闭测试 API/Web，并使用运行时随机凭据，截图/trace/合成凭据均被忽略。开发库不被测试重置。首次安装 Linux 浏览器可用 `playwright install --with-deps chromium`。

浏览器覆盖桌面 1440px 和手机 390px：登录、项目创建/刷新、管理员建成员/激活、双账号隔离、改密和注销、折叠导航与页面溢出。构建产物额外在测试端口 8794 验证 API/Worker 就绪、静态页面/JS 访问和 SIGTERM 正常关闭，避免只验证 tsx 开发入口。真实 PG 覆盖迁移重放、运行权限、并发链接兑付、过期/替换令牌、多会话撤销、workspace 外键、HTTP/CSRF 和并发限流。阶段 2 补充后台生图、额度、文件和进程故障检查；完整画布和 Agent 属于阶段 3。

```sh
docker compose --env-file .env.docker -p tuyile-docker config --quiet --no-env-resolution
docker compose --env-file .env.docker -p tuyile-docker --profile app up -d --build --wait
corepack pnpm test:docker
curl --fail http://127.0.0.1:8792/api/ready
docker compose --env-file .env.docker -p tuyile-docker --profile app down
```

本地 Compose 明确采用 development HTTP；Docker 镜像默认 production，正式运行必须 HTTPS Origin，并另行确认主机/域名/密钥与迁移窗口。运行容器用非 root 用户，API/Worker 不接收迁移密码。`down` 保留数据卷，不加 `-v`。迁移命令先完成，API 和 Worker 才启动；不要同时启动两份开发服务占用相同端口。

CI 工作流复用上述脚本，仅建立合成数据和独立卷，不发布镜像或部署。远程 CI 是否通过须看实际运行记录，本地通过不等于远程已运行。

## 后台图片创作与私有文件

API 负责准入，单 Worker 读取 PostgreSQL 队列并执行。每用户等待队列默认 10、全局 64；执行并发默认每用户 1、全局 2。等待与执行容量独立，整单预留图片与存储后才接受任务。同一 requestKey 和相同输入返回原任务，不同输入返回冲突。前端每 1.5 秒读取任务快照，丢失提交响应时使用原键找回。

普通注销不取消任务。停用、改密、重置和显式取消阻止后续 dispatch，并尽力取消在途请求；在途仍可能计费。Worker 使用 PostgreSQL 会话 advisory lock，失去连接立即停止执行，第二份 Worker 拒绝启动。重启时原 running 任务失败或部分完成，dispatched/received 未确认调用保留 unknown，不重发；API 重启不执行这项清理。

`APP_MASTER_KEY` 为 32 字节十六进制密钥，用于 AES-256-GCM 加密 Provider Key；与数据库和图片卷分开保管并备份，丢失后无法解密旧配置。`env:init` 仅补齐缺失配置，不覆盖现有值。Provider 保存为不可变版本；保留 Key 必须显式选择且模式与地址一致。普通用户只收到允许模型，不收到地址或 Key。适配 JSON 生图和 multipart 参考图，仅接受内嵌 base64 图片，不下载上游 URL。未知网络/5xx 不重试，仅明确 429 最多一次重试；真实模型兼容性仍需授权烟测。

开发/测试支持明确标注的 fake Provider，输出真实编码的合成蓝色图片，经过完整 Worker、解码、落盘和额度流程。production 禁止 fake。假服务不调用模型，不能证明真实模型兼容性。

`STORAGE_DIR` 是 API/Worker 共用的私有目录，production 必须使用绝对路径。Docker 使用独立 `images` 卷 `/app/storage`，禁止不同数据库共用图片目录。原件/预览通过鉴权 API 提供，不作静态资源开放。文件经过 staging、同步、rename、数据库 ready 后可见；提交回执丢失不能删除已 ready 文件。孤立 staging 和 deleting 由 Worker 清理，物理删除后释放容量。上传校验真实格式/尺寸并受限解码；读取核验哈希。磁盘低于 512 MiB 暂停新准入。

管理员待核验入口只展示元数据和额度，不展示私人正文、图片或 Key。人工确认成功张数只结算额度，不生成或恢复本地文件；同样处置幂等，不同重复处置拒绝。未解决 unknown 保留相关额度和引用保护。

上述为 M2 当前实现说明。用户随后确认图片额度只计本地成功持久化输出，上游收费但无法取得图片应在核验后释放图片预留，尝试/费用另记。当前人工核验入口尚未符合此细化口径，列入 [专项治理 G2](architecture-governance.md)，不能以历史测试通过视为已修正。

标准按钮、输入、选择器、表格、上传、提示和确认弹窗采用 Ant Design 6.6.8；共享 UI 包提供工程蓝主题与薄封装。构建 HTML 每次响应生成样式 nonce，经 ConfigProvider 传入动态样式，保持 CSP 的 script-src self，不使用 unsafe-inline。

新增 API 为 `/api/images/usage`、`/api/images/tasks`（提交/列表/详情/取消）、`/api/images/recover`、`/api/images/uploads`、`/api/images/assets/:id/{original,preview,download}`；管理配置为 `/api/image-admin/providers`、`policies/:userId` 和 `review`。全部按服务端工作区鉴权，管理员没有内容越权特例。

构建工具链和 pnpm store 使用 BuildKit 缓存，依赖仍以锁文件安装。若公共注册表下载中断，可在可信环境用 `corepack pack pnpm@9.14.2` 准备相同公共工具链缓存；本轮本地 Docker 验收预热了该工具链及已按文件完整性核验的公开 `antd@6.6.8` 包缓存，随后运行仓库原始 Dockerfile/Compose 构建。没有复制宿主应用构建产物、私人配置或数据进入镜像。网络异常和缓存预热属于本机验证条件，不代表远程 CI 或无缓存下载已通过。

Ant Design 底层 `@rc-component/util@1.14.0` 的滚动条测量及弹窗滚动锁没有传递 nonce，生产浏览器会阻止其临时样式。`patches/` 保留 ESM/CJS 的最小补丁与说明，让该库的动态样式工具在调用方未传 nonce 时读取页面 nonce，显式 nonce 仍优先；不修改全局 DOM、不放开任意内联样式。锁文件固定补丁，Docker 安装前复制补丁，构建浏览器验收覆盖真实 CSP。

Docker 验收每轮在严格守卫的 55441 / `tuyile_docker` 中建立新的随机合成管理员，测试凭据仅写入权限 0600 的忽略文件。它不清空已有数据、不修改应用登录限流，也不访问开发库。API 与构建版浏览器用本轮账号完成检查，避免多轮验收共用账号触发 15 分钟登录预算。
