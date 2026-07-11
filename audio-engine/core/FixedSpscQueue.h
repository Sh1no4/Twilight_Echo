#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace twilight::audio {

template <typename T, size_t Capacity>
class FixedSpscQueue {
  static_assert(Capacity > 0, "FixedSpscQueue capacity must be positive");
  static_assert(std::is_trivially_copyable_v<T>, "FixedSpscQueue requires trivially copyable values");
  static_assert(
      std::atomic<uint64_t>::is_always_lock_free,
      "FixedSpscQueue requires lock-free 64-bit atomic indices");

 public:
  bool push(const T& value) noexcept {
    const uint64_t head = head_.load(std::memory_order_relaxed);
    const uint64_t tail = tail_.load(std::memory_order_acquire);
    if (head - tail >= Capacity) return false;
    entries_[static_cast<size_t>(head % Capacity)] = value;
    head_.store(head + 1, std::memory_order_release);
    return true;
  }

  bool pop(T& value) noexcept {
    const uint64_t tail = tail_.load(std::memory_order_relaxed);
    const uint64_t head = head_.load(std::memory_order_acquire);
    if (tail == head) return false;
    value = entries_[static_cast<size_t>(tail % Capacity)];
    tail_.store(tail + 1, std::memory_order_release);
    return true;
  }

 private:
  std::array<T, Capacity> entries_{};
  alignas(64) std::atomic<uint64_t> head_{0};
  alignas(64) std::atomic<uint64_t> tail_{0};
};

}  // namespace twilight::audio
