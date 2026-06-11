//! Synapse 向量引擎 — fast-hnsw（纯 Rust，零 C 依赖）+ N-API 绑定
//!
//! 导出:
//!   - VectorIndex::new(dim)              → 创建索引
//!   - VectorIndex::add(vector) → key     → 写入向量，返回自增 key
//!   - VectorIndex::search(vector, k, ef) → 检索 top-K
//!   - VectorIndex::save(path)            → 持久化
//!   - VectorIndex::load(path, dim)       → 从文件加载
//!   - VectorIndex::size()                → 索引大小

use fast_hnsw::distance::Cosine;
use fast_hnsw::{Builder, Hnsw};
use napi_derive::napi;
use std::sync::Mutex;

/// HNSW 向量索引（余弦距离）
#[napi]
pub struct VectorIndex {
    inner: Mutex<Hnsw<Cosine>>,
}

#[napi]
impl VectorIndex {
    /// 创建新索引
    #[napi(constructor)]
    pub fn new() -> napi::Result<Self> {
        let index: Hnsw<Cosine> = Builder::new()
            .m(16)
            .ef_construction(200)
            .seed(0)
            .build(Cosine);

        Ok(VectorIndex {
            inner: Mutex::new(index),
        })
    }

    /// 写入向量，返回自增 key（u32 足够个人使用场景）
    #[napi]
    pub fn add(&self, vector: Vec<f64>) -> napi::Result<u32> {
        let vec_f32: Vec<f32> = vector.into_iter().map(|v| v as f32).collect();
        let mut index = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock: {}", e)))?;
        let key = index.insert(vec_f32);
        Ok(key as u32)
    }

    /// 检索 top-K 最相似向量
    /// @returns Array<{ key: number, distance: number }>
    #[napi]
    pub fn search(&self, vector: Vec<f64>, k: u32) -> napi::Result<Vec<SearchResult>> {
        let vec_f32: Vec<f32> = vector.into_iter().map(|v| v as f32).collect();
        let index = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock: {}", e)))?;

        let results = index.search(&vec_f32, k as usize, k as usize * 2);

        Ok(results
            .into_iter()
            .map(|r| SearchResult {
                key: r.id as u32,
                distance: r.distance as f64,
            })
            .collect())
    }

    /// 持久化到文件
    #[napi]
    pub fn save(&self, path: String) -> napi::Result<()> {
        let index = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock: {}", e)))?;
        fast_hnsw::persist::save(&*index, &path)
            .map_err(|e| napi::Error::from_reason(format!("save: {}", e)))
    }

    /// 从文件加载（模块级函数，非实例方法）
    #[napi]
    pub fn load_from_file(path: String) -> napi::Result<Self> {
        let index: Hnsw<Cosine> = fast_hnsw::persist::load(&path, Cosine)
            .map_err(|e| napi::Error::from_reason(format!("load: {}", e)))?;

        Ok(VectorIndex {
            inner: Mutex::new(index),
        })
    }

    /// 索引大小
    #[napi]
    pub fn size(&self) -> napi::Result<u32> {
        let index = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock: {}", e)))?;
        Ok(index.len() as u32)
    }
}

/// 检索结果
#[napi(object)]
pub struct SearchResult {
    pub key: u32,
    pub distance: f64,
}
