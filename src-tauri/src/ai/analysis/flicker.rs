use crate::ai::providers::FlickerFrame;

/// 基于亮度差异的闪烁检测
pub fn detect_flicker_simple(
    frames: &[Vec<u8>],
    widths: &[u32],
    heights: &[u32],
) -> Vec<FlickerFrame> {
    let mut results = Vec::new();

    let brightnesses: Vec<f64> = frames.iter().enumerate().map(|(i, data)| {
        let pixel_count = (widths[i] as usize) * (heights[i] as usize);
        let channels = if data.len() >= pixel_count * 4 { 4 } else if data.len() >= pixel_count * 3 { 3 } else { 1 };
        let total: f64 = data.chunks(channels).map(|px| {
            if channels >= 3 {
                (px[0] as f64 * 0.299 + px[1] as f64 * 0.587 + px[2] as f64 * 0.114) / 255.0
            } else {
                px[0] as f64 / 255.0
            }
        }).sum();
        let count = (widths[i] * heights[i]) as f64;
        if count > 0.0 { total / count } else { 0.0 }
    }).collect();

    let avg_brightness: f64 = {
        let sum: f64 = brightnesses.iter().sum();
        let count = brightnesses.len().max(1) as f64;
        sum / count
    };

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
