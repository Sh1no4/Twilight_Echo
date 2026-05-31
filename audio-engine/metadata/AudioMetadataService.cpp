#include "AudioMetadataService.h"

#include "AudioMetadataTypes.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <optional>
#include <sstream>
#include <vector>

#if defined(TAE_HAS_FFMPEG)
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/dict.h>
}
#endif

namespace twilight::audio {
namespace {

std::string escapeJson(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char ch : value) {
    switch (ch) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

std::string toUpper(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::toupper(ch));
  });
  return value;
}

std::optional<double> parseGainDb(const char* rawValue, bool r128) {
  if (!rawValue) return std::nullopt;
  std::string value(rawValue);
  value.erase(value.begin(), std::find_if(value.begin(), value.end(), [](unsigned char ch) {
                return !std::isspace(ch);
              }));
  value.erase(std::find_if(value.rbegin(), value.rend(), [](unsigned char ch) {
                return !std::isspace(ch);
              }).base(),
              value.end());
  if (value.empty()) return std::nullopt;

  std::string lower = value;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });

  char* end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);
  if (end == value.c_str()) return std::nullopt;
  if (r128 && lower.find("db") == std::string::npos) return parsed / 256.0;
  return parsed;
}

void assignMetadataField(AudioMetadata* metadata, const std::string& key, const char* value) {
  if (!metadata || !value) return;
  if (key == "TITLE") metadata->title = value;
  if (key == "ARTIST") metadata->artist = value;
  if (key == "ALBUM") metadata->album = value;
  if (key == "ALBUMARTIST" || key == "ALBUM_ARTIST") metadata->albumArtist = value;
  if (key == "COMPOSER") metadata->composer = value;
  if (key == "DATE" || key == "YEAR") metadata->year = value;
  if (key == "GENRE") metadata->genre = value;
  if (key == "TRACK" || key == "TRACKNUMBER") metadata->trackNumber = value;
  if (key == "DISC" || key == "DISCNUMBER") metadata->discNumber = value;
  if (key == "COMMENT" || key == "DESCRIPTION") metadata->comment = value;

  if (key == "REPLAYGAIN_TRACK_GAIN") metadata->replayGain.trackGainDb = parseGainDb(value, false);
  if (key == "REPLAYGAIN_ALBUM_GAIN") metadata->replayGain.albumGainDb = parseGainDb(value, false);
  if (key == "R128_TRACK_GAIN") metadata->replayGain.r128TrackGainDb = parseGainDb(value, true);
  if (key == "R128_ALBUM_GAIN") metadata->replayGain.r128AlbumGainDb = parseGainDb(value, true);
}

#if defined(TAE_HAS_FFMPEG)
void readDictionary(AVDictionary* dictionary, AudioMetadata* metadata) {
  if (!dictionary || !metadata) return;
  const AVDictionaryEntry* entry = nullptr;
  while ((entry = av_dict_get(dictionary, "", entry, AV_DICT_IGNORE_SUFFIX)) != nullptr) {
    assignMetadataField(metadata, toUpper(entry->key ? entry->key : ""), entry->value);
  }
}

std::string base64Encode(const uint8_t* data, size_t size) {
  static constexpr char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((size + 2) / 3) * 4);
  for (size_t i = 0; i < size; i += 3) {
    const uint32_t b0 = data[i];
    const uint32_t b1 = i + 1 < size ? data[i + 1] : 0;
    const uint32_t b2 = i + 2 < size ? data[i + 2] : 0;
    const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
    out.push_back(alphabet[(triple >> 18) & 0x3f]);
    out.push_back(alphabet[(triple >> 12) & 0x3f]);
    out.push_back(i + 1 < size ? alphabet[(triple >> 6) & 0x3f] : '=');
    out.push_back(i + 2 < size ? alphabet[triple & 0x3f] : '=');
  }
  return out;
}

std::string coverMimeForCodec(AVCodecID codecId) {
  if (codecId == AV_CODEC_ID_PNG) return "image/png";
  if (codecId == AV_CODEC_ID_MJPEG) return "image/jpeg";
  if (codecId == AV_CODEC_ID_GIF) return "image/gif";
  if (codecId == AV_CODEC_ID_BMP) return "image/bmp";
  return "application/octet-stream";
}

struct FormatContextHandle {
  AVFormatContext* context = nullptr;
  ~FormatContextHandle() {
    if (context) avformat_close_input(&context);
  }
};
#endif

std::string optionalNumber(std::optional<double> value) {
  if (!value) return "null";
  std::ostringstream out;
  out << *value;
  return out.str();
}

std::string metadataToJson(const AudioMetadata& metadata, const std::string& error = {}) {
  std::ostringstream json;
  json << "{"
       << "\"source\":\"" << escapeJson(metadata.source) << "\","
       << "\"title\":\"" << escapeJson(metadata.title) << "\","
       << "\"artist\":\"" << escapeJson(metadata.artist) << "\","
       << "\"album\":\"" << escapeJson(metadata.album) << "\","
       << "\"albumArtist\":\"" << escapeJson(metadata.albumArtist) << "\","
       << "\"composer\":\"" << escapeJson(metadata.composer) << "\","
       << "\"year\":\"" << escapeJson(metadata.year) << "\","
       << "\"genre\":\"" << escapeJson(metadata.genre) << "\","
       << "\"trackNumber\":\"" << escapeJson(metadata.trackNumber) << "\","
       << "\"discNumber\":\"" << escapeJson(metadata.discNumber) << "\","
       << "\"comment\":\"" << escapeJson(metadata.comment) << "\","
       << "\"codec\":\"" << escapeJson(metadata.codec) << "\","
       << "\"sampleRate\":" << metadata.sampleRate << ","
       << "\"bitDepth\":" << metadata.bitDepth << ","
       << "\"bitrate\":" << metadata.bitrate << ","
       << "\"duration\":" << metadata.durationSeconds << ","
       << "\"coverMime\":\"" << escapeJson(metadata.coverMime) << "\","
       << "\"coverDataBase64\":\"" << escapeJson(metadata.coverDataBase64) << "\","
       << "\"replayGainTrackGain\":" << optionalNumber(metadata.replayGain.trackGainDb) << ","
       << "\"replayGainAlbumGain\":" << optionalNumber(metadata.replayGain.albumGainDb) << ","
       << "\"r128TrackGain\":" << optionalNumber(metadata.replayGain.r128TrackGainDb) << ","
       << "\"r128AlbumGain\":" << optionalNumber(metadata.replayGain.r128AlbumGainDb) << ","
       << "\"error\":\"" << escapeJson(error) << "\""
       << "}";
  return json.str();
}

}  // namespace

std::string readMetadataJson(const std::string& source) {
  AudioMetadata metadata;
  metadata.source = source;
  if (source.empty()) return metadataToJson(metadata, "音频地址为空");

#if defined(TAE_HAS_FFMPEG)
  FormatContextHandle handle;
  if (avformat_open_input(&handle.context, source.c_str(), nullptr, nullptr) < 0 || !handle.context) {
    return metadataToJson(metadata, "无法打开音频文件");
  }
  if (avformat_find_stream_info(handle.context, nullptr) < 0) {
    return metadataToJson(metadata, "无法读取音频流信息");
  }

  readDictionary(handle.context->metadata, &metadata);
  metadata.durationSeconds =
      handle.context->duration != AV_NOPTS_VALUE
          ? static_cast<double>(handle.context->duration) / static_cast<double>(AV_TIME_BASE)
          : 0.0;
  metadata.bitrate = handle.context->bit_rate;

  for (unsigned int i = 0; i < handle.context->nb_streams; ++i) {
    AVStream* stream = handle.context->streams[i];
    if (!stream || !stream->codecpar) continue;
    readDictionary(stream->metadata, &metadata);
    if (stream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO && metadata.sampleRate == 0) {
      const AVCodecDescriptor* descriptor = avcodec_descriptor_get(stream->codecpar->codec_id);
      metadata.codec = descriptor && descriptor->name ? descriptor->name : "";
      metadata.sampleRate = stream->codecpar->sample_rate;
      metadata.bitDepth = stream->codecpar->bits_per_raw_sample > 0
                              ? stream->codecpar->bits_per_raw_sample
                              : stream->codecpar->bits_per_coded_sample;
      if (stream->codecpar->bit_rate > 0) metadata.bitrate = stream->codecpar->bit_rate;
    }
    if ((stream->disposition & AV_DISPOSITION_ATTACHED_PIC) != 0 && stream->attached_pic.data &&
        stream->attached_pic.size > 0 && metadata.coverDataBase64.empty()) {
      metadata.coverMime = coverMimeForCodec(stream->codecpar->codec_id);
      metadata.coverDataBase64 =
          base64Encode(stream->attached_pic.data, static_cast<size_t>(stream->attached_pic.size));
    }
  }
  return metadataToJson(metadata);
#else
  return metadataToJson(metadata, "当前构建未启用元数据读取支持");
#endif
}

}  // namespace twilight::audio
