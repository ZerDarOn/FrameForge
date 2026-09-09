use crate::ai::providers::FrameDisplacement;

/// 加载帧并解码为 RGBA 字节
pub fn load_frame_rgba(path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let data = std::fs::read(path).map_err(|e| format!("读取帧失败: {}", e))?;
    let img = image::load_from_memory(&data).map_err(|e| format!("解码帧失败: {}", e))?;
    let rgba = img.to_rgba8();
    let dimensions = rgba.dimensions();
    Ok((rgba.into_raw(), dimensions.0, dimensions.1))
}

/// 检测相邻两帧间的位移（逐对调用，无需全量数据）
pub fn detect_displacement_pair(
    frame_a: &[u8],
    width_a: u32,
    height_a: u32,
    frame_b: &[u8],
    width_b: u32,
    height_b: u32,
    frame_index: i64,
) -> FrameDisplacement {
    let (dx, dy) = estimate_shift(frame_a, width_a, height_a, frame_b, width_b, height_b);
    let magnitude = (dx * dx + dy * dy).sqrt();
    let severity = if magnitude > 3.0 {
        "high"
    } else if magnitude > 1.0 {
        "medium"
    } else {
        "low"
    };
    FrameDisplacement {
        frame_index,
        dx,
        dy,
        magnitude,
        severity: severity.to_string(),
    }
}

/// 基于像素差的简易位移检测（保留原签名兼容性）
pub fn detect_displacement_simple(
    frames: &[Vec<u8>],
    widths: &[u32],
    heights: &[u32],
) -> Vec<FrameDisplacement> {
    let mut results = Vec::new();
    for i in 1..frames.len() {
        results.push(detect_displacement_pair(
            &frames[i - 1],
            widths[i - 1],
            heights[i - 1],
            &frames[i],
            widths[i],
            heights[i],
            i as i64,
        ));
    }
    results
}

/// 使用 alpha 加权特征的均方误差估计两帧间位移
fn estimate_shift(img1: &[u8], w1: u32, h1: u32, img2: &[u8], w2: u32, h2: u32) -> (f64, f64) {
    let feature1 = to_alignment_feature(img1, w1, h1);
    let feature2 = to_alignment_feature(img2, w2, h2);

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
            let mut squared_error = 0.0f64;
            let mut count = 0u32;

            for by in -half_block..half_block {
                for bx in -half_block..half_block {
                    let x1 = cx + bx;
                    let y1 = cy + by;
                    if x1 < 0 || y1 < 0 || x1 >= w1 as i32 || y1 >= h1 as i32 {
                        continue;
                    }
                    let x2 = x1 + dx;
                    let y2 = y1 + dy;
                    let v1 = feature1[y1 as usize * w1 as usize + x1 as usize];
                    let v2 = if x2 >= 0 && y2 >= 0 && x2 < w2 as i32 && y2 < h2 as i32 {
                        feature2[y2 as usize * w2 as usize + x2 as usize]
                    } else {
                        0.0
                    };
                    let difference = v1 - v2;
                    squared_error += difference * difference;
                    count += 1;
                }
            }

            if count > 0 {
                let score = -(squared_error / count as f64);
                let candidate_distance = dx * dx + dy * dy;
                let best_distance =
                    best_dx as i32 * best_dx as i32 + best_dy as i32 * best_dy as i32;
                if score > best_score + f64::EPSILON
                    || ((score - best_score).abs() <= f64::EPSILON
                        && candidate_distance < best_distance)
                {
                    best_score = score;
                    best_dx = dx as f64;
                    best_dy = dy as f64;
                }
            }
        }
    }

    (best_dx, best_dy)
}

fn to_alignment_feature(data: &[u8], width: u32, height: u32) -> Vec<f64> {
    let pixel_count = (width as usize) * (height as usize);
    let channels = if data.len() >= pixel_count * 4 {
        4
    } else if data.len() >= pixel_count * 3 {
        3
    } else {
        1
    };
    data.chunks(channels)
        .map(|px| {
            if channels >= 3 {
                let luminance =
                    (px[0] as f64 * 0.299 + px[1] as f64 * 0.587 + px[2] as f64 * 0.114) / 255.0;
                let alpha = if channels == 4 {
                    px[3] as f64 / 255.0
                } else {
                    1.0
                };
                alpha * (0.25 + luminance * 0.75)
            } else {
                px[0] as f64 / 255.0
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::estimate_shift;

    fn transparent_rgba(width: u32, height: u32) -> Vec<u8> {
        vec![0; width as usize * height as usize * 4]
    }

    fn fill_square(image: &mut [u8], width: u32, left: u32, top: u32, size: u32) {
        for y in top..top + size {
            for x in left..left + size {
                let offset = (y as usize * width as usize + x as usize) * 4;
                image[offset..offset + 4].copy_from_slice(&[0, 0, 0, 255]);
            }
        }
    }

    #[test]
    fn transparent_frames_do_not_report_a_search_boundary_shift() {
        let mut first = transparent_rgba(32, 32);
        let mut second = transparent_rgba(32, 32);
        for pixel in first.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[255, 0, 0, 0]);
        }
        for pixel in second.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[0, 255, 0, 0]);
        }
        assert_eq!(estimate_shift(&first, 32, 32, &second, 32, 32), (0.0, 0.0),);
    }

    #[test]
    fn opaque_shape_translation_is_detected_through_transparency() {
        let mut first = transparent_rgba(40, 40);
        let mut second = transparent_rgba(40, 40);
        fill_square(&mut first, 40, 12, 14, 8);
        fill_square(&mut second, 40, 15, 12, 8);

        assert_eq!(estimate_shift(&first, 40, 40, &second, 40, 40), (3.0, -2.0),);
    }
}
