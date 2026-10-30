# 图一乐 · Tuyile

面向指定用户的私有 AI 图片创作工作台，支持直接生图、参考图编辑、Agent 先规划后确认、项目画布、图库、提示池与收藏。

采用 TypeScript 模块化单体、React / Ant Design / React Flow、Hono、PostgreSQL 和一个独立 Worker。任务提交后在后台执行，正常运行时关页、刷新和普通退出登录不影响任务；Worker 中断允许失败或部分完成，不自动续跑未知调用。

当前首版功能、本地技术验收及页面优化已完成，尚未公开上线。当前没有进行中的工程实施计划；后续安排见[交付状态](docs/delivery-roadmap.md)。

- [文档索引](docs/README.md)：按业务、开发、运维查找现行说明。
- [本地开发](docs/development.md)：环境、启动、账号初始化和测试命令。
- [产品基线](docs/product-baseline.md)：业务范围、权限、额度与故障边界。
- [架构设计](docs/architecture.md)：模块、事务、任务、模型及前端状态。
- [运行与恢复](docs/operations.md)：Compose、HTTPS、成套备份与恢复。
- [界面规范](docs/ui-direction.md)：桌面布局、控件、状态与账户交互。

历史执行计划和验收记录统一放在[文档归档](docs/archive/README.md)，不再作为待实施要求。依赖来源和许可证见[第三方声明](THIRD_PARTY_NOTICES.md)。
