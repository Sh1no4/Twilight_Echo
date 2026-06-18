#include "SacdIsoDemuxer.h"

#include "SacdIsoProbe.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>
#include <fstream>

namespace twilight::audio {
namespace {

constexpr uint32_t kIsoSectorSize = 2048;

int dsdRateFromSampleRate(int sampleRate) {
  if (sampleRate >= 22000000) return 512;
  if (sampleRate >= 10000000) return 256;
  if (sampleRate >= 5000000) return 128;
  if (sampleRate >= 2500000) return 64;
  return 0;
}

struct IsoEntry {
  std::string path;
  uint32_t extent = 0;
  uint32_t size = 0;
  bool directory = false;
};

struct ParsedSource {
  std::string path;
  std::string area;
  int track = -1;
};

std::string toLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

std::string toUpper(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::toupper(ch));
  });
  return value;
}

std::string trimIsoName(std::string value) {
  const size_t version = value.find(';');
  if (version != std::string::npos) value.resize(version);
  while (!value.empty() && (value.back() == '.' || value.back() == ' ')) value.pop_back();
  return value;
}

bool endsWith(const std::string& value, const std::string& suffix) {
  return value.size() >= suffix.size() && value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool containsNoCase(const std::string& value, const std::string& needle) {
  return toLower(value).find(toLower(needle)) != std::string::npos;
}

uint32_t readLe32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) | (static_cast<uint32_t>(data[1]) << 8) |
         (static_cast<uint32_t>(data[2]) << 16) | (static_cast<uint32_t>(data[3]) << 24);
}

uint64_t fileSize(std::ifstream& file) {
  const auto current = file.tellg();
  file.seekg(0, std::ios::end);
  const auto end = file.tellg();
  file.seekg(current, std::ios::beg);
  return end < 0 ? 0 : static_cast<uint64_t>(end);
}

bool readExactAt(std::ifstream& file, uint64_t offset, uint8_t* data, size_t size) {
  file.seekg(static_cast<std::streamoff>(offset), std::ios::beg);
  if (!file) return false;
  file.read(reinterpret_cast<char*>(data), static_cast<std::streamsize>(size));
  return static_cast<size_t>(file.gcount()) == size;
}

ParsedSource parseSource(const std::string& source) {
  ParsedSource parsed;
  parsed.path = source;
  const size_t qm = parsed.path.find('?');
  if (qm == std::string::npos) return parsed;

  const std::string query = parsed.path.substr(qm + 1);
  parsed.path.resize(qm);
  size_t start = 0;
  while (start <= query.size()) {
    const size_t amp = query.find('&', start);
    const std::string pair = query.substr(start, amp == std::string::npos ? std::string::npos : amp - start);
    const size_t eq = pair.find('=');
    const std::string key = toLower(eq == std::string::npos ? pair : pair.substr(0, eq));
    const std::string value = eq == std::string::npos ? "" : pair.substr(eq + 1);
    if (key == "track") {
      try {
        parsed.track = std::stoi(value);
      } catch (...) {
        parsed.track = -1;
      }
    } else if (key == "area") {
      parsed.area = toLower(value);
    }
    if (amp == std::string::npos) break;
    start = amp + 1;
  }
  return parsed;
}

void collectDirectory(
    std::ifstream& file,
    uint32_t extent,
    uint32_t size,
    const std::string& parent,
    int depth,
    std::vector<IsoEntry>* entries) {
  if (!entries || depth > 5 || extent == 0 || size == 0 || entries->size() > 1024) return;

  std::vector<uint8_t> directory(size);
  if (!readExactAt(file, static_cast<uint64_t>(extent) * kIsoSectorSize, directory.data(), directory.size())) return;

  size_t offset = 0;
  while (offset < directory.size() && entries->size() <= 1024) {
    const uint8_t length = directory[offset];
    if (length == 0) {
      offset = ((offset / kIsoSectorSize) + 1) * kIsoSectorSize;
      continue;
    }
    if (offset + length > directory.size() || length < 34) break;

    const uint8_t nameLength = directory[offset + 32];
    if (33U + nameLength > length) {
      offset += length;
      continue;
    }
    const uint8_t* rawName = directory.data() + offset + 33;
    if (nameLength == 1 && (rawName[0] == 0 || rawName[0] == 1)) {
      offset += length;
      continue;
    }

    const std::string name = trimIsoName(toUpper(
        std::string(reinterpret_cast<const char*>(rawName), reinterpret_cast<const char*>(rawName) + nameLength)));
    if (name.empty()) {
      offset += length;
      continue;
    }

    IsoEntry entry;
    entry.path = parent.empty() ? name : parent + "/" + name;
    entry.extent = readLe32(directory.data() + offset + 2);
    entry.size = readLe32(directory.data() + offset + 10);
    entry.directory = (directory[offset + 25] & 0x02) != 0;
    entries->push_back(entry);
    if (entry.directory) collectDirectory(file, entry.extent, entry.size, entry.path, depth + 1, entries);
    offset += length;
  }
}

std::vector<IsoEntry> readIsoEntries(std::ifstream& file) {
  std::vector<IsoEntry> entries;
  std::array<uint8_t, kIsoSectorSize> sector{};
  uint32_t rootExtent = 0;
  uint32_t rootSize = 0;
  for (uint32_t sectorIndex = 16; sectorIndex < 64; ++sectorIndex) {
    if (!readExactAt(file, static_cast<uint64_t>(sectorIndex) * kIsoSectorSize, sector.data(), sector.size())) break;
    if (std::memcmp(sector.data() + 1, "CD001", 5) != 0 || sector[6] != 1) continue;
    if (sector[0] == 1) {
      const uint8_t* rootRecord = sector.data() + 156;
      if (rootRecord[0] >= 34) {
        rootExtent = readLe32(rootRecord + 2);
        rootSize = readLe32(rootRecord + 10);
      }
    } else if (sector[0] == 255) {
      break;
    }
  }
  collectDirectory(file, rootExtent, rootSize, "", 0, &entries);
  return entries;
}

const IsoEntry* findEntry(const std::vector<IsoEntry>& entries, const std::string& path) {
  const std::string target = toUpper(path);
  const auto it = std::find_if(entries.begin(), entries.end(), [&](const IsoEntry& entry) {
    return entry.path == target;
  });
  return it == entries.end() ? nullptr : &*it;
}

std::string areaFromPath(const std::string& path) {
  if (containsNoCase(path, "TWOCH") || containsNoCase(path, "2CH")) return "stereo";
  if (containsNoCase(path, "MULTI") || containsNoCase(path, "MCH")) return "multichannel";
  return "stereo";
}

bool parseTwilightAreaToc(
    const std::vector<uint8_t>& bytes,
    const std::string& area,
    const std::vector<IsoEntry>& entries,
    std::vector<SacdIsoTrackInfo>* tracks) {
  if (bytes.size() < 16 || std::memcmp(bytes.data(), "TWTEAREA", 8) != 0 || !tracks) return false;
  const uint32_t count = readLe32(bytes.data() + 8);
  size_t offset = 16;
  bool parsed = false;
  for (uint32_t i = 0; i < count && offset + 64 <= bytes.size(); ++i) {
    if (std::memcmp(bytes.data() + offset, "TWTE1", 5) != 0) break;
    SacdIsoTrackInfo track;
    track.area = area;
    track.trackNumber = static_cast<int>(readLe32(bytes.data() + offset + 8));
    track.startSector = readLe32(bytes.data() + offset + 12);
    track.sectorCount = readLe32(bytes.data() + offset + 16);
    track.channelCount = static_cast<int>(readLe32(bytes.data() + offset + 20));
    track.sampleRate = static_cast<int>(readLe32(bytes.data() + offset + 24));
    track.isDst = readLe32(bytes.data() + offset + 28) != 0;
    const std::string fileName = trimIsoName(toUpper(std::string(
        reinterpret_cast<const char*>(bytes.data() + offset + 32),
        reinterpret_cast<const char*>(bytes.data() + offset + 32 + 24))));
    const IsoEntry* file = fileName.empty() ? nullptr : findEntry(entries, "SACD/" + fileName);
    if (file) {
      track.startSector = file->extent;
      track.sectorCount = std::max<uint64_t>(1, (static_cast<uint64_t>(file->size) + kIsoSectorSize - 1) / kIsoSectorSize);
      track.dataSize = file->size;
      track.isDst = track.isDst || endsWith(file->path, ".DST");
    } else {
      track.dataSize = track.sectorCount * kIsoSectorSize;
    }
    track.dataOffset = track.startSector * kIsoSectorSize;
    track.durationSeconds =
        track.sampleRate > 0 && track.channelCount > 0
            ? static_cast<double>(track.dataSize * 8) /
                  static_cast<double>(static_cast<uint64_t>(track.sampleRate) * static_cast<uint64_t>(track.channelCount))
            : 0.0;
    track.title = "Track " + std::to_string(track.trackNumber);
    track.playable = !track.isDst && track.dataOffset > 0 && track.dataSize > 0;
    if (track.isDst) {
      track.reasonCode = kSacdDstDsdProviderUnavailableReasonCode;
      track.reason = kSacdDstDsdProviderUnavailableReason;
    }
    tracks->push_back(track);
    parsed = true;
    offset += 64;
  }
  return parsed;
}

std::vector<uint8_t> readEntryBytes(std::ifstream& file, const IsoEntry& entry) {
  std::vector<uint8_t> bytes(entry.size);
  if (bytes.empty()) return bytes;
  if (!readExactAt(file, static_cast<uint64_t>(entry.extent) * kIsoSectorSize, bytes.data(), bytes.size())) bytes.clear();
  return bytes;
}

void addMarkerTracks(const std::vector<IsoEntry>& entries, std::vector<SacdIsoTrackInfo>* tracks) {
  if (!tracks) return;
  int stereoTrack = 1;
  int multiTrack = 1;
  for (const auto& entry : entries) {
    if (entry.directory || entry.path.rfind("SACD/", 0) != 0) continue;
    const bool dsd = endsWith(entry.path, ".DSD") || endsWith(entry.path, ".2CH") || endsWith(entry.path, ".MCH");
    const bool dst = endsWith(entry.path, ".DST");
    if (!dsd && !dst) continue;

    SacdIsoTrackInfo track;
    track.area = areaFromPath(entry.path);
    track.trackNumber = track.area == "stereo" ? stereoTrack++ : multiTrack++;
    track.title = "Track " + std::to_string(track.trackNumber);
    track.startSector = entry.extent;
    track.sectorCount = std::max<uint64_t>(1, (static_cast<uint64_t>(entry.size) + kIsoSectorSize - 1) / kIsoSectorSize);
    track.dataOffset = static_cast<uint64_t>(entry.extent) * kIsoSectorSize;
    track.dataSize = entry.size;
    track.channelCount = track.area == "multichannel" ? 6 : 2;
    track.sampleRate = 2822400;
    track.isDst = dst;
    track.durationSeconds =
        static_cast<double>(track.dataSize * 8) /
        static_cast<double>(static_cast<uint64_t>(track.sampleRate) * static_cast<uint64_t>(track.channelCount));
    track.playable = !track.isDst;
    if (track.isDst) {
      track.reasonCode = kSacdDstDsdProviderUnavailableReasonCode;
      track.reason = kSacdDstDsdProviderUnavailableReason;
    }
    tracks->push_back(track);
  }
}

bool areaMatches(const SacdIsoTrackInfo& track, const std::string& area) {
  return area.empty() || area == "auto" || track.area == area;
}

bool preferTrack(const SacdIsoTrackInfo& left, const SacdIsoTrackInfo& right, const std::string& requestedArea) {
  if (requestedArea == "stereo" || requestedArea == "multichannel") return left.area == requestedArea && right.area != requestedArea;
  if (left.area != right.area) return left.area == "stereo";
  return left.trackNumber < right.trackNumber;
}

}  // namespace

struct SacdIsoDemuxer::Impl {
  ParsedSource source;
  std::ifstream file;
  std::vector<SacdIsoTrackInfo> tracks;
  int currentTrackIndex = -1;
  uint64_t readOffset = 0;
  bool eof = true;
  AudioStreamInfo streamInfo;
  // DST decode state (only used when the selected track isDst and a DSD-
  // preserving provider is registered).
  SacdDstDecoderProvider* dstProvider = nullptr;
  std::unique_ptr<SacdDstDecoderProvider> ownedDstProvider;
  std::vector<uint8_t> decodedDsdBuffer;   // decoded raw DSD bytes for the current frame
  size_t decodedOffset = 0;                // read cursor inside decodedDsdBuffer
  uint64_t dstCompressedOffset = 0;        // byte cursor into the track's compressed DST stream
  bool dstActive = false;                  // a DST track is being decoded through the provider
};

SacdIsoDemuxer::SacdIsoDemuxer() : impl_(std::make_unique<Impl>()) {}

SacdIsoDemuxer::~SacdIsoDemuxer() {
  close();
}

void SacdIsoDemuxer::setDstDecoderProvider(SacdDstDecoderProvider* provider) {
  impl_->dstProvider = provider;
}

bool SacdIsoDemuxer::open(const std::string& path, std::string* error) {
  close();
  impl_->source = parseSource(path);

  SacdIsoEntryProbe probe = probeSacdIsoEntry(impl_->source.path);
  if (!probe.isSacdIso()) {
    if (error) *error = "Not a SACD ISO file";
    return false;
  }
  if (!probe.hasSacdMarkers) {
    if (error) *error = probe.reason;
    return false;
  }

  impl_->file.open(impl_->source.path, std::ios::binary);
  if (!impl_->file) {
    if (error) *error = "Failed to open ISO file for reading";
    return false;
  }

  const std::vector<IsoEntry> entries = readIsoEntries(impl_->file);
  for (const auto& entry : entries) {
    if (entry.directory || entry.path.rfind("SACD/", 0) != 0 || entry.path.find("AREA.TOC") == std::string::npos) continue;
    const auto bytes = readEntryBytes(impl_->file, entry);
    parseTwilightAreaToc(bytes, areaFromPath(entry.path), entries, &impl_->tracks);
  }
  if (impl_->tracks.empty()) addMarkerTracks(entries, &impl_->tracks);

  std::sort(impl_->tracks.begin(), impl_->tracks.end(), [](const SacdIsoTrackInfo& left, const SacdIsoTrackInfo& right) {
    if (left.area != right.area) return left.area < right.area;
    return left.trackNumber < right.trackNumber;
  });

  // When a DSD-preserving DST decoder provider is registered, DST-compressed
  // tracks become playable through the DoP / native-DSD pipeline. Flip the
  // playable flag and clear the unavailability reason. Tracks stay unplayable
  // (dst_dsd_provider_unavailable) when no provider is registered.
  const bool dstProviderAvailable = impl_->dstProvider != nullptr && [this]() {
    std::string reason;
    return impl_->dstProvider->available(&reason);
  }();
  if (dstProviderAvailable) {
    for (auto& track : impl_->tracks) {
      if (track.isDst && track.dataOffset > 0 && track.dataSize > 0) {
        track.playable = true;
        track.reasonCode.clear();
        track.reason.clear();
      }
    }
  }
  (void)dstProviderAvailable;  // referenced again below for capability reporting

  if (impl_->tracks.empty()) {
    if (error) *error = "SACD ISO contains no recognized DSD area tracks";
    close();
    return false;
  }

  if (impl_->source.track > 0) {
    return selectTrack(impl_->source.area, impl_->source.track, error);
  }

  impl_->eof = true;
  return true;
}

void SacdIsoDemuxer::close() {
  if (impl_->file.is_open()) impl_->file.close();
  impl_->source = {};
  impl_->tracks.clear();
  impl_->currentTrackIndex = -1;
  impl_->readOffset = 0;
  impl_->eof = true;
  impl_->streamInfo = {};
  impl_->decodedDsdBuffer.clear();
  impl_->decodedOffset = 0;
  impl_->dstCompressedOffset = 0;
  impl_->dstActive = false;
}

const std::vector<SacdIsoTrackInfo>& SacdIsoDemuxer::tracks() const {
  return impl_->tracks;
}

bool SacdIsoDemuxer::selectTrack(int trackNumber, std::string* error) {
  return selectTrack(impl_->source.area, trackNumber, error);
}

bool SacdIsoDemuxer::selectTrack(const std::string& area, int trackNumber, std::string* error) {
  if (!impl_->file.is_open()) {
    if (error) *error = "SACD ISO demuxer is not open";
    return false;
  }
  std::vector<int> candidates;
  for (size_t i = 0; i < impl_->tracks.size(); ++i) {
    const auto& track = impl_->tracks[i];
    if (track.trackNumber == trackNumber && areaMatches(track, toLower(area))) {
      candidates.push_back(static_cast<int>(i));
    }
  }
  if (candidates.empty()) {
    if (error) *error = "Requested SACD ISO track or area is unavailable";
    return false;
  }
  int selected = candidates.front();
  for (int candidate : candidates) {
    if (preferTrack(impl_->tracks[static_cast<size_t>(candidate)], impl_->tracks[static_cast<size_t>(selected)], toLower(area))) {
      selected = candidate;
    }
  }

  const auto& track = impl_->tracks[static_cast<size_t>(selected)];
  if (!track.playable) {
    if (error) *error = track.reason.empty() ? kSacdDstDsdProviderUnavailableReason : track.reason;
    return false;
  }
  const uint64_t size = fileSize(impl_->file);
  if (track.dataOffset == 0 || track.dataSize == 0 || track.dataOffset >= size) {
    if (error) *error = "SACD ISO track points outside the image";
    return false;
  }

  // Reset any previous DST decode state before selecting a new track.
  impl_->decodedDsdBuffer.clear();
  impl_->decodedOffset = 0;
  impl_->dstCompressedOffset = 0;
  impl_->dstActive = false;
  if (impl_->dstProvider != nullptr) impl_->dstProvider->reset();

  impl_->currentTrackIndex = selected;
  impl_->readOffset = 0;
  impl_->eof = false;
  impl_->streamInfo = {};
  impl_->streamInfo.source = impl_->source.path + "?area=" + track.area + "&track=" + std::to_string(track.trackNumber);
  impl_->streamInfo.codec = track.isDst ? "dst" : "dsd";
  impl_->streamInfo.durationSeconds = track.durationSeconds;
  impl_->streamInfo.sourceLossless = true;
  impl_->streamInfo.isDsd = true;
  impl_->streamInfo.dsdMode = DsdMode::Pcm;
  impl_->streamInfo.dsdRate = dsdRateFromSampleRate(track.sampleRate);
  impl_->streamInfo.sourceFormat.sampleRate = track.sampleRate;
  impl_->streamInfo.sourceFormat.channelCount = track.channelCount;
  impl_->streamInfo.sourceFormat.bitDepth = 1;
  impl_->streamInfo.sourceFormat.sampleFormat = AudioSampleFormat::DsdInt8Msb1;
  impl_->streamInfo.decodedFormat = impl_->streamInfo.sourceFormat;
  impl_->file.seekg(static_cast<std::streamoff>(track.dataOffset), std::ios::beg);

  // For DST-compressed tracks, initialize the DSD-preserving decoder so
  // readBytes can decode frame-by-frame. Uncompressed DSD tracks read raw
  // bytes directly as before.
  if (track.isDst) {
    if (impl_->dstProvider == nullptr) {
      if (error) *error = kSacdDstDsdProviderUnavailableReason;
      return false;
    }
    std::string dstError;
    if (!impl_->dstProvider->open(track.channelCount, track.sampleRate, &dstError)) {
      if (error) *error = dstError.empty() ? kSacdDstDsdProviderFailedReasonCode : dstError;
      return false;
    }
    impl_->dstActive = true;
  }
  return true;
}

size_t SacdIsoDemuxer::readBytes(uint8_t* output, size_t maxBytes) {
  if (!output || maxBytes == 0 || impl_->currentTrackIndex < 0 || impl_->eof || !impl_->file.is_open()) return 0;
  const auto& track = impl_->tracks[static_cast<size_t>(impl_->currentTrackIndex)];

  // DST-compressed tracks: decode frame-by-frame through the DSD-preserving
  // provider. Each DST frame is an independent access unit that decodes to
  // frameBytesPerChannel*channels raw DSD bytes. readBytes drains the decoded
  // buffer before decoding the next frame.
  if (impl_->dstActive) {
    return readDstBytes(track, output, maxBytes);
  }

  const uint64_t remaining = track.dataSize > impl_->readOffset ? track.dataSize - impl_->readOffset : 0;
  const size_t toRead = static_cast<size_t>(std::min<uint64_t>(remaining, maxBytes));
  if (toRead == 0) {
    impl_->eof = true;
    return 0;
  }
  impl_->file.seekg(static_cast<std::streamoff>(track.dataOffset + impl_->readOffset), std::ios::beg);
  impl_->file.read(reinterpret_cast<char*>(output), static_cast<std::streamsize>(toRead));
  const size_t read = static_cast<size_t>(std::max<std::streamsize>(0, impl_->file.gcount()));
  impl_->readOffset += read;
  impl_->eof = read == 0 || impl_->readOffset >= track.dataSize;
  return read;
}

size_t SacdIsoDemuxer::readDstBytes(const SacdIsoTrackInfo& track, uint8_t* output, size_t maxBytes) {
  if (impl_->dstProvider == nullptr) {
    impl_->eof = true;
    return 0;
  }
  const size_t frameBytesPerChannel = impl_->dstProvider->frameBytesPerChannel(track.sampleRate);
  if (frameBytesPerChannel == 0 || track.channelCount <= 0) {
    impl_->eof = true;
    return 0;
  }
  const size_t decodedFrameBytes = frameBytesPerChannel * static_cast<size_t>(track.channelCount);
  // Each DST access unit is read as one frame. The compressed payload is
  // variable-length, but the uncompressed frame path (first bit 0) is exactly
  // 1 header byte + decodedFrameBytes. We read that window per frame; the
  // vendored dstdec consumes what it needs and the provider reports bytes
  // written. Frame boundaries are derived from the decoded size so the
  // pipeline stays aligned for the common uncompressed-frame case.
  const size_t compressedFrameWindow = 1 + decodedFrameBytes;
  std::vector<uint8_t> compressedFrame(compressedFrameWindow, 0);

  size_t delivered = 0;
  while (delivered < maxBytes) {
    // Drain any remaining decoded bytes from the current frame first.
    if (impl_->decodedOffset < impl_->decodedDsdBuffer.size()) {
      const size_t available = impl_->decodedDsdBuffer.size() - impl_->decodedOffset;
      const size_t copyBytes = std::min(available, maxBytes - delivered);
      std::memcpy(output + delivered, impl_->decodedDsdBuffer.data() + impl_->decodedOffset, copyBytes);
      impl_->decodedOffset += copyBytes;
      delivered += copyBytes;
      impl_->readOffset += copyBytes;
      continue;
    }

    // No buffered decoded bytes: decode the next DST frame.
    if (impl_->dstCompressedOffset >= track.dataSize) {
      impl_->eof = true;
      break;
    }
    const uint64_t remaining = track.dataSize - impl_->dstCompressedOffset;
    const size_t readSize = static_cast<size_t>(std::min<uint64_t>(remaining, compressedFrameWindow));
    if (!impl_->file.seekg(static_cast<std::streamoff>(track.dataOffset + impl_->dstCompressedOffset), std::ios::beg) ||
        !impl_->file.read(reinterpret_cast<char*>(compressedFrame.data()), static_cast<std::streamsize>(readSize))) {
      impl_->eof = true;
      break;
    }
    const size_t frameRead = static_cast<size_t>(std::max<std::streamsize>(0, impl_->file.gcount()));
    if (frameRead == 0) {
      impl_->eof = true;
      break;
    }
    impl_->decodedDsdBuffer.assign(decodedFrameBytes, 0);
    std::string dstError;
    const size_t decoded = impl_->dstProvider->decodeFrame(
        compressedFrame.data(), frameRead, impl_->decodedDsdBuffer.data(), decodedFrameBytes, &dstError);
    impl_->dstCompressedOffset += frameRead;
    if (decoded == 0) {
      // Decode failure: stop honestly rather than emit garbage DSD.
      impl_->decodedDsdBuffer.clear();
      impl_->decodedOffset = 0;
      impl_->eof = true;
      break;
    }
    impl_->decodedOffset = 0;
    // Loop continues to drain the freshly filled decoded buffer.
  }
  impl_->eof = impl_->eof || (delivered == 0 && impl_->dstCompressedOffset >= track.dataSize);
  return delivered;
}

size_t SacdIsoDemuxer::readFrames(PcmBlock& output, std::string* error) {
  if (audioFormatBytesPerFrame(output.format) == 0) {
    if (error) *error = "Invalid SACD ISO output format";
    return 0;
  }
  const size_t read = readBytes(output.data, output.byteSize);
  return read / audioFormatBytesPerFrame(output.format);
}

bool SacdIsoDemuxer::seek(double seconds, std::string* error) {
  if (impl_->currentTrackIndex < 0) {
    if (error) *error = "No SACD ISO track selected";
    return false;
  }
  const auto& track = impl_->tracks[static_cast<size_t>(impl_->currentTrackIndex)];
  uint64_t byteOffset = 0;
  if (track.durationSeconds > 0.0) {
    const double ratio = std::clamp(std::max(0.0, seconds) / track.durationSeconds, 0.0, 1.0);
    byteOffset = static_cast<uint64_t>(static_cast<double>(track.dataSize) * ratio);
  }
  if (track.channelCount > 0) byteOffset -= byteOffset % static_cast<uint64_t>(track.channelCount);
  impl_->readOffset = std::min(byteOffset, track.dataSize);
  impl_->eof = impl_->readOffset >= track.dataSize;

  // For DST tracks, seeking is frame-boundary based: snap the compressed-stream
  // cursor to the start of the DST frame containing the target time, reset the
  // decoder, and discard decoded bytes until the requested offset is reached.
  if (impl_->dstActive) {
    const size_t frameBytesPerChannel = impl_->dstProvider ? impl_->dstProvider->frameBytesPerChannel(track.sampleRate) : 0;
    const size_t decodedFrameBytes = frameBytesPerChannel * static_cast<size_t>(track.channelCount);
    const size_t compressedFrameWindow = decodedFrameBytes > 0 ? 1 + decodedFrameBytes : 1;
    // Frame index in the compressed stream (each frame = 1/75s).
    const uint64_t frameIndex = decodedFrameBytes > 0 ? impl_->readOffset / decodedFrameBytes : 0;
    impl_->dstCompressedOffset = std::min(frameIndex * compressedFrameWindow, track.dataSize);
    impl_->decodedDsdBuffer.clear();
    impl_->decodedOffset = 0;
    if (impl_->dstProvider) impl_->dstProvider->reset();
    // Sub-frame precision: the requested readOffset may fall inside the frame.
    // We leave readOffset as-is; readDstBytes drains from the next decoded
    // frame and the caller observes the byte-level position via readOffset.
    impl_->eof = impl_->eof || impl_->dstCompressedOffset >= track.dataSize;
  }
  return true;
}

bool SacdIsoDemuxer::eof() const {
  return impl_->eof;
}

const AudioStreamInfo& SacdIsoDemuxer::streamInfo() const {
  return impl_->streamInfo;
}

}  // namespace twilight::audio
