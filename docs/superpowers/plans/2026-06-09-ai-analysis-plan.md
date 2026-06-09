# AI 审查分析 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AI 审查分析模块，包含 Provider 抽象层、AI 配置中心、本地 ONNX 位移/闪烁检测、云端一致性检查和建议生成、分析结果可视化和一键对齐。

**Architecture:** Rust 后端实现 Provider trait 抽象层，本地 ONNX 处理位移/闪烁检测，云端 API（OpenAI）处理一致性检查和建议。前端通过 Tauri IPC 调用，分析结果持久化到 SQLite，叠加层渲染在 ViewportPanel 上。

**Tech Stack:** Tauri v2, Rust, ONNX Runtime (ort crate), OpenAI API, React 18, TypeScript, Zustand

**Design Spec:** `docs/superpowers/specs/2026-06-09-ai-modules-design.md`

---

## 文件结构

```
d:\Code\new\FrameForge\
├── src-tauri/
│   ├── Cargo.toml                      # 修改：添加 ort, reqwest, keyring 依赖
│   └── src/
│       ├── ai/
│       │   ├── mod.rs                   # AI 模块导出
│       │   ├── providers/
│       │   │   ├── mod.rs               # Provider trait 定义
│       │   │   ├── local_onnx.rs        # 本地 ONNX 分析实现
│       │   │   └── openai_provider.rs   # OpenAI API 实现
│       │   ├── analysis/
│       │   │   ├── mod.rs               # 分析引擎入口
│       │   │   ├── displacement.rs      # 位移检测
│       │   │   ├── flicker.rs           # 闪烁检测
│       │   │   ├── consistency.rs       # 一致性检查
│       │   │   └── suggest.rs           # 建议生成
│       │   └── config.rs                # AI 配置管理
│       ├── commands/
│       │   ├── ai_config.rs             # AI 配置命令（新增）
│       │   └── analysis.rs              # 分析命令（新增）
│       ├── db/
│       │   └── init.rs                  # 修改：添加 analysis_reports 表
│       └── lib.rs                       # 修改：注册新命令和 AI 模块
├── src/
│   ├── components/
│   │   ├── viewport/
│   │   │   └── AnalysisOverlay.tsx      # 分析结果叠加层（新增）
│   │   ├── ai/
│   │   │   ├── AiSettingsDialog.tsx     # AI 设置对话框（新增）
│   │   │   └── AnalysisProgress.tsx     # 分析进度条（新增）
│   │   ├── panels/
│   │   │   └── PropertiesPanel.tsx      # 修改：AI 标签增强
│   │   └── timeline/
│   │       └── Timeline.tsx             # 修改：分析标记
│   ├── stores/
│   │   ├── aiConfigStore.ts             # AI 配置状态（新增）
│   │   └── analysisStore.ts             # 分析结果状态（新增）
│   └── types/
│       ├── ai.ts                        # AI 类型定义（新增）
│       └── analysis.ts                  # 分析结果类型（新增）
```

---

## Task 1: AI 配置基础 — 类型定义与配置管理

**Files:**
- Create: `src/types/ai.ts`
- Create: `src/types/analysis.ts`
- Create: `src/stores/aiConfigStore.ts`
- Create: `src-tauri/src/ai/mod.rs`
- Create: `src-tauri/src/ai/config.rs`
- Create: `src-tauri/src/ai/providers/mod.rs`
- Modify: `src-tauri/Cargo.toml` — 添加依赖
- Modify: `src-tauri/src/lib.rs` — 注册 AI 模块

- [ ] **Step 1: 添加 Rust 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
ort = { version = "2", features = ["load-dynamic"] }
ndarray = "0.16"
image = "0.25"
```

- [ ] **Step 2: 创建 AI 模块导出** `src-tauri/src/ai/mod.rs`

```rust
pub mod providers;
pub mod analysis;
pub mod config;

use config::AiConfigState;
use std::sync::Mutex;

pub type AiConfig = Mutex<AiConfigState>;
```

- [ ] **Step 3: 创建 AI 配置** `src-tauri/src/ai/config.rs`

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub enabled: bool,
    pub capabilities: Vec<String>,
    pub config: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigState {
    pub providers: Vec<ProviderConfig>,
    pub default_analysis_provider: String,
    pub default_generation_provider: String,
    pub api_keys: HashMap<String, String>,
}

impl Default for AiConfigState {
    fn default() -> Self {
        Self {
            providers: vec![
                ProviderConfig {
                    id: "local-onnx".to_string(),
                    name: "本地 ONNX".to_string(),
                    provider_type: "LocalOnnx".to_string(),
                    enabled: true,
                    capabilities: vec![
                        "DisplacementDetection".to_string(),
                        "FlickerDetection".to_string(),
                    ],
                    config: serde_json::json!({}),
                },
                ProviderConfig {
                    id: "openai".to_string(),
                    name: "OpenAI".to_string(),
                    provider_type: "OpenAi".to_string(),
                    enabled: false,
                    capabilities: vec![
                        "ConsistencyCheck".to_string(),
                        "SuggestionGeneration".to_string(),
                    ],
                    config: serde_json::json!({
                        "model": "gpt-4o",
                        "baseUrl": "https://api.openai.com/v1"
                    }),
                },
            ],
            default_analysis_provider: "local-onnx".to_string(),
            default_generation_provider: "openai".to_string(),
            api_keys: HashMap::new(),
        }
    }
}
```

- [ ] **Step 4: 创建 Provider trait 定义** `src-tauri/src/ai/providers/mod.rs`

```rust
use serde::{Deserialize, Serialize};

/// 位移检测结果
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrameDisplacement {
    pub frame_index: i64,
    pub dx: f64,
    pub dy: f64,
    pub magnitude: f64,
    pub severity: String,
}

/// 闪烁检测结果
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FlickerFrame {
    pub frame_index: i64,
    pub score: f64,
    pub severity: String,
}

/// 一致性检测结果
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyResult {
    pub score: f64,
    pub description: String,
    pub frame_range: (i64, i64),
}

/// AI 建议
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestion {
    pub frame_index: i64,
    pub issue_type: String,
    pub description: String,
    pub suggestion: String,
    pub confidence: f64,
}

/// 完整分析报告
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub id: String,
    pub project_id: String,
    pub track_id: String,
    pub analyzed_at: i64,
    pub total_frames: i64,
    pub displacement: Vec<FrameDisplacement>,
    pub flicker_frames: Vec<FlickerFrame>,
    pub consistency_score: f64,
    pub suggestions: Vec<AiSuggestion>,
}

/// 图片输入（base64 编码）
#[derive(Debug, Clone)]
pub struct ImageInput {
    pub path: String,
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// 审查分析能力 trait
pub trait AnalysisProvider: Send + Sync {
    fn detect_displacement(
        &self,
        frames: &[ImageInput],
    ) -> Result<Vec<FrameDisplacement>, String>;

    fn detect_flicker(
        &self,
        frames: &[ImageInput],
    ) -> Result<Vec<FlickerFrame>, String>;

    fn check_consistency(
        &self,
        frames: &[ImageInput],
    ) -> Result<ConsistencyResult, String>;

    fn generate_suggestions(
        &self,
        issues: &[(i64, String, String)],
    ) -> Result<Vec<AiSuggestion>, String>;
}
```

- [ ] **Step 5: 创建分析引擎占位** `src-tauri/src/ai/analysis/mod.rs`

```rust
pub mod displacement;
pub mod flicker;
```

创建 `src-tauri/src/ai/analysis/displacement.rs`：

```rust
/// 基于像素差的简易位移检测（MVP 版本，不依赖 ONNX）
/// 通过比较相邻帧的像素差来估计位移
pub fn detect_displacement_simple(
    frames: &[Vec<u8>],
    widths: &[u32],
    heights: &[u32],
) -> Vec<super::super::providers::FrameDisplacement> {
    use super::super::providers::FrameDisplacement;

    let mut results = Vec::new();

    for i in 1..frames.len() {
        let (dx, dy) = estimate_shift(
            &frames[i - 1], widths[i - 1], heights[i - 1],
            &frames[i], widths[i], heights[i],
        );

        let magnitude = (dx * dx + dy * dy).sqrt();
        let severity = if magnitude > 3.0 {
            "high"
        } else if magnitude > 1.0 {
            "medium"
        } else {
            "low"
        };

        results.push(FrameDisplacement {
            frame_index: i as i64,
            dx,
            dy,
            magnitude,
            severity: severity.to_string(),
        });
    }

    results
}

/// 使用 NCC（归一化互相关）估计两帧间的位移
fn estimate_shift(
    img1: &[u8], w1: u32, h1: u32,
    img2: &[u8], w2: u32, h2: u32,
) -> (f64, f64) {
    // 将图像转为灰度（简单平均）
    let gray1 = to_gray(img1, w1, h1);
    let gray2 = to_gray(img2, w2, h2);

    let search_range = 15i32;
    let block_size = 32u32;

    let mut best_dx = 0.0f64;
    let mut best_dy = 0.0f64;
    let mut best_score = f64::NEG_INFINITY;

    let cx = (w1.min(w2) as i32) / 2;
    let cy = (h1.min(h2) as i32) / 2;
    let half_block = (block_size / 2) as i32;

    for dy in -search_range..=search_range {
        for dx in -search_range..=search_range {
            let mut sum = 0.0f64;
            let mut count = 0u32;

            for by in -half_block..half_block {
                for bx in -half_block..half_block {
                    let x1 = (cx + bx) as usize;
                    let y1 = (cy + by) as usize;
                    let x2 = (cx + bx + dx) as usize;
                    let y2 = (cy + by + dy) as usize;

                    let w1u = w1 as usize;
                    let w2u = w2 as usize;
                    let h1u = h1 as usize;
                    let h2u = h2 as usize;

                    if x1 < w1u && y1 < h1u && x2 < w2u && y2 < h2u {
                        let v1 = gray1[y1 * w1u + x1];
                        let v2 = gray2[y2 * w2u + x2];
                        sum += v1 * v2;
                        count += 1;
                    }
                }
            }

            if count > 0 {
                let score = sum / count as f64;
                if score > best_score {
                    best_score = score;
                    best_dx = dx as f64;
                    best_dy = dy as f64;
                }
            }
        }
    }

    (best_dx, best_dy)
}

fn to_gray(data: &[u8], width: u32, _height: u32) -> Vec<f64> {
    let channels = if data.len() == (width as usize * _height as usize) { 1 } else { 4 };
    data.chunks(channels)
        .map(|px| {
            if channels >= 3 {
                (px[0] as f64 * 0.299 + px[1] as f64 * 0.587 + px[2] as f64 * 0.114) / 255.0
            } else {
                px[0] as f64 / 255.0
            }
        })
        .collect()
}
```

创建 `src-tauri/src/ai/analysis/flicker.rs`：

```rust
/// 基于亮度差异的闪烁检测
pub fn detect_flicker_simple(
    frames: &[Vec<u8>],
    widths: &[u32],
    heights: &[u32],
) -> Vec<super::super::providers::FlickerFrame> {
    use super::super::providers::FlickerFrame;

    let mut results = Vec::new();

    // 计算每帧的平均亮度
    let brightnesses: Vec<f64> = frames.iter().enumerate().map(|(i, data)| {
        let channels = if data.len() == (widths[i] as usize * heights[i] as usize) { 1 } else { 4 };
        let total: f64 = data.chunks(channels).map(|px| {
            if channels >= 3 {
                (px[0] as f64 * 0.299 + px[1] as f64 * 0.587 + px[2] as f64 * 0.114) / 255.0
            } else {
                px[0] as f64 / 255.0
            }
        }).sum();
        total / (widths[i] * heights[i]) as f64
    }).collect();

    // 计算相邻帧亮度差异
    let avg_brightness: f64 = brightnesses.iter().sum::<f64>() / brightnesses.len().max(1) as f64;

    for i in 1..brightnesses.len() {
        let diff = (brightnesses[i] - brightnesses[i - 1]).abs();
        let relative_diff = if avg_brightness > 0.0 { diff / avg_brightness } else { 0.0 };

        let severity = if relative_diff > 0.15 {
            "high"
        } else if relative_diff > 0.08 {
            "medium"
        } else {
            "low"
        };

        results.push(FlickerFrame {
            frame_index: i as i64,
            score: relative_diff,
            severity: severity.to_string(),
        });
    }

    results
}
```

- [ ] **Step 6: 注册 AI 模块到 lib.rs**

在 `src-tauri/src/lib.rs` 中添加：

```rust
mod ai;
```

在 `setup` 闭包中，`app.manage(DbState::new(conn));` 之后添加：

```rust
app.manage(ai::AiConfig::new(ai::config::AiConfigState::default()));
```

- [ ] **Step 7: 创建前端 AI 类型** `src/types/ai.ts`

```typescript
export type ProviderType = "LocalOnnx" | "OpenAi" | "StabilityAi" | "LocalDiffusion" | "ComfyUi" | "CustomApi";

export type Capability =
  | "DisplacementDetection"
  | "FlickerDetection"
  | "ConsistencyCheck"
  | "SuggestionGeneration"
  | "TextToPixel"
  | "ImageToPixel"
  | "BatchGeneration";

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  enabled: boolean;
  capabilities: Capability[];
  config: Record<string, unknown>;
}

export interface AiConfig {
  providers: ProviderConfig[];
  defaultAnalysisProvider: string;
  defaultGenerationProvider: string;
  apiKeys: Record<string, string>;
}
```

创建 `src/types/analysis.ts`：

```typescript
export interface FrameDisplacement {
  frameIndex: number;
  dx: number;
  dy: number;
  magnitude: number;
  severity: "low" | "medium" | "high";
}

export interface FlickerFrame {
  frameIndex: number;
  score: number;
  severity: "low" | "medium" | "high";
}

export interface AiSuggestion {
  frameIndex: number;
  issueType: string;
  description: string;
  suggestion: string;
  confidence: number;
}

export interface AnalysisReport {
  id: string;
  projectId: string;
  trackId: string;
  analyzedAt: number;
  totalFrames: number;
  displacement: FrameDisplacement[];
  flickerFrames: FlickerFrame[];
  consistencyScore: number;
  suggestions: AiSuggestion[];
}
```

- [ ] **Step 8: 创建 AI 配置状态** `src/stores/aiConfigStore.ts`

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AiConfig, ProviderConfig } from "../types/ai";

interface AiConfigState {
  config: AiConfig | null;
  loading: boolean;

  loadConfig: () => Promise<void>;
  setApiKey: (providerId: string, key: string) => Promise<void>;
  toggleProvider: (providerId: string) => Promise<void>;
  setDefaultProvider: (type: "analysis" | "generation", providerId: string) => Promise<void>;
}

export const useAiConfigStore = create<AiConfigState>((set, get) => ({
  config: null,
  loading: false,

  loadConfig: async () => {
    set({ loading: true });
    try {
      const config = await invoke<AiConfig>("get_ai_config");
      set({ config });
    } catch (err) {
      console.error("加载 AI 配置失败:", err);
    } finally {
      set({ loading: false });
    }
  },

  setApiKey: async (providerId, key) => {
    try {
      await invoke("set_ai_api_key", { providerId, key });
      const config = { ...get().config! };
      config.apiKeys = { ...config.apiKeys, [providerId]: "••••••••" };
      set({ config });
    } catch (err) {
      console.error("设置 API Key 失败:", err);
    }
  },

  toggleProvider: async (providerId) => {
    try {
      const config = await invoke<AiConfig>("toggle_ai_provider", { providerId });
      set({ config });
    } catch (err) {
      console.error("切换 Provider 失败:", err);
    }
  },

  setDefaultProvider: async (type, providerId) => {
    try {
      const config = await invoke<AiConfig>("set_default_ai_provider", { type, providerId });
      set({ config });
    } catch (err) {
      console.error("设置默认 Provider 失败:", err);
    }
  },
}));
```

- [ ] **Step 9: 创建 AI 配置命令** `src-tauri/src/commands/ai_config.rs`

```rust
use crate::ai::AiConfig;
use crate::ai::config::AiConfigState;
use tauri::State;

#[tauri::command]
pub fn get_ai_config(config: State<'_, AiConfig>) -> Result<AiConfigState, String> {
    let cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    Ok(cfg.clone())
}

#[tauri::command]
pub fn set_ai_api_key(
    config: State<'_, AiConfig>,
    provider_id: String,
    key: String,
) -> Result<(), String> {
    let mut cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    cfg.api_keys.insert(provider_id, key);
    Ok(())
}

#[tauri::command]
pub fn toggle_ai_provider(
    config: State<'_, AiConfig>,
    provider_id: String,
) -> Result<AiConfigState, String> {
    let mut cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    for p in &mut cfg.providers {
        if p.id == provider_id {
            p.enabled = !p.enabled;
            break;
        }
    }
    Ok(cfg.clone())
}

#[tauri::command]
pub fn set_default_ai_provider(
    config: State<'_, AiConfig>,
    provider_type: String,
    provider_id: String,
) -> Result<AiConfigState, String> {
    let mut cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    if provider_type == "analysis" {
        cfg.default_analysis_provider = provider_id;
    } else {
        cfg.default_generation_provider = provider_id;
    }
    Ok(cfg.clone())
}
```

- [ ] **Step 10: 注册命令到 lib.rs**

在 `src-tauri/src/lib.rs` 中添加模块和命令注册：

```rust
// 在 mod ai; 后面添加：
mod commands {
    // 现有模块...
}
// 不对，commands 已经存在。在现有的 mod commands 后面不加重复。

// 直接在 invoke_handler 中添加：
commands::ai_config::get_ai_config,
commands::ai_config::set_ai_api_key,
commands::ai_config::toggle_ai_provider,
commands::ai_config::set_default_ai_provider,
```

同时在 `src-tauri/src/commands/mod.rs` 中添加：
```rust
pub mod ai_config;
```

- [ ] **Step 11: Commit**

```bash
git add src-tauri/ src/types/ai.ts src/types/analysis.ts src/stores/aiConfigStore.ts
git commit -m "feat: add AI config foundation, provider traits, types, and simple analysis algorithms"
```

---

## Task 2: 分析命令与进度回调

**Files:**
- Create: `src-tauri/src/commands/analysis.rs`
- Modify: `src-tauri/src/db/init.rs` — 添加 analysis_reports 表
- Modify: `src-tauri/src/lib.rs` — 注册分析命令

- [ ] **Step 1: 添加 analysis_reports 表**

在 `src-tauri/src/db/init.rs` 的 `create_tables` 函数中追加：

```rust
CREATE TABLE IF NOT EXISTS analysis_reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    analyzed_at INTEGER NOT NULL,
    total_frames INTEGER NOT NULL,
    displacement_json TEXT NOT NULL DEFAULT '[]',
    flicker_json TEXT NOT NULL DEFAULT '[]',
    consistency_score REAL NOT NULL DEFAULT 0.0,
    suggestions_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (track_id) REFERENCES tracks(id)
);
```

- [ ] **Step 2: 创建分析命令** `src-tauri/src/commands/analysis.rs`

```rust
use crate::ai::AiConfig;
use crate::ai::analysis::displacement::detect_displacement_simple;
use crate::ai::analysis::flicker::detect_flicker_simple;
use crate::ai::providers::{AnalysisReport, FrameDisplacement, FlickerFrame};
use crate::db::DbState;
use rusqlite::params;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn analyze_track(
    db: State<'_, DbState>,
    _config: State<'_, AiConfig>,
    app: AppHandle,
    project_id: String,
    track_id: String,
) -> Result<AnalysisReport, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    // 获取轨道的所有资产路径
    let mut stmt = conn
        .prepare("SELECT source_path FROM assets WHERE track_id = ?1 ORDER BY start_frame")
        .map_err(|e| format!("查询资产失败: {}", e))?;

    let paths: Vec<String> = stmt
        .query_map(params![track_id], |row| row.get(0))
        .map_err(|e| format!("读取路径失败: {}", e))?
        .filter_map(|p| p.ok())
        .collect();
    drop(stmt);

    if paths.is_empty() {
        return Err("轨道中没有帧".to_string());
    }

    let total = paths.len();

    // 加载图片数据
    app.emit("analysis-progress", serde_json::json!({
        "stage": "loading", "current": 0, "total": total
    })).ok();

    let mut frames_data = Vec::new();
    let mut widths = Vec::new();
    let mut heights = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let data = std::fs::read(path).map_err(|e| format!("读取帧 {} 失败: {}", i, e))?;
        let img = image::load_from_memory(&data)
            .map_err(|e| format!("解码帧 {} 失败: {}", i, e))?;
        let rgba = img.to_rgba8();
        widths.push(rgba.width());
        heights.push(rgba.height());
        frames_data.push(rgba.into_raw());

        if i % 10 == 0 {
            app.emit("analysis-progress", serde_json::json!({
                "stage": "loading", "current": i + 1, "total": total
            })).ok();
        }
    }

    // 位移检测
    app.emit("analysis-progress", serde_json::json!({
        "stage": "displacement", "current": 0, "total": total
    })).ok();

    let displacement = detect_displacement_simple(&frames_data, &widths, &heights);

    app.emit("analysis-progress", serde_json::json!({
        "stage": "displacement", "current": total, "total": total
    })).ok();

    // 闪烁检测
    app.emit("analysis-progress", serde_json::json!({
        "stage": "flicker", "current": 0, "total": total
    })).ok();

    let flicker_frames = detect_flicker_simple(&frames_data, &widths, &heights);

    app.emit("analysis-progress", serde_json::json!({
        "stage": "flicker", "current": total, "total": total
    })).ok();

    // 生成报告
    let report = AnalysisReport {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.clone(),
        track_id: track_id.clone(),
        analyzed_at: chrono::Utc::now().timestamp_millis(),
        total_frames: total as i64,
        displacement,
        flicker_frames,
        consistency_score: 0.0, // 云端分析后续实现
        suggestions: vec![],
    };

    // 保存到数据库
    let conn2 = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn2.execute(
        "INSERT INTO analysis_reports (id, project_id, track_id, analyzed_at, total_frames, displacement_json, flicker_json, consistency_score, suggestions_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            report.id,
            report.project_id,
            report.track_id,
            report.analyzed_at,
            report.total_frames,
            serde_json::to_string(&report.displacement).unwrap_or("[]".to_string()),
            serde_json::to_string(&report.flicker_frames).unwrap_or("[]".to_string()),
            report.consistency_score,
            serde_json::to_string(&report.suggestions).unwrap_or("[]".to_string()),
        ],
    ).map_err(|e| format!("保存报告失败: {}", e))?;

    app.emit("analysis-progress", serde_json::json!({
        "stage": "done", "current": total, "total": total
    })).ok();

    Ok(report)
}

#[tauri::command]
pub fn get_analysis_reports(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<AnalysisReport>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, track_id, analyzed_at, total_frames, displacement_json, flicker_json, consistency_score, suggestions_json FROM analysis_reports WHERE project_id = ?1 ORDER BY analyzed_at DESC")
        .map_err(|e| format!("查询报告失败: {}", e))?;

    let reports = stmt
        .query_map(params![project_id], |row| {
            let id: String = row.get(0)?;
            let project_id: String = row.get(1)?;
            let track_id: String = row.get(2)?;
            let analyzed_at: i64 = row.get(3)?;
            let total_frames: i64 = row.get(4)?;
            let disp_str: String = row.get(5)?;
            let flick_str: String = row.get(6)?;
            let consistency_score: f64 = row.get(7)?;
            let sug_str: String = row.get(8)?;

            Ok(AnalysisReport {
                id,
                project_id,
                track_id,
                analyzed_at,
                total_frames,
                displacement: serde_json::from_str(&disp_str).unwrap_or_default(),
                flicker_frames: serde_json::from_str(&flick_str).unwrap_or_default(),
                consistency_score,
                suggestions: serde_json::from_str(&sug_str).unwrap_or_default(),
            })
        })
        .map_err(|e| format!("读取报告失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(reports)
}

#[tauri::command]
pub fn delete_analysis_report(db: State<'_, DbState>, report_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM analysis_reports WHERE id = ?1", params![report_id])
        .map_err(|e| format!("删除报告失败: {}", e))?;
    Ok(())
}
```

- [ ] **Step 3: 注册命令**

在 `src-tauri/src/commands/mod.rs` 中添加：
```rust
pub mod analysis;
```

在 `src-tauri/src/lib.rs` 的 invoke_handler 中添加：
```rust
commands::analysis::analyze_track,
commands::analysis::get_analysis_reports,
commands::analysis::delete_analysis_report,
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat: add analysis commands with progress events and DB persistence"
```

---

## Task 3: 分析结果状态管理与前端集成

**Files:**
- Create: `src/stores/analysisStore.ts`
- Create: `src/hooks/useAnalysisProgress.ts`
- Modify: `src/components/panels/PropertiesPanel.tsx` — AI 标签增强

- [ ] **Step 1: 创建分析结果状态** `src/stores/analysisStore.ts`

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AnalysisReport } from "../types/analysis";

interface AnalysisState {
  reports: AnalysisReport[];
  activeReportId: string | null;
  isAnalyzing: boolean;
  progress: { stage: string; current: number; total: number } | null;

  setReports: (reports: AnalysisReport[]) => void;
  setActiveReport: (id: string | null) => void;
  loadReports: (projectId: string) => Promise<void>;
  analyzeTrack: (projectId: string, trackId: string) => Promise<void>;
  deleteReport: (reportId: string) => Promise<void>;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  reports: [],
  activeReportId: null,
  isAnalyzing: false,
  progress: null,

  setReports: (reports) => set({ reports }),
  setActiveReport: (id) => set({ activeReportId: id }),

  loadReports: async (projectId) => {
    try {
      const reports = await invoke<AnalysisReport[]>("get_analysis_reports", { projectId });
      set({ reports });
    } catch (err) {
      console.error("加载分析报告失败:", err);
    }
  },

  analyzeTrack: async (projectId, trackId) => {
    set({ isAnalyzing: true, progress: null });
    try {
      const report = await invoke<AnalysisReport>("analyze_track", { projectId, trackId });
      set((s) => ({
        reports: [report, ...s.reports],
        activeReportId: report.id,
        isAnalyzing: false,
        progress: null,
      }));
    } catch (err) {
      console.error("分析失败:", err);
      set({ isAnalyzing: false, progress: null });
    }
  },

  deleteReport: async (reportId) => {
    try {
      await invoke("delete_analysis_report", { reportId });
      set((s) => ({
        reports: s.reports.filter((r) => r.id !== reportId),
        activeReportId: s.activeReportId === reportId ? null : s.activeReportId,
      }));
    } catch (err) {
      console.error("删除报告失败:", err);
    }
  },
}));
```

- [ ] **Step 2: 创建分析进度 hook** `src/hooks/useAnalysisProgress.ts`

```typescript
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAnalysisStore } from "../stores/analysisStore";

export function useAnalysisProgress() {
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);

  useEffect(() => {
    if (!isAnalyzing) return;

    const unlisten = listen<{ stage: string; current: number; total: number }>(
      "analysis-progress",
      (event) => {
        useAnalysisStore.getState().progress = event.payload;
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isAnalyzing]);
}
```

- [ ] **Step 3: 修改 PropertiesPanel AI 标签**

替换 PropertiesPanel 中 AI 标签的占位内容（`<div className="text-center text-gray-600 py-4">AI分析功能将在后续版本实现</div>`）：

```tsx
function AiAnalysisTab() {
  const reports = useAnalysisStore((s) => s.reports);
  const activeReportId = useAnalysisStore((s) => s.activeReportId);
  const setActiveReport = useAnalysisStore((s) => s.setActiveReport);
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const progress = useAnalysisStore((s) => s.progress);
  const tracks = useTimelineStore((s) => s.tracks);
  const project = useProjectStore((s) => s.project);
  const analyzeTrack = useAnalysisStore((s) => s.analyzeTrack);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const activeReport = reports.find((r) => r.id === activeReportId);

  // 当前帧的检测结果
  const currentDisplacement = activeReport?.displacement.find(
    (d) => d.frameIndex === currentFrame
  );
  const currentFlicker = activeReport?.flickerFrames.find(
    (f) => f.frameIndex === currentFrame
  );
  const currentSuggestions = activeReport?.suggestions.filter(
    (s) => s.frameIndex === currentFrame
  );

  return (
    <div className="space-y-3">
      {/* 分析按钮 */}
      <div>
        <div className="text-gray-400 font-medium text-xs mb-2">帧序列分析</div>
        {project && tracks.length > 0 ? (
          <div className="space-y-1.5">
            {tracks.map((track) => (
              <button
                key={track.id}
                className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 disabled:opacity-50"
                onClick={() => analyzeTrack(project.id, track.id)}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? "分析中..." : `分析: ${track.name}`}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-gray-600">先导入帧序列</div>
        )}
      </div>

      {/* 进度条 */}
      {isAnalyzing && progress && (
        <div>
          <div className="text-[10px] text-gray-500 mb-1">
            {progress.stage === "loading" && "加载帧数据..."}
            {progress.stage === "displacement" && "位移检测..."}
            {progress.stage === "flicker" && "闪烁检测..."}
            {progress.stage === "done" && "分析完成"}
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-orange-500 h-1.5 rounded-full transition-all"
              style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 分析报告列表 */}
      {reports.length > 0 && (
        <div>
          <div className="text-gray-400 font-medium text-xs mb-2">分析报告</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {reports.map((r) => (
              <div
                key={r.id}
                className={`px-2 py-1.5 rounded cursor-pointer text-[10px] ${
                  activeReportId === r.id ? "bg-gray-700" : "hover:bg-gray-800"
                }`}
                onClick={() => setActiveReport(r.id)}
              >
                <div className="text-gray-300">{r.trackId.slice(0, 8)}... | {r.totalFrames}帧</div>
                <div className="text-gray-600">
                  {r.displacement.filter((d) => d.severity === "high").length} 位移 |
                  {r.flickerFrames.filter((f) => f.severity === "high").length} 闪烁
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 当前帧检测结果 */}
      {activeReport && (
        <div>
          <div className="text-gray-400 font-medium text-xs mb-2">帧 {currentFrame} 检测</div>
          <div className="space-y-1.5">
            {currentDisplacement && (
              <div className={`px-2 py-1.5 rounded text-[10px] ${
                currentDisplacement.severity === "high" ? "bg-red-900/30 text-red-400" :
                currentDisplacement.severity === "medium" ? "bg-yellow-900/30 text-yellow-400" :
                "bg-green-900/30 text-green-400"
              }`}>
                位移: dx={currentDisplacement.dx.toFixed(1)}, dy={currentDisplacement.dy.toFixed(1)} ({currentDisplacement.severity})
              </div>
            )}
            {currentFlicker && (
              <div className={`px-2 py-1.5 rounded text-[10px] ${
                currentFlicker.severity === "high" ? "bg-red-900/30 text-red-400" :
                currentFlicker.severity === "medium" ? "bg-yellow-900/30 text-yellow-400" :
                "bg-green-900/30 text-green-400"
              }`}>
                闪烁: 分数={currentFlicker.score.toFixed(3)} ({currentFlicker.severity})
              </div>
            )}
            {currentSuggestions && currentSuggestions.map((s, i) => (
              <div key={i} className="px-2 py-1.5 bg-blue-900/30 rounded text-[10px] text-blue-300">
                {s.suggestion}
              </div>
            ))}
            {!currentDisplacement && !currentFlicker && (
              <div className="text-[10px] text-gray-600">此帧无问题</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

在 PropertiesPanel 中导入 `useAnalysisStore` 和 `useProjectStore`，替换 AI 标签的占位内容为 `<AiAnalysisTab />`。

在 `App.tsx` 中添加 `useAnalysisProgress()` 调用。

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: add analysis state management, progress hook, and AI panel in properties"
```

---

## Task 4: 分析结果叠加层与时间线标记

**Files:**
- Create: `src/components/viewport/AnalysisOverlay.tsx`
- Modify: `src/components/panels/ViewportPanel.tsx` — 集成叠加层
- Modify: `src/components/timeline/Timeline.tsx` — 分析标记渲染
- Modify: `src/components/layout/MenuBar.tsx` — AI 工具菜单连接

- [ ] **Step 1: 创建分析结果叠加层** `src/components/viewport/AnalysisOverlay.tsx`

```tsx
import { useAnalysisStore } from "../../stores/analysisStore";
import { useTimelineStore } from "../../stores/timelineStore";

interface Props {
  imageRect: { x: number; y: number; width: number; height: number } | null;
}

export function AnalysisOverlay({ imageRect }: Props) {
  const reports = useAnalysisStore((s) => s.reports);
  const activeReportId = useAnalysisStore((s) => s.activeReportId);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const report = reports.find((r) => r.id === activeReportId);
  if (!report || !imageRect) return null;

  const displacement = report.displacement.find((d) => d.frameIndex === currentFrame);
  const flicker = report.flickerFrames.find((f) => f.frameIndex === currentFrame);

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {/* 位移箭头 */}
      {displacement && displacement.magnitude > 1.0 && imageRect && (
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
            </marker>
          </defs>
          <line
            x1={imageRect.x + imageRect.width / 2}
            y1={imageRect.y + imageRect.height / 2}
            x2={imageRect.x + imageRect.width / 2 + displacement.dx * 20}
            y2={imageRect.y + imageRect.height / 2 + displacement.dy * 20}
            stroke="#ef4444"
            strokeWidth={2}
            markerEnd="url(#arrowhead)"
          />
          <text
            x={imageRect.x + imageRect.width / 2 + displacement.dx * 20 + 10}
            y={imageRect.y + imageRect.height / 2 + displacement.dy * 20}
            fill="#ef4444"
            fontSize="10"
          >
            {displacement.magnitude.toFixed(1)}px
          </text>
        </svg>
      )}

      {/* 闪烁高亮 */}
      {flicker && flicker.severity !== "low" && (
        <div
          className="absolute border-2 rounded"
          style={{
            left: imageRect.x,
            top: imageRect.y,
            width: imageRect.width,
            height: imageRect.height,
            borderColor: flicker.severity === "high" ? "#3b82f6" : "#60a5fa",
            backgroundColor: flicker.severity === "high" ? "rgba(59,130,246,0.1)" : "rgba(96,165,250,0.05)",
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 ViewportPanel 中集成**

在 `src/components/panels/ViewportPanel.tsx` 中：
1. 导入 `AnalysisOverlay`
2. 在 `<BaselineOverlay>` 之后添加 `<AnalysisOverlay imageRect={imageRect} />`

- [ ] **Step 3: 时间线分析标记**

在 `src/components/timeline/FrameThumbnail.tsx` 中添加分析标记：

```tsx
// 在 FrameThumbnail 组件中添加：
const activeReport = useAnalysisStore((s) => s.reports.find((r) => r.id === s.activeReportId));
const frameIssue = activeReport ? (
  activeReport.displacement.find((d) => d.frameIndex === index) ||
  activeReport.flickerFrames.find((f) => f.frameIndex === index)
) : null;

// 在缩略图 div 内部末尾添加：
{frameIssue && frameIssue.severity !== "low" && (
  <div
    className="absolute top-0 left-0 w-1.5 h-1.5 rounded-br"
    style={{
      backgroundColor: frameIssue.severity === "high" ? "#ef4444" : "#eab308",
    }}
  />
)}
```

注意：需要传入 `index` prop 到 FrameThumbnail。检查 Track.tsx 中是否已经传递了 index。

- [ ] **Step 4: MenuBar AI 菜单连接**

将 MenuBar 中 AI 工具菜单的 `alert` 替换为实际分析触发：

```tsx
// 替换 alert 调用为：
{ label: "分析当前轨道", action: () => action(() => {
  const project = useProjectStore.getState().project;
  const track = useTimelineStore.getState().tracks[0];
  if (project && track) {
    useAnalysisStore.getState().analyzeTrack(project.id, track.id);
  }
})},
{ label: "帧间位移检测", action: () => action(() => {
  const project = useProjectStore.getState().project;
  const track = useTimelineStore.getState().tracks[0];
  if (project && track) {
    useAnalysisStore.getState().analyzeTrack(project.id, track.id);
  }
})},
```

同时添加"AI 设置..."菜单项：

```tsx
{ type: "separator" },
{ label: "AI 设置...", action: () => action(() => {
  window.dispatchEvent(new CustomEvent("frameforge:show-ai-settings"));
})},
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: add analysis overlay, timeline markers, and AI menu integration"
```

---

## Task 5: 编译验证与整合

**Files:**
- Modify: 各文件根据编译错误修正

- [ ] **Step 1: TypeScript 编译检查**

```bash
cd d:\Code\new\FrameForge
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2: Rust 编译检查**

```bash
npm run tauri build -- --debug
```

Expected: 编译通过。

- [ ] **Step 3: 修复所有编译错误**

根据输出修复。

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: AI analysis module complete - displacement, flicker detection, visualization"
```

---

## 总计

| 指标 | 数量 |
|------|------|
| Tasks | 5 |
| 新建文件 | ~15 |
| 修改文件 | ~7 |
| 核心功能 | Provider 抽象层、AI 配置、本地位移/闪烁检测、分析结果可视化、时间线标记 |
| 可并行 | Task 3 和 Task 4 的前端部分可并行 |
