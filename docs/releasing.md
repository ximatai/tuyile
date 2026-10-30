# 源码与镜像发布

本指南用于准备发布材料，不代表仓库、镜像或服务已经公开。源码公开、二进制分发和公网部署是不同动作，应分别确认目标和范围。

## 发布前检查

1. 确认本次变更的测试结果，按[开发说明](development.md)复跑受影响检查；不要把旧版本的通过记录当作当前结果。
2. 提交或暂存准备公开的文件，运行 `corepack pnpm check:release`。它检查Git暂存区的私密/生成路径、文件类型、明显秘密、大小和许可证材料，不检查完整漏洞或全部秘密类型。

   该命令需要Git工作副本。下载的源码包使用后文的清单和解包扫描，不需要伪造Git元数据。

3. 使用Gitleaks 8.30.1或兼容版本扫描完整可达历史，保留脱敏结果在Git外：

```sh
gitleaks git --config .gitleaks.toml --log-opts="--all --full-history" --redact=100 --no-banner
```

仓库配置继承默认规则，仅排除`.env.example`里的一个精确占位符，不跳过整个测试目录或历史提交。CI使用固定版本和摘要的只读、离线扫描容器，checkout保留完整历史。CI状态以实际运行结果为准。

4. 检查提交作者姓名/邮箱、commit message、分支/tag、内部地址和历史素材。export-ignore不隐藏Git clone或push中的历史；若要改写历史，先备份并明确授权，不在普通文档整理中自动执行。
5. 检查截图EXIF、账号、路径、模型输出及素材授权。不要把`.env`、备份、trace、私有图片卷、`.git`或整个工作目录上传到release。
6. 确认LICENSE、NOTICE、第三方许可与包元数据一致；依赖、模型访问权和素材权利分别处理。
7. 公开托管仓库时设置私密漏洞报告渠道、必要的分支保护和扫描，依据[安全政策](../SECURITY.md)接收报告。

## 源码包

从审核后的Git提交生成，避免夹带本地忽略文件：

```sh
mkdir -p .codex-temp/releases
git archive --format=tar.gz --prefix=tuyile/ --output=.codex-temp/releases/tuyile-source.tar.gz HEAD
tar -tzf .codex-temp/releases/tuyile-source.tar.gz
```

`.gitattributes`让源码包省略内部阶段日志docs/archive和代理协作文件AGENTS.md；现行文档和许可证保留。该设置不移除仓库或历史中的文件，若公开整个Git仓库，它们仍可被访问。不要使用`tar`直接打包工作目录，也不要强制把忽略文件加入Git。

发布前检查包内清单和解包后的文档链接，再对解包内容运行Gitleaks：

```sh
mkdir -p .codex-temp/releases/source
tar -xzf .codex-temp/releases/tuyile-source.tar.gz -C .codex-temp/releases/source
gitleaks dir .codex-temp/releases/source/tuyile --config .gitleaks.toml --redact=100 --no-banner
```

复用解包目录前清理上次的隔离样本，避免混入旧文件。包应包含构建所需源码、锁文件、迁移及许可材料，不包含运行配置或真实数据。

## 镜像与原生依赖

Docker构建上下文采用允许目录加私密/生成文件排除，镜像显式保留LICENSE、NOTICE及licenses目录。不要复制宿主node_modules、运行卷或凭据到镜像。实际部署凭据通过运行环境注入，镜像不内置Key或管理员密码。

分发二进制前，在目标平台检查`corepack pnpm licenses list --prod --json`及原生包的README / versions.json。sharp/libvips包含LGPL和其他许可证组件；保留对应许可、版权说明，按实际分发方式满足对应源码与替换/重新链接要求。[第三方声明](../THIRD_PARTY_NOTICES.md)给出来源。不要把某台机器的npm级清单当作完整的跨平台二进制合规证明。

本项目未发布公共镜像或软件包。工作区`private: true`防止npm误发布；不应为了公开源码而去掉它。

## 公网部署

按[运行手册](operations.md)配置HTTPS、精确Origin、数据库权限、可信管理员和Provider出口、备份恢复及磁盘监控。使用新的部署凭据，不复用开发/test环境。启动一个Worker；未知结果待核验，不通过重启或手改任务重发。不要把发布源码的授权当作部署或付费模型调用授权。
