#include "DsdReader.h"

#include "SacdIsoProbe.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>

namespace twilight::audio {
namespace {

std::string toLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

std::string extensionOf(const std::string& source) {
  const size_t slash = source.find_last_of("/\\");
  const size_t dot = source.find_last_of('.');
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return "";
  return toLower(source.substr(dot + 1));
}

bool readExact(std::ifstream& file, void* data, size_t size) {
  file.read(reinterpret_cast<char*>(data), static_cast<std::streamsize>(size));
  return file.good() || static_cast<size_t>(file.gcount()) == size;
}

uint32_t readLe32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) | (static_cast<uint32_t>(data[1]) << 8) |
         (static_cast<uint32_t>(data[2]) << 16) | (static_cast<uint32_t>(data[3]) << 24);
}

uint64_t readLe64(const uint8_t* data) {
  uint64_t value = 0;
  for (int i = 7; i >= 0; --i) value = (value << 8) | data[i];
  return value;
}

uint32_t readBe32(const uint8_t* data) {
  return (static_cast<uint32_t>(data[0]) << 24) | (static_cast<uint32_t>(data[1]) << 16) |
         (static_cast<uint32_t>(data[2]) << 8) | static_cast<uint32_t>(data[3]);
}

uint64_t readBe64(const uint8_t* data) {
  uint64_t value = 0;
  for (int i = 0; i < 8; ++i) value = (value << 8) | data[i];
  return value;
}

bool readChunkHeaderLe(std::ifstream& file, char id[4], uint64_t* size) {
  uint8_t rawSize[8] = {};
  return readExact(file, id, 4) && readExact(file, rawSize, sizeof(rawSize)) && ((*size = readLe64(rawSize)), true);
}

bool readChunkHeaderBe(std::ifstream& file, char id[4], uint64_t* size) {
  uint8_t rawSize[8] = {};
  return readExact(file, id, 4) && readExact(file, rawSize, sizeof(rawSize)) && ((*size = readBe64(rawSize)), true);
}

bool idEquals(const char id[4], const char* expected) {
  return std::memcmp(id, expected, 4) == 0;
}

uint64_t tell(std::ifstream& file) {
  const auto pos = file.tellg();
  return pos < 0 ? 0 : static_cast<uint64_t>(pos);
}

void skipTo(std::ifstream& file, uint64_t position) {
  file.seekg(static_cast<std::streamoff>(position), std::ios::beg);
}

int dsdRateFromSampleRate(int sampleRate) {
  if (sampleRate >= 22000000) return 512;
  if (sampleRate >= 10000000) return 256;
  if (sampleRate >= 5000000) return 128;
  if (sampleRate >= 2500000) return 64;
  return 0;
}

}  // namespace

bool sourceLooksDsfOrDff(const std::string& source) {
  const std::string ext = extensionOf(source);
  return ext == "dsf" || ext == "dff";
}

bool sourceLooksSacdIso(const std::string& source) {
  return probeSacdIsoEntry(source).isSacdIso();
}

int inferDsdRateFromSampleRate(int sampleRate) {
  return dsdRateFromSampleRate(sampleRate);
}

DsdReader::DsdReader() = default;

DsdReader::~DsdReader() {
  close();
}

bool DsdReader::open(const std::string& source, std::string* error) {
  close();
  info_.source = source;
  if (source.empty()) {
    if (error) *error = "DSD source is empty";
    return false;
  }
  const SacdIsoEntryProbe sacdIso = probeSacdIsoEntry(source);
  if (sacdIso.isSacdIso()) {
    return openSacdIso(source, error);
  }

  file_.open(source, std::ios::binary);
  if (!file_) {
    if (error) *error = "Unable to open DSD source";
    return false;
  }

  const std::string ext = extensionOf(source);
  const bool ok = ext == "dsf" ? openDsf(error) : (ext == "dff" ? openDff(error) : false);
  if (!ok) {
    close();
    return false;
  }
  seek(0.0, nullptr);
  return true;
}

void DsdReader::close() {
  if (file_.is_open()) file_.close();
  sacd_.close();
  info_ = {};
  readOffset_ = 0;
  eof_ = false;
  sacdActive_ = false;
}

bool DsdReader::seek(double seconds, std::string* error) {
  if (sacdActive_) {
    const bool ok = sacd_.seek(seconds, error);
    eof_ = sacd_.eof();
    return ok;
  }
  if (!file_.is_open() || info_.dataOffset == 0) {
    if (error) *error = "DSD reader is not open";
    return false;
  }

  const double clamped = std::max(0.0, seconds);
  uint64_t byteOffset = 0;
  if (info_.durationSeconds > 0.0 && info_.dataSize > 0) {
    const double ratio = std::min(1.0, clamped / info_.durationSeconds);
    byteOffset = static_cast<uint64_t>(static_cast<double>(info_.dataSize) * ratio);
  }
  if (info_.channelCount > 0) {
    byteOffset -= byteOffset % static_cast<uint64_t>(info_.channelCount);
  }
  readOffset_ = std::min(byteOffset, info_.dataSize);
  eof_ = readOffset_ >= info_.dataSize;
  skipTo(file_, info_.dataOffset + readOffset_);
  return true;
}

size_t DsdReader::readBytes(uint8_t* output, size_t maxBytes) {
  if (sacdActive_) {
    const size_t read = sacd_.readBytes(output, maxBytes);
    eof_ = sacd_.eof();
    return read;
  }
  if (!output || maxBytes == 0 || !file_.is_open() || eof_) return 0;
  const uint64_t remaining = info_.dataSize > readOffset_ ? info_.dataSize - readOffset_ : 0;
  const size_t toRead = static_cast<size_t>(std::min<uint64_t>(remaining, maxBytes));
  if (toRead == 0) {
    eof_ = true;
    return 0;
  }
  file_.read(reinterpret_cast<char*>(output), static_cast<std::streamsize>(toRead));
  const size_t read = static_cast<size_t>(std::max<std::streamsize>(0, file_.gcount()));
  readOffset_ += read;
  eof_ = read == 0 || readOffset_ >= info_.dataSize;
  return read;
}

bool DsdReader::eof() const {
  return eof_;
}

const DsdStreamInfo& DsdReader::streamInfo() const {
  return info_;
}

bool DsdReader::openDsf(std::string* error) {
  char id[4] = {};
  uint64_t chunkSize = 0;
  if (!readChunkHeaderLe(file_, id, &chunkSize) || !idEquals(id, "DSD ")) {
    if (error) *error = "Invalid DSF header";
    return false;
  }
  skipTo(file_, chunkSize);

  bool sawFmt = false;
  bool sawData = false;
  while (file_ && !(sawFmt && sawData)) {
    const uint64_t headerStart = tell(file_);
    if (!readChunkHeaderLe(file_, id, &chunkSize)) break;
    const uint64_t payloadStart = tell(file_);
    if (chunkSize < 12) {
      if (error) *error = "Invalid DSF chunk size";
      return false;
    }
    const uint64_t next = headerStart + chunkSize;

    if (idEquals(id, "fmt ")) {
      std::array<uint8_t, 40> fmt{};
      if (!readExact(file_, fmt.data(), fmt.size())) {
        if (error) *error = "Invalid DSF fmt chunk";
        return false;
      }
      const uint32_t channelCount = readLe32(fmt.data() + 12);
      const uint32_t sampleRate = readLe32(fmt.data() + 16);
      const uint64_t sampleCount = readLe64(fmt.data() + 24);
      const uint32_t blockSize = readLe32(fmt.data() + 32);
      info_.container = "DSF";
      info_.channelCount = static_cast<int>(channelCount);
      info_.dsdSampleRate = static_cast<int>(sampleRate);
      info_.dsdRate = dsdRateFromSampleRate(info_.dsdSampleRate);
      info_.bitOrder = DsdBitOrder::LsbFirst;
      info_.packing = DsdPacking::DsfPlanarBlocks;
      info_.blockSizePerChannel = blockSize;
      info_.durationSeconds = sampleRate > 0 ? static_cast<double>(sampleCount) / static_cast<double>(sampleRate) : 0.0;
      sawFmt = true;
    } else if (idEquals(id, "data")) {
      info_.dataOffset = payloadStart;
      info_.dataSize = chunkSize >= 12 ? chunkSize - 12 : 0;
      sawData = true;
    }
    skipTo(file_, next);
  }

  if (!sawFmt || !sawData || info_.channelCount <= 0 || info_.dsdRate <= 0 || info_.dataSize == 0) {
    if (error) *error = "Unsupported or incomplete DSF stream";
    return false;
  }
  return true;
}

bool DsdReader::openDff(std::string* error) {
  char id[4] = {};
  uint64_t formSize = 0;
  char formType[4] = {};
  if (!readChunkHeaderBe(file_, id, &formSize) || !idEquals(id, "FRM8") || !readExact(file_, formType, 4) ||
      !idEquals(formType, "DSD ")) {
    if (error) *error = "Invalid DFF header";
    return false;
  }

  const uint64_t formEnd = 12 + formSize;
  bool sawData = false;
  while (file_ && tell(file_) + 12 <= formEnd) {
    const uint64_t headerStart = tell(file_);
    uint64_t chunkSize = 0;
    if (!readChunkHeaderBe(file_, id, &chunkSize)) break;
    const uint64_t payloadStart = tell(file_);
    const uint64_t next = payloadStart + chunkSize + (chunkSize & 1);

    if (idEquals(id, "PROP")) {
      char propType[4] = {};
      if (!readExact(file_, propType, 4)) break;
      while (file_ && tell(file_) + 12 <= next) {
        uint64_t subSize = 0;
        char subId[4] = {};
        if (!readChunkHeaderBe(file_, subId, &subSize)) break;
        const uint64_t subPayload = tell(file_);
        const uint64_t subNext = subPayload + subSize + (subSize & 1);
        if (idEquals(subId, "FS  ") && subSize >= 4) {
          uint8_t raw[4] = {};
          if (readExact(file_, raw, sizeof(raw))) info_.dsdSampleRate = static_cast<int>(readBe32(raw));
        } else if (idEquals(subId, "CHNL") && subSize >= 2) {
          uint8_t raw[2] = {};
          if (readExact(file_, raw, sizeof(raw))) {
            info_.channelCount = (static_cast<int>(raw[0]) << 8) | static_cast<int>(raw[1]);
          }
        }
        skipTo(file_, subNext);
      }
    } else if (idEquals(id, "DSD ")) {
      info_.dataOffset = payloadStart;
      info_.dataSize = chunkSize;
      sawData = true;
    }
    skipTo(file_, std::max(next, headerStart + 12));
  }

  info_.container = "DFF";
  info_.dsdRate = dsdRateFromSampleRate(info_.dsdSampleRate);
  info_.bitOrder = DsdBitOrder::MsbFirst;
  info_.packing = DsdPacking::DffInterleaved;
  if (info_.dsdSampleRate > 0 && info_.channelCount > 0 && info_.dataSize > 0) {
    info_.durationSeconds =
        static_cast<double>(info_.dataSize * 8) /
        static_cast<double>(info_.dsdSampleRate * static_cast<uint64_t>(info_.channelCount));
  }

  if (!sawData || info_.channelCount <= 0 || info_.dsdRate <= 0 || info_.dataSize == 0) {
    if (error) *error = "Unsupported or incomplete DFF stream";
    return false;
  }
  return true;
}

bool DsdReader::openSacdIso(const std::string& source, std::string* error) {
  if (!sacd_.open(source, error)) return false;
  int trackNumber = 1;
  std::string area;
  const size_t qm = source.find('?');
  if (qm != std::string::npos) {
    const std::string query = source.substr(qm + 1);
    size_t start = 0;
    while (start <= query.size()) {
      const size_t amp = query.find('&', start);
      const std::string pair = query.substr(start, amp == std::string::npos ? std::string::npos : amp - start);
      const size_t eq = pair.find('=');
      const std::string key = eq == std::string::npos ? pair : pair.substr(0, eq);
      const std::string value = eq == std::string::npos ? "" : pair.substr(eq + 1);
      if (key == "track") {
        try {
          trackNumber = std::stoi(value);
        } catch (...) {
          trackNumber = 1;
        }
      } else if (key == "area") {
        area = value;
      }
      if (amp == std::string::npos) break;
      start = amp + 1;
    }
  }
  if (!sacd_.selectTrack(area, trackNumber, error)) {
    sacd_.close();
    return false;
  }
  const AudioStreamInfo& stream = sacd_.streamInfo();
  info_.source = source;
  info_.container = "SACD ISO";
  info_.channelCount = stream.sourceFormat.channelCount;
  info_.dsdSampleRate = stream.sourceFormat.sampleRate;
  info_.dsdRate = stream.dsdRate > 0 ? stream.dsdRate : dsdRateFromSampleRate(info_.dsdSampleRate);
  info_.bitOrder = DsdBitOrder::MsbFirst;
  info_.packing = DsdPacking::DffInterleaved;
  info_.durationSeconds = stream.durationSeconds;
  const auto& tracks = sacd_.tracks();
  const auto selected = std::find_if(tracks.begin(), tracks.end(), [&](const SacdIsoTrackInfo& track) {
    return track.trackNumber == trackNumber && (area.empty() || track.area == area);
  });
  if (selected != tracks.end()) {
    info_.dataOffset = selected->dataOffset;
    info_.dataSize = selected->dataSize;
  }
  sacdActive_ = true;
  eof_ = sacd_.eof();
  return info_.channelCount > 0 && info_.dsdSampleRate > 0 && info_.dataSize > 0;
}

}  // namespace twilight::audio
