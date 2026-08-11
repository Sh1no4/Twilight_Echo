#pragma once

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <future>
#include <memory>
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
    if (std::this_thread::get_id() == workerThreadId())
      return std::optional<Result>(std::forward<Function>(function)());
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
      markUnhealthy();
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
  // Everything the worker touches outlives this object. stop() has to be able to
  // walk away from a driver call that never returns, and the thread it abandons
  // keeps using the mutex, the queue and the window until it finally unwinds.
  // Co-owning that state through a shared_ptr turns what would be a
  // use-after-free into a bounded leak.
  struct State {
    std::mutex mutex;
    std::condition_variable condition;
    std::queue<std::function<void()>> commands;
    std::function<void()> maintenance;
    std::thread::id threadId;
    HWND window = nullptr;
    bool ready = false;
    bool running = false;
    bool stopping = false;
    bool exited = false;
    bool initializationSucceeded = false;
    std::atomic<bool> unhealthy = false;
  };

  bool submit(std::function<void()> command);
  void markUnhealthy();
  std::thread::id workerThreadId() const;
  std::shared_ptr<State> sharedState() const;
  static void worker(std::shared_ptr<State> state);

  // start() swaps state_ when it abandons a wedged worker, and call() reaches
  // healthy()/workerThreadId() from arbitrary threads, so the pointer itself needs
  // a guard. stateMutex_ only ever covers reading or replacing the pointer -- never
  // a wait -- so a stuck worker calling back in cannot deadlock on it.
  // lifecycleMutex_ serializes start() against stop(), which are the only places
  // thread_ is touched. Lock order is lifecycleMutex_ -> stateMutex_ -> State::mutex.
  mutable std::mutex stateMutex_;
  std::mutex lifecycleMutex_;
  std::shared_ptr<State> state_ = std::make_shared<State>();
  std::thread thread_;
};

}  // namespace twilight::audio::asio_windows
