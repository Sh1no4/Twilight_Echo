#include "SacdIsoDemuxer.h"
#include "SacdIsoProbe.h"

#include <fstream>
#include <iostream>

namespace twilight::audio {

struct SacdIsoDemuxer::Impl {
  std::string path;
  std::ifstream file;
  std::vector<SacdIsoTrackInfo> tracks;
  int currentTrackIndex = -1;
  AudioStreamInfo streamInfo;
};

SacdIsoDemuxer::SacdIsoDemuxer() : impl_(std::make_unique<Impl>()) {}

SacdIsoDemuxer::~SacdIsoDemuxer() {
  close();
}

bool SacdIsoDemuxer::open(const std::string& path, std::string* error) {
  close();
  
  SacdIsoEntryProbe probe = probeSacdIsoEntry(path);
  if (!probe.isSacdIso()) {
    if (error) *error = "Not a SACD ISO file";
    return false;
  }
  
  if (!probe.hasSacdMarkers) {
    if (error) *error = probe.reason;
    return false;
  }

  std::string cleanSource = path;
  int targetTrackNumber = -1;
  const size_t qm = cleanSource.find('?');
  if (qm != std::string::npos) {
    std::string query = cleanSource.substr(qm + 1);
    cleanSource = cleanSource.substr(0, qm);
    
    const size_t trackPos = query.find("track=");
    if (trackPos != std::string::npos) {
      targetTrackNumber = std::stoi(query.substr(trackPos + 6));
    }
  }

  impl_->path = path;
  impl_->file.open(cleanSource, std::ios::binary);
  if (!impl_->file) {
    if (error) *error = "Failed to open ISO file for reading";
    return false;
  }

  // TODO: Implement ScarletBook MASTER.TOC parsing to extract tracks
  // For now, we just insert a dummy track to simulate success
  SacdIsoTrackInfo dummy;
  dummy.trackNumber = 1;
  dummy.title = "ISO Track 1 (Stub)";
  dummy.artist = "Unknown Artist";
  dummy.durationSeconds = 0.0;
  dummy.startSector = 0;
  dummy.sectorCount = 0;
  dummy.channelCount = 2;
  dummy.sampleRate = 2822400;
  dummy.isDst = probe.hasDst;
  impl_->tracks.push_back(dummy);

  if (error) *error = "SACD ISO Demuxer not fully implemented yet";
  return false; // Return false so it falls back until we actually implement reading
}

void SacdIsoDemuxer::close() {
  if (impl_->file.is_open()) {
    impl_->file.close();
  }
  impl_->tracks.clear();
  impl_->currentTrackIndex = -1;
  impl_->streamInfo = {};
}

const std::vector<SacdIsoTrackInfo>& SacdIsoDemuxer::tracks() const {
  return impl_->tracks;
}

bool SacdIsoDemuxer::selectTrack(int trackNumber, std::string* error) {
  if (error) *error = "Not implemented";
  return false;
}

size_t SacdIsoDemuxer::readFrames(PcmBlock& output, std::string* error) {
  if (error) *error = "Not implemented";
  return 0;
}

bool SacdIsoDemuxer::seek(double seconds, std::string* error) {
  if (error) *error = "Not implemented";
  return false;
}

bool SacdIsoDemuxer::eof() const {
  return true;
}

const AudioStreamInfo& SacdIsoDemuxer::streamInfo() const {
  return impl_->streamInfo;
}

} // namespace twilight::audio
