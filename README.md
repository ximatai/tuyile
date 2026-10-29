# 图一乐 · Tuyile

面向指定用户的 AI 图片创作工作台。

产品采用服务器多用户形态，支持个人项目、图片生成与参考图创作、Agent 计划、私有图库和后台任务。首版以一个 Worker 消费有界队列，正常运行时关页、刷新和普通注销不影响执行；Worker 中断允许任务失败，进度通过轮询查看。视觉方向为工程蓝，工作台采用左侧项目导航、中央画布、右侧创作面板，侧栏可收起。

阶段 1—2 已完成并通过自查与独立 review：独立工程、账号/会话、个人项目、单 Worker 后台图片任务、额度和私有文件。标准控件使用 Ant Design，沿用工程蓝；以中大型桌面和已认可的 A 布局/B 窄轨为方向。完整画布与 Agent 在阶段 3 交付；真实模型兼容烟测仍需另行授权。

- [产品基线与已确认边界](docs/product-baseline.md)
- [架构设计](docs/architecture.md)
- [架构专项治理：M3 前置与集成要求](docs/architecture-governance.md)
- [本地开发与阶段验收](docs/development.md)
- [工程执行计划](docs/exec-plans/active/tuyile-foundation.md)
- [开发与里程碑计划](docs/delivery-roadmap.md)

先搭好中期基础，保持职责和模块边界清晰，保留长期演进空间，再在受控范围内尽快上线。
