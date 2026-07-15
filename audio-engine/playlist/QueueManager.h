#pragma once

#include "../core/AudioTypes.h"

#include <optional>
#include <random>
#include <string>
#include <vector>

namespace twilight::audio {

enum class PlayMode {
  Sequential,
  Repeat,
  Shuffle
};

class QueueManager {
 public:
  bool loadFromJson(const std::string& queueJson, int startIndex, std::string* error);
  bool addFromJson(const std::string& itemJson, std::string* error);
  bool removeAt(int index);

  void setPlayMode(PlayMode mode);
  PlayMode playMode() const;
  std::string playModeId() const;

  bool empty() const;
  int currentIndex() const;
  void setCurrentIndex(int index);

  std::optional<QueueItem> current() const;
  std::optional<QueueItem> upcoming() const;
  /** Linear search by source path; used so host-injected loudnorm fields survive Play(source). */
  std::optional<QueueItem> findBySource(const std::string& source) const;
  std::optional<QueueItem> next();
  std::optional<QueueItem> previous();
  std::optional<QueueItem> advanceAfterEnd();

  std::string queueJson() const;
  std::string upcomingJson() const;

  static PlayMode parsePlayMode(const std::string& mode);
  static std::string playModeToId(PlayMode mode);
  static std::string itemToJson(const std::optional<QueueItem>& item);

 private:
  void rebuildPlayOrder();
  int queueIndexAtOrderOffset(int offset, bool honorRepeat, bool allowWrap) const;

  std::vector<QueueItem> items_;
  std::vector<int> playOrder_;
  int orderPosition_ = -1;
  PlayMode playMode_ = PlayMode::Sequential;
  std::string rawQueueJson_ = "[]";
  mutable std::mt19937 rng_{std::random_device{}()};
};

}  // namespace twilight::audio
