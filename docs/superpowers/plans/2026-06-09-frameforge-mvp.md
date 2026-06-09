# FrameForge MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 FrameForge 桌面应用的 MVP 框架，包含 Tauri 壳、前端基础架构、资产管理、时间线和帧检查器。

**Architecture:** Tauri v2 桌面应用，Rust 后端处理文件系统和图像操作，React + PixiJS 前端负责 WebGL 时间线渲染和 UI。前后端通过 Tauri IPC 通信。

**Tech Stack:** Tauri v2, React 18, TypeScript, PixiJS v8, Zustand, TailwindCSS, Rust

---

## 文件结构

```
d:\Code\new\
├── docs/
│   └── superpowers/
│       ├── specs/                        # 设计文档
│       └── plans/                        # 实现计划
├── src-tauri/                            # Rust 后端
│   ├── Cargo.toml                        # Rust 依赖
│   ├── tauri.conf.json                   # Tauri 配置
│   ├── src/
│   │   ├── main.rs                       # Tauri 入口
│   │   ├── lib.rs                        # 模块导出
│   │   ├── commands/
│   │   │   ├── mod.rs                    # 命令模块导出
│   │   │   ├── project.rs               # 项目 CRUD 命令
│   │   │   └── asset.rs                 # 资产导入/管理命令
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   └── init.rs                  # SQLite 初始化
│   │   └── models/
│   │       ├── mod.rs
│   │       └── project.rs               # 项目数据模型
│   └── icons/                            # 应用图标
├── src/                                  # React 前端
│   ├── main.tsx                          # React 入口
│   ├── App.tsx                           # 根组件（三栏布局）
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TitleBar.tsx              # 自定义标题栏
│   │   │   ├── MenuBar.tsx              # 菜单栏
│   │   │   └── StatusBar.tsx            # 状态栏
│   │   ├── panels/
│   │   │   ├── AssetPanel.tsx           # 左侧资产面板
│   │   │   ├── ViewportPanel.tsx        # 中间画布视口
│   │   │   └── PropertiesPanel.tsx      # 右侧属性面板
│   │   ├── timeline/
│   │   │   ├── Timeline.tsx             # 时间线主组件
│   │   │   ├── Track.tsx                # 单个轨道
│   │   │   ├── FrameThumbnail.tsx       # 帧缩略图
│   │   │   └── PlaybackControls.tsx     # 播放控制
│   │   └── inspector/
│   │       ├── OnionSkin.tsx            # 洋葱皮控制
│   │       └── BaselineMarker.tsx       # 基准点标记工具
│   ├── engines/
│   │   ├── TimelineEngine.ts            # PixiJS 时间线渲染引擎
│   │   └── ViewportEngine.ts            # PixiJS 画布渲染引擎
│   ├── stores/
│   │   ├── projectStore.ts              # 项目状态
│   │   ├── timelineStore.ts             # 时间线状态
│   │   └── uiStore.ts                   # UI 状态
│   ├── types/
│   │   ├── project.ts                   # 项目类型定义
│   │   ├── asset.ts                     # 资产类型定义
│   │   └── timeline.ts                  # 时间线类型定义
│   └── styles/
│       └── index.css                    # TailwindCSS 入口
├── index.html                            # HTML 入口
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── README.md
```

---

## Task 1: 初始化 Tauri + React + Vite 项目

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 使用 create-tauri-app 初始化项目**

在 `d:\Code` 目录下创建项目（注意：不在 `new` 目录内再嵌套，而是直接在 `new` 目录初始化）：

```bash
cd d:\Code\new
npm create tauri-app@latest -- --template react-ts --manager npm .
```

如果提示目录非空，选择继续。这将生成 Tauri v2 + React + TypeScript + Vite 基础框架。

- [ ] **Step 2: 安装前端依赖**

```bash
cd d:\Code\new
npm install zustand @pixi/node pixi.js tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: 配置 TailwindCSS**

创建 `d:\Code\new\src\styles\index.css`：

```css
@import "tailwindcss";
```

修改 `vite.config.ts`：

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 4: 配置 Tauri**

修改 `src-tauri/tauri.conf.json`，确保窗口配置：

```json
{
  "identifier": "com.frameforge.app",
  "productName": "FrameForge",
  "version": "0.1.0",
  "app": {
    "windows": [
      {
        "title": "FrameForge - AI动画帧审查工具",
        "width": 1440,
        "height": 900,
        "minWidth": 1024,
        "minHeight": 680,
        "decorations": false,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  }
}
```

- [ ] **Step 5: 验证项目能编译运行**

```bash
cd d:\Code\new
npm run tauri dev
```

Expected: 窗口弹出，显示默认 React 页面。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 初始化 Tauri + React + PixiJS 项目框架"
```

---

## Task 2: TypeScript 类型定义

**Files:**
- Create: `src/types/project.ts`
- Create: `src/types/asset.ts`
- Create: `src/types/timeline.ts`

- [ ] **Step 1: 创建项目类型** `src/types/project.ts`

```typescript
export interface BaselinePoint {
  id: string;
  name: string;
  type: "point" | "line" | "region";
  coordinates: number[];
  frameIndex: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  canvasWidth: number;
  canvasHeight: number;
  fps: 12 | 24 | 30;
  baselinePoints: BaselinePoint[];
}
```

- [ ] **Step 2: 创建资产类型** `src/types/asset.ts`

```typescript
export type AssetSourceType = "image" | "video";
export type AssetFormat = "png" | "jpg" | "webp" | "mp4" | "webm";

export interface AssetTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface AlignmentOffset {
  dx: number;
  dy: number;
}

export interface Asset {
  id: string;
  trackId: string;
  name: string;
  sourceType: AssetSourceType;
  sourcePath: string;
  thumbnailPath: string;
  startFrame: number;
  durationFrames: number;
  width: number;
  height: number;
  transform: AssetTransform;
  alignmentOffset: AlignmentOffset;
}

export interface ImportOptions {
  fps?: number;
  startFrame?: number;
}
```

- [ ] **Step 3: 创建时间线类型** `src/types/timeline.ts`

```typescript
import type { Asset } from "./asset";

export type TrackType = "image_sequence" | "video_clip" | "audio";

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  order: number;
  assets: Asset[];
}

export interface PlaybackState {
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  fps: number;
  loop: boolean;
}

export interface TimelineViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  frameWidth: number;
  frameHeight: number;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/
git commit -m "feat: 添加项目、资产、时间线 TypeScript 类型定义"
```

---

## Task 3: Zustand 状态管理

**Files:**
- Create: `src/stores/projectStore.ts`
- Create: `src/stores/timelineStore.ts`
- Create: `src/stores/uiStore.ts`

- [ ] **Step 1: 创建项目状态** `src/stores/projectStore.ts`

```typescript
import { create } from "zustand";
import type { Project, BaselinePoint } from "../types/project";

interface ProjectState {
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (partial: Partial<Project>) => void;
  addBaselinePoint: (point: BaselinePoint) => void;
  removeBaselinePoint: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  setProject: (project) => set({ project }),
  updateProject: (partial) =>
    set((state) => ({
      project: state.project
        ? { ...state.project, ...partial, updatedAt: Date.now() }
        : null,
    })),
  addBaselinePoint: (point) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            baselinePoints: [...state.project.baselinePoints, point],
            updatedAt: Date.now(),
          }
        : null,
    })),
  removeBaselinePoint: (id) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            baselinePoints: state.project.baselinePoints.filter(
              (p) => p.id !== id
            ),
            updatedAt: Date.now(),
          }
        : null,
    })),
}));
```

- [ ] **Step 2: 创建时间线状态** `src/stores/timelineStore.ts`

```typescript
import { create } from "zustand";
import type { Track, PlaybackState, TimelineViewport } from "../types/timeline";
import type { Asset } from "../types/asset";

interface TimelineState {
  tracks: Track[];
  playback: PlaybackState;
  viewport: TimelineViewport;
  selectedTrackId: string | null;
  selectedAssetId: string | null;

  setTracks: (tracks: Track[]) => void;
  addTrack: (track: Track) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, partial: Partial<Track>) => void;

  addAssetToTrack: (trackId: string, asset: Asset) => void;
  removeAssetFromTrack: (trackId: string, assetId: string) => void;
  updateAsset: (trackId: string, assetId: string, partial: Partial<Asset>) => void;

  setCurrentFrame: (frame: number) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;

  setViewport: (partial: Partial<TimelineViewport>) => void;
  setSelectedTrack: (id: string | null) => void;
  setSelectedAsset: (id: string | null) => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  tracks: [],
  playback: {
    currentFrame: 0,
    totalFrames: 0,
    isPlaying: false,
    fps: 24,
    loop: true,
  },
  viewport: {
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    frameWidth: 60,
    frameHeight: 40,
  },
  selectedTrackId: null,
  selectedAssetId: null,

  setTracks: (tracks) => set({ tracks }),
  addTrack: (track) => set((s) => ({ tracks: [...s.tracks, track] })),
  removeTrack: (id) =>
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) })),
  updateTrack: (id, partial) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    })),

  addAssetToTrack: (trackId, asset) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, assets: [...t.assets, asset] } : t
      ),
    })),
  removeAssetFromTrack: (trackId, assetId) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? { ...t, assets: t.assets.filter((a) => a.id !== assetId) }
          : t
      ),
    })),
  updateAsset: (trackId, assetId, partial) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              assets: t.assets.map((a) =>
                a.id === assetId ? { ...a, ...partial } : a
              ),
            }
          : t
      ),
    })),

  setCurrentFrame: (frame) =>
    set((s) => ({ playback: { ...s.playback, currentFrame: frame } })),
  togglePlay: () =>
    set((s) => ({
      playback: { ...s.playback, isPlaying: !s.playback.isPlaying },
    })),
  setPlaying: (playing) =>
    set((s) => ({ playback: { ...s.playback, isPlaying: playing } })),

  setViewport: (partial) =>
    set((s) => ({ viewport: { ...s.viewport, ...partial } })),
  setSelectedTrack: (id) => set({ selectedTrackId: id }),
  setSelectedAsset: (id) => set({ selectedAssetId: id }),
}));
```

- [ ] **Step 3: 创建 UI 状态** `src/stores/uiStore.ts`

```typescript
import { create } from "zustand";

type PanelTab = "assets" | "inspector";
type PropertiesTab = "info" | "baseline" | "ai" | "transform";

interface UIState {
  sidebarTab: PanelTab;
  propertiesTab: PropertiesTab;
  sidebarWidth: number;
  propertiesWidth: number;
  timelineHeight: number;
  onionSkinEnabled: boolean;
  onionSkinOpacity: number;
  onionSkinFrames: number;
  magnifierEnabled: boolean;
  magnifierZoom: number;

  setSidebarTab: (tab: PanelTab) => void;
  setPropertiesTab: (tab: PropertiesTab) => void;
  setSidebarWidth: (w: number) => void;
  setPropertiesWidth: (w: number) => void;
  setTimelineHeight: (h: number) => void;
  setOnionSkinEnabled: (v: boolean) => void;
  setOnionSkinOpacity: (v: number) => void;
  setOnionSkinFrames: (n: number) => void;
  setMagnifierEnabled: (v: boolean) => void;
  setMagnifierZoom: (v: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarTab: "assets",
  propertiesTab: "info",
  sidebarWidth: 260,
  propertiesWidth: 300,
  timelineHeight: 240,
  onionSkinEnabled: false,
  onionSkinOpacity: 0.3,
  onionSkinFrames: 2,
  magnifierEnabled: false,
  magnifierZoom: 4,

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setPropertiesTab: (tab) => set({ propertiesTab: tab }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setPropertiesWidth: (w) => set({ propertiesWidth: w }),
  setTimelineHeight: (h) => set({ timelineHeight: h }),
  setOnionSkinEnabled: (v) => set({ onionSkinEnabled: v }),
  setOnionSkinOpacity: (v) => set({ onionSkinOpacity: v }),
  setOnionSkinFrames: (n) => set({ onionSkinFrames: n }),
  setMagnifierEnabled: (v) => set({ magnifierEnabled: v }),
  setMagnifierZoom: (v) => set({ magnifierZoom: v }),
}));
```

- [ ] **Step 4: Commit**

```bash
git add src/stores/
git commit -m "feat: 添加 Zustand 状态管理（项目、时间线、UI）"
```

---

## Task 4: Rust 后端 - SQLite 数据库与项目命令

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/init.rs`
- Create: `src-tauri/src/models/mod.rs`
- Create: `src-tauri/src/models/project.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/project.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 添加 Rust 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
rusqlite = { version = "0.31", features = ["bundled"] }
```

- [ ] **Step 2: 创建数据库初始化** `src-tauri/src/db/mod.rs`

```rust
pub mod init;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

pub type DbState = Mutex<Connection>;

pub fn init_db(app_dir: &std::path::Path) -> Result<Connection, String> {
    let db_path = app_dir.join("frameforge.db");
    let conn =
        Connection::open(&db_path).map_err(|e| format!("数据库打开失败: {}", e))?;
    init::create_tables(&conn)?;
    Ok(conn)
}
```

- [ ] **Step 3: 创建数据库表** `src-tauri/src/db/init.rs`

```rust
use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            canvas_width INTEGER NOT NULL DEFAULT 1920,
            canvas_height INTEGER NOT NULL DEFAULT 1080,
            fps INTEGER NOT NULL DEFAULT 24,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'image_sequence',
            visible INTEGER NOT NULL DEFAULT 1,
            locked INTEGER NOT NULL DEFAULT 0,
            opacity REAL NOT NULL DEFAULT 1.0,
            track_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            track_id TEXT NOT NULL,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_path TEXT NOT NULL,
            thumbnail_path TEXT NOT NULL,
            start_frame INTEGER NOT NULL DEFAULT 0,
            duration_frames INTEGER NOT NULL DEFAULT 1,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            transform_x REAL NOT NULL DEFAULT 0.0,
            transform_y REAL NOT NULL DEFAULT 0.0,
            transform_scale_x REAL NOT NULL DEFAULT 1.0,
            transform_scale_y REAL NOT NULL DEFAULT 1.0,
            transform_rotation REAL NOT NULL DEFAULT 0.0,
            alignment_dx REAL NOT NULL DEFAULT 0.0,
            alignment_dy REAL NOT NULL DEFAULT 0.0,
            FOREIGN KEY (track_id) REFERENCES tracks(id)
        );

        CREATE TABLE IF NOT EXISTS baseline_points (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'point',
            coordinates TEXT NOT NULL DEFAULT '[]',
            frame_index INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );
        ",
    )
    .map_err(|e| format!("创建表失败: {}", e))?;
    Ok(())
}
```

- [ ] **Step 4: 创建项目模型** `src-tauri/src/models/mod.rs`

```rust
pub mod project;
```

`src-tauri/src/models/project.rs`：

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BaselinePoint {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub point_type: String,
    pub coordinates: Vec<f64>,
    pub frame_index: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub canvas_width: i64,
    pub canvas_height: i64,
    pub fps: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub baseline_points: Vec<BaselinePoint>,
}
```

- [ ] **Step 5: 创建项目命令** `src-tauri/src/commands/mod.rs`

```rust
pub mod project;
```

`src-tauri/src/commands/project.rs`：

```rust
use crate::db::DbState;
use crate::models::project::{BaselinePoint, Project};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn create_project(
    db: State<'_, DbState>,
    name: String,
    canvas_width: i64,
    canvas_height: i64,
    fps: i64,
) -> Result<Project, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let project = Project {
        id: id.clone(),
        name,
        canvas_width,
        canvas_height,
        fps,
        created_at: now,
        updated_at: now,
        baseline_points: vec![],
    };

    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO projects (id, name, canvas_width, canvas_height, fps, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![project.id, project.name, project.canvas_width, project.canvas_height, project.fps, project.created_at, project.updated_at],
    )
    .map_err(|e| format!("创建项目失败: {}", e))?;

    Ok(project)
}

#[tauri::command]
pub fn list_projects(db: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, canvas_width, canvas_height, fps, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("查询项目失败: {}", e))?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                canvas_width: row.get(2)?,
                canvas_height: row.get(3)?,
                fps: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                baseline_points: vec![],
            })
        })
        .map_err(|e| format!("读取项目失败: {}", e))?
        .filter_map(|p| p.ok())
        .collect();

    Ok(projects)
}

#[tauri::command]
pub fn get_project(db: State<'_, DbState>, id: String) -> Result<Project, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, canvas_width, canvas_height, fps, created_at, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| format!("查询项目失败: {}", e))?;

    let project = stmt
        .query_row(params![id], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                canvas_width: row.get(2)?,
                canvas_height: row.get(3)?,
                fps: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                baseline_points: vec![],
            })
        })
        .map_err(|e| format!("项目不存在: {}", e))?;

    Ok(project)
}

#[tauri::command]
pub fn delete_project(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("删除项目失败: {}", e))?;
    Ok(())
}
```

- [ ] **Step 6: 更新 lib.rs**

`src-tauri/src/lib.rs`：

```rust
mod commands;
mod db;
mod models;

use db::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_dir).ok();
            let conn = db::init_db(&app_dir).expect("数据库初始化失败");
            app.manage(DbState::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
```

- [ ] **Step 7: 编译验证**

```bash
cd d:\Code\new
npm run tauri build -- --debug
```

Expected: Rust 编译通过，无错误。

- [ ] **Step 8: Commit**

```bash
git add src-tauri/
git commit -m "feat: 添加 Rust 后端 SQLite 数据库与项目 CRUD 命令"
```

---

## Task 5: 前端 UI 布局 - 三栏 + 时间线

**Files:**
- Create: `src/App.tsx`
- Create: `src/main.tsx`
- Create: `src/components/layout/TitleBar.tsx`
- Create: `src/components/layout/MenuBar.tsx`
- Create: `src/components/layout/StatusBar.tsx`
- Create: `src/components/panels/AssetPanel.tsx`
- Create: `src/components/panels/ViewportPanel.tsx`
- Create: `src/components/panels/PropertiesPanel.tsx`

- [ ] **Step 1: 创建入口文件** `src/main.tsx`

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 2: 创建根组件** `src/App.tsx`

```tsx
import { TitleBar } from "./components/layout/TitleBar";
import { MenuBar } from "./components/layout/MenuBar";
import { StatusBar } from "./components/layout/StatusBar";
import { AssetPanel } from "./components/panels/AssetPanel";
import { ViewportPanel } from "./components/panels/ViewportPanel";
import { PropertiesPanel } from "./components/panels/PropertiesPanel";
import { Timeline } from "./components/timeline/Timeline";
import { useUIStore } from "./stores/uiStore";

export default function App() {
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const propertiesWidth = useUIStore((s) => s.propertiesWidth);
  const timelineHeight = useUIStore((s) => s.timelineHeight);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 select-none overflow-hidden">
      {/* 标题栏 */}
      <TitleBar />

      {/* 菜单栏 */}
      <MenuBar />

      {/* 主体区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧资产面板 */}
        <div
          className="flex-shrink-0 border-r border-gray-700 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <AssetPanel />
        </div>

        {/* 中间区域：画布 + 时间线 */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* 画布视口 */}
          <div className="flex-1 overflow-hidden">
            <ViewportPanel />
          </div>

          {/* 时间线 */}
          <div
            className="flex-shrink-0 border-t border-gray-700 overflow-hidden"
            style={{ height: timelineHeight }}
          >
            <Timeline />
          </div>
        </div>

        {/* 右侧属性面板 */}
        <div
          className="flex-shrink-0 border-l border-gray-700 overflow-hidden"
          style={{ width: propertiesWidth }}
        >
          <PropertiesPanel />
        </div>
      </div>

      {/* 状态栏 */}
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 3: 创建 TitleBar** `src/components/layout/TitleBar.tsx`

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      className="flex items-center justify-between h-9 bg-gray-950 px-3"
      onMouseDown={() => appWindow.startDragging()}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-orange-400">FrameForge</span>
        <span className="text-xs text-gray-500">AI动画帧审查工具</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="w-8 h-7 flex items-center justify-center hover:bg-gray-700 text-gray-400"
          onClick={() => appWindow.minimize()}
        >
          ─
        </button>
        <button
          className="w-8 h-7 flex items-center justify-center hover:bg-gray-700 text-gray-400"
          onClick={() => appWindow.toggleMaximize()}
        >
          □
        </button>
        <button
          className="w-8 h-7 flex items-center justify-center hover:bg-red-600 text-gray-400"
          onClick={() => appWindow.close()}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 MenuBar** `src/components/layout/MenuBar.tsx`

```tsx
export function MenuBar() {
  return (
    <div className="flex items-center h-7 bg-gray-900 border-b border-gray-700 px-2 text-xs">
      <MenuItem label="项目" />
      <MenuItem label="编辑" />
      <MenuItem label="视图" />
      <MenuItem label="AI工具" />
      <MenuItem label="导出" />
      <MenuItem label="帮助" />
    </div>
  );
}

function MenuItem({ label }: { label: string }) {
  return (
    <button className="px-3 py-1 hover:bg-gray-700 rounded text-gray-300 hover:text-white">
      {label}
    </button>
  );
}
```

- [ ] **Step 5: 创建 StatusBar** `src/components/layout/StatusBar.tsx`

```tsx
import { useTimelineStore } from "../../stores/timelineStore";

export function StatusBar() {
  const currentFrame = useTimelineStore((s) => s.playback.currentFrame);
  const totalFrames = useTimelineStore((s) => s.playback.totalFrames);
  const fps = useTimelineStore((s) => s.playback.fps);
  const trackCount = useTimelineStore((s) => s.tracks.length);

  return (
    <div className="flex items-center h-6 bg-gray-950 border-t border-gray-700 px-3 text-xs text-gray-500 gap-4">
      <span>帧: {currentFrame}/{totalFrames}</span>
      <span>帧率: {fps}fps</span>
      <span>轨道: {trackCount}</span>
      <span className="ml-auto text-green-600">就绪</span>
    </div>
  );
}
```

- [ ] **Step 6: 创建 AssetPanel** `src/components/panels/AssetPanel.tsx`

```tsx
import { useUIStore } from "../../stores/uiStore";

export function AssetPanel() {
  const tab = useUIStore((s) => s.sidebarTab);
  const setTab = useUIStore((s) => s.setSidebarTab);

  return (
    <div className="flex flex-col h-full">
      {/* 标签切换 */}
      <div className="flex border-b border-gray-700">
        <TabButton
          active={tab === "assets"}
          onClick={() => setTab("assets")}
          label="资产库"
        />
        <TabButton
          active={tab === "inspector"}
          onClick={() => setTab("inspector")}
          label="检查器"
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "assets" ? <AssetList /> : <InspectorList />}
      </div>

      {/* 导入按钮 */}
      {tab === "assets" && (
        <div className="p-2 border-t border-gray-700">
          <button className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium">
            导入资产
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={`flex-1 py-2 text-xs ${
        active
          ? "text-orange-400 border-b-2 border-orange-400"
          : "text-gray-500 hover:text-gray-300"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function AssetList() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800 rounded">
        <input
          className="flex-1 bg-transparent text-xs text-gray-300 outline-none placeholder-gray-600"
          placeholder="搜索资产..."
        />
      </div>
      <div className="text-center text-gray-600 text-xs py-8">
        拖拽文件到此处或点击导入
      </div>
    </div>
  );
}

function InspectorList() {
  return (
    <div className="text-center text-gray-600 text-xs py-8">
      选择资产查看详情
    </div>
  );
}
```

- [ ] **Step 7: 创建 ViewportPanel** `src/components/panels/ViewportPanel.tsx`

```tsx
import { useRef, useEffect } from "react";
import { Application } from "pixi.js";

export function ViewportPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    if (!containerRef.current || appRef.current) return;

    const app = new Application();
    app.init({ background: "#111111", resizeTo: containerRef.current }).then(
      () => {
        if (containerRef.current) {
          containerRef.current.appendChild(app.canvas);
          appRef.current = app;
        }
      }
    );

    return () => {
      app.destroy(true);
      appRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* 空状态提示 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center text-gray-600">
          <div className="text-4xl mb-2">🎬</div>
          <div className="text-sm">创建项目开始审查动画帧</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 创建 PropertiesPanel** `src/components/panels/PropertiesPanel.tsx`

```tsx
import { useUIStore } from "../../stores/uiStore";

export function PropertiesPanel() {
  const tab = useUIStore((s) => s.propertiesTab);
  const setTab = useUIStore((s) => s.setPropertiesTab);

  const tabs = [
    { key: "info" as const, label: "帧信息" },
    { key: "baseline" as const, label: "基准点" },
    { key: "ai" as const, label: "AI检测" },
    { key: "transform" as const, label: "变换" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex-1 py-2 text-xs ${
              tab === t.key
                ? "text-orange-400 border-b-2 border-orange-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs text-gray-500">
        <div className="text-center py-8">选择资产查看属性</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "feat: 添加前端三栏布局（资产面板、画布视口、属性面板）与基础 UI 组件"
```

---

## Task 6: 时间线组件

**Files:**
- Create: `src/components/timeline/Timeline.tsx`
- Create: `src/components/timeline/Track.tsx`
- Create: `src/components/timeline/FrameThumbnail.tsx`
- Create: `src/components/timeline/PlaybackControls.tsx`

- [ ] **Step 1: 创建 PlaybackControls** `src/components/timeline/PlaybackControls.tsx`

```tsx
import { useTimelineStore } from "../../stores/timelineStore";

export function PlaybackControls() {
  const currentFrame = useTimelineStore((s) => s.playback.currentFrame);
  const totalFrames = useTimelineStore((s) => s.playback.totalFrames);
  const isPlaying = useTimelineStore((s) => s.playback.isPlaying);
  const fps = useTimelineStore((s) => s.playback.fps);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const togglePlay = useTimelineStore((s) => s.togglePlay);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-850 border-b border-gray-700">
      {/* 播放控制 */}
      <button
        className="px-2 py-0.5 hover:bg-gray-700 rounded text-sm"
        onClick={() => setCurrentFrame(0)}
      >
        ⏮
      </button>
      <button
        className="px-2 py-0.5 hover:bg-gray-700 rounded text-lg"
        onClick={togglePlay}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>
      <button
        className="px-2 py-0.5 hover:bg-gray-700 rounded text-sm"
        onClick={() => setCurrentFrame(Math.max(0, totalFrames - 1))}
      >
        ⏭
      </button>

      {/* 帧信息 */}
      <div className="flex items-center gap-1 ml-4 text-xs text-gray-400">
        <span>帧:</span>
        <input
          type="number"
          value={currentFrame}
          onChange={(e) =>
            setCurrentFrame(
              Math.max(0, Math.min(totalFrames - 1, parseInt(e.target.value) || 0))
            )
          }
          className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-center text-gray-300"
        />
        <span>/ {totalFrames}</span>
      </div>

      <div className="text-xs text-gray-500 ml-4">{fps} fps</div>

      {/* 缩放 */}
      <div className="ml-auto flex items-center gap-1 text-xs text-gray-500">
        <span>缩放</span>
        <input
          type="range"
          min="0.25"
          max="3"
          step="0.25"
          defaultValue="1"
          className="w-20 accent-orange-500"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 FrameThumbnail** `src/components/timeline/FrameThumbnail.tsx`

```tsx
import type { Asset } from "../../types/asset";

interface Props {
  asset: Asset;
  isSelected: boolean;
  onClick: () => void;
}

export function FrameThumbnail({ asset, isSelected, onClick }: Props) {
  return (
    <div
      className={`flex-shrink-0 border-2 cursor-pointer transition-colors ${
        isSelected ? "border-orange-400" : "border-gray-700 hover:border-gray-500"
      }`}
      style={{ width: 60, height: 40 }}
      onClick={onClick}
    >
      {asset.thumbnailPath ? (
        <img
          src={asset.thumbnailPath}
          alt={asset.name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xs text-gray-600">
          {asset.name.slice(0, 4)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建 Track** `src/components/timeline/Track.tsx`

```tsx
import type { Track as TrackType } from "../../types/timeline";
import { useTimelineStore } from "../../stores/timelineStore";
import { FrameThumbnail } from "./FrameThumbnail";

interface Props {
  track: TrackType;
}

export function Track({ track }: Props) {
  const selectedAssetId = useTimelineStore((s) => s.selectedAssetId);
  const setSelectedAsset = useTimelineStore((s) => s.setSelectedAsset);
  const currentFrame = useTimelineStore((s) => s.playback.currentFrame);

  return (
    <div className="flex items-stretch h-12 border-b border-gray-800">
      {/* 轨道标签 */}
      <div className="w-32 flex-shrink-0 flex items-center gap-1 px-2 bg-gray-850 border-r border-gray-700">
        <button
          className={`text-xs ${track.visible ? "text-gray-300" : "text-gray-600"}`}
          title={track.visible ? "隐藏" : "显示"}
        >
          {track.visible ? "👁" : "👁‍🗨"}
        </button>
        <span className="text-xs text-gray-400 truncate flex-1">{track.name}</span>
      </div>

      {/* 帧内容 */}
      <div className="flex-1 flex items-center overflow-x-auto px-1 gap-0.5">
        {track.assets.map((asset) => (
          <FrameThumbnail
            key={asset.id}
            asset={asset}
            isSelected={selectedAssetId === asset.id}
            onClick={() => setSelectedAsset(asset.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 Timeline** `src/components/timeline/Timeline.tsx`

```tsx
import { useTimelineStore } from "../../stores/timelineStore";
import { Track } from "./Track";
import { PlaybackControls } from "./PlaybackControls";

export function Timeline() {
  const tracks = useTimelineStore((s) => s.tracks);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <PlaybackControls />

      {/* 轨道区域 */}
      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            添加轨道开始编辑时间线
          </div>
        ) : (
          tracks.map((track) => <Track key={track.id} track={track} />)
        )}
      </div>

      {/* 添加轨道按钮 */}
      <div className="flex items-center h-8 px-2 border-t border-gray-700">
        <button className="text-xs text-gray-500 hover:text-orange-400">
          + 添加轨道
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/
git commit -m "feat: 添加时间线组件（轨道、帧缩略图、播放控制）"
```

---

## Task 7: 欢迎对话框与项目创建

**Files:**
- Create: `src/components/dialogs/WelcomeDialog.tsx`
- Create: `src/components/dialogs/NewProjectDialog.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 WelcomeDialog** `src/components/dialogs/WelcomeDialog.tsx`

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import type { Project } from "../../types/project";

interface Props {
  onProjectCreated: () => void;
}

export function WelcomeDialog({ onProjectCreated }: Props) {
  const [showNew, setShowNew] = useState(false);

  if (showNew) {
    return <NewProjectDialog onCreated={onProjectCreated} onCancel={() => setShowNew(false)} />;
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[480px]">
        <h1 className="text-2xl font-bold text-orange-400 mb-2">FrameForge</h1>
        <p className="text-gray-400 text-sm mb-6">AI动画帧审查工具</p>

        <div className="space-y-3">
          <button
            className="w-full py-3 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium"
            onClick={() => setShowNew(true)}
          >
            新建项目
          </button>
          <button className="w-full py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm">
            打开项目
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700 text-xs text-gray-600 text-center">
          v0.1.0 - MVP
        </div>
      </div>
    </div>
  );
}

interface NewProjectProps {
  onCreated: () => void;
  onCancel: () => void;
}

function NewProjectDialog({ onCreated, onCancel }: NewProjectProps) {
  const [name, setName] = useState("未命名项目");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(24);

  const setProject = useProjectStore((s) => s.setProject);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const setPlaying = useTimelineStore((s) => s.setPlaying);

  const handleCreate = async () => {
    try {
      const project = await invoke<Project>("create_project", {
        name,
        canvasWidth: width,
        canvasHeight: height,
        fps,
      });
      setProject(project);
      setCurrentFrame(0);
      setPlaying(false);
      onCreated();
    } catch (err) {
      console.error("创建项目失败:", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[480px]">
        <h2 className="text-lg font-bold text-white mb-4">新建项目</h2>

        <div className="space-y-4">
          <Field label="项目名称">
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="flex gap-4">
            <Field label="画布宽度">
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 1920)}
              />
            </Field>
            <Field label="画布高度">
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 1080)}
              />
            </Field>
          </div>

          <Field label="帧率">
            <div className="flex gap-2">
              {[12, 24, 30].map((f) => (
                <button
                  key={f}
                  className={`flex-1 py-2 rounded text-sm ${
                    fps === f
                      ? "bg-orange-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                  onClick={() => setFps(f)}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium"
            onClick={handleCreate}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: 更新 App.tsx 集成欢迎对话框**

在 `src/App.tsx` 中添加：

```tsx
import { useState } from "react";
import { useProjectStore } from "./stores/projectStore";
import { WelcomeDialog } from "./components/dialogs/WelcomeDialog";
// ... 其余 import 不变

export default function App() {
  const project = useProjectStore((s) => s.project);
  const [showWelcome, setShowWelcome] = useState(true);
  // ... 其余代码不变

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 select-none overflow-hidden">
      {/* 标题栏 - 原有代码不变 */}

      {/* 欢迎对话框 */}
      {(showWelcome || !project) && (
        <WelcomeDialog onProjectCreated={() => setShowWelcome(false)} />
      )}

      {/* 主体区域 - 原有代码不变 */}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dialogs/ src/App.tsx
git commit -m "feat: 添加欢迎对话框与项目创建流程"
```

---

## Task 8: 编译验证与整合

**Files:**
- Modify: 各文件根据编译错误修正

- [ ] **Step 1: 完整编译测试**

```bash
cd d:\Code\new
npm run tauri dev
```

Expected: 窗口弹出，显示欢迎对话框，可以创建项目，三栏布局和时间线显示正常。

- [ ] **Step 2: 修复编译错误**

根据编译输出修复所有 TypeScript 类型错误和 Rust 编译错误。

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: FrameForge MVP 框架完成 - 可运行的基础应用"
```

---

## 总计

| 指标 | 数量 |
|------|------|
| Tasks | 8 |
| 新建文件 | ~25 |
| 核心功能 | Tauri壳、数据库、项目CRUD、三栏布局、时间线、帧检查器占位、欢迎对话框 |
| 可并行 | Task 2（类型）和 Task 4（Rust后端）可并行 |
