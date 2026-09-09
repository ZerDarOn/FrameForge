# FrameForge

**像素帧动画编辑器与 AI 辅助审查工具**

FrameForge 是一款基于 Tauri 的本地桌面像素帧动画编辑器。它以统一动画文档组织动作、时间步、图层、画格和不可变内容版本，同时保留位移、闪烁和角色一致性等 AI 辅助审查能力。

## 当前能力

- 多图层时间线，支持空画格、长停留、拖拽、删除、撤销/重做和变换。
- AnimationDocument 持久化，带稳定 ID、版本校验、串行保存队列和旧项目兼容迁移。
- 公共 Canvas 2D 合成语义用于播放预览与 PNG/GIF 导出。
- 像素编辑器提供铅笔、橡皮、填充、取色、矩形选区、选区移动、内部复制粘贴、缩放网格、调色板分析和 2–32 色压缩；透明清理会给出带覆盖率和最小容差的边缘背景候选，并可把确认后的颜色/容差批量应用到最多 64 个已选画格。压色可分析累计最多 8M 像素并为所选画格生成共享色板，还可选用 4×4 有序抖动缓解色带。清理与压色都需先生成预览，确认后创建新的 PNG 内容版本，原始素材不变。
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
- 视频可按起止时间与抽帧 FPS 导入为 PNG 画格，长任务支持取消；MP4 导出使用 H.264 编码且同样可取消。运行桌面端前需安装 FFmpeg/ffprobe，并将其加入 PATH，或把 `FRAMEFORGE_FFMPEG_DIR` 指向二者所在目录。
- 尚无无人确认的一键背景清除；边缘背景分析仅提供候选，仍需显式采用、调整容差并确认预览。调色板压缩使用确定性的 RGB 中位切分，可选有序抖动默认关闭。
- WebP 导出、自动基准追踪和一键自动对齐尚未实现。
- 生成任务支持 jobId/projectId 隔离、进度路由、请求级取消、失败重试和显式候选采用；失败/取消任务的不可变参数会按项目保存在本地，刷新后可恢复手动重试，成功或新任务会清除旧快照。取消会在客户端丢弃进行中的供应商 HTTP 请求并拒绝迟到候选，但供应商已接收的请求仍可能在其服务端继续处理；运行中任务不会在刷新后自动续跑。

后续范围详见 `docs/superpowers/plans/2026-09-08-pixel-animation-editor-refactor.md`。

## 许可证

MIT
