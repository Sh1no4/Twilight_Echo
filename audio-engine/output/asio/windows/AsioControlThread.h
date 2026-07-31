#pragma once

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <future>
#include <mutex>
#include <optional>
#include <queue>
#include <string>
#include <thread>
#include <type_traits>
#include <utility>

namespace twilight::audio::asio_windows {

class AsioControlThread final {
 public:
  AsioControlThread() = default;
  ~AsioControlThread();

  bool start(std::string* error);
  void stop();
  bool healthy() const;
  void setMaintenance(std::function<void()> maintenance);
  void* systemReference() const;

  template <typename Function>
  auto call(Function&& function, std::string* error)
      -> std::optional<std::invoke_result_t<std::decay_t<Function>>> {
    using Result = std::invoke_result_t<std::decay_t<Function>>;
    if (std::this_thread::get_id() == threadId_) return std::optional<Result>(std::forward<Function>(function)());
    if (!healthy()) {
      if (error) *error = "ASIO control thread is unavailable";
      return std::nullopt;
    }

    auto promise = std::make_shared<std::promise<Result>>();
    auto future = promise->get_future();
    if (!submit([promise, function = std::forward<Function>(function)]() mutable {
          try {
            promise->set_value(function());
          } catch (...) {
            promise->set_exception(std::current_exception());
          }
        })) {
      if (error) *error = "ASIO control thread rejected the command";
      return std::nullopt;
    }
    if (future.wait_for(std::chrono::seconds(10)) != std::future_status::ready) {
      unhealthy_ = true;
      if (error) *error = "ASIO control thread timed out";
      return std::nullopt;
    }
    try {
      return future.get();
    } catch (...) {
      if (error) *error = "ASIO control command failed";
      return std::nullopt;
    }
  }

 private:
  bool submit(std::function<void()> command);
  void worker();

  mutable std::mutex mutex_;
  std::condition_variable condition_;
  std::queue<std::function<void()>> commands_;
  std::function<void()> maintenance_;
  std::thread thread_;
  std::thread::id threadId_;
  HWND window_ = nullptr;
  bool ready_ = false;
  bool running_ = false;
  bool stopping_ = false;
  bool initializationSucceeded_ = false;
  std::atomic<bool> unhealthy_ = false;
};

}  // namespace twilight::audio::asio_windows
