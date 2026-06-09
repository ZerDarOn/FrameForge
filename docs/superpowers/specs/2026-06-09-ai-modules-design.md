# FrameForge AI 模块设计

**设计文档**
**日期：** 2026-06-09
**状态：** 待审阅

---

## 1. 概述

FrameForge AI 模块为现有的帧审查工具增加两大能力：

1. **AI 审查分析** — 自动检测帧间的位移、闪烁和角色不一致问题，生成修复建议
2. **AI 像素画生成** — 通过文字或参考图生成像素画资产（角色、道具、物品等），深度集成到时间线

两个子系统共享一个 Provider 抽象层，统一管理 AI 后端配置和密钥。

### 目标

- 用户可以一键分析整个帧序列，获得可视化的位移/闪烁/不一致报告
- 用户可以通过文字描述或参考图生成像素画，结果直接进入资产管理器和时间线
- 支持多种 AI 后端：本地 ONNX、云端 API（OpenAI/Stability AI 等）、ComfyUI 工作流
- API Key 管理支持用户自带和 FrameForge 代理两种模式

---

## 2. 架构

### 2.1 Provider 抽象层

采用 Rust trait 定义两种 Provider 接口，不同后端各自实现：

```rust
/// 审查分析能力
trait AnalysisProvider: Send + Sync {
    /// 检测帧间位移（返回每帧的 dx, dy 偏移量）
    fn detect_displacement(&self, frames: Vec<ImageInput>) -> Result<DisplacementResult>;
    /// 检测闪烁（返回问题帧索引和严重度）
    fn detect_flicker(&self, frames: Vec<ImageInput>) -> Result<FlickerResult>;
    /// 角色一致性检查（返回差异描述和评分）
    fn check_consistency(&self, frames: Vec<ImageInput>) -> Result<ConsistencyResult>;
    /// 生成修复建议
    fn generate_suggestions(&self, issues: Vec<DetectedIssue>) -> Result<Vec<Suggestion>>;
}

/// 像素画生成能力
trait GenerationProvider: Send + Sync {
    /// 文生图：文字描述生成像素画
    fn text_to_pixel(&self, params: TextToPixelParams) -> Result<GeneratedAsset>;
    /// 图生图：参考图 + 参数生成像素画
    fn image_to_pixel(&self, params: ImageToPixelParams) -> Result<GeneratedAsset>;
    /// 批量生成：同 prompt 多变体
    fn batch_generate(&self, params: BatchParams) -> Result<Vec<GeneratedAsset>>;
}
```

### 2.2 后端实现矩阵

| 后端 | AnalysisProvider | GenerationProvider | 备注 |
|------|:---:|:---:|------|
| **本地 ONNX** | ✅ 位移+闪烁 | ❌ | 光流法 + SSIM，无需网络 |
| **云端 API (OpenAI)** | ✅ 一致性+建议 | ✅ DALL-E / GPT-Image | 用户自带 Key 或代理 |
| **云端 API (Stability AI)** | ❌ | ✅ SD3 / SDXL | 像素画 prompt 模板 |
| **本地模型 (SD Turbo)** | ❌ | ✅ | 本地推理，需要 GPU |
| **ComfyUI 工作流** | ❌ | ✅ | 用户自建 ComfyUI 后端 |

### 2.3 模块架构图

```
┌─────────────────────────────────────────────────────────┐
│                    FrameForge AI 模块                     │
│                                                          │
│  ┌────────────────────┐  ┌──────────────────────────┐  │
│  │  AI 审查分析器      │  │  AI 像素画生成器          │  │
│  │  - 位移检测         │  │  - 文生图                 │  │
│  │  - 闪烁检测         │  │  - 图生图                 │  │
│  │  - 一致性检查       │  │  - 批量生成               │  │
│  │  - 建议生成         │  │  - 资产管理               │  │
│  └────────┬───────────┘  └────────┬─────────────────┘  │
│           │                        │                     │
│  ┌────────▼────────────────────────▼─────────────────┐ │
│  │            Provider 抽象层                         │ │
│  │  AnalysisProvider trait  /  GenerationProvider    │ │
│  └────────┬────────────────────────┬─────────────────┘ │
│           │                        │                     │
│  ┌────────▼─────┐ ┌───────────────▼──────────┐        │
│  │ 本地 ONNX    │ │  云端/本地生成后端        │        │
│  │ (Rust)       │ │  - OpenAI API             │        │
│  │              │ │  - Stability AI           │        │
│  │              │ │  - 本地 SD Turbo          │        │
│  │              │ │  - ComfyUI                │        │
│  └──────────────┘ └──────────────────────────┘        │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  AI 配置中心                                      │  │
│  │  - Provider 注册与选择                            │  │
│  │  - API Key 管理（自带 / 代理）                    │  │
│  │  - 模型参数配置                                   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. AI 审查分析

### 3.1 本地分析（ONNX Runtime）

| 功能 | 算法 | 输入 | 输出 | 性能目标 |
|------|------|------|------|---------|
| 帧间位移检测 | Farneback 光流法 + 相位相关 | 相邻帧对 | 位移向量 (dx, dy) per frame | 100 帧 < 5s |
| 闪烁检测 | 帧间 SSIM + 直方图差异 | 相邻帧对 | 闪烁分数 + 问题帧列表 | 100 帧 < 3s |
| 基准点追踪 | KLT 特征追踪 | 基准点 + 帧序列 | 各帧基准点位置 | 100 帧 < 2s |

**Rust 侧实现：**
- 使用 `ort` crate（ONNX Runtime Rust bindings）加载预转换的 ONNX 模型
- 光流和 SSIM 模型在首次使用时从内置资源解压到 app data 目录
- 通过 Tauri IPC 命令暴露给前端，支持进度回调

```rust
// Tauri 命令示例
#[tauri::command]
async fn analyze_displacement(
    db: State<'_, DbState>,
    project_id: String,
    track_id: String,
) -> Result<DisplacementReport, String> { ... }

#[tauri::command]
async fn analyze_flicker(
    db: State<'_, DbState>,
    project_id: String,
    track_id: String,
) -> Result<FlickerReport, String> { ... }
```

### 3.2 云端分析

| 功能 | 模型 | 输入 | 输出 |
|------|------|------|------|
| 角色一致性检查 | GPT-4V / Claude Vision | 连续帧截图（最多 10 帧） | 一致性评分 + 差异描述 |
| AI 修复建议 | GPT-4 / Claude | 问题帧 + 检测结果 JSON | 自然语言修复建议 |
| 背景一致性 | GPT-4V | 背景区域截图 | 一致性评分 |

**调用策略：**
- 一致性检查：每 10 帧一组，并行调用（受 rate limit 约束）
- 建议生成：汇总所有检测结果后一次性调用
- 支持取消：前端可中断分析任务

### 3.3 分析结果数据模型

```rust
#[derive(Serialize, Deserialize)]
struct AnalysisReport {
    id: String,
    project_id: String,
    track_id: String,
    analyzed_at: i64,
    total_frames: i64,

    // 位移数据
    displacement: Vec<FrameDisplacement>,  // 每帧的 dx, dy

    // 闪烁数据
    flicker_frames: Vec<FlickerFrame>,  // 闪烁帧索引 + 严重度

    // 一致性
    consistency_score: f64,  // 0-100
    inconsistency_regions: Vec<InconsistencyRegion>,

    // AI 建议
    suggestions: Vec<AiSuggestion>,
}

#[derive(Serialize, Deserialize)]
struct FrameDisplacement {
    frame_index: i64,
    dx: f64,
    dy: f64,
    magnitude: f64,
    severity: String,  // "low" | "medium" | "high"
}

#[derive(Serialize, Deserialize)]
struct FlickerFrame {
    frame_index: i64,
    score: f64,
    severity: String,
}

#[derive(Serialize, Deserialize)]
struct AiSuggestion {
    frame_index: i64,
    issue_type: String,
    description: String,
    suggestion: String,
    confidence: f64,
}
```

### 3.4 分析结果可视化

**时间线标记：**
- 红色标记 = 高严重度问题帧
- 黄色标记 = 中等严重度
- 绿色标记 = 通过
- 问题帧数量显示在播放控制栏

**视口叠加层（复用现有 ViewportPanel）：**
- 位移：红色箭头显示偏移方向和距离
- 闪烁：蓝色半透明高亮闪烁区域
- 不一致：黄色边框标记差异区域
- 通过 `AnalysisOverlay` 组件渲染

**属性面板 AI 标签增强：**
- 显示当前帧的所有检测结果
- AI 修复建议列表（可点击跳转到对应帧）
- 一致性评分仪表盘

### 3.5 一键对齐

分析完成后，基于位移检测结果，可以一键将所有帧对齐到基准点：

```rust
#[tauri::command]
fn auto_align_frames(
    db: State<'_, DbState>,
    report_id: String,
    baseline_point_id: Option<String>,
) -> Result<AlignResult, String> { ... }
```

对齐逻辑：
1. 选择一个基准帧（用户指定或 AI 推荐最稳定的帧）
2. 根据位移数据计算每帧相对于基准帧的偏移
3. 应用偏移到每帧的 `alignment_dx/alignment_dy`
4. 前端实时更新视口显示对齐效果

---

## 4. AI 像素画生成

### 4.1 生成参数

```rust
#[derive(Serialize, Deserialize)]
struct TextToPixelParams {
    prompt: String,                          // 文字描述
    negative_prompt: Option<String>,         // 反向提示
    style: PixelStyle,                       // 像素风格
    width: u32,                              // 输出宽度（像素）
    height: u32,                             // 输出高度（像素）
    palette: Option<Vec<String>>,            // 自定义色板（hex 颜色列表）
    seed: Option<u64>,                       // 随机种子（可复现）
    num_variants: u32,                       // 生成变体数量
}

#[derive(Serialize, Deserialize)]
struct ImageToPixelParams {
    reference_image: String,                 // 参考图路径
    prompt: Option<String>,                  // 附加描述
    style: PixelStyle,
    denoise_strength: f64,                   // 0.0-1.0 参考图影响程度
    width: u32,
    height: u32,
    palette: Option<Vec<String>>,
    seed: Option<u64>,
    num_variants: u32,
}

#[derive(Serialize, Deserialize)]
enum PixelStyle {
    #[serde(rename = "8bit")]
    EightBit,        // 8-bit NES 风格
    #[serde(rename = "16bit")]
    SixteenBit,      // 16-bit SNES 风格
    #[serde(rename = "32bit")]
    ThirtyTwoBit,    // 32-bit GBA 风格
    #[serde(rename = "hd")]
    HdPixel,         // 高清像素风
    #[serde(rename = "custom")]
    Custom(String),  // 自定义风格描述
}
```

### 4.2 Prompt 工程模板

系统自动为像素画生成优化 prompt：

```rust
fn build_pixel_prompt(params: &TextToPixelParams) -> String {
    let style_desc = match &params.style {
        EightBit => "8-bit pixel art, NES style, limited color palette, crisp pixels",
        SixteenBit => "16-bit pixel art, SNES style, detailed pixel art, vibrant colors",
        ThirtyTwoBit => "32-bit pixel art, GBA style, smooth pixel transitions",
        HdPixel => "high definition pixel art, detailed, modern pixel art style",
        Custom(s) => s,
    };

    let palette_desc = params.palette.as_ref()
        .map(|p| format!("limited to these exact colors: {}", p.join(", ")))
        .unwrap_or_default();

    format!(
        "{}, {}, {}, pixel art sprite, transparent background, {}x{} pixels, no anti-aliasing, sharp pixel edges. {}",
        params.prompt, style_desc, palette_desc,
        params.width, params.height,
        params.negative_prompt.as_ref().map(|n| format!("NOT {}", n)).unwrap_or_default()
    )
}
```

### 4.3 生成资产管理

生成的像素画资产存储在独立的 `GeneratedAssets` 空间：

```sql
CREATE TABLE IF NOT EXISTS generated_assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'sprite',  -- sprite | prop | item | background | effect
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    style TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    palette TEXT,                                -- JSON array of hex colors
    seed INTEGER,
    provider TEXT NOT NULL,                      -- 'openai' | 'stability' | 'local' | 'comfyui'
    file_path TEXT NOT NULL,                     -- 生成图文件路径
    thumbnail_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    metadata TEXT,                               -- JSON: 生成参数快照
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**生成资产与时间线的关系：**
- 生成的资产可选择"添加到时间线"，创建新轨道并导入
- 也可保留在生成资产面板中，用户手动拖拽到时间线
- 每个生成资产记录完整的生成参数，支持"重新生成"（同参数不同种子）和"变体生成"

### 4.4 生成 UI 流程

```
┌──────────────────────────────────────────────────────┐
│  AI 生成面板（新增标签页，在左侧面板资产库旁边）       │
│                                                       │
│  [文生图] [图生图]                                    │
│                                                       │
│  Prompt: [________________________________]           │
│  反向提示: [______________________________]           │
│                                                       │
│  风格: [8-bit] [16-bit] [32-bit] [HD] [自定义]       │
│  尺寸: [32] x [32]  [64x64] [128x128] [自定义]       │
│  色板: [默认] [自定义色板...]                         │
│  变体: [1] [2] [4]                                    │
│  种子: [随机]                                         │
│                                                       │
│  [图生图] 参考图: [拖拽或选择文件]                    │
│           影响度: [====|====] 0.5                     │
│                                                       │
│  后端: [自动] [OpenAI] [Stability] [本地] [ComfyUI]   │
│                                                       │
│  [生成]                                               │
│                                                       │
│  ─── 生成历史 ───                                     │
│  [像素战士 32x32]  8-bit  seed:12345  [重新生成]     │
│  [像素剑]          16-bit  seed:67890  [添加到时间线] │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

### 4.5 后端接口

```rust
#[tauri::command]
async fn generate_pixel_art(
    db: State<'_, DbState>,
    config: State<'_, AiConfig>,
    project_id: String,
    params: TextToPixelParams,
) -> Result<Vec<GeneratedAsset>, String> { ... }

#[tauri::command]
async fn generate_pixel_from_image(
    db: State<'_, DbState>,
    config: State<'_, AiConfig>,
    project_id: String,
    params: ImageToPixelParams,
) -> Result<Vec<GeneratedAsset>, String> { ... }

#[tauri::command]
async fn add_generated_to_timeline(
    db: State<'_, DbState>,
    asset_id: String,
    track_id: Option<String>,  // None = 创建新轨道
) -> Result<(), String> { ... }

#[tauri::command]
async fn list_generated_assets(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<GeneratedAsset>, String> { ... }

#[tauri::command]
async fn delete_generated_asset(
    db: State<'_, DbState>,
    asset_id: String,
) -> Result<(), String> { ... }
```

---

## 5. AI 配置中心

### 5.1 配置数据模型

```rust
#[derive(Serialize, Deserialize)]
struct AiConfig {
    providers: Vec<ProviderConfig>,
    default_analysis_provider: String,
    default_generation_provider: String,
}

#[derive(Serialize, Deserialize)]
struct ProviderConfig {
    id: String,                    // 唯一标识
    name: String,                  // 显示名称
    provider_type: ProviderType,   // 后端类型
    enabled: bool,
    capabilities: Vec<Capability>, // 支持的能力
    config: serde_json::Value,     // 类型特定配置
}

#[derive(Serialize, Deserialize)]
enum ProviderType {
    LocalOnnx,          // 本地 ONNX
    OpenAi,             // OpenAI API
    StabilityAi,        // Stability AI
    LocalDiffusion,     // 本地扩散模型
    ComfyUi,            // ComfyUI
    CustomApi,          // 自定义 API（OpenAI 兼容）
}

#[derive(Serialize, Deserialize)]
enum Capability {
    DisplacementDetection,
    FlickerDetection,
    ConsistencyCheck,
    SuggestionGeneration,
    TextToPixel,
    ImageToPixel,
    BatchGeneration,
}
```

### 5.2 API Key 管理

```rust
#[derive(Serialize, Deserialize)]
struct ApiKeyConfig {
    provider_id: String,
    key_source: KeySource,
}

#[derive(Serialize, Deserialize)]
enum KeySource {
    UserProvided(String),     // 用户自带的 Key（加密存储）
    ProxyServer(String),      // FrameForge 代理服务 URL
    EnvironmentVariable(String), // 环境变量名
}
```

Key 存储策略：
- 用户自带 Key：使用 OS keychain（macOS Keychain / Windows Credential Manager）加密存储
- 代理模式：只存储代理 URL，Key 在服务端
- 本地模型：无需 Key

### 5.3 配置 UI

在菜单栏"AI工具"下新增"AI 设置..."：

```
┌──────────────────────────────────────────────────────┐
│  AI 设置                                              │
│                                                       │
│  ─── 审查分析 ───                                     │
│  位移/闪烁检测: [本地 ONNX (推荐)] [云端]             │
│  一致性检查:    [OpenAI GPT-4V] [Claude] [关闭]       │
│  修复建议:      [OpenAI] [Claude] [关闭]              │
│                                                       │
│  ─── 像素画生成 ───                                   │
│  默认后端: [OpenAI DALL-E] [Stability] [本地] [ComfyUI]│
│                                                       │
│  ─── API 密钥 ───                                     │
│  OpenAI:      [••••••••sk-xxxx] [测试连接]            │
│  Stability:   [未配置] [配置]                         │
│  ComfyUI:     [http://localhost:8188] [测试连接]       │
│                                                       │
│  ─── 本地模型 ───                                     │
│  ONNX 模型: [已就绪] [重新下载]                       │
│  SD Turbo:  [未安装] [下载 (需 2GB)]                  │
│                                                       │
│  [保存] [取消]                                        │
└──────────────────────────────────────────────────────┘
```

---

## 6. 文件结构

```
src-tauri/src/
├── ai/
│   ├── mod.rs                    # AI 模块导出
│   ├── providers/
│   │   ├── mod.rs                # Provider trait 定义
│   │   ├── local_onnx.rs         # 本地 ONNX 分析实现
│   │   ├── openai.rs             # OpenAI API 实现
│   │   ├── stability.rs          # Stability AI 实现
│   │   ├── local_diffusion.rs    # 本地扩散模型实现
│   │   └── comfyui.rs            # ComfyUI 对接实现
│   ├── analysis/
│   │   ├── mod.rs                # 分析引擎入口
│   │   ├── displacement.rs       # 位移检测逻辑
│   │   ├── flicker.rs            # 闪烁检测逻辑
│   │   ├── consistency.rs        # 一致性检查逻辑
│   │   └── suggest.rs            # 建议生成逻辑
│   ├── generation/
│   │   ├── mod.rs                # 生成引擎入口
│   │   ├── pixel_prompt.rs       # 像素画 prompt 工程
│   │   └── asset_manager.rs      # 生成资产管理
│   ├── config.rs                 # AI 配置管理
│   └── keychain.rs               # API Key 安全存储
├── commands/
│   ├── analysis.rs               # 分析相关 Tauri 命令（新增）
│   ├── generation.rs             # 生成相关 Tauri 命令（新增）
│   └── ai_config.rs              # AI 配置相关 Tauri 命令（新增）

src/
├── components/
│   ├── viewport/
│   │   └── AnalysisOverlay.tsx   # 分析结果视口叠加层（新增）
│   ├── ai/
│   │   ├── AiGenerationPanel.tsx # AI 生成面板（新增）
│   │   ├── AiSettingsDialog.tsx  # AI 设置对话框（新增）
│   │   ├── AnalysisProgress.tsx  # 分析进度条（新增）
│   │   └── GeneratedAssetCard.tsx # 生成资产卡片（新增）
│   ├── panels/
│   │   └── PropertiesPanel.tsx   # 修改：AI 标签增强
│   └── timeline/
│       └── Timeline.tsx          # 修改：分析标记渲染
├── stores/
│   ├── aiConfigStore.ts          # AI 配置状态（新增）
│   ├── analysisStore.ts          # 分析结果状态（新增）
│   └── generationStore.ts        # 生成资产状态（新增）
├── hooks/
│   └── useAnalysisProgress.ts    # 分析进度 hook（新增）
└── types/
    ├── ai.ts                     # AI 相关类型定义（新增）
    └── analysis.ts               # 分析结果类型（新增）
```

---

## 7. 构建顺序

```
AI 配置中心 → 本地 ONNX 分析 → 云端分析 → 分析结果可视化 → 一键对齐
→ 像素画生成（OpenAI 先行）→ 像素画生成（多后端）→ 生成资产管理 → 深度集成时间线
```

### 分阶段交付

**阶段 2a — AI 审查分析：**
1. AI 配置中心（Provider 注册、API Key 管理）
2. 本地 ONNX 位移 + 闪烁检测
3. 云端一致性检查 + 建议生成
4. 分析结果可视化（叠加层 + 时间线标记 + AI 标签增强）
5. 一键对齐

**阶段 2b — AI 像素画生成：**
1. 生成面板 UI
2. OpenAI DALL-E 后端实现
3. Stability AI 后端实现
4. 生成资产管理（数据库 + UI）
5. 深度集成时间线（拖拽添加 + 自动创建轨道）
6. 本地扩散模型支持
7. ComfyUI 工作流对接

---

## 8. 架构决策记录

### ADR-5：Provider 抽象层
- **决策：** 使用 Rust trait 定义 `AnalysisProvider` 和 `GenerationProvider`
- **背景：** 需要支持多种 AI 后端，且审查和生成的接口差异大
- **备选方案：** 统一 Pipeline / Plugin 系统
- **选择：** 分离的 Provider trait — 审查和生成各自有清晰的接口
- **取舍：** 两个 trait 意味着后端可能需要实现多个 trait，但接口更精确
- **回退方案：** 可合并为单一 trait + capability flags

### ADR-6：像素画生成 Prompt 工程
- **决策：** 系统自动包装 prompt，添加像素画专用描述词
- **背景：** 通用 AI 模型默认不生成像素风，需要 prompt 引导
- **备选方案：** 微调专用模型 / 后处理像素化
- **选择：** Prompt 工程 — 零额外成本，效果足够好
- **取舍：** 可能不如微调模型精确，但无需训练成本
- **回退方案：** 可后处理：先生成高清图再像素化降采样

### ADR-7：API Key 安全存储
- **决策：** 使用 OS keychain 存储，不存数据库
- **背景：** API Key 是敏感信息，不能明文存储
- **备选方案：** 加密后存 SQLite / 明文配置文件
- **选择：** OS keychain — 利用操作系统级安全存储
- **取舍：** 跨平台实现稍复杂（`keyring` crate），但安全性最高
- **回退方案：** AES-256 加密存 SQLite（密钥派生自用户密码）

---

## 9. 关键假设

1. 用户主要使用 OpenAI API 作为首选云端后端
2. 本地 ONNX 模型文件 < 50MB，可内置或首次使用下载
3. 像素画生成尺寸通常在 32x32 到 256x256 之间
4. 分析 1000 帧以内的序列，本地分析在 30 秒内完成
5. 云端 API 调用遵循各服务的 rate limit，不自行绕过
6. ComfyUI 用户自行部署，FrameForge 只做 API 对接

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| ONNX 模型体积过大 | 安装包膨胀 | 首次使用时按需下载，不内置 |
| 云端 API 变更/停服 | 功能不可用 | 多后端冗余，自动 fallback |
| 本地推理 GPU 不足 | 生成速度慢 | CPU fallback + 队列机制 |
| 像素画质量不稳定 | 用户体验差 | Prompt 模板优化 + 多变体选择 |
| API Key 泄露 | 安全风险 | OS keychain + 不日志记录 |
