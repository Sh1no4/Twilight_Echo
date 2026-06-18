#include "../decoder/DstDecoder.h"

#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio::test {
namespace {

std::vector<uint8_t> makeUncompressedDstFrame(const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> frame;
  frame.reserve(payload.size() + 1);
  frame.push_back(0x00);
  frame.insert(frame.end(), payload.begin(), payload.end());
  return frame;
}

void testDstInitValidation() {
  DstDecoder decoder;
  std::string error;

  assert(!decoder.init(7, 2822400, &error));
  assert(!error.empty());

  error.clear();
  assert(!decoder.init(2, 44100, &error));
  assert(!error.empty());
}

void testDstFrameSizeAndPassthrough() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(2, 2822400, &error));
  assert(decoder.frameBytesPerChannel() == 4704);
  assert(decoder.channels() == 2);
  assert(decoder.sampleRate() == 2822400);

  std::vector<uint8_t> source(decoder.frameBytesPerChannel() * static_cast<size_t>(decoder.channels()));
  for (size_t index = 0; index < source.size(); ++index) {
    source[index] = static_cast<uint8_t>(index & 0xff);
  }

  const std::vector<uint8_t> frame = makeUncompressedDstFrame(source);
  std::vector<uint8_t> output(source.size(), 0xff);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == source.size());
  assert(output == source);
}

void testDstUncompressedInterleaveLayout() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(2, 2822400, &error));

  std::vector<uint8_t> payload(decoder.frameBytesPerChannel() * 2U);
  for (size_t i = 0; i < decoder.frameBytesPerChannel(); ++i) {
    payload[i * 2U] = static_cast<uint8_t>(0x10U + (i & 0x0fU));
    payload[i * 2U + 1U] = static_cast<uint8_t>(0x80U + (i & 0x0fU));
  }

  const std::vector<uint8_t> frame = makeUncompressedDstFrame(payload);
  std::vector<uint8_t> output(payload.size(), 0x00);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == payload.size());
  assert(output == payload);
}

}  // namespace

void runDstDecoderTests() {
  testDstInitValidation();
  testDstFrameSizeAndPassthrough();
  testDstUncompressedInterleaveLayout();
}

}  // namespace twilight::audio::test

int main() {
  twilight::audio::test::runDstDecoderTests();
  return 0;
}
