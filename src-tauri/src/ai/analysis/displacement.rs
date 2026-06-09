use crate::ai::providers::FrameDisplacement;

/// 基于像素差的简易位移检测（MVP 版本）
/// 通过 NCC（归一化互相关）比较相邻帧来估计位移
pub fn detect_displacement_simple(
    frames: &[Vec<u8>],
    widths: &[u32],
    heights: &[u32],
) -> Vec<FrameDisplacement> {
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

/// 使用 NCC 估计两帧间的位移
fn estimate_shift(
    img1: &[u8], w1: u32, h1: u32,
    img2: &[u8], w2: u32, h2: u32,
) -> (f64, f64) {
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

fn to_gray(data: &[u8], width: u32, height: u32) -> Vec<f64> {
    let pixel_count = (width as usize) * (height as usize);
    let channels = if data.len() >= pixel_count * 4 { 4 } else if data.len() >= pixel_count * 3 { 3 } else { 1 };
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
