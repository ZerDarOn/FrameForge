use crate::ai::providers::FlickerFrame;

/// 从 RGBA 像素数据计算亮度值（单帧）
pub fn compute_brightness(data: &[u8], width: u32, height: u32) -> f64 {
    let Some(pixel_count) = (width as usize).checked_mul(height as usize) else {
        return 0.0;
    };
    if pixel_count == 0 {
        return 0.0;
    }
    let channels = if data.len() >= pixel_count.saturating_mul(4) {
        4
    } else if data.len() >= pixel_count.saturating_mul(3) {
        3
    } else if data.len() >= pixel_count {
        1
    } else {
        return 0.0;
    };
    let total: f64 = data
        .chunks_exact(channels)
        .take(pixel_count)
        .map(|px| {
            if channels >= 3 {
                let luminance =
                    (px[0] as f64 * 0.299 + px[1] as f64 * 0.587 + px[2] as f64 * 0.114) / 255.0;
                if channels == 4 {
                    let alpha = px[3] as f64 / 255.0;
                    alpha * (0.25 + luminance * 0.75)
                } else {
                    luminance
                }
            } else {
                px[0] as f64 / 255.0
            }
        })
        .sum();
    total / pixel_count as f64
}

/// 基于预计算的亮度值序列检测闪烁（无需全帧数据）
pub fn detect_flicker_from_brightnesses(brightnesses: &[f64]) -> Vec<FlickerFrame> {
    let mut results = Vec::new();

    let avg_brightness: f64 = {
        let sum: f64 = brightnesses.iter().sum();
        let count = brightnesses.len().max(1) as f64;
        sum / count
    };

    for i in 1..brightnesses.len() {
        let diff = (brightnesses[i] - brightnesses[i - 1]).abs();
        let relative_diff = if avg_brightness > 0.0 {
            diff / avg_brightness
        } else {
            0.0
        };

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

/// 基于亮度差异的闪烁检测（保留原签名，内部委托给流式版本）
pub fn detect_flicker_simple(
    frames: &[Vec<u8>],
    widths: &[u32],
    heights: &[u32],
) -> Vec<FlickerFrame> {
    let brightnesses: Vec<f64> = frames
        .iter()
        .enumerate()
        .map(|(i, data)| compute_brightness(data, widths[i], heights[i]))
        .collect();

    detect_flicker_from_brightnesses(&brightnesses)
}

#[cfg(test)]
mod tests {
    use super::{compute_brightness, detect_flicker_from_brightnesses};

    #[test]
    fn transparent_hidden_rgb_does_not_affect_visible_brightness() {
        let red = [255, 0, 0, 0];
        let green = [0, 255, 0, 0];
        assert_eq!(compute_brightness(&red, 1, 1), 0.0);
        assert_eq!(compute_brightness(&green, 1, 1), 0.0);
        assert_eq!(
            detect_flicker_from_brightnesses(&[
                compute_brightness(&red, 1, 1),
                compute_brightness(&green, 1, 1),
            ])[0]
                .severity,
            "low",
        );
    }

    #[test]
    fn opaque_black_pixels_remain_visible_to_flicker_detection() {
        let transparent = [0, 0, 0, 0];
        let black = [0, 0, 0, 255];
        assert!(compute_brightness(&black, 1, 1) > 0.0);
        assert_eq!(
            detect_flicker_from_brightnesses(&[
                compute_brightness(&black, 1, 1),
                compute_brightness(&transparent, 1, 1),
            ])[0]
                .severity,
            "high",
        );
    }
}
