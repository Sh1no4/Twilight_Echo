#include "../playlist/QueueManager.h"

#include <cassert>
#include <string>

using namespace twilight::audio;

namespace {

const char* kQueueJson =
    "[{\"id\":\"a\",\"audioSource\":\"a.flac\",\"duration\":1.5},"
    "{\"id\":\"b\",\"source\":\"b.flac\",\"duration\":2.5},"
    "{\"id\":\"c\",\"filePath\":\"c.flac\",\"duration\":3.5}]";

void testLoadAndUpcoming() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  assert(queue.currentIndex() == 1);
  assert(queue.current()->source == "b.flac");
  assert(queue.upcoming()->source == "c.flac");
  assert(queue.upcomingJson().find("\"source\":\"c.flac\"") != std::string::npos);
}

void testSequentialAdvanceWrapsLikeRenderer() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 2, &error));
  auto next = queue.advanceAfterEnd();
  assert(next);
  assert(queue.currentIndex() == 0);
  assert(next->source == "a.flac");
}

void testRepeatAdvanceKeepsCurrentTrack() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  queue.setPlayMode(PlayMode::Repeat);
  auto next = queue.advanceAfterEnd();
  assert(next);
  assert(queue.currentIndex() == 1);
  assert(next->source == "b.flac");
}

void testRepeatManualNextUsesPlaylistOrder() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  queue.setPlayMode(PlayMode::Repeat);
  auto next = queue.next();
  assert(next);
  assert(queue.currentIndex() == 2);
  assert(next->source == "c.flac");
  auto previous = queue.previous();
  assert(previous);
  assert(queue.currentIndex() == 1);
  assert(previous->source == "b.flac");
}

void testAddRemoveAndInvalidInput() {
  QueueManager queue;
  std::string error;
  assert(!queue.loadFromJson("{\"source\":\"bad.flac\"}", 0, &error));
  assert(queue.empty());
  assert(queue.addFromJson("{\"source\":\"one.flac\"}", &error));
  assert(queue.addFromJson("{\"streamUrl\":\"two.flac\"}", &error));
  assert(queue.currentIndex() == 0);
  assert(queue.removeAt(0));
  assert(queue.currentIndex() == 0);
  assert(queue.current()->source == "two.flac");
  assert(!queue.removeAt(4));
}

}  // namespace

int main() {
  testLoadAndUpcoming();
  testSequentialAdvanceWrapsLikeRenderer();
  testRepeatAdvanceKeepsCurrentTrack();
  testRepeatManualNextUsesPlaylistOrder();
  testAddRemoveAndInvalidInput();
  return 0;
}
