#include "QueueManager.h"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <numeric>
#include <sstream>

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

std::string unescapeJsonString(const std::string& value) {
  std::string out;
  out.reserve(value.size());
  bool escaped = false;
  for (size_t i = 0; i < value.size(); ++i) {
    const char ch = value[i];
    if (!escaped) {
      if (ch == '\\') {
        escaped = true;
      } else {
        out += ch;
      }
      continue;
    }

    switch (ch) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case '"':
      case '\\':
      case '/':
        out += ch;
        break;
      case 'u':
        out += '?';
        i += std::min<size_t>(4, value.size() - i - 1);
        break;
      default:
        out += ch;
        break;
    }
    escaped = false;
  }
  return out;
}

std::vector<std::string> splitTopLevelObjects(const std::string& json) {
  std::vector<std::string> objects;
  bool inString = false;
  bool escaped = false;
  int depth = 0;
  size_t objectStart = std::string::npos;

  for (size_t i = 0; i < json.size(); ++i) {
    const char ch = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }

    if (ch == '"') {
      inString = true;
      continue;
    }
    if (ch == '{') {
      if (depth == 0) objectStart = i;
      ++depth;
      continue;
    }
    if (ch == '}') {
      --depth;
      if (depth == 0 && objectStart != std::string::npos) {
        objects.push_back(json.substr(objectStart, i - objectStart + 1));
        objectStart = std::string::npos;
      }
    }
  }

  return objects;
}

std::optional<std::string> extractStringField(const std::string& object, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = object.find(marker);
  if (pos == std::string::npos) return std::nullopt;
  pos = object.find(':', pos + marker.size());
  if (pos == std::string::npos) return std::nullopt;
  pos = object.find('"', pos + 1);
  if (pos == std::string::npos) return std::nullopt;

  std::string raw;
  bool escaped = false;
  for (size_t i = pos + 1; i < object.size(); ++i) {
    const char ch = object[i];
    if (escaped) {
      raw += '\\';
      raw += ch;
      escaped = false;
      continue;
    }
    if (ch == '\\') {
      escaped = true;
      continue;
    }
    if (ch == '"') return unescapeJsonString(raw);
    raw += ch;
  }
  return std::nullopt;
}

std::optional<double> extractNumberField(const std::string& object, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = object.find(marker);
  if (pos == std::string::npos) return std::nullopt;
  pos = object.find(':', pos + marker.size());
  if (pos == std::string::npos) return std::nullopt;
  ++pos;
  while (pos < object.size() && std::isspace(static_cast<unsigned char>(object[pos]))) ++pos;

  size_t end = pos;
  while (end < object.size()) {
    const char ch = object[end];
    if (!std::isdigit(static_cast<unsigned char>(ch)) && ch != '.' && ch != '-' && ch != '+' && ch != 'e' &&
        ch != 'E') {
      break;
    }
    ++end;
  }
  if (end == pos) return std::nullopt;

  double value = 0.0;
  const auto result = std::from_chars(object.data() + pos, object.data() + end, value);
  if (result.ec != std::errc()) return std::nullopt;
  return value;
}

QueueItem parseQueueItem(const std::string& object) {
  QueueItem item;
  item.id = extractStringField(object, "id").value_or("");
  item.title = extractStringField(object, "title").value_or(extractStringField(object, "name").value_or(""));
  item.artist = extractStringField(object, "artist").value_or("");
  item.album = extractStringField(object, "album").value_or("");
  item.codec = extractStringField(object, "codec").value_or(extractStringField(object, "format").value_or(""));
  item.source = extractStringField(object, "audioSource")
                    .value_or(extractStringField(object, "filePath")
                                  .value_or(extractStringField(object, "streamUrl")
                                                .value_or(extractStringField(object, "source").value_or(""))));
  item.durationSeconds = extractNumberField(object, "duration").value_or(0.0);
  item.sampleRate = static_cast<int>(extractNumberField(object, "sampleRate").value_or(0.0));
  item.bitrate = static_cast<int64_t>(extractNumberField(object, "bitrate").value_or(0.0));
  item.bitDepth = static_cast<int>(extractNumberField(object, "bitDepth").value_or(0.0));
  if (item.id.empty()) item.id = item.source;
  if (item.title.empty()) item.title = item.id;
  return item;
}

std::string itemsToJson(const std::vector<QueueItem>& items) {
  std::ostringstream json;
  json << "[";
  for (size_t i = 0; i < items.size(); ++i) {
    if (i > 0) json << ",";
    json << QueueManager::itemToJson(items[i]);
  }
  json << "]";
  return json.str();
}

}  // namespace

bool QueueManager::loadFromJson(const std::string& queueJson, int startIndex, std::string* error) {
  rawQueueJson_ = queueJson.empty() ? "[]" : queueJson;
  items_.clear();

  if (!rawQueueJson_.empty() && rawQueueJson_.front() != '[') {
    if (error) *error = "播放队列格式无效";
    rawQueueJson_ = "[]";
    rebuildPlayOrder();
    return false;
  }

  for (const std::string& object : splitTopLevelObjects(rawQueueJson_)) {
    QueueItem item = parseQueueItem(object);
    if (!item.source.empty()) items_.push_back(std::move(item));
  }

  if (items_.empty()) {
    orderPosition_ = -1;
    rebuildPlayOrder();
    return true;
  }

  startIndex = std::clamp(startIndex, 0, static_cast<int>(items_.size() - 1));
  rebuildPlayOrder();
  auto it = std::find(playOrder_.begin(), playOrder_.end(), startIndex);
  orderPosition_ = it == playOrder_.end() ? 0 : static_cast<int>(std::distance(playOrder_.begin(), it));
  return true;
}

bool QueueManager::addFromJson(const std::string& itemJson, std::string* error) {
  QueueItem item = parseQueueItem(itemJson);
  if (item.source.empty()) {
    if (error) *error = "队列项目缺少音频地址";
    return false;
  }
  items_.push_back(std::move(item));
  rawQueueJson_ = itemsToJson(items_);
  rebuildPlayOrder();
  if (orderPosition_ < 0) orderPosition_ = 0;
  return true;
}

bool QueueManager::removeAt(int index) {
  if (index < 0 || index >= static_cast<int>(items_.size())) return false;
  const int current = currentIndex();
  items_.erase(items_.begin() + index);
  rebuildPlayOrder();
  if (items_.empty()) {
    orderPosition_ = -1;
  } else {
    setCurrentIndex(std::clamp(current >= index ? current - 1 : current, 0, static_cast<int>(items_.size() - 1)));
  }
  rawQueueJson_ = itemsToJson(items_);
  return true;
}

void QueueManager::setPlayMode(PlayMode mode) {
  if (playMode_ == mode) return;
  const int current = currentIndex();
  playMode_ = mode;
  rebuildPlayOrder();
  setCurrentIndex(current);
}

PlayMode QueueManager::playMode() const {
  return playMode_;
}

std::string QueueManager::playModeId() const {
  return playModeToId(playMode_);
}

bool QueueManager::empty() const {
  return items_.empty();
}

int QueueManager::currentIndex() const {
  if (orderPosition_ < 0 || orderPosition_ >= static_cast<int>(playOrder_.size())) return -1;
  return playOrder_[static_cast<size_t>(orderPosition_)];
}

void QueueManager::setCurrentIndex(int index) {
  if (items_.empty()) {
    orderPosition_ = -1;
    return;
  }
  index = std::clamp(index, 0, static_cast<int>(items_.size() - 1));
  auto it = std::find(playOrder_.begin(), playOrder_.end(), index);
  orderPosition_ = it == playOrder_.end() ? 0 : static_cast<int>(std::distance(playOrder_.begin(), it));
}

std::optional<QueueItem> QueueManager::current() const {
  const int index = currentIndex();
  if (index < 0 || index >= static_cast<int>(items_.size())) return std::nullopt;
  return items_[static_cast<size_t>(index)];
}

std::optional<QueueItem> QueueManager::upcoming() const {
  const int index = queueIndexAtOrderOffset(1, true);
  if (index < 0 || index >= static_cast<int>(items_.size())) return std::nullopt;
  return items_[static_cast<size_t>(index)];
}

std::optional<QueueItem> QueueManager::next() {
  const int index = queueIndexAtOrderOffset(1, false);
  if (index < 0) return std::nullopt;
  setCurrentIndex(index);
  return current();
}

std::optional<QueueItem> QueueManager::previous() {
  const int index = queueIndexAtOrderOffset(-1, false);
  if (index < 0) return std::nullopt;
  setCurrentIndex(index);
  return current();
}

std::optional<QueueItem> QueueManager::advanceAfterEnd() {
  const int index = queueIndexAtOrderOffset(1, true);
  if (index < 0) return std::nullopt;
  setCurrentIndex(index);
  return current();
}

std::string QueueManager::queueJson() const {
  return rawQueueJson_;
}

std::string QueueManager::upcomingJson() const {
  return itemToJson(upcoming());
}

PlayMode QueueManager::parsePlayMode(const std::string& mode) {
  if (mode == "repeat") return PlayMode::Repeat;
  if (mode == "shuffle") return PlayMode::Shuffle;
  return PlayMode::Sequential;
}

std::string QueueManager::playModeToId(PlayMode mode) {
  switch (mode) {
    case PlayMode::Repeat:
      return "repeat";
    case PlayMode::Shuffle:
      return "shuffle";
    case PlayMode::Sequential:
    default:
      return "sequential";
  }
}

std::string QueueManager::itemToJson(const std::optional<QueueItem>& item) {
  if (!item) return "null";
  std::ostringstream json;
  json << "{"
       << "\"id\":\"" << escapeJson(item->id) << "\","
       << "\"source\":\"" << escapeJson(item->source) << "\","
       << "\"title\":\"" << escapeJson(item->title) << "\","
       << "\"artist\":\"" << escapeJson(item->artist) << "\","
       << "\"album\":\"" << escapeJson(item->album) << "\","
       << "\"duration\":" << item->durationSeconds << ","
       << "\"codec\":\"" << escapeJson(item->codec) << "\","
       << "\"sampleRate\":" << item->sampleRate << ","
       << "\"bitrate\":" << item->bitrate << ","
       << "\"bitDepth\":" << item->bitDepth
       << "}";
  return json.str();
}

void QueueManager::rebuildPlayOrder() {
  playOrder_.resize(items_.size());
  std::iota(playOrder_.begin(), playOrder_.end(), 0);
  const int current = currentIndex();

  if (playMode_ == PlayMode::Shuffle && playOrder_.size() > 1) {
    std::shuffle(playOrder_.begin(), playOrder_.end(), rng_);
    if (current >= 0) {
      auto it = std::find(playOrder_.begin(), playOrder_.end(), current);
      if (it != playOrder_.end()) std::iter_swap(playOrder_.begin(), it);
    }
  }

  if (items_.empty()) {
    orderPosition_ = -1;
  } else if (orderPosition_ < 0 || orderPosition_ >= static_cast<int>(playOrder_.size())) {
    orderPosition_ = 0;
  }
}

int QueueManager::queueIndexAtOrderOffset(int offset, bool honorRepeat) const {
  if (items_.empty() || playOrder_.empty()) return -1;
  if (honorRepeat && playMode_ == PlayMode::Repeat) return currentIndex();

  const int count = static_cast<int>(playOrder_.size());
  const int base = orderPosition_ < 0 ? 0 : orderPosition_;
  int next = (base + offset) % count;
  if (next < 0) next += count;
  return playOrder_[static_cast<size_t>(next)];
}

}  // namespace twilight::audio
