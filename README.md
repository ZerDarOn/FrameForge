# FrameForge

**像素帧动画编辑器与 AI 辅助审查工具**

FrameForge 是一款基于 Tauri 的本地桌面像素帧动画编辑器。它以统一动画文档组织动作、时间步、图层、画格和不可变内容版本，同时保留位移、闪烁和角色一致性等 AI 辅助审查能力。

## 当前能力

- 多图层时间线，支持空画格、长停留、拖拽、删除、撤销/重做和变换。
- AnimationDocument 持久化，带稳定 ID、版本校验、串行保存队列和旧项目兼容迁移。
- 公共 Canvas 2D 合成语义用于播放预览与 PNG/GIF 导出。
- 像素编辑器提供铅笔、橡皮、填充、取色、矩形选区、选区移动、内部复制粘贴和缩放网格；每次像素修改创建新的 PNG 内容版本，原始素材不变。
- 洋葱皮、像素放大镜、A/B 对比和点/线/区域基准标记。
- 本地中心块 NCC 位移估计和相邻帧亮度变化检测。
- 配置 API Key 后可使用云端一致性检查及建议；这些调用不会在测试中自动执行。
- 全屏预览以及 PNG 序列、GIF 导出。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri v2 |
| 前端 | React 19 + TypeScript |
| 2D 渲染 | Canvas 2D（统一预览/导出语义） |
| 状态管理 | Zustand |
| 样式 | TailwindCSS |
| 后端 | Rust |
| 图像处理 | `image` crate |
| 存储 | SQLite (`rusqlite`) |

## 项目结构

```
frameforge/
├── src-tauri/          # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── commands/   # Tauri IPC 命令
│   │   ├── ai/         # AI 分析引擎
│   │   └── db/         # SQLite 存储
│   └── Cargo.toml
├── src/                # React 前端
│   ├── components/     # UI 组件
│   ├── stores/         # Zustand 状态
│   ├── core/           # 文档命令与像素编辑核心
│   ├── engines/        # 公共 Canvas 渲染
│   └── types/          # TypeScript 类型
├── docs/
│   └── superpowers/
│       └── specs/      # 设计文档
└── README.md
```

## 开始使用

```bash
npm install
npm run test:core
npm run build
npm run tauri dev
```

桌面构建需要 Rust stable、MSVC C++ Build Tools 与 Windows SDK。

当前限制：

- 时间线支持多画格选择、批量偏移与视觉包围盒底边对齐；自动脚部特征识别与持久化基准点追踪仍未实现。
- 尚无视频/GIF 抽帧、精灵图规则切分、自动抠图或调色板清理流程。
- MP4/WebP 导出、自动基准追踪和一键自动对齐尚未实现。
- 生成任务尚未具备完整的取消、重试和候选采用治理。

后续范围详见 `docs/superpowers/plans/2026-09-08-pixel-animation-editor-refactor.md`。

## 许可证

MIT
