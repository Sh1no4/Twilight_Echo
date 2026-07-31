#include "AsioControlThread.h"

#include <Windows.h>
#include <objbase.h>

#include <vector>

namespace twilight::audio::asio_windows {

AsioControlThread::~AsioControlThread() {
  stop();
}

bool AsioControlThread::start(std::string* error) {
  std::unique_lock lock(mutex_);
  if (running_) return initializationSucceeded_;
  ready_ = false;
  stopping_ = false;
  unhealthy_ = false;
  thread_ = std::thread([this] { worker(); });
  condition_.wait(lock, [this] { return ready_; });
  if (!initializationSucceeded_ && error) *error = "ASIO control thread failed to initialize COM";
  return initializationSucceeded_;
}

void AsioControlThread::stop() {
  {
    std::lock_guard lock(mutex_);
    if (!running_ && !thread_.joinable()) return;
    stopping_ = true;
  }
  condition_.notify_all();
  if (thread_.joinable()) thread_.join();
}

bool AsioControlThread::healthy() const {
  std::lock_guard lock(mutex_);
  return running_ && initializationSucceeded_ && !stopping_ && !unhealthy_.load();
}

void AsioControlThread::setMaintenance(std::function<void()> maintenance) {
  std::lock_guard lock(mutex_);
  maintenance_ = std::move(maintenance);
}

void* AsioControlThread::systemReference() const {
  return window_;
}

bool AsioControlThread::submit(std::function<void()> command) {
  {
    std::lock_guard lock(mutex_);
    if (!running_ || stopping_ || unhealthy_) return false;
    commands_.push(std::move(command));
  }
  condition_.notify_one();
  return true;
}

void AsioControlThread::worker() {
  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  const bool comReady = SUCCEEDED(comResult);
  HWND window = nullptr;
  if (comReady) {
    window = CreateWindowExW(
        0, L"STATIC", L"Twilight Echo ASIO", WS_POPUP, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
  }
  {
    std::lock_guard lock(mutex_);
    threadId_ = std::this_thread::get_id();
    window_ = window;
    initializationSucceeded_ = comReady && window != nullptr;
    running_ = initializationSucceeded_;
    ready_ = true;
  }
  condition_.notify_all();
  if (!comReady || !window) {
    if (comReady) CoUninitialize();
    return;
  }

  for (;;) {
    std::vector<std::function<void()>> commands;
    std::function<void()> maintenance;
    {
      std::unique_lock lock(mutex_);
      condition_.wait_for(lock, std::chrono::milliseconds(10), [this] {
        return stopping_ || !commands_.empty();
      });
      if (stopping_) break;
      while (!commands_.empty()) {
        commands.push_back(std::move(commands_.front()));
        commands_.pop();
      }
      maintenance = maintenance_;
    }
    for (auto& command : commands) command();
    if (maintenance) maintenance();
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }

  DestroyWindow(window);
  CoUninitialize();
  {
    std::lock_guard lock(mutex_);
    window_ = nullptr;
    threadId_ = {};
    running_ = false;
    initializationSucceeded_ = false;
  }
}

}  // namespace twilight::audio::asio_windows
