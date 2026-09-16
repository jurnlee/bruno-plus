# 构建发布包指导(GUI 与 CLI,Windows)

本文记录在本仓库从源码构建可分发产物的完整流程,以及 Windows 上实测会踩的坑。
产物共四类:

| 产物 | 来源 | 说明 |
|---|---|---|
| `bruno_<version>_x64_win.exe` | electron-builder(NSIS) | GUI 安装包 |
| `usebruno-cli-<ver>.tgz` | `npm pack`(bruno-cli) | CLI,源码分发,无构建步骤 |
| `usebruno-common-<ver>.tgz` | `npm pack`(bruno-common) | fork 改动过的 workspace 依赖,CLI 需要它 |
| `usebruno-js-<ver>.tgz` | `npm pack`(bruno-js) | 同上 |

> CLI 的 tarball 中 `@usebruno/*` 依赖是 registry 版本引用,而本 fork 对
> `bruno-common`(data-file 模块)、`bruno-js` 有改动且未发布到 npm——单独安装 CLI
> tarball 会缺 API(如 `parseDataFile`),`bru run --data` 直接坏掉。因此这两个包必须
> 一并打包发布,安装时用 overrides 指向本地 tarball(见文末)。

## 版本号机制

上游的 GitHub release tag(v3.x / v4.x)与仓库内各包的 `package.json` 版本是**两套脱钩的体系**:
tag 只存在于 git(如 `v4.1.0`),**不会回写**到任何 `package.json`——v4.1.0 tag 里
`packages/bruno-electron/package.json` 的 `version` 仍是 `2.0.0`。

因此产物文件名的版本号来源如下,**构建前必须手动 bump**,否则打出来的包永远显示旧版本,
无法区分发布批次:

| 产物 | 版本来源 | 当前值 |
|---|---|---|
| `bruno_<version>_x64_win.exe` | `packages/bruno-electron/package.json` 的 `version`(electron-builder `artifactName` 的 `${version}`) | 2.0.0 |
| `usebruno-cli-<ver>.tgz` | `packages/bruno-cli/package.json` 的 `version` | 1.16.0 |
| `usebruno-common-<ver>.tgz` | `packages/bruno-common/package.json` 的 `version` | 0.1.0 |
| `usebruno-js-<ver>.tgz` | `packages/bruno-js/package.json` 的 `version` | 0.12.0 |

fork 的建议做法:每次发布确定一个自己的版本号(可沿用 `2.0.x` 序列,或改用日期式
如 `2.0.0-ddt.1`),至少 bump `bruno-electron` 与 `bruno-cli` 两处;若 `common`/`js`
的对外 API 有变动(如 data-file),一并 bump 以便安装方区分。改动只涉及各
`package.json` 的 `version` 字段,无其它联动配置。

## 与上游同步

本仓库 `origin` 直接指向上游 `usebruno/bruno`。构建前建议先确认同步状态:

```bash
git fetch origin --tags
# SHA 层面:某 release 是否已包含(输出 NO 则未包含)
git merge-base --is-ancestor v4.1.0 HEAD && echo YES || echo NO
# patch 层面:缺失的真实修复数(release 分支的提交常以 cherry-pick 形式进了 main)
git cherry HEAD v4.1.0 | grep -c "^+"
# 落后上游 main 多少 / 本地独有多少
git rev-list --count HEAD..origin/main
git rev-list --count origin/main..HEAD
```

同步方式:`git rebase origin/main`(或 merge),冲突解决后重新执行完整构建流程
(共享包重建 → web → electron)。注意上游的 release 修复在 `release/vX.Y.Z` 分支上,
其中部分提交**不会**合入 main——若某个 release 的修复对本 fork 重要,需要单独
cherry-pick。

## 前置条件

- **Node 22**(`.nvmrc` 为 v22.12.0,v22 LTS 系列即可)。**不要用 Node 24+**,原因见坑 1。
- nvm-windows(切换 Node 版本用;注意 `nvm use` 是全局切换)。
- **Visual Studio 2022 BuildTools**,且视目标架构安装对应 MSVC 组件:
  - x64 安装包:已含的 `MSVC v143 x64/x86 生成工具` 即可;
  - arm64 安装包:必须额外勾选 **"MSVC v143 - VS 2022 C++ ARM64 生成工具"**
    (组件 ID `Microsoft.VisualStudio.Component.VC.Tools.ARM64`)。
  - 可用 vswhere 自检(空输出 = 未安装):
    ```bash
    "/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" \
      -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 \
      -property installationPath
    ```
- 网络:electron-builder 首次构建会下载 Electron 运行时(~123 MB)与 NSIS 工具,之后走缓存。

## 构建流程(按序执行,均在仓库根目录)

### 0. 切换 Node 版本

```bash
nvm list            # 确认本机有 v22.x
nvm use 22.18.0     # 或你安装的其它 v22;必须是 v22 系
node --version      # 验证
```

### 1. 安装依赖(仅首次或切换 Node 大版本后)

```bash
npm i --legacy-peer-deps && npm run setup
```

`npm run setup`(`scripts/setup.js`)会重装并预构建全部共享包;已有可用的 `node_modules`
和共享包 dist 时可跳过,但发布前若共享包源码有改动,务必走第 2 步重建。

### 2. 重建共享包

`npm run dev` / `npm run build:web` 都**不会**重建共享包(bruno-common、bruno-requests、
bruno-filestore、bruno-converters、bruno-query、bruno-schema-types、bruno-graphql-docs、
bruno-sqlite)。发布前按 setup 的顺序全部重建,并重新 bundle JS 沙箱库:

```bash
npm run build:graphql-docs && npm run build:bruno-query && npm run build:bruno-common \
  && npm run build:bruno-converters && npm run build:bruno-requests && npm run build:schema-types \
  && npm run build:bruno-filestore && npm run build:bruno-sqlite \
  && npm run sandbox:bundle-libraries --workspace=packages/bruno-js
```

### 3. 构建 GUI

```bash
npm run build:web        # 产出 packages/bruno-app/dist(约 1 分钟)
npm run build:electron   # 复制 web → bruno-electron/web,修正静态路径,再跑 electron-builder
```

`build:electron` 在 Windows 上调用 `dist:win`,按 `electron-builder-config.js` 的
`win.target` 打 **x64 + arm64 双架构** NSIS 安装包,产物在 `packages/bruno-electron/out/`。

只打 x64(本机没有 ARM64 MSVC 组件时):

```bash
cd packages/bruno-electron
npx electron-builder --win nsis --x64 --config electron-builder-config.js
```

> 注意必须**同时写 target 名和架构**(`--win nsis --x64`)。只写 `--x64` 无效——config
> 里 `win.target[0].arch: ['x64', 'arm64']` 优先于 CLI 架构标志,arm64 的原生依赖重建
> 照样会跑并失败(实测坑 3)。

### 4. 打包 CLI 及其依赖

```bash
mkdir -p release
(cd packages/bruno-cli     && npm pack --pack-destination ../../release)
(cd packages/bruno-common  && npm pack --pack-destination ../../release)
(cd packages/bruno-js      && npm pack --pack-destination ../../release)
cp packages/bruno-electron/out/bruno_*_x64_win.exe release/
```

冒烟验证 CLI(在 workspace 内直接跑,不装包):

```bash
cd packages/bruno-cli
node bin/bru.js --version                 # 期望输出版本号
node bin/bru.js run --help | grep data    # 期望看到 --data 标志
```

验证 common 的 tarball 确实带上了 fork 新增代码(rollup 是单文件 bundle,看不到独立的
data-file 目录,要 grep bundle 内容):

```bash
tar -xzf release/usebruno-common-*.tgz -O package/dist/cjs/index.js | grep -c parseDataFile
```

## 产物安装方式(CLI)

### 项目内安装

在目标项目里连同依赖一起安装,用 overrides 把 fork 改过的包指向本地 tarball:

```jsonc
{
  "dependencies": { "@usebruno/cli": "file:./release/usebruno-cli-1.16.0.tgz" },
  "overrides": {
    "@usebruno/common": "file:./release/usebruno-common-0.1.0.tgz",
    "@usebruno/js": "file:./release/usebruno-js-0.12.0.tgz"
  }
}
```

### 全局安装

**不能直接 `npm install -g usebruno-cli-1.16.0.tgz`**:npm 的 `overrides` 只在项目
package.json 中生效,`-g` 安装没有 overrides 上下文,CLI 的 `@usebruno/common@0.1.0`
会从 registry 解析成原版(缺 `parseDataFile`),`bru run --data` 会坏。

方式一,**本机有仓库(开发场景,推荐)**——`npm link` 链到 workspace,依赖走仓库
hoist 的 fork 版 `node_modules`,天然正确:

```bash
npm link --workspace=packages/bruno-cli   # 仓库根目录执行
bru --version                              # 验证
# 卸载:npm uninstall -g @usebruno/cli
```

注意:link 后 `bru` 指向仓库工作副本,源码改动即时生效;仓库移动或删除后失效,
需要重新 link。

方式二,**只有 tarball(分发场景)**——建一个独立目录,放一个带 overrides 的
package.json(把三个 tgz 拷进同目录),普通 `npm install` 后把 `.bin` 加入 PATH:

```bash
mkdir ~/bruno-cli && cd ~/bruno-cli
cp <发布目录>/usebruno-*.tgz .
# 写入 package.json:
# {
#   "name": "bruno-cli-global", "private": true,
#   "dependencies": { "@usebruno/cli": "file:./usebruno-cli-1.16.0.tgz" },
#   "overrides": {
#     "@usebruno/common": "file:./usebruno-common-0.1.0.tgz",
#     "@usebruno/js": "file:./usebruno-js-0.12.0.tgz"
#   }
# }
npm install
export PATH="$HOME/bruno-cli/node_modules/.bin:$PATH"   # Windows: setx PATH 或系统设置
bru --version
```

GUI 安装包直接运行 `bruno_<version>_x64_win.exe`(未签名,见坑 6)。

## 踩坑清单(全部实测)

1. **Node 24+ 上 rollup 构建挂起。** 共享包构建(rollup 3.30.0)输出 "created …" 后
   进程不退出,链条卡死在第一个包,无任何报错。诊断:查 node 进程会发现 rollup 常驻。
   解法:必须用 Node 22。这不是"慢",是挂起,等再久也没用。
2. **共享包 dist 过期,产物静默缺新功能。** fork 改了 `bruno-common/src` 而不重建,
   `build:web` 照样成功,打出的 GUI/CLI 表面正常但缺新 API——没有任何报错。发布前
   务必执行第 2 步。
3. **arm64 失败:`MSB8020 无法找到 v143 的生成工具`。** node-gyp 为 arm64 重编原生依赖
   (`native-reg`、`win-export-certificate-and-key`)时,VS BuildTools 缺 ARM64 MSVC 组件。
   自检与安装方式见"前置条件"。**MSYS2/MinGW(GCC)不能替代**:node-gyp 走 MSBuild +
   v143 工具集,且 Electron 的 Windows 二进制是 MSVC ABI,GCC 编译的原生模块不兼容。
4. **`--x64` 不覆盖 config 的 arch。** 见上文第 3 步的说明,要 `--win nsis --x64` 一起给。
5. **CLI tarball 装完 `--data` 报错。** 原因与解法见文首引言与"产物安装方式"。
6. **exe 未签名。** 配置 `win.sign: null`,首次安装会触发 SmartScreen 警告("仍要运行"
   即可);正式分发需要代码签名证书。
7. **首次 electron-builder 构建要联网下载** Electron zip(123 MB)与 NSIS 工具,内网/代理
   环境注意预下载或配置镜像。
8. **构建输出噪音可忽略**:rollup 打 bruno-requests 时会刷大量 `@faker-js/faker` 的
   d.ts TS1068/TS1005 警告(const 泛型语法),以及 chai/protobufjs 的 circular dependency
   提示——均为依赖包声明文件的既有噪音,不影响产物。
9. **nvm-windows 的 `nvm use` 是全局切换**,会影响同一机器上其它项目;构建完记得按需切回。
10. **`release/` 已加入 `.gitignore`**,产物不会被误提交;`packages/bruno-electron/out/`
    下的中间产物(`win-unpacked/`、`.blockmap`)同样无需入库。
11. **产物版本号不随上游 release tag 变化。** 上游打了 `v4.1.0` tag,`bruno-electron`
    的 `package.json` 依旧是 `2.0.0`,构建出的安装包仍叫 `bruno_2.0.0_x64_win.exe`。
    发布前记得手动 bump(见"版本号机制"),别用文件名推断代码对应的上游版本。
