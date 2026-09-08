# FrameForge

**像素帧动画编辑器与 AI 辅助审查工具**

FrameForge 是一款基于 Tauri 的本地桌面像素帧动画编辑器。它以统一动画文档组织动作、时间步、图层、画格和不可变内容版本，同时保留位移、闪烁和角色一致性等 AI 辅助审查能力。

## 当前能力

- 多图层时间线，支持空画格、长停留、拖拽、删除、撤销/重做和变换。
- AnimationDocument 持久化，带稳定 ID、版本校验、串行保存队列和旧项目兼容迁移。
- 公共 Canvas 2D 合成语义用于播放预览与 PNG/GIF 导出。
- 像素编辑器提供铅笔、橡皮、填充、取色、矩形选区、选区移动、内部复制粘贴、缩放网格、调色板分析和 2–32 色压缩；透明清理与压色都需先生成预览，确认后创建新的 PNG 内容版本，原始素材不变。
- 支持图片序列、精灵图和 GIF 导入；精灵图可按规则切分，GIF 原始帧时长会量化为项目 tick；长任务显示进度并以事务写入项目。
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
- 尚无视频抽帧、抖动量化或自动背景推断；当前透明清理需要显式选色并确认预览，调色板压缩使用确定性的 RGB 中位切分。视频抽帧需要可用的 FFmpeg/ffprobe，本机当前未检测到。
- MP4/WebP 导出、自动基准追踪和一键自动对齐尚未实现。
- 生成任务支持 jobId/projectId 隔离、进度路由、协作式取消、失败重试和显式候选采用；已发出的供应商 HTTP 请求可能仍会执行到响应返回，取消会阻止后续候选落盘或接纳。

后续范围详见 `docs/superpowers/plans/2026-09-08-pixel-animation-editor-refactor.md`。

## 许可证

MIT
