#include "AsioCallbackRouter.h"

#include <Windows.h>

#include <atomic>
#include <chrono>

namespace twilight::audio::asio_windows {
namespace {

std::atomic<AsioCallbackTarget*> activeTarget = nullptr;
std::atomic<uint64_t> activeGeneration = 0;
std::atomic<uint32_t> inFlight = 0;

template <typename Function>
void dispatch(Function&& function) noexcept {
  AsioCallbackTarget* target = activeTarget.load(std::memory_order_acquire);
  const uint64_t generation = activeGeneration.load(std::memory_order_acquire);
  if (!target) return;
  inFlight.fetch_add(1, std::memory_order_acq_rel);
  if (target == activeTarget.load(std::memory_order_acquire) &&
      generation == activeGeneration.load(std::memory_order_acquire)) {
    function(target);
  }
  inFlight.fetch_sub(1, std::memory_order_release);
}

void bufferSwitch(int32_t bufferIndex, asio_abi::AsioBool) {
  dispatch([bufferIndex](AsioCallbackTarget* target) { target->onAsioBufferSwitch(bufferIndex); });
}

void sampleRateDidChange(asio_abi::AsioSampleRate sampleRate) {
  dispatch([sampleRate](AsioCallbackTarget* target) { target->onAsioSampleRateChanged(sampleRate); });
}

int32_t asioMessage(int32_t selector, int32_t value, void* message, double* option) {
  int32_t result = 0;
  dispatch([&](AsioCallbackTarget* target) { result = target->onAsioMessage(selector, value, message, option); });
  return result;
}

asio_abi::AsioTime* bufferSwitchTimeInfo(
    asio_abi::AsioTime* parameters,
    int32_t bufferIndex,
    asio_abi::AsioBool) {
  dispatch([bufferIndex](AsioCallbackTarget* target) { target->onAsioBufferSwitch(bufferIndex); });
  return parameters;
}

}  // namespace

bool AsioCallbackRouter::install(AsioCallbackTarget* target, std::string* error) {
  if (!target) {
    if (error) *error = "ASIO callback target is null";
    return false;
  }
  AsioCallbackTarget* expected = nullptr;
  if (!activeTarget.compare_exchange_strong(expected, target, std::memory_order_acq_rel)) {
    if (error) *error = "only one ASIO session may own the callback router";
    return false;
  }
  activeGeneration.fetch_add(1, std::memory_order_release);
  return true;
}

bool AsioCallbackRouter::uninstall(AsioCallbackTarget* target, std::string* error) {
  AsioCallbackTarget* expected = target;
  if (!activeTarget.compare_exchange_strong(expected, nullptr, std::memory_order_acq_rel) && expected != nullptr) {
    if (error) *error = "ASIO callback router belongs to a different session";
    return false;
  }
  activeGeneration.fetch_add(1, std::memory_order_release);
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (inFlight.load(std::memory_order_acquire) != 0 && std::chrono::steady_clock::now() < deadline) {
    Sleep(1);
  }
  if (inFlight.load(std::memory_order_acquire) == 0) return true;
  if (error) *error = "ASIO callback drain timed out";
  return false;
}

asio_abi::AsioCallbacks AsioCallbackRouter::callbacks() {
  return {
      .bufferSwitch = bufferSwitch,
      .sampleRateDidChange = sampleRateDidChange,
      .asioMessage = asioMessage,
      .bufferSwitchTimeInfo = bufferSwitchTimeInfo};
}

}  // namespace twilight::audio::asio_windows
