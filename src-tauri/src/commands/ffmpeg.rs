use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

const FFMPEG_DIRECTORY_ENV: &str = "FRAMEFORGE_FFMPEG_DIR";

pub fn resolve_ffmpeg_tool(tool_name: &str) -> Result<PathBuf, String> {
    let executable_name = if cfg!(windows) {
        format!("{}.exe", tool_name)
    } else {
        tool_name.to_string()
    };
    if let Ok(directory) = std::env::var(FFMPEG_DIRECTORY_ENV) {
        let candidate = PathBuf::from(directory).join(&executable_name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let path_candidate = PathBuf::from(&executable_name);
    let available_on_path = Command::new(&path_candidate)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if available_on_path {
        return Ok(path_candidate);
    }

    Err(format!(
        "未找到 {}。请安装 FFmpeg，并将 {} 设置为包含 ffmpeg 与 ffprobe 的目录",
        tool_name, FFMPEG_DIRECTORY_ENV
    ))
}
