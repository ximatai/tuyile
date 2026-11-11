# 运行与备份恢复

部署由 API、一个 Worker、PostgreSQL 和私有图片卷组成。本文说明独立运行、HTTPS 配置与成套备份恢复。

## 独立运行

依赖和隔离地址见 [本地开发](development.md)。当前程序要求 schema 1—35（以[迁移目录](../migrations)及启动校验为准）；迁移由 migrator 显式执行，API/Worker 只检查兼容性，运行身份不能修改 schema。普通停止用 `docker compose ... stop api worker`，保留数据库与图片卷；不要用删除卷解决启动问题。

本地 Docker 使用 `.env.docker`、项目 `tuyile-docker`、数据库 `tuyile_docker`/55441 和应用8792。专用自动测试只使用 `tuyile_test`/55440。其他实例的数据、凭据与后台服务不参与本实例运行或构建。

后台 Worker 持有执行。关闭页面和普通注销不会取消任务；Worker 中断后不承诺续跑。重启后已保存输出仍可读取，未知结果保留待核验，不重发。不要启动第二个 Worker，也不要把健康 Worker 的数据库状态手工改回 queued。

## HTTPS 配置材料

[生产配置覆盖文件](../compose.production.yaml)将 API/Worker 设为 production，要求明确的 HTTPS origin；基础 Compose 的 API 和数据库端口仍只绑定 loopback。正式部署需配置对应的证书、域名、主机和外部流量入口。

只检查配置、不启动服务：

```sh
PUBLIC_APP_ORIGIN=https://tuyile.example docker compose --env-file .env.docker -p tuyile-docker -f compose.yaml -f compose.production.yaml config --quiet --no-env-resolution
```

[Nginx 模板](../deploy/nginx.conf.example)供宿主机代理使用；替换域名，配置证书和密钥后先运行 `nginx -t`。API 的精确 origin 与浏览器入口必须一致。生产会话使用 Secure、HttpOnly、SameSite=Strict；不把模型 Key 或私有图片地址变成公开链接。模板不重试上游请求，应用继续使用 HTTP 轮询，无需 SSE 或 WebSocket。

配置依据为 [Nginx proxy 模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)与 [SSL 模块](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)。本地演练用短期自签证书，仅在隔离浏览器上下文接受该证书，不修改系统信任，也不关闭应用 TLS 验证。

外部 Agent 连接同一 HTTPS 域名的 `/mcp` 路由，由现有代理转发到 API。内网实例要求 Agent 所在设备能够访问该地址。项目连接和令牌管理位于画布的「在 Codex 中继续」。

## 成套备份

备份是同一停写点的数据库、私有图片卷和对应应用版本。仅备份数据库会缺原图；只复制图片不能恢复归属、引用、任务及额度。已保存内容的恢复与任务续跑是两回事。

操作顺序：

1. 停止 API 和 Worker，确认本实例没有其他写入者；等待正常关闭，记录需要核验的未知任务。
2. 用对应 PostgreSQL 版本的 `pg_dump -Fc` 备份完整应用数据库；同时打包私有图片卷，保留所有原件和预览。示例模板、初始化状态和副本元数据随完整数据库备份，源图及副本原件/预览也必须包含在图片卷中。记录当前 Git/镜像版本、schema版本、文件/归档哈希及备份时间。
3. 备份目录权限0700、文件0600，放在Git外。主密钥 `APP_MASTER_KEY` 与数据库/运行凭据另行安全保管；不要把它们写入报告或与备份一起公开。恢复配置中的主密钥必须与备份匹配。
4. 校验备份后再启动原实例。保留上一次已验证备份；轮换前先确认新备份可恢复。

采用 PostgreSQL 原生 dump/restore 和普通文件归档即可。当前不建设在线快照、增量平台或跨区域容灾。

## 恢复与回退

恢复先落到新的隔离数据库卷和图片目录，原实例保留。用初始化脚本建立 migrator/runtime 角色，再由受控维护身份恢复 dump 的所有权、约束和授权；应用始终使用 runtime 身份。不要以超级用户运行 API/Worker。

恢复前核对归档哈希；恢复后逐个核对原图/预览哈希、schema校验和、账号及项目归属、画布/收藏/引用、输出与额度对账。缺文件、损坏、错误主密钥、schema不匹配或对账差异都不能算恢复成功。

先核对已保存状态，再启动一个 Worker。原在途未知任务应失败并保留待核验证据，不应重发；单独提交一个新的合成任务验证新的执行链。随后通过 HTTPS 用两个账号核对资源隔离、轮询、下载和会话属性。

回退使用与备份 schema 匹配的应用镜像和成套数据库/文件快照；不自动降级 schema。发生新写入后，不直接用旧备份覆盖当前唯一数据，先保留当前完整副本，再按业务需要决定恢复点。真实实例切换需明确目标环境与授权。

## 可重复的本地演练

```sh
corepack pnpm build
corepack pnpm test:recovery
```

演练占用与集成/浏览器相同的数据库排他锁，不能并行运行。脚本拒绝非 loopback55440/tuyile_test；创建合成账号、原图、画布、收藏、规划及在途未知记录，备份后暂时停止 `tuyile-test` PostgreSQL，在随机命名的新 Compose 项目/新卷中仍以55440/tuyile_test恢复。结束时删除该次新测试卷并恢复原测试容器，不删除原卷，不使用开发库或旧项目数据。

演练实际校验缺图/损坏检测、原件哈希、关系和额度、服务配置解密、未知不重发、新生成、编译版API生产HTTPS、Secure Cookie及双账号/匿名资源隔离。报告、dump、自签证书和截图均位于被忽略的 `.codex-temp/m4-recovery-*`，包含测试凭据的产物不可提交。演练退出失败时先检查测试容器状态；不要删除数据库测试锁或原卷来绕过失败。

本机演练使用 Docker Desktop 的 `host.docker.internal` 连接本机编译版API，仅把Nginx的HTTPS端口映射到 `127.0.0.1:8843`。固定官方Nginx镜像先校验原始模板，再以演练上游地址运行同一配置；浏览器请求实际经过Nginx，不用前端假响应替代。

`RECOVERY_TEST_ABORT_AFTER_CLONE=1 corepack pnpm test:recovery` 是有意中断反例，预期退出非零；正常SIGINT/SIGTERM会等待清理临时容器/卷并恢复原测试实例，失败或中断不会写入成功报告。SIGKILL或宿主机故障无法保证执行清理：先确认测试进程已结束，依据该次忽略目录的 `run.json` 精确识别随机恢复项目、Nginx容器及本次API进程。核对PID仍对应本次8795端口的编译API后再结束它，仅清理本次代理和恢复项目，再启动原 `tuyile-test` PostgreSQL。不要盲目按PID终止进程、按前缀批量删除卷，或把原项目当恢复项目清理。

本地演练通过不能替代目标部署环境的验证。

## 公开分发

构建镜像不等于公开发布。分发源码或镜像前检查[发布指南](releasing.md)中的暂存区、Git历史、原生依赖许可和隐私要求；不把运行卷、Key或本地验收数据放入镜像。

规划任务出现 `PLANNING_RESULT_UNKNOWN` 时，先按任务 ID 查询 `planning_attempts.error_code`。新调用可区分 `PLANNING_DNS_FAILURE`、`PLANNING_CONNECT_TIMEOUT`、`PLANNING_CONNECT_REFUSED`、`PLANNING_TLS_FAILURE`、`PLANNING_CONNECTION_LOST`、`PLANNING_RESPONSE_TIMEOUT`、`PLANNING_RESPONSE_READ_FAILED`、`PLANNING_RESPONSE_JSON_INVALID` 和 `PLANNING_TRANSPORT_FAILED`。这些是故障阶段提示，不能单凭连接断开认定上游未处理或未计费。历史同名泛化错误不含原始原因；不要为诊断盲目重放任务。调用中断沿用 `PLANNING_INTERRUPTED`，worker 中断沿用原有恢复规则。诊断记录不保存原始响应、异常消息或凭据。

文案便签使用CanvasDocument v1的新增节点类型及任务JSONB快照，无需新增SQL迁移；升级时API、Worker与Web应使用同一镜像版本。旧版不认识text节点，不应在已有文案的实例上直接降级；先备份数据库与图片卷，并在隔离环境核对目标版本兼容性。

## 创作升级与版本核对

升级到 SVG 支持版本须先在同一停写点备份，再显式应用 0030；它只追加衍生来源外键和活跃副本索引，不覆盖已有任务、原件或额度。迁移前后核对原表已有列的数据摘要、原件/预览文件哈希及 schema；迁移成功后旧版 schema 校验不兼容，不直接切旧镜像。启动前发生失败可以恢复同停写点成套备份；新 API 接受写入后先保留当前完整状态，再决定恢复点。

`/api/health` 和 `/api/ready` 返回 package.json 版本，镜像构建可传入 APP_REVISION、APP_VERSION，保存 OCI 版本/提交标签。API 与唯一 Worker 使用同一候选镜像；候选和正式版本均核对 HTTPS、私有文件、数据库身份、Worker 启动及重启次数。浏览器需实际核对 CSP、旧资料读取、新草稿保存及隔离；不以进程运行或首页 200 代替业务验收。

新增 2.6、markup 或 SVG 选项前核对实际服务权限及能力。发现模型目录刷新失败时保留原目录和已发布默认项，不据同名模型推定真实接口已验证。没有付费测试授权时只做不付费检查，记录未验证组合；生产禁止 fake。
