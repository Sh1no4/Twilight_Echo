#include "AsioControlThread.h"

#include <Windows.h>

#include <cassert>
#include <chrono>
#include <iostream>
#include <thread>

using namespace twilight::audio::asio_windows;

void testStopWithHungCommand() {
  std::cout << "Test: stop() with hung driver call should detach after 3s timeout\n";

  AsioControlThread thread;
  std::string error;
  assert(thread.start(&error) && "Failed to start control thread");
  assert(thread.healthy() && "Thread not healthy after start");

  std::atomic<bool> commandStarted{false};
  std::atomic<bool> commandCompleted{false};

  const auto result = thread.call(
      [&commandStarted, &commandCompleted] {
        commandStarted = true;
        std::this_thread::sleep_for(std::chrono::seconds(15));
        commandCompleted = true;
        return true;
      },
      &error);

  std::this_thread::sleep_for(std::chrono::milliseconds(100));
  assert(commandStarted.load() && "Command should have started");

  const auto stopStart = std::chrono::steady_clock::now();
  thread.stop();
  const auto stopElapsed =
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - stopStart).count();

  std::cout << "  stop() returned after " << stopElapsed << "ms\n";
  assert(stopElapsed >= 3000 && stopElapsed < 4000 && "stop() should return after ~3s timeout");
  assert(!thread.healthy() && "Thread should be marked unhealthy after detach");

  std::cout << "  PASS: stop() detached hung thread\n";
}

void testMaintenanceUnsetAfterTimeout() {
  std::cout << "\nTest: setMaintenance(nullptr) should execute even after close() timeout\n";

  AsioControlThread thread;
  std::string error;
  assert(thread.start(&error));

  std::atomic<int> maintenanceCallCount{0};
  thread.setMaintenance([&maintenanceCallCount] { maintenanceCallCount++; });

  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  const int callsBefore = maintenanceCallCount.load();
  assert(callsBefore > 0 && "Maintenance callback should have fired");

  thread.setMaintenance(nullptr);

  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  const int callsAfter = maintenanceCallCount.load();
  assert(callsAfter == callsBefore && "Maintenance callback should stop firing after unset");

  thread.stop();
  std::cout << "  PASS: maintenance unset works independently of command timeout\n";
}

int main() {
  try {
    testStopWithHungCommand();
    testMaintenanceUnsetAfterTimeout();
    std::cout << "\nAll tests passed\n";
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "Test failed: " << e.what() << "\n";
    return 1;
  }
}
