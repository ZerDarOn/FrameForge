# FrameForge

**AI 动画帧审查与对齐工具**

FrameForge 是一款桌面应用程序，专为审查、对齐和质量检测 AI 生成的动画帧序列而设计。它提供基于时间线的工作流，并结合 AI 辅助分析，自动检测帧间的位移、闪烁和角色不一致问题。

## 为什么需要 FrameForge？

AI 动画工具（Runway、Kling、Midjourney、Stable Diffusion 等）生成的是独立的片段或帧，但缺乏专门的审查和校正工具。创作者目前只能依赖传统非线性编辑器（After Effects、Premiere Pro、DaVinci Resolve）来拼接和检查帧序列——这种工作流并非为 AI 生成的素材而设计。

FrameForge 填补了这一空白，提供专用的帧级检查和 AI 辅助对齐功能。

## 核心功能

### 基于时间线的工作流
- 多轨道时间线，支持拖拽排列资产
- 支持图片序列帧（PNG/JPG/WebP）和视频片段（MP4/WebM）
- 可调帧率（12/24/30fps）
- 精确到帧的播放控制

### 基准点对齐
- 在任意帧上设定参考点（角色位置、地平线等）
- 多种基准点类型：点、线、区域
- 一键自动对齐所有帧到基准点
- 支持手动微调，对齐前后对比

### AI 辅助分析
- **位移检测** — 基于光流法的帧间位移测量
- **闪烁检测** — SSIM + 直方图分析检测亮度不一致
- **角色一致性** — AI 驱动的跨帧视觉一致性检查
- **AI 建议** — 针对检测到的问题生成自然语言修复建议
- **基准点追踪** — KLT 特征追踪跨帧序列

### 帧检查器
- 洋葱皮（幽灵叠加）对比相邻帧
- 像素级放大镜工具
- AI 问题叠加在画面上（位移箭头、闪烁高亮、不一致标记）

### 展示与导出
- 全屏干净播放预览
- 导出为 GIF、MP4、WebP 或 PNG 序列帧
- 对齐前后分屏对比

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri v2 |
| 前端 | React 18 + TypeScript |
| 2D 渲染 | PixiJS v8 (WebGL) |
| 3D（预留） | Three.js |
| 状态管理 | Zustand |
| 样式 | TailwindCSS |
| 后端 | Rust |
| 本地 AI | ONNX Runtime |
| 云端 AI | OpenAI API / 自部署 |
| 图像处理 | `image` crate + `opencv-rust` |
| 视频处理 | `ffmpeg-next` |
| 存储 | SQLite (`rusqlite`) |

## 项目结构

```
frameforge/
├── src-tauri/          # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── commands/   # Tauri IPC 命令
│   │   ├── ai/         # AI 分析引擎
│   │   ├── align/      # 对齐引擎
│   │   ├── assets/     # 资产管理
│   │   └── db/         # SQLite 存储
│   └── Cargo.toml
├── src/                # React 前端
│   ├── components/     # UI 组件
│   ├── stores/         # Zustand 状态
│   ├── engines/        # PixiJS 渲染
│   └── types/          # TypeScript 类型
├── docs/
│   └── superpowers/
│       └── specs/      # 设计文档
└── README.md
```

## 开发阶段

### 阶段 1 — MVP
Tauri 壳 + 资产管理器 + 时间线引擎 + 帧检查器

### 阶段 2 — AI 集成
AI 分析器（本地 ONNX）+ 对齐引擎

### 阶段 3 — 展示空间
展示模式 + 导出功能 + 云端 AI 集成

### 阶段 4 — 扩展
生成端集成、团队协作、3D 预览、插件系统

## 开始使用

*项目处于设计阶段，即将进入实现。*

## 许可证

待定
