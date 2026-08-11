#include "../decoder/DstDecoder.h"

#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace twilight::audio::test {
namespace {

// MSB-first bit writer mirroring the layout the decoder's BitReader expects.
class BitWriter {
 public:
  void putBit(unsigned bit) {
    if ((bitCount_ % 8U) == 0U) bytes_.push_back(0U);
    if (bit) bytes_.back() |= static_cast<uint8_t>(1U << (7U - (bitCount_ % 8U)));
    ++bitCount_;
  }

  void putBits(unsigned count, uint32_t value) {
    for (unsigned index = 0; index < count; ++index) {
      putBit((value >> (count - 1U - index)) & 1U);
    }
  }

  // Signed two's-complement field, matching BitReader::getSignedBits.
  void putSignedBits(unsigned count, int value) {
    const uint32_t mask = (count >= 32U) ? 0xffffffffU : ((1U << count) - 1U);
    putBits(count, static_cast<uint32_t>(value) & mask);
  }

  // Sign-and-rice Golomb value, matching getSrGolombDst.
  void putSrGolomb(unsigned k, int value) {
    const unsigned magnitude = static_cast<unsigned>(value < 0 ? -value : value);
    const unsigned unaryCount = magnitude >> k;
    for (unsigned index = 0; index < unaryCount; ++index) putBit(0U);
    putBit(1U);
    if (k > 0U) putBits(k, magnitude & ((1U << k) - 1U));
    if (magnitude != 0U) putBit(value < 0 ? 1U : 0U);
  }

  void appendBytes(const std::vector<uint8_t>& extra) {
    // Only valid on a byte boundary; all callers align before appending.
    bytes_.insert(bytes_.end(), extra.begin(), extra.end());
    bitCount_ += extra.size() * 8U;
  }

  const std::vector<uint8_t>& bytes() const {
    return bytes_;
  }

 private:
  std::vector<uint8_t> bytes_;
  size_t bitCount_ = 0;
};

std::vector<uint8_t> makeUncompressedDstFrame(const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> frame;
  frame.reserve(payload.size() + 1);
  frame.push_back(0x00);
  frame.insert(frame.end(), payload.begin(), payload.end());
  return frame;
}

// Knobs for building a minimal compressed DST frame. Defaults produce a
// well-formed single-element frame; individual fields are flipped by the
// negative tests below.
struct CompressedFrameOptions {
  int channels = 1;
  unsigned sameSegmentation = 1U;
  unsigned sameSegmentationAll = 1U;
  unsigned endOfChannelSegmentation = 1U;
  unsigned trailingZero = 0U;
  unsigned halfProb = 0U;
  unsigned fsetsLength = 1U;   // stored as length-1 in the bitstream
  unsigned probsLength = 1U;   // stored as length-1 in the bitstream
  int fsetsCoeff = 0;          // signed 9-bit filter coefficient
  int probsCoeff = 128;        // unsigned 7-bit probability, offset by +1
  bool codedFsets = false;     // exercise the Golomb residual path
  unsigned fsetsMethod = 0U;   // predictor order - 1 when codedFsets
  unsigned lsbSize = 0U;       // Golomb k when codedFsets
  size_t arithPaddingBytes = 8192U;
};

// Builds a compressed DST frame whose arithmetic payload is all-zero bits.
// The decoder consumes roughly one bit per output DSD bit, so the padding is
// sized well above the 37633 symbol reads a DSD64 mono frame requires.
std::vector<uint8_t> makeCompressedDstFrame(const CompressedFrameOptions& options) {
  BitWriter writer;
  writer.putBit(1U);  // compressed frame marker
  writer.putBit(options.sameSegmentation);
  writer.putBit(options.sameSegmentationAll);
  writer.putBit(options.endOfChannelSegmentation);

  writer.putBit(1U);  // sameMap: reuse the fsets map for probs
  writer.putBit(1U);  // readMap firstBit: all channels map to element 0

  for (int channel = 0; channel < options.channels; ++channel) {
    writer.putBit(options.halfProb);
  }

  // fsets table: 7-bit length field, signed 9-bit coefficients.
  writer.putBits(7U, options.fsetsLength - 1U);
  if (!options.codedFsets) {
    writer.putBit(0U);  // uncoded: raw coefficients follow
    for (unsigned index = 0; index < options.fsetsLength; ++index) {
      writer.putSignedBits(9U, options.fsetsCoeff);
    }
  } else {
    writer.putBit(1U);  // coded: predictor + Golomb residuals
    writer.putBits(2U, options.fsetsMethod);
    for (unsigned index = 0; index <= options.fsetsMethod; ++index) {
      writer.putSignedBits(9U, options.fsetsCoeff);
    }
    writer.putBits(3U, options.lsbSize);
    for (unsigned index = options.fsetsMethod + 1U; index < options.fsetsLength; ++index) {
      writer.putSrGolomb(options.lsbSize, 0);
    }
  }

  // probs table: 6-bit length field, unsigned 7-bit coefficients offset by +1.
  writer.putBits(6U, options.probsLength - 1U);
  writer.putBit(0U);  // uncoded
  for (unsigned index = 0; index < options.probsLength; ++index) {
    writer.putBits(7U, static_cast<uint32_t>(options.probsCoeff - 1));
  }

  writer.putBit(options.trailingZero);
  writer.putBits(12U, 0U);  // initial arithmetic code register

  if (options.arithPaddingBytes > 0U) {
    std::vector<uint8_t> padding(options.arithPaddingBytes, 0x00);
    writer.appendBytes(padding);
  }
  return writer.bytes();
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

// Drives the full arithmetic decode loop: table parsing, filter construction,
// probability lookup, acGet renormalization, and interleaved bit packing.
void testDstArithmeticDecodeProducesFullFrame() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));

  const std::vector<uint8_t> frame = makeCompressedDstFrame({});
  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0xff);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == decoder.frameBytesPerChannel() && "arithmetic decode must fill exactly one frame");
  assert(error.empty());
}

// Same path with two channels, verifying per-channel interleaving and that the
// second channel's halfProb bit is consumed in the right order.
void testDstArithmeticDecodeStereo() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(2, 2822400, &error));

  CompressedFrameOptions options;
  options.channels = 2;
  options.arithPaddingBytes = 16384U;
  const std::vector<uint8_t> frame = makeCompressedDstFrame(options);

  const size_t expected = decoder.frameBytesPerChannel() * 2U;
  std::vector<uint8_t> output(expected, 0xff);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == expected && "stereo arithmetic decode must fill both channels");
  assert(error.empty());
}

// The Golomb-coded coefficient branch of readTable is skipped entirely by
// uncompressed frames; this exercises the predictor plus residual path.
void testDstArithmeticDecodeCodedCoefficients() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));

  CompressedFrameOptions options;
  options.codedFsets = true;
  options.fsetsLength = 4U;
  options.fsetsMethod = 0U;
  options.lsbSize = 0U;
  const std::vector<uint8_t> frame = makeCompressedDstFrame(options);

  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0xff);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == decoder.frameBytesPerChannel() && "Golomb-coded table must decode");
  assert(error.empty());
}

// halfProb=1 bypasses the probability table for the first fsets.length bits,
// a branch no other test reaches.
void testDstArithmeticDecodeHalfProbability() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));

  CompressedFrameOptions options;
  options.halfProb = 1U;
  const std::vector<uint8_t> frame = makeCompressedDstFrame(options);

  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0xff);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == decoder.frameBytesPerChannel());
  assert(error.empty());
}

void testDstRejectsUnsupportedSegmentation() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));
  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0x00);

  for (int field = 0; field < 3; ++field) {
    CompressedFrameOptions options;
    if (field == 0) options.sameSegmentation = 0U;
    if (field == 1) options.sameSegmentationAll = 0U;
    if (field == 2) options.endOfChannelSegmentation = 0U;

    const std::vector<uint8_t> frame = makeCompressedDstFrame(options);
    error.clear();
    const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
    assert(written == 0 && "unsupported segmentation must fail closed");
    assert(!error.empty());
  }
}

void testDstRejectsBadArithmeticStreamMarker() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));

  CompressedFrameOptions options;
  options.trailingZero = 1U;  // must be zero
  const std::vector<uint8_t> frame = makeCompressedDstFrame(options);

  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0x00);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == 0);
  assert(!error.empty());
}

// A frame whose arithmetic payload is exhausted mid-decode must report an
// error rather than emit a partially decoded frame.
void testDstRejectsTruncatedArithmeticPayload() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));

  CompressedFrameOptions options;
  options.arithPaddingBytes = 4U;  // far short of a full frame
  const std::vector<uint8_t> frame = makeCompressedDstFrame(options);

  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0x00);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == 0 && "truncated payload must not report a full frame");
  assert(!error.empty());
}

void testDstRejectsUndersizedOutputBuffer() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(2, 2822400, &error));

  const std::vector<uint8_t> frame = makeCompressedDstFrame({});
  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0x00);  // one channel short
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == 0);
  assert(!error.empty());
}

void testDstRejectsTruncatedUncompressedFrame() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(2, 2822400, &error));

  const size_t expected = decoder.frameBytesPerChannel() * 2U;
  std::vector<uint8_t> frame(expected, 0x00);  // header byte plus short payload
  frame[0] = 0x00;

  std::vector<uint8_t> output(expected, 0x00);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == 0 && "short uncompressed frame must fail closed");
  assert(!error.empty());
}

void testDstRejectsReservedBitsInUncompressedHeader() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(1, 2822400, &error));

  std::vector<uint8_t> frame(decoder.frameBytesPerChannel() + 1U, 0x00);
  frame[0] = 0x01;  // reserved field must be zero

  std::vector<uint8_t> output(decoder.frameBytesPerChannel(), 0x00);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == 0);
  assert(!error.empty());
}

void testDstRejectsUninitializedDecoder() {
  DstDecoder decoder;
  std::string error;

  const std::vector<uint8_t> frame = makeCompressedDstFrame({});
  std::vector<uint8_t> output(4704, 0x00);
  const size_t written = decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error);
  assert(written == 0);
  assert(!error.empty());
}

void testDstResetClearsConfiguration() {
  DstDecoder decoder;
  std::string error;
  assert(decoder.init(2, 5644800, &error));
  assert(decoder.frameBytesPerChannel() == 9408);

  decoder.reset();
  assert(decoder.channels() == 0);
  assert(decoder.sampleRate() == 0);
  assert(decoder.frameBytesPerChannel() == 0);

  const std::vector<uint8_t> frame = makeCompressedDstFrame({});
  std::vector<uint8_t> output(9408, 0x00);
  error.clear();
  assert(decoder.decodeFrame(frame.data(), frame.size(), output.data(), output.size(), &error) == 0);
  assert(!error.empty());
}

void testDstSupportedRateFrameSizes() {
  const std::array<std::pair<int, size_t>, 4> cases{
      {{2822400, 4704}, {5644800, 9408}, {11289600, 18816}, {22579200, 37632}}};
  for (const auto& [rate, expectedBytes] : cases) {
    DstDecoder decoder;
    std::string error;
    assert(decoder.init(2, rate, &error));
    assert(decoder.frameBytesPerChannel() == expectedBytes);
  }

  DstDecoder decoder;
  std::string error;
  assert(!decoder.init(2, 3528000, &error));  // 80x base rate is not a DSD rate
  assert(!error.empty());
}

}  // namespace

void runDstDecoderTests() {
  testDstInitValidation();
  testDstFrameSizeAndPassthrough();
  testDstUncompressedInterleaveLayout();
  testDstArithmeticDecodeProducesFullFrame();
  testDstArithmeticDecodeStereo();
  testDstArithmeticDecodeCodedCoefficients();
  testDstArithmeticDecodeHalfProbability();
  testDstRejectsUnsupportedSegmentation();
  testDstRejectsBadArithmeticStreamMarker();
  testDstRejectsTruncatedArithmeticPayload();
  testDstRejectsUndersizedOutputBuffer();
  testDstRejectsTruncatedUncompressedFrame();
  testDstRejectsReservedBitsInUncompressedHeader();
  testDstRejectsUninitializedDecoder();
  testDstResetClearsConfiguration();
  testDstSupportedRateFrameSizes();
}

}  // namespace twilight::audio::test

int main() {
  twilight::audio::test::runDstDecoderTests();
  return 0;
}
