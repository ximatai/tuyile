# M4 本地技术验收

> 历史归档（2026-10-30）：保留当时的计划、失败修正与验收证据。其中阶段状态和过渡规则不作为当前执行要求；现行文档见[文档索引](../../../README.md)。

日期：2026-10-30。状态：主代理验收及唯一独立review通过，M4完成。范围为本地运行、HTTPS代理材料及合成备份恢复；旧业务数据迁移已取消，未执行公开部署。

## 实现与核验

| 退出条件 | 实际证据 |
| --- | --- |
| 独立运行与schema | 原有独立镜像/Compose及runtime/migrator身份保留；新卷恢复schema1—12及checksum，编译API严格检查schema与运行权限。 |
| 一致性备份 | 停止合成Worker后，对完整数据库做原生custom dump，复制原件与预览，记录逐文件SHA256、dump哈希、schema校验和；原卷保留。 |
| 新卷恢复 | 临时停止专用测试实例，在随机Compose项目的新PostgreSQL卷和独立图片目录恢复，仍只使用loopback55440/tuyile_test。 |
| 数据与归属 | 原件哈希、画布节点/落图回执、收藏/分组、Agent引用和配置解密通过；原图引用仍能阻止删除，双账号及匿名访问分别验证。 |
| 额度与中断 | 图片和规划在途记录恢复后均失败/保留未知证据，没有重复调用；图片预留保留，规划计次保留，对账无差异。显式新任务正常生成。 |
| HTTPS与代理 | 原Nginx模板在固定官方1.30.6镜像通过语法/证书检查；本地实际运行该代理配置，仅替换演练上游IPv4地址，浏览器请求经过Nginx到production编译API。 |
| 私有资源 | Secure/HttpOnly/SameSite=Strict Cookie、CSP、任务轮询、原图下载哈希与no-store通过；跨账号项目/原图404、成员管理403、匿名原图401。 |
| 清理与故障 | 正常结束清理临时代理、恢复卷和API，恢复原测试容器。克隆后有意中断预期退出非零，仍清理并恢复原实例，不写成功报告。硬终止时按run.json核对进程/容器后处理。 |
| 运行材料 | [运行与恢复手册](../../../operations.md)、[production覆盖文件](../../../../compose.production.yaml)、[Nginx模板](../../../../deploy/nginx.conf.example)、排他锁保护的 `test:recovery` 已提供。 |

测试实现见 [本地恢复演练](../../../../tests/recovery/local-recovery.ts)。报告、dump、自签证书、Nginx日志和HTTPS截图位于被忽略的 `.codex-temp/m4-recovery-*`；不提交凭据或生成产物。

## 过程与结果

类型检查、unit20、真实PG63、build/runtime、完整浏览器8/8及Docker构建/API/Chromium通过；恢复演练真实经过新卷、配置解密、两类未知不重发和Nginx HTTPS。中断反例的非零退出是预期结果，不能与正常演练通过混写。

实际Nginx验收先发现测试脚本同名变量遮蔽中断标记，导致就绪循环未执行；修正后又发现Docker Desktop双栈地址中IPv6不可达造成502。现明确解析测试上游IPv4，并断言配置替换成功；原宿主机模板本就使用127.0.0.1。保持上游自动重试关闭，未用重试掩盖问题。修复后演练通过，原测试实例恢复健康。

本阶段保留既有LICENSE、第三方说明及随镜像复制的licenses目录；未引入新业务运行库或通用迁移/备份平台。

## 后续范围

唯一reviewer已独立通过typecheck/unit20/PG63/build/runtime/e2e8、production Compose、现有Docker API/Chromium、恢复及Nginx HTTPS，并复验故障注入、源卷保留和并发锁；未独立重建镜像，无P1/P2。M4可闭环。官方OpenAI关键页面效果图生成、界面校准和最终页面端到端验收仍待继续，另需在授权范围内核验真实模型兼容性；本记录不能代替这些结果。生产部署、真实旧数据导入和公开资源创建均未执行。
