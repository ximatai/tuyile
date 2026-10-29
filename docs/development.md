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

版本化 SQL 在 `migrations/`，显式迁移按事务锁和 checksum 执行，重复执行不重复建表，已应用 SQL 被修改则拒绝。迁移 1 保存账号/工作区/项目；迁移 2 增加图片任务、调用记录、额度、配置版本、文件元数据和引用；迁移 3/4 增加独立输出、预留、流水与历史纠正。迁移 5 增加模型能力、独立规划配置、技能版本、工具启停及任务工具版本绑定；迁移 6 追加画布文档、引用、落图回执和来源关系；迁移 7 增加规划预算/作业/调用证据、计划版本和步骤依赖；迁移 8 增加私有收藏；迁移 9 增加项目删除标记；迁移 10 增加规划历史归档、规划全局设置、管理审计及规划对账；迁移 11 增加规划历史与用户频率读取索引；迁移 12 增加规划模型视觉输入声明；当前 API/Worker 要求 schema 1—12。不建立租约或事件平台。内容归属通过 workspace 外键与服务端上下文共同约束，管理员没有跨工作区查看项目的特权。

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
corepack pnpm test:recovery
```

`test:recovery` 与其他数据库测试共用排他锁，用合成数据在新卷恢复并验证生产HTTPS；会暂时停止、随后恢复专用 `tuyile-test` PostgreSQL，不改开发库或原测试卷。需要Docker Desktop、OpenSSL和已安装的Chromium；先运行build。详见 [运行与恢复手册](operations.md)。

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

管理员待核验入口只展示元数据和额度，不展示私人正文、图片或 Key。当前工作区已限制人工核验为确认无法取得图片后释放预留，拒绝无本地成功输出的额外计次；同样处置幂等，不同重复处置拒绝。未解决 unknown 保留相关额度和引用保护。

上述为 M3 进行中的局部修正。M2 的旧入口允许人工确认额外成功张数；迁移 0003/0004 已实现合成旧数据纠正、独立输出/预留、额度流水及对账视图；正在按 [专项治理](architecture-governance.md) 完成逐步审阅。上游尝试不返还，费用证据与图片次数分开。

标准按钮、输入、选择器、表格、上传、提示和确认弹窗采用 Ant Design 6.6.8；共享 UI 包提供工程蓝主题与薄封装。构建 HTML 每次响应生成样式 nonce，经 ConfigProvider 传入动态样式，保持 CSP 的 script-src self，不使用 unsafe-inline。

新增 API 为 `/api/images/usage`、`/api/images/tasks`（提交/列表/详情/取消）、`/api/images/recover`、`/api/images/uploads`、`/api/images/assets/:id/{original,preview,download}`；管理配置为 `/api/image-admin/providers`、`policies/:userId` 和 `review`。全部按服务端工作区鉴权，管理员没有内容越权特例。

构建工具链和 pnpm store 使用 BuildKit 缓存，依赖仍以锁文件安装。若公共注册表下载中断，可在可信环境用 `corepack pack pnpm@9.14.2` 准备相同公共工具链缓存；本轮本地 Docker 验收预热了该工具链及已按文件完整性核验的公开 `antd@6.6.8` 包缓存，随后运行仓库原始 Dockerfile/Compose 构建。没有复制宿主应用构建产物、私人配置或数据进入镜像。网络异常和缓存预热属于本机验证条件，不代表远程 CI 或无缓存下载已通过。

Ant Design 底层 `@rc-component/util@1.14.0` 的滚动条测量及弹窗滚动锁没有传递 nonce，生产浏览器会阻止其临时样式。`patches/` 保留 ESM/CJS 的最小补丁与说明，让该库的动态样式工具在调用方未传 nonce 时读取页面 nonce，显式 nonce 仍优先；不修改全局 DOM、不放开任意内联样式。锁文件固定补丁，Docker 安装前复制补丁，构建浏览器验收覆盖真实 CSP。

Docker 验收每轮在严格守卫的 55441 / `tuyile_docker` 中建立新的随机合成管理员，测试凭据仅写入权限 0600 的忽略文件。它不清空已有数据、不修改应用登录限流，也不访问开发库。API 与构建版浏览器用本轮账号完成检查，避免多轮验收共用账号触发 15 分钟登录预算。


## 规划与可信扩展（M3 第 2 步）

图片服务与规划服务分别维护不可变配置版本，每类一个当前配置。图片配置包含逐模型能力声明：生成/编辑、参考图数量、尺寸与像素上限、限定尺寸、质量和格式。声明由管理员依据服务商信息填写，准入和 dispatch 校验绑定版本；不是在线自动探测或真实兼容性证明。

规划适配器只支持 Chat Completions 非流式协议，使用 `max_completion_tokens`，按配置选择 `json_object` 或文本后校验；调用者必须提供明确 JSON 指令。输入字符、响应体和输出预算均受限，缺失 token 用量为 unknown，适配器不自行重试。协议依据 [官方 Chat Completions 创建接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)；文档连接器返回 403 后通过官方网页核对。测试只注入合成响应，未发起真实模型请求。

`ToolRegistry` 在部署代码注册可信实现，不加载上传代码。工具 ID/版本不能重复，定义固定输入/输出 schema、权限、外部访问和单图副作用。执行上下文不提供数据库或 Key，只允许一次平台持有参数的生成调用；统一 Worker 继续负责尝试、持久化和额度。改变工具定义或实现语义必须增加版本，部署需保留仍被任务引用的版本；缺失版本拒绝执行，不回退到最新实现。

管理员通过页面或 `/api/image-admin/skills` 管理声明式技能，编辑新增版本。依赖必须是已注册且可用的工具；普通停用阻止新提交，已接受任务按绑定版本执行；撤销不可撤回，阻止后续 dispatch。`/api/skills` 只列出依赖完整、可用于新计划的技能。技能指导不具有授权效力。完整规划计次、确认与计划执行属于第 4 步，当前管理入口保存配置不会发起模型调用。


## 画布与前端状态（M3 第 3 步）

React Router 7.18.5 使用显式项目路径，TanStack Query 5.105.0 负责按账号/工作区/执行版本及项目区分的查询，React Flow 12.12.0 只负责展示与交互。图片与分组几何、自有 schemaVersion 1 文档、撤销历史和保存队列属于项目 editor store。标准控件仍由 Ant Design 提供。

`GET/POST /api/projects/:id/canvas` 查询/保存 revision 文档，`POST .../canvas/copy` 另存冲突副本，`GET .../canvas/outputs` 读取带 revision 的尚未落图输出，`GET .../canvas/sources` 读取只读来源关系。单文档最多 1000 个节点；未放入的输出保留在任务结果中，移除节点腾出空间后继续落图。响应体与查询批次均有界。画布引用和资产删除共用事务锁；保存回执与落图回执是不同业务事实，不使用任务轮询覆盖本地文档。

切页与普通注销先尝试保存；失败留在原项目，冲突可重载或另存；关闭浏览器有未保存修改时使用浏览器原生离开提示，不承诺离线保存。撤销账号或跨标签会话变化立即清除私有上下文，不保留浏览器私人正文副本。


## Agent 交互与后台执行（M3 第 4 步实施中）

项目工作台右侧提供直接创作和 Agent 页签。Agent 对话生成计划草案，支持保存手动修改版本；手动保存不调用规划模型或生成图片。只有确认才原子预留整计划图片并提交既有图片队列。需要前序图片的步骤等待前序成功并使用其第一张输出，前序失败停止后续；取消和重启不恢复旧执行。

`POST /api/agent/planning`、`GET /api/agent/jobs?projectId=...`、`GET /api/agent/usage` 分别负责规划准入、持久状态和规划额度；`POST /api/agent/jobs/:id/revisions` 保存不可变手动版本，`POST /api/agent/plans/:id/confirm` 确认，作业及计划分别提供 `.../:id/cancel`。均使用会话、workspace 授权及 CSRF；读取与刷新不触发模型。规划最多一次安全 429 重试与一次格式修复，共享 token/字符/截止预算，未知不重发。

当前只完成第四步的 Agent 链路与相应合成验收；图库、收藏及管理补齐仍在同一步继续，未作为完整 M3 交付。Docker 验收库已追加迁移至 7，开发库未随测试迁移。


图库后端提供 `/api/library/assets`、`favorites`、`groups`、`prompts`、`assets/:id/references` 及 `export`。图库覆盖本工作区上传和生成原件；收藏支持私有图片/提示词及分组。ZIP 每批最多 5 张且合计不超过 50 MiB，鉴权与哈希核验沿用私有原件服务，不接受远端 URL。公共提示池是代码内原创只读白名单。

`POST /api/projects/:id/delete` 与任务准入/画布/收藏共用用户事务锁；活动、取消中或待核验图片任务以及活动规划阻止删除。可删除时清除画布、对话、计划及任务提示词，保留原件/用量与必要归属行；删除项目退出普通查询与新准入，不恢复旧执行。专用测试库及 Docker 合成验收库已迁移至 10；开发库未随本轮测试迁移。


Web 图库、提示池与收藏分别使用 `/gallery`、`/prompts`、`/favorites`，页面按需加载，缓存包含认证身份。图库选择原件后可加入目标画布或设为参考图；提示词应用与图片引用通过 SessionState 内存草稿传递，消费后清除，不写浏览器持久存储。复用写入 revision 文档，未知保存结果保留同一请求；离开页面后的响应不会清空其他编辑上下文或强制切页。项目列表提供删除确认和服务端保护反馈。


管理页运行概览使用 `/api/image-admin/summary`，只返回状态/用量/错误码/审计元数据与对账差异。`execution-settings` 配置图片/规划的全局并发和队列；`planning-policies/:userId` 配置规划每日次数、并发和排队。管理员写入与准入共享短队列锁及排序账号锁，策略变更留审计，降额不取消已接受预留。

`POST /api/agent/projects/:id/clear` 清理已结束的规划对话与计划并释放其引用；活动、取消中或待核验任务会阻止清理。保留计次/调用证据及图片与任务历史，已归档的计划不能再确认或派生，旧幂等键不恢复已清理内容。
