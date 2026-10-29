# 本地运行、备份恢复与发布材料

本轮交付只在本地验收，不执行公开部署，也不做旧业务数据迁移。沿用模块化单体、一个 Worker、PostgreSQL 和私有图片卷，不增加备份平台或调度服务。

## 独立运行

依赖和隔离地址见 [本地开发](development.md)。当前程序要求 schema 1—12；迁移由 migrator 显式执行，API/Worker 只检查兼容性，运行身份不能修改 schema。普通停止用 `docker compose ... stop api worker`，保留数据库与图片卷；不要用删除卷解决启动问题。

本地 Docker 使用 `.env.docker`、项目 `tuyile-docker`、数据库 `tuyile_docker`/55441 和应用8792。专用自动测试只使用 `tuyile_test`/55440。旧项目、旧 LaunchAgent 和它的数据不参与新工程运行或构建。

后台 Worker 持有执行。关闭页面和普通注销不会取消任务；Worker 中断后不承诺续跑。重启后已保存输出仍可读取，未知结果保留待核验，不重发。不要启动第二个 Worker，也不要把健康 Worker 的数据库状态手工改回 queued。

## HTTPS 配置材料

[生产配置覆盖文件](../compose.production.yaml)将 API/Worker 设为 production，要求明确的 HTTPS origin；基础 Compose 的 API 和数据库端口仍只绑定 loopback。正式证书、域名、主机及外部流量不在本轮执行范围。

只检查配置、不启动服务：

```sh
PUBLIC_APP_ORIGIN=https://tuyile.example docker compose --env-file .env.docker -p tuyile-docker -f compose.yaml -f compose.production.yaml config --quiet --no-env-resolution
```

[Nginx 模板](../deploy/nginx.conf.example)供宿主机代理使用；替换域名，配置证书和密钥后先运行 `nginx -t`。API 的精确 origin 与浏览器入口必须一致。生产会话使用 Secure、HttpOnly、SameSite=Strict；不把模型 Key 或私有图片地址变成公开链接。模板不重试上游请求，应用继续使用 HTTP 轮询，无需 SSE 或 WebSocket。

配置依据为 [Nginx proxy 模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)与 [SSL 模块](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)。本地演练用短期自签证书，仅在隔离浏览器上下文接受该证书，不修改系统信任，也不关闭应用 TLS 验证。

## 成套备份

备份是同一停写点的数据库、私有图片卷和对应应用版本。仅备份数据库会缺原图；只复制图片不能恢复归属、引用、任务及额度。已保存内容的恢复与任务续跑是两回事。

操作顺序：

1. 停止 API 和 Worker，确认本实例没有其他写入者；等待正常关闭，记录需要核验的未知任务。
2. 用对应 PostgreSQL 版本的 `pg_dump -Fc` 备份完整应用数据库；同时打包私有图片卷，保留所有原件和预览。记录当前 Git/镜像版本、schema版本、文件/归档哈希及备份时间。
3. 备份目录权限0700、文件0600，放在Git外。主密钥 `APP_MASTER_KEY` 与数据库/运行凭据另行安全保管；不要把它们写入报告或与备份一起公开。恢复配置中的主密钥必须与备份匹配。
4. 校验备份后再启动原实例。保留上一次已验证备份；轮换前先确认新备份可恢复。

采用 PostgreSQL 原生 dump/restore 和普通文件归档即可。当前不建设在线快照、增量平台或跨区域容灾。

## 恢复与回退

恢复先落到新的隔离数据库卷和图片目录，原实例保留。用初始化脚本建立 migrator/runtime 角色，再由受控维护身份恢复 dump 的所有权、约束和授权；应用始终使用 runtime 身份。不要以超级用户运行 API/Worker。

恢复前核对归档哈希；恢复后逐个核对原图/预览哈希、schema校验和、账号及项目归属、画布/收藏/引用、输出与额度对账。缺文件、损坏、错误主密钥、schema不匹配或对账差异都不能算恢复成功。

先核对已保存状态，再启动一个 Worker。原在途未知任务应失败并保留待核验证据，不应重发；单独提交一个新的合成任务验证新的执行链。随后通过 HTTPS 用两个账号核对资源隔离、轮询、下载和会话属性。

回退使用与备份 schema 匹配的应用镜像和成套数据库/文件快照；不自动降级 schema。发生新写入后，不直接用旧备份覆盖当前唯一数据，先保留当前完整副本，再按业务需要决定恢复点。本轮不对真实实例执行切换。

## 可重复的本地演练

```sh
corepack pnpm build
corepack pnpm test:recovery
```

演练占用与集成/浏览器相同的数据库排他锁，不能并行运行。脚本拒绝非 loopback55440/tuyile_test；创建合成账号、原图、画布、收藏、规划及在途未知记录，备份后暂时停止 `tuyile-test` PostgreSQL，在随机命名的新 Compose 项目/新卷中仍以55440/tuyile_test恢复。结束时删除该次新测试卷并恢复原测试容器，不删除原卷，不使用开发库或旧项目数据。

演练实际校验缺图/损坏检测、原件哈希、关系和额度、服务配置解密、未知不重发、新生成、编译版API生产HTTPS、Secure Cookie及双账号/匿名资源隔离。报告、dump、自签证书和截图均位于被忽略的 `.codex-temp/m4-recovery-*`，包含测试凭据的产物不可提交。演练退出失败时先检查测试容器状态；不要删除数据库测试锁或原卷来绕过失败。

本机演练使用 Docker Desktop 的 `host.docker.internal` 连接本机编译版API，仅把Nginx的HTTPS端口映射到 `127.0.0.1:8843`。固定官方Nginx镜像先校验原始模板，再以演练上游地址运行同一配置；浏览器请求实际经过Nginx，不用前端假响应替代。

`RECOVERY_TEST_ABORT_AFTER_CLONE=1 corepack pnpm test:recovery` 是有意中断反例，预期退出非零；正常SIGINT/SIGTERM会等待清理临时容器/卷并恢复原测试实例，失败或中断不会写入成功报告。SIGKILL或宿主机故障无法保证执行清理：先确认测试进程已结束，依据该次忽略目录的 `run.json` 精确识别随机恢复项目、Nginx容器及本次API进程。核对PID仍对应本次8795端口的编译API后再结束它，仅清理本次代理和恢复项目，再启动原 `tuyile-test` PostgreSQL。不要盲目按PID终止进程、按前缀批量删除卷，或把原项目当恢复项目清理。

本地演练通过不表示生产已部署，也不代替后续关键页面效果图校准和最终产品验收。
