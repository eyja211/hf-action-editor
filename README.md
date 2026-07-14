# HF 动作编辑器

**中文** | [English](README.en.md) | [日本語](README.ja.md)

Hero Fighter / HF-EX 本地浏览器动作与贴图编辑器。目标是替代手工修改 HFWorkshop 导出的 `Spt.json` / `Lmi` 数据：可视化编辑动作帧、贴图变体、判定框，并导出 HFWorkshop 可导入的 zip。

## 主要功能

- 支持 HFE v1.0.2 与 HF-EX v0.2.5 导出的角色数据。
- 本地浏览器运行，无构建、无 CDN、经典 `<script>` 加载，双击 `index.html` 即可打开。
- 实时 Canvas 预览：绘制顺序、骨骼点、地面线、洋葱皮、判定框叠加。
- 动作与帧：动作列表、时间轴播放、复制/删除帧、复制动作。
- 姿势编辑：选择、旋转、移动、缩放，支持 FK 联动开关。
- 部位管理：添加当前帧未使用的部位，也可重复添加已使用部位；支持移除部位条目。
- 判定框：editBody / editAttack / editAttackB 可视化编辑并烘焙运行时框。
- 贴图工具：浏览变体、替换 PNG、新增 LimbPic 变体、锚点/关节编辑器。
- 多 Lmi 支持：自动加载所选目录下多个 `*Lmi` 文件夹，兼容角色跨 Lmi 借用部位。
- zip 导出：生成 Spt zip 与每个 Lmi 文件夹对应的 zip。

## 界面预览

| 动作时间轴与角色预览 | 姿势编辑 |
|---|---|
| ![动作时间轴与角色预览](docs/screenshots/overview.png) | ![选择部位并旋转编辑姿势](docs/screenshots/pose-editing.png) |
| 判定框可视化 | 贴图变体 |
| ![攻击框与受击框可视化](docs/screenshots/hitboxes.png) | ![贴图变体与锚点工具](docs/screenshots/textures.png) |

## 目录结构

```text
HF动作编辑器/
├─ index.html              # 入口页面
├─ css/app.css             # UI 样式
├─ docs/screenshots/       # README 截图
├─ js/
│  ├─ app.js               # 主控制器、状态、保存、编辑入口
│  ├─ model.js             # Spt/Lmi 数据模型、多 Lmi、脏文件追踪
│  ├─ jsonio.js            # HFWorkshop JSON 保序/保数字原文解析与序列化
│  ├─ as3math.js           # AS3 Matrix 复刻、矩阵构造/分解
│  ├─ skeleton.js          # 骨骼静态表、默认绘制顺序、部位名
│  ├─ pose.js              # 帧姿势、FK/非联动重建、ref 复用帧
│  ├─ render.js            # Canvas 渲染与命中检测
│  ├─ rebake.js            # 裁剪框、footY、矩阵、判定框重烘焙
│  ├─ fsio.js              # 文件夹读取/写回
│  ├─ zip.js               # zip 生成与导出
│  └─ ui/                  # 各面板
├─ test/
│  ├─ all.js               # node 总测试入口
│  ├─ roundtrip.js         # JSON round-trip 测试
│  ├─ matrix.js            # 矩阵回归测试
│  └─ browser/e2e.js       # 浏览器端到端测试
├─ 使用说明.md             # 面向使用者的中文操作说明
├─ 进度记录.md             # 当前实现与验证记录
├─ README.md
├─ CHANGELOG.md
└─ 维护说明.md
```

## 使用方法

1. 用 Edge 或 Chrome 打开 `index.html`。
2. 点击「打开角色」，选择包含角色 Spt/Lmi 导出文件夹的父目录，例如：

```text
某角色目录/
├─ 197 - Data.Global_taylorSpt/
│  └─ Spt.json
├─ 465 - Data.Global_taylorLmi/
│  ├─ Limb_*.json
│  ├─ LimbPic_*.json
│  └─ *.png
└─ 其他被借用的 *Lmi/   # 可选；工具会自动加载同目录全部 Lmi
```

3. 编辑动作、帧、部位、判定框或贴图。
4. 点击「保存」写回原文件夹，或点击「导出 zip」生成 HFWorkshop 可导入的 zip。

### 多 Lmi / 缺部位说明

Hero Fighter 的 Limb 是全局注册的，角色可能引用别的角色或共享特效的 Lmi。比如 Taylor 可能借用 Lucas 的拳头，Rudolf 可能引用另一个包含 `rudolf_*` 部位的 Lmi。

如果工具弹出「缺部位」警告：

1. 记下警告里的 Limb 名，例如 `Lucas_07LeftFist`。
2. 在 HFWorkshop 里找到包含这些 Limb 的 `* - Data.Global_*Lmi` 并导出。
3. 把解压后的 Lmi 文件夹放到当前角色目录旁边。
4. 重新打开角色。

工具会自动把同一目录下所有 `*Lmi` 文件夹载入，并按各自图池独立解析。

## 开发与测试

### Node 数据层与矩阵测试

```bash
cd <repo>
node test/all.js
```

这会运行：

- `test/roundtrip.js`：确认 HFE/HFEX 样本 JSON 读取后再写出逐字节一致。
- `test/matrix.js`：确认全部帧部位矩阵分解→重建误差小于 `1e-6`。

### 浏览器端到端测试

首次需要安装依赖（已用 `puppeteer-core`，不会下载浏览器）：

```bash
cd <repo>/test/browser
npm install
```

运行测试：

```bash
cd <repo>
node test/browser/e2e.js
```

测试会驱动系统 Edge，覆盖加载、渲染、播放、FK、非联动、添加/移除部位、判定框、贴图、zip、多 Lmi 等主流程。

## Git 维护建议

本仓库只跟踪源码、测试和文档。以下内容被 `.gitignore` 排除：

- `node_modules/`
- `test/browser/downloads/`
- `test/browser/shots/`
- 手动导出的 `*.zip`
- 临时日志和编辑器状态

推荐每次功能修改后执行：

```bash
node test/all.js
node test/browser/e2e.js
```

涉及导出、footY、骨骼、判定框、多 Lmi 的变更，还需要导入游戏实测。
