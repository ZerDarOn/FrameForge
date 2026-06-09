pub mod providers;
pub mod analysis;
pub mod config;

use config::AiConfigState;
use std::sync::Mutex;

pub type AiConfig = Mutex<AiConfigState>;
