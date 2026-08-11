#include "AsioControlThread.h"

#include <Windows.h>

#include <atomic>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

using namespace twilight::audio::asio_windows;

namespace {

// Lives on the heap so a worker abandoned by stop() keeps it alive. Capturing test
// locals by reference would hand the detached thread a dead stack frame.
struct Gate {
  std::mutex mutex;
  std::condition_variable condition;
  bool released = false;
  std::atomic<int> entered{0};

  void wait() {
    std::unique_lock lock(mutex);
    entered.fetch_add(1);
    condition.wait(lock, [this] { return released; });
  }

  void release() {
    {
      std::lock_guard lock(mutex);
      released = true;
    }
    condition.notify_all();
  }
};

long long millisecondsSince(std::chrono::steady_clock::time_point start) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start)
      .count();
}

void testStopJoinsHealthyThread() {
  std::cout << "Test: stop() joins promptly when the worker is responsive\n";

  AsioControlThread thread;
  std::string error;
  assert(thread.start(&error) && "control thread failed to start");
  assert(thread.healthy() && "control thread not healthy after start");

  const auto executed = thread.call([] { return 7; }, &error);
  assert(executed && *executed == 7 && "command did not run on the control thread");

  const auto stopStart = std::chrono::steady_clock::now();
  thread.stop();
  const auto elapsed = millisecondsSince(stopStart);
  std::cout << "  stop() returned after " << elapsed << "ms\n";

  assert(elapsed < 3000 && "responsive worker should be joined, not waited out");
  assert(!thread.healthy() && "control thread should not report healthy after stop");
  std::cout << "  PASS\n";
}

void testStopAbandonsWedgedWorker() {
  std::cout << "\nTest: stop() detaches a worker wedged outside the command loop\n";

  auto gate = std::make_shared<Gate>();
  std::string error;
  long long elapsed = 0;
  {
    AsioControlThread thread;
    assert(thread.start(&error) && "control thread failed to start");

    // Maintenance runs outside the queue lock, exactly where a driver callback wedges
    // the worker so it can never reach the loop's stopping check.
    thread.setMaintenance([gate] { gate->wait(); });
    for (int spin = 0; spin < 200 && gate->entered.load() == 0; ++spin)
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    assert(gate->entered.load() > 0 && "maintenance callback never ran");

    const auto stopStart = std::chrono::steady_clock::now();
    thread.stop();
    elapsed = millisecondsSince(stopStart);
    std::cout << "  stop() returned after " << elapsed << "ms\n";

    assert(elapsed >= 3000 && "stop() must wait for the drain window before giving up");
    assert(elapsed < 6000 && "stop() must not block on a wedged worker");
    assert(!thread.healthy() && "abandoned control thread must report unhealthy");
  }

  // The object is gone while the worker still holds its state. Releasing the gate now
  // lets that worker unwind; without shared ownership it would fault on freed members.
  gate->release();
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  std::cout << "  PASS\n";
}

void testStartRecoversAfterAbandonedWorker() {
  std::cout << "\nTest: start() recovers after a previous worker was abandoned\n";

  auto gate = std::make_shared<Gate>();
  AsioControlThread thread;
  std::string error;
  assert(thread.start(&error) && "control thread failed to start");
  thread.setMaintenance([gate] { gate->wait(); });
  for (int spin = 0; spin < 200 && gate->entered.load() == 0; ++spin)
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  assert(gate->entered.load() > 0 && "maintenance callback never ran");
  thread.stop();
  assert(!thread.healthy() && "abandoned control thread must report unhealthy");

  assert(thread.start(&error) && "restart after abandoning a worker failed");
  assert(thread.healthy() && "restarted control thread should be healthy");
  const auto executed = thread.call([] { return 11; }, &error);
  assert(executed && *executed == 11 && "restarted control thread cannot run commands");
  assert(thread.systemReference() != nullptr && "restarted control thread has no message window");

  thread.stop();
  gate->release();
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  std::cout << "  PASS\n";
}

void testMaintenanceUnsetStopsFiring() {
  std::cout << "\nTest: setMaintenance(nullptr) stops the drain callback\n";

  AsioControlThread thread;
  std::string error;
  assert(thread.start(&error) && "control thread failed to start");

  auto callCount = std::make_shared<std::atomic<int>>(0);
  thread.setMaintenance([callCount] { callCount->fetch_add(1); });
  for (int spin = 0; spin < 200 && callCount->load() == 0; ++spin)
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  assert(callCount->load() > 0 && "maintenance callback never fired");

  thread.setMaintenance(nullptr);
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  const int settled = callCount->load();
  std::this_thread::sleep_for(std::chrono::milliseconds(100));
  assert(callCount->load() == settled && "maintenance kept firing after being unset");

  thread.stop();
  std::cout << "  PASS\n";
}

}  // namespace

int main() {
  try {
    testStopJoinsHealthyThread();
    testStopAbandonsWedgedWorker();
    testStartRecoversAfterAbandonedWorker();
    testMaintenanceUnsetStopsFiring();
    std::cout << "\nAll tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "Test failed: " << error.what() << "\n";
    return 1;
  }
}
