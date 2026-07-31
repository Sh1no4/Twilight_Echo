#include "AsioAbi.h"

#include <cstddef>
#include <iostream>

using namespace twilight::audio::asio_abi;

int main() {
  std::cout << "{\n"
            << "  \"contractVersion\": " << kAsioAbiContractVersion << ",\n"
            << "  \"pointerSize\": " << sizeof(void*) << ",\n"
            << "  \"functionPointerSize\": " << sizeof(AsioBufferSwitch) << ",\n"
            << "  \"sizes\": {\n"
            << "    \"AsioBool\": " << sizeof(AsioBool) << ",\n"
            << "    \"AsioBufferInfo\": " << sizeof(AsioBufferInfo) << ",\n"
            << "    \"AsioClockSource\": " << sizeof(AsioClockSource) << ",\n"
            << "    \"AsioChannelInfo\": " << sizeof(AsioChannelInfo) << ",\n"
            << "    \"AsioIoFormat\": " << sizeof(AsioIoFormat) << ",\n"
            << "    \"AsioTimeInfo\": " << sizeof(AsioTimeInfo) << ",\n"
            << "    \"AsioTimeCode\": " << sizeof(AsioTimeCode) << ",\n"
            << "    \"AsioTime\": " << sizeof(AsioTime) << ",\n"
            << "    \"AsioCallbacks\": " << sizeof(AsioCallbacks) << "\n"
            << "  },\n"
            << "  \"alignments\": {\n"
            << "    \"AsioBufferInfo\": " << alignof(AsioBufferInfo) << ",\n"
            << "    \"AsioClockSource\": " << alignof(AsioClockSource) << ",\n"
            << "    \"AsioChannelInfo\": " << alignof(AsioChannelInfo) << ",\n"
            << "    \"AsioIoFormat\": " << alignof(AsioIoFormat) << ",\n"
            << "    \"AsioTimeInfo\": " << alignof(AsioTimeInfo) << ",\n"
            << "    \"AsioTimeCode\": " << alignof(AsioTimeCode) << ",\n"
            << "    \"AsioTime\": " << alignof(AsioTime) << ",\n"
            << "    \"AsioCallbacks\": " << alignof(AsioCallbacks) << "\n"
            << "  },\n"
            << "  \"offsets\": {\n"
            << "    \"AsioBufferInfo.channelNum\": " << offsetof(AsioBufferInfo, channelNum) << ",\n"
            << "    \"AsioBufferInfo.buffers\": " << offsetof(AsioBufferInfo, buffers) << ",\n"
            << "    \"AsioClockSource.name\": " << offsetof(AsioClockSource, name) << ",\n"
            << "    \"AsioChannelInfo.type\": " << offsetof(AsioChannelInfo, type) << ",\n"
            << "    \"AsioChannelInfo.name\": " << offsetof(AsioChannelInfo, name) << ",\n"
            << "    \"AsioIoFormat.formatType\": " << offsetof(AsioIoFormat, formatType) << ",\n"
            << "    \"AsioIoFormat.reserved\": " << offsetof(AsioIoFormat, reserved) << ",\n"
            << "    \"AsioTimeInfo.samplePosition\": " << offsetof(AsioTimeInfo, samplePosition) << ",\n"
            << "    \"AsioTimeInfo.systemTime\": " << offsetof(AsioTimeInfo, systemTime) << "\n"
            << "  }\n"
            << "}\n";
  return 0;
}
