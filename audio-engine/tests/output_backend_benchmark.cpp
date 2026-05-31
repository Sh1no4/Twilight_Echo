#include <chrono>
#include <iostream>
#include <string>
#include <vector>

namespace {

struct BenchmarkReport {
  std::string backend;
  double cpuUsagePercent = 0.0;
  double averageCallbackTimeMs = 0.0;
  double peakCallbackTimeMs = 0.0;
  uint64_t underrunCount = 0;
};

BenchmarkReport runSyntheticBenchmark(const std::string& backend) {
  constexpr int kIterations = 128;
  std::vector<float> buffer(512 * 2, 0.0f);
  BenchmarkReport report;
  report.backend = backend;
  double totalMs = 0.0;

  for (int i = 0; i < kIterations; ++i) {
    const auto start = std::chrono::high_resolution_clock::now();
    for (size_t sample = 0; sample < buffer.size(); ++sample) {
      buffer[sample] = static_cast<float>((sample + i) % 17) / 17.0f;
    }
    const auto end = std::chrono::high_resolution_clock::now();
    const double elapsedMs = std::chrono::duration<double, std::milli>(end - start).count();
    totalMs += elapsedMs;
    if (elapsedMs > report.peakCallbackTimeMs) report.peakCallbackTimeMs = elapsedMs;
  }

  report.averageCallbackTimeMs = totalMs / static_cast<double>(kIterations);
  report.cpuUsagePercent = 0.0;
  report.underrunCount = 0;
  return report;
}

void printReport(const BenchmarkReport& report, bool last) {
  std::cout << "  {"
            << "\"backend\":\"" << report.backend << "\","
            << "\"cpuUsagePercent\":" << report.cpuUsagePercent << ","
            << "\"averageCallbackTimeMs\":" << report.averageCallbackTimeMs << ","
            << "\"peakCallbackTimeMs\":" << report.peakCallbackTimeMs << ","
            << "\"underrunCount\":" << report.underrunCount << "}";
  if (!last) std::cout << ",";
  std::cout << "\n";
}

}  // namespace

int main() {
  const std::vector<std::string> backends = {"asio", "wasapi", "wasapi-exclusive"};
  std::cout << "[\n";
  for (size_t i = 0; i < backends.size(); ++i) {
    printReport(runSyntheticBenchmark(backends[i]), i + 1 == backends.size());
  }
  std::cout << "]\n";
  return 0;
}
