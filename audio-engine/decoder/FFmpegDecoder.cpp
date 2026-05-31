#include "FFmpegDecoder.h"

#include <algorithm>
#include <cstring>
#include <vector>

#if defined(TAE_HAS_FFMPEG)
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}
#endif

namespace twilight::audio {

struct FFmpegDecoder::Impl {
  AudioStreamInfo streamInfo;
  AudioFormat outputFormat;
  bool eof = false;

#if defined(TAE_HAS_FFMPEG)
  AVFormatContext* formatContext = nullptr;
  AVCodecContext* codecContext = nullptr;
  AVPacket* packet = nullptr;
  AVFrame* frame = nullptr;
  SwrContext* swr = nullptr;
  int audioStreamIndex = -1;
  bool inputEof = false;
  std::vector<float> pending;
  size_t pendingFrameOffset = 0;
  AVChannelLayout targetLayout{};

  static std::string avError(int code) {
    char buffer[AV_ERROR_MAX_STRING_SIZE] = {};
    av_strerror(code, buffer, sizeof(buffer));
    return buffer;
  }

  void resetPending() {
    pending.clear();
    pendingFrameOffset = 0;
  }

  void close() {
    if (swr) {
      swr_free(&swr);
    }
    av_channel_layout_uninit(&targetLayout);
    if (frame) {
      av_frame_free(&frame);
    }
    if (packet) {
      av_packet_free(&packet);
    }
    if (codecContext) {
      avcodec_free_context(&codecContext);
    }
    if (formatContext) {
      avformat_close_input(&formatContext);
    }
    audioStreamIndex = -1;
    inputEof = false;
    eof = false;
    resetPending();
    streamInfo = {};
    outputFormat = {};
  }

  bool convertFrame(std::string* error) {
    if (!swr) {
      if (error) *error = "解码重采样器尚未初始化";
      return false;
    }

    const int channels = std::max(1, outputFormat.channelCount);
    const int outSamples = static_cast<int>(av_rescale_rnd(
        swr_get_delay(swr, codecContext->sample_rate) + frame->nb_samples,
        outputFormat.sampleRate,
        codecContext->sample_rate,
        AV_ROUND_UP));
    if (outSamples <= 0) return true;

    std::vector<float> converted(static_cast<size_t>(outSamples) * static_cast<size_t>(channels));
    uint8_t* outData[] = {reinterpret_cast<uint8_t*>(converted.data())};
    const int actualSamples = swr_convert(
        swr,
        outData,
        outSamples,
        const_cast<const uint8_t**>(frame->extended_data),
        frame->nb_samples);
    if (actualSamples < 0) {
      if (error) *error = "解码重采样失败，错误码：" + std::to_string(actualSamples);
      return false;
    }

    converted.resize(static_cast<size_t>(actualSamples) * static_cast<size_t>(channels));
    pending.insert(pending.end(), converted.begin(), converted.end());
    return true;
  }

  bool decodeOneFrame(std::string* error) {
    resetPending();

    while (true) {
      int ret = avcodec_receive_frame(codecContext, frame);
      if (ret == 0) {
        const bool ok = convertFrame(error);
        av_frame_unref(frame);
        return ok && !pending.empty();
      }
      if (ret == AVERROR_EOF) {
        eof = true;
        return false;
      }
      if (ret != AVERROR(EAGAIN)) {
        if (error) *error = "解码器接收音频帧失败，错误码：" + std::to_string(ret);
        eof = true;
        return false;
      }

      if (inputEof) {
        ret = avcodec_send_packet(codecContext, nullptr);
        if (ret == AVERROR_EOF) {
          eof = true;
          return false;
        }
        if (ret < 0 && ret != AVERROR(EAGAIN)) {
          if (error) *error = "解码器收尾失败，错误码：" + std::to_string(ret);
          eof = true;
          return false;
        }
        continue;
      }

      ret = av_read_frame(formatContext, packet);
      if (ret < 0) {
        inputEof = true;
        continue;
      }

      if (packet->stream_index == audioStreamIndex) {
        ret = avcodec_send_packet(codecContext, packet);
        av_packet_unref(packet);
        if (ret < 0 && ret != AVERROR(EAGAIN)) {
          if (error) *error = "解码器提交音频包失败，错误码：" + std::to_string(ret);
          eof = true;
          return false;
        }
      } else {
        av_packet_unref(packet);
      }
    }
  }
#else
  void close() {
    streamInfo = {};
    outputFormat = {};
    eof = false;
  }
#endif
};

FFmpegDecoder::FFmpegDecoder() : impl_(std::make_unique<Impl>()) {}

FFmpegDecoder::~FFmpegDecoder() {
  close();
}

bool FFmpegDecoder::open(const std::string& source, std::string* error) {
  close();

#if defined(TAE_HAS_FFMPEG)
  int ret = avformat_open_input(&impl_->formatContext, source.c_str(), nullptr, nullptr);
  if (ret < 0) {
    if (error) *error = "打开音频失败，错误码：" + std::to_string(ret);
    return false;
  }

  ret = avformat_find_stream_info(impl_->formatContext, nullptr);
  if (ret < 0) {
    if (error) *error = "解析音频信息失败，错误码：" + std::to_string(ret);
    return false;
  }

  ret = av_find_best_stream(impl_->formatContext, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
  if (ret < 0) {
    if (error) *error = "未找到音频流";
    return false;
  }
  impl_->audioStreamIndex = ret;

  AVStream* stream = impl_->formatContext->streams[impl_->audioStreamIndex];
  const AVCodecParameters* params = stream->codecpar;
  const AVCodec* codec = avcodec_find_decoder(params->codec_id);
  if (!codec) {
    if (error) *error = "当前音频格式没有可用解码器";
    return false;
  }

  impl_->codecContext = avcodec_alloc_context3(codec);
  if (!impl_->codecContext) {
    if (error) *error = "无法分配解码器上下文";
    return false;
  }

  ret = avcodec_parameters_to_context(impl_->codecContext, params);
  if (ret < 0) {
    if (error) *error = "无法读取解码参数，错误码：" + std::to_string(ret);
    return false;
  }

  ret = avcodec_open2(impl_->codecContext, codec, nullptr);
  if (ret < 0) {
    if (error) *error = "无法打开解码器，错误码：" + std::to_string(ret);
    return false;
  }

  impl_->packet = av_packet_alloc();
  impl_->frame = av_frame_alloc();
  if (!impl_->packet || !impl_->frame) {
    if (error) *error = "无法分配解码缓冲";
    return false;
  }

  const int channels = std::max(1, impl_->codecContext->ch_layout.nb_channels);
  const int rawBitDepth = params->bits_per_raw_sample > 0 ? params->bits_per_raw_sample : 0;
  const int sampleBitDepth = av_get_bytes_per_sample(impl_->codecContext->sample_fmt) * 8;

  impl_->streamInfo.source = source;
  impl_->streamInfo.codec = codec->name ? codec->name : "未知";
  impl_->streamInfo.bitrate =
      params->bit_rate > 0 ? params->bit_rate : impl_->formatContext->bit_rate;
  impl_->streamInfo.sourceFormat.sampleRate = impl_->codecContext->sample_rate;
  impl_->streamInfo.sourceFormat.channelCount = channels;
  impl_->streamInfo.sourceFormat.bitDepth = rawBitDepth > 0 ? rawBitDepth : sampleBitDepth;
  impl_->streamInfo.sourceFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
  impl_->streamInfo.isDsd = impl_->streamInfo.codec.rfind("dsd", 0) == 0;

  if (stream->duration != AV_NOPTS_VALUE) {
    impl_->streamInfo.durationSeconds = static_cast<double>(stream->duration) * av_q2d(stream->time_base);
  } else if (impl_->formatContext->duration != AV_NOPTS_VALUE) {
    impl_->streamInfo.durationSeconds =
        static_cast<double>(impl_->formatContext->duration) / static_cast<double>(AV_TIME_BASE);
  }

  AudioFormat defaultOutput = impl_->streamInfo.sourceFormat;
  defaultOutput.bitDepth = 32;
  return setOutputFormat(defaultOutput, error);
#else
  (void)source;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

void FFmpegDecoder::close() {
  impl_->close();
}

bool FFmpegDecoder::setOutputFormat(const AudioFormat& format, std::string* error) {
#if defined(TAE_HAS_FFMPEG)
  if (!impl_->codecContext) {
    if (error) *error = "解码器尚未打开";
    return false;
  }
  if (format.sampleRate <= 0 || format.channelCount <= 0) {
    if (error) *error = "请求的输出格式无效";
    return false;
  }

  if (impl_->swr) {
    swr_free(&impl_->swr);
  }
  av_channel_layout_uninit(&impl_->targetLayout);
  av_channel_layout_default(&impl_->targetLayout, format.channelCount);

  int ret = swr_alloc_set_opts2(
      &impl_->swr,
      &impl_->targetLayout,
      AV_SAMPLE_FMT_FLT,
      format.sampleRate,
      &impl_->codecContext->ch_layout,
      impl_->codecContext->sample_fmt,
      impl_->codecContext->sample_rate,
      0,
      nullptr);
  if (ret < 0 || !impl_->swr) {
    if (error) *error = "无法分配解码重采样器";
    return false;
  }

  ret = swr_init(impl_->swr);
  if (ret < 0) {
    if (error) *error = "无法初始化解码重采样器，错误码：" + std::to_string(ret);
    return false;
  }

  impl_->outputFormat = format;
  impl_->outputFormat.bitDepth = 32;
  impl_->outputFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
  impl_->resetPending();
  return true;
#else
  (void)format;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

size_t FFmpegDecoder::readFrames(float* output, size_t frameCount, std::string* error) {
  if (!output || frameCount == 0) return 0;
  std::fill(output, output + frameCount * static_cast<size_t>(std::max(1, impl_->outputFormat.channelCount)), 0.0f);

#if defined(TAE_HAS_FFMPEG)
  if (!impl_->codecContext || !impl_->swr) return 0;

  const size_t channels = static_cast<size_t>(std::max(1, impl_->outputFormat.channelCount));
  size_t copiedFrames = 0;

  while (copiedFrames < frameCount) {
    const size_t pendingFrames =
        impl_->pending.size() / channels > impl_->pendingFrameOffset
            ? impl_->pending.size() / channels - impl_->pendingFrameOffset
            : 0;
    if (pendingFrames == 0) {
      if (!impl_->decodeOneFrame(error)) break;
      continue;
    }

    const size_t toCopy = std::min(frameCount - copiedFrames, pendingFrames);
    const size_t srcOffset = impl_->pendingFrameOffset * channels;
    const size_t dstOffset = copiedFrames * channels;
    std::memcpy(output + dstOffset, impl_->pending.data() + srcOffset, toCopy * channels * sizeof(float));

    impl_->pendingFrameOffset += toCopy;
    copiedFrames += toCopy;
    if (impl_->pendingFrameOffset >= impl_->pending.size() / channels) {
      impl_->resetPending();
    }
  }

  return copiedFrames;
#else
  (void)error;
  return 0;
#endif
}

bool FFmpegDecoder::seek(double seconds, std::string* error) {
#if defined(TAE_HAS_FFMPEG)
  if (!impl_->formatContext || impl_->audioStreamIndex < 0) return false;
  AVStream* stream = impl_->formatContext->streams[impl_->audioStreamIndex];
  const int64_t timestamp = static_cast<int64_t>(seconds / av_q2d(stream->time_base));
  const int ret = av_seek_frame(impl_->formatContext, impl_->audioStreamIndex, timestamp, AVSEEK_FLAG_BACKWARD);
  if (ret < 0) {
    if (error) *error = "音频跳转失败，错误码：" + std::to_string(ret);
    return false;
  }
  avcodec_flush_buffers(impl_->codecContext);
  impl_->inputEof = false;
  impl_->eof = false;
  impl_->resetPending();
  return true;
#else
  (void)seconds;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

bool FFmpegDecoder::eof() const {
  return impl_->eof;
}

const AudioStreamInfo& FFmpegDecoder::streamInfo() const {
  return impl_->streamInfo;
}

const AudioFormat& FFmpegDecoder::outputFormat() const {
  return impl_->outputFormat;
}

}  // namespace twilight::audio
