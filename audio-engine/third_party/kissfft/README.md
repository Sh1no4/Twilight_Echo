# kissfft adapter

本目录保留给 Twilight Audio Engine 的 kissfft 兼容层。当前构建通过 `audio-engine/dsp/KissFftAdapter.*` 暴露 FFT 能力，Convolver 和 FFT Spectrum 统一使用该适配层，后续可直接替换为上游 kissfft 源文件而不改变 DSP 模块接口。
