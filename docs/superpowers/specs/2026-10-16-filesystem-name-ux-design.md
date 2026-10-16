# 文件系统名称（Filesystem Name）交互机制统一设计

日期：2026-10-16
状态：已实现（NewRequest 侧先行落地，本设计记录统一改造的完整需求与改动范围，与实现一致）

## 1. 背景与目标

Bruno 中每个集合/请求/文件夹在磁盘上都以真实文件/目录存在，"显示名（display
name）"与"文件系统名（filesystem name）"可以不同。涉及两者的表单一共有 8 处：
新建请求、新建文件夹、新建集合、新建工作区、克隆集合、克隆请求/文件夹、
重命名、保存临时请求（内嵌新建文件夹子表单）。

改造前的旧机制存在两层摩擦：

- **默认隐藏**：文件系统名字段收在 Options → "Show Filesystem Name" 下拉里，
  用户必须先点 Options 展开
- **二次交互**：展开后字段仍是只读的 `PathDisplay` 预览，必须再点编辑图标
  （`IconEdit`）才能输入，点恢复图标（`IconArrowBackUp`）退出编辑——由
  `isEditing` state 驱动两态切换

NewRequest 先行改造为新机制并验证通过后，本设计将其统一推广到其余全部 7 处，
消除"同一概念两套交互"的不一致。

## 2. 新机制定义

所有表单的文件系统名字段遵循同一套行为：

1. **默认直接显示**：`showFilesystemName` 初始值为 `true`，无需点 Options；
   Options 下拉的 "Show/Hide Filesystem Name" 切换保留（用户仍可隐藏字段）
2. **始终可直接编辑**：字段就是真实的 `<input>`，移除 `isEditing` 状态、
   `PathDisplay` 只读预览与 `IconEdit`/`IconArrowBackUp` 图标切换
3. **跟随名称输入直到用户自定义**：修改显示名时文件系统名自动同步为
   `sanitizeName(显示名)`；一旦用户手动输入过自定义文件系统名，跟随即停止。
   统一的判断模式（用**旧值**比较，因为同一 onChange 内 formik state 尚未更新）：

   ```javascript
   const filenameFollowsName = !values.filename
     || values.filename === sanitizeName(values.name);
   if (filenameFollowsName) {
     setFieldValue('filename', sanitizeName(newName));
   }
   ```

   语义：
   - 字段为空（新建场景初值 `''`）→ 跟随
   - 字段等于当前显示名的 sanitize 结果 → 视为尚未自定义 → 跟随
   - 字段为其他值（曾自定义，或既有文件名本就不同于显示名，如重命名场景
     的 `sanitizeName(itemFilename)`）→ 尊重自定义，不再跟随

4. **Help 文案**改为描述跟随机制（如 "The file name follows the request name
   until you type a different one."），替换旧机制下"You can choose a file name
   different from..."的说法

不改动任何数据流与 on-disk 契约：提交 payload、`renameItem`/`cloneItem`/
`newFolder` 等 thunk、`sanitizeName`/`validateName` 校验、防碰撞后缀行为
均保持不变——本设计是纯 UI 交互层的统一。

## 3. 改动范围

全部位于 `packages/bruno-app/src/components/`：

| 组件 | 流程 | 跟随字段映射 | 备注 |
|---|---|---|---|
| `Sidebar/NewRequest` | 新建请求 | requestName → filename | 先行落地（本设计的参照实现） |
| `Sidebar/.../CollectionItem/RenameCollectionItem` | 重命名请求/文件夹/JS 脚本 | name → filename | folder 与非 folder 的 Help 文案分支保留；非 folder 文案按 `itemTypeLabel` 动态生成 |
| `Sidebar/NewFolder` | 新建文件夹 | folderName → directoryName | |
| `Sidebar/CreateCollection` | 新建集合 | collectionName → collectionFolderName | 字段仍受 `collectionName` 非空条件渲染控制；Options 下拉原是 "Show Advanced Options"（格式选择），与本字段无关，保持不变 |
| `Sidebar/Collections/Collection/CloneCollection` | 克隆集合 | collectionName → collectionFolderName | 无 Options 切换，字段本就常显，仅移除编辑门 |
| `Sidebar/.../CollectionItem/CloneCollectionItem` | 克隆请求/文件夹 | name → filename | 初值 `"xxx copy"`，与 sanitize 结果一致故初始即跟随 |
| `SaveTransientRequest` | 保存临时请求（内嵌 New Folder 子表单） | newFolderName → newFolderDirectoryName | useState 管理（非 formik）；"Show/Hide filesystem name" 切换按钮保留，现只切换显隐，**不再重置**已输入的目录名；`resetForm`/show/cancel 的初值改为显示 |
| `WorkspaceSidebar/CreateWorkspace` | 新建工作区 | workspaceName → workspaceFolderName | 确认为同款旧机制后一并统一 |

每个组件的机械性清理一致：删除 `isEditing`（或 `isEditingFolderFilename`）state、
`PathDisplay` import、`IconEdit`/`IconArrowBackUp` import 及其 JSX 分支；
`IconCaretDown`（Options 触发器）保留。

## 4. 测试改动

旧机制的 e2e 依赖（点 Options 展开 + 点编辑图标）随机制移除同步清理：

| 文件 | 改动 |
|---|---|
| `tests/naming-collisions/request/rename.spec.ts` | 删 `revealFilesystemName` 调用与 import（保留名校验错误断言不变——filename 字段默认渲染后错误照常显示） |
| `tests/naming-collisions/folder/rename.spec.ts` | 同上 |
| `tests/naming-collisions/folder/create.spec.ts` | 同上（NewFolder 路径） |
| `tests/sidebar/rename-collection-item.spec.ts` | 删 Options 下拉与编辑图标两步，直接断言 `.file-extension` |
| `tests/utils/page/actions.ts` | 删 `revealFilesystemName` 定义与 export；`renameViaFilename`/`createRequestWithEditedFilename` 移除中间步骤 |
| `tests/utils/page/sidebar/index.ts` | `renameItemModal.filenameEditIcon`、`filesystemName.optionsButton`/`showFilesystemNameItem` 删除（`fileNameInput` 保留，仍被使用） |
| `tests/utils/page/workspace/create-workspace-modal.ts` + `create-workspace.spec.ts` | `folderNamePreview()`（指向被删除的 PathDisplay 的 `.name-container`）删除，断言改为 `folderNameInput()` + `toHaveValue` |

`tests/naming-collisions/request/create.spec.ts` 在 NewRequest 先行改造时已同步
处理，此处仅记录归属。

## 5. 验证

- **ESLint**：全部改动文件 0 errors（剩余 warnings 均为改动范围外的 pre-existing 项）
- **E2E**（单 worker，本机并行多 Electron 实例会资源过载产生环境级失败）：
  - naming-collisions 的 request/folder rename（19）、rename-collection-item（1）、
    folder create、collection clone、transient-file-mode-save、collection create、
    create-workspace（22）、default-collection-location、js-script create——
    除下述已知问题外全部通过

**已知问题（与本次改动无关，已用 HEAD 版本对照运行证实为 pre-existing）**：
`tests/js-script/create.spec.ts` 的 "creates a JS script inside a folder" 稳定
失败（文件夹内 JS 脚本创建链路，断言 folder 子项可见超时），待单独排查。

## 6. 遗留的一致性说明

- `CreateWorkspace` 不在最初清单中，实施时确认其与新集合完全同构
  （workspaceName → workspaceFolderName），为避免留下最后一处旧机制而一并统一
- Options 切换能力在 NewRequest/NewFolder/RenameCollectionItem/
  CloneCollectionItem/SaveTransientRequest 中保留（隐藏字段是合法诉求）；
  CreateCollection/CreateWorkspace/CloneCollection 本就没有该切换，字段常显
- 旧机制的其余残余（如 `SaveTransientRequest` 头部 label 的
  `(in bruno)` 后缀三元）与文件系统名机制无直接关系，未纳入本次范围
