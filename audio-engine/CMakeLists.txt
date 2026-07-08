cmake_minimum_required(VERSION 3.25)

project(TwilightAudioEngine VERSION 0.1.0 LANGUAGES CXX)

option(TAE_BUILD_NAPI "Build the Node-API bridge" OFF)
option(TAE_BUILD_TESTS "Build Twilight Audio Engine tests" ON)
option(TAE_ENABLE_WASAPI "Enable the Windows WASAPI backend" ON)
option(TAE_ENABLE_ASIO "Enable optional ASIO backend when the SDK is available" ON)
option(TAE_ENABLE_COREAUDIO "Enable the macOS CoreAudio backend" ON)
option(TAE_ENABLE_ALSA "Enable the Linux ALSA backend" ON)

set(TAE_NODE_INCLUDE_DIR "" CACHE PATH "Path to Node-API headers")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(TAE_ASIO_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/ASIOSDK")
set(TAE_WASAPI_AVAILABLE OFF)
set(TAE_ASIO_AVAILABLE OFF)
set(TAE_COREAUDIO_AVAILABLE OFF)
set(TAE_ALSA_AVAILABLE OFF)
if(WIN32 AND TAE_ENABLE_ASIO)
  if(EXISTS "${TAE_ASIO_SDK_DIR}/common/asio.h" AND EXISTS "${TAE_ASIO_SDK_DIR}/host/asiodrivers.cpp")
    set(TAE_ASIO_AVAILABLE ON)
  else()
    message(WARNING "ASIO SDK not found at ${TAE_ASIO_SDK_DIR}; ASIO backend will be disabled.")
    set(TAE_ENABLE_ASIO OFF CACHE BOOL "Enable optional ASIO backend when the SDK is available" FORCE)
  endif()
endif()
if(WIN32 AND TAE_ENABLE_WASAPI)
  set(TAE_WASAPI_AVAILABLE ON)
endif()
if(APPLE AND TAE_ENABLE_COREAUDIO)
  set(TAE_COREAUDIO_AVAILABLE ON)
endif()
if(UNIX AND NOT APPLE AND TAE_ENABLE_ALSA)
  find_package(ALSA QUIET)
  if(ALSA_FOUND)
    set(TAE_ALSA_AVAILABLE ON)
  else()
    message(WARNING "ALSA development libraries were not found; ALSA backend will be disabled.")
    set(TAE_ENABLE_ALSA OFF CACHE BOOL "Enable the Linux ALSA backend" FORCE)
  endif()
endif()

set(TAE_ENGINE_SOURCES
  core/AudioBuffer.cpp
  core/AudioPipeline.cpp
  core/AudioTypes.cpp
  core/TwilightAudioEngine.cpp
  analysis/BpmAnalyzer.cpp
  decoder/DopPacker.cpp
  decoder/DsdReader.cpp
  decoder/DstDecoder.cpp
  decoder/SacdDstDecoderProvider.cpp
  decoder/vendor/dstdec/dstdec.cpp
  decoder/FFmpegDecoder.cpp
  decoder/SacdIsoDemuxer.cpp
  devices/DeviceManager.cpp
  dsp/ChannelRouter.cpp
  dsp/ConvolverProcessor.cpp
  dsp/CrossfeedProcessor.cpp
  dsp/DspChain.cpp
  dsp/FftSpectrumAnalyzer.cpp
  dsp/KissFftAdapter.cpp
  dsp/ParametricEqProcessor.cpp
  dsp/ReplayGainProcessor.cpp
  metadata/AudioMetadataService.cpp
  output/OutputBackendFactory.cpp
  playlist/QueueManager.cpp
  plugins/PluginRegistry.cpp
  utils/StringUtils.cpp
)

add_library(twilight_audio_engine SHARED ${TAE_ENGINE_SOURCES})

target_include_directories(twilight_audio_engine
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_definitions(twilight_audio_engine PRIVATE TAE_BUILDING_LIBRARY=1)
target_link_libraries(twilight_audio_engine PRIVATE ${CMAKE_DL_LIBS})

if(WIN32)
  target_compile_definitions(twilight_audio_engine PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
  set_target_properties(twilight_audio_engine PROPERTIES
    OUTPUT_NAME "twilight-audio-engine"
    PREFIX ""
    WINDOWS_EXPORT_ALL_SYMBOLS OFF
  )
else()
  set_target_properties(twilight_audio_engine PROPERTIES
    OUTPUT_NAME "twilight-audio-engine"
  )
endif()

find_package(FFMPEG QUIET)
if(NOT FFMPEG_FOUND)
  find_path(FFMPEG_INCLUDE_DIR libavformat/avformat.h)
  find_library(FFMPEG_AVFORMAT_LIBRARY avformat)
  find_library(FFMPEG_AVCODEC_LIBRARY avcodec)
  find_library(FFMPEG_AVUTIL_LIBRARY avutil)
  find_library(FFMPEG_SWRESAMPLE_LIBRARY swresample)
  if(FFMPEG_INCLUDE_DIR AND FFMPEG_AVFORMAT_LIBRARY AND FFMPEG_AVCODEC_LIBRARY AND FFMPEG_AVUTIL_LIBRARY AND FFMPEG_SWRESAMPLE_LIBRARY)
    set(FFMPEG_FOUND TRUE)
    set(FFMPEG_INCLUDE_DIRS ${FFMPEG_INCLUDE_DIR})
    set(FFMPEG_LIBRARIES
      ${FFMPEG_AVFORMAT_LIBRARY}
      ${FFMPEG_AVCODEC_LIBRARY}
      ${FFMPEG_AVUTIL_LIBRARY}
      ${FFMPEG_SWRESAMPLE_LIBRARY}
    )
  endif()
endif()

set(TAE_FFMPEG_EXTRA_LIBS)
if(WIN32)
  list(APPEND TAE_FFMPEG_EXTRA_LIBS ws2_32 secur32 ncrypt crypt32 bcrypt user32 atomic)
elseif(UNIX AND NOT APPLE)
  list(APPEND TAE_FFMPEG_EXTRA_LIBS atomic)
endif()

if(FFMPEG_FOUND)
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_HAS_FFMPEG=1)
  target_include_directories(twilight_audio_engine PRIVATE ${FFMPEG_INCLUDE_DIRS})
  target_link_libraries(twilight_audio_engine PRIVATE ${FFMPEG_LIBRARIES} ${TAE_FFMPEG_EXTRA_LIBS})
else()
  message(WARNING "FFmpeg development libraries were not found; native playback will report TAE_RESULT_BACKEND_UNAVAILABLE.")
endif()

if(TAE_WASAPI_AVAILABLE)
  target_sources(twilight_audio_engine PRIVATE
    output/wasapi/WasapiFormatNegotiator.cpp
    output/wasapi/WasapiSharedBackend.cpp
    output/wasapi/WasapiExclusiveBackend.cpp
  )
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_WASAPI=1)
  target_link_libraries(twilight_audio_engine PRIVATE ole32 uuid avrt)
endif()

if(TAE_ASIO_AVAILABLE)
  target_sources(twilight_audio_engine PRIVATE
    output/asio/AsioBackend.cpp
    output/asio/DeviceCapabilityCache.cpp
    output/asio/RealAsioHost.cpp
  )
  set(TAE_ASIO_SDK_SOURCES
    "${TAE_ASIO_SDK_DIR}/common/asio.cpp"
    "${TAE_ASIO_SDK_DIR}/host/asiodrivers.cpp"
    "${TAE_ASIO_SDK_DIR}/host/pc/asiolist.cpp"
  )
  set_source_files_properties(${TAE_ASIO_SDK_SOURCES} PROPERTIES
    COMPILE_DEFINITIONS "interface=struct"
    COMPILE_OPTIONS "-include;unknwn.h"
  )
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_ASIO=1)
  target_include_directories(twilight_audio_engine PRIVATE
    "${TAE_ASIO_SDK_DIR}/common"
    "${TAE_ASIO_SDK_DIR}/host"
    "${TAE_ASIO_SDK_DIR}/host/pc"
  )
  target_sources(twilight_audio_engine PRIVATE ${TAE_ASIO_SDK_SOURCES})
  target_link_libraries(twilight_audio_engine PRIVATE ole32 uuid winmm)
endif()

if(TAE_COREAUDIO_AVAILABLE)
  target_sources(twilight_audio_engine PRIVATE
    output/coreaudio/CoreAudioBackend.cpp
    output/coreaudio/CoreAudioExclusiveBackend.cpp
    output/coreaudio/RealCoreAudioHost.cpp
  )
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_COREAUDIO=1)
  target_link_libraries(twilight_audio_engine PRIVATE
    "-framework CoreAudio"
    "-framework CoreFoundation"
    "-framework AudioToolbox"
    "-framework AudioUnit"
  )
endif()

if(TAE_ALSA_AVAILABLE)
  target_sources(twilight_audio_engine PRIVATE
    output/alsa/AlsaBackend.cpp
    output/alsa/RealAlsaHost.cpp
  )
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_ALSA=1)
  target_include_directories(twilight_audio_engine PRIVATE ${ALSA_INCLUDE_DIRS})
  target_link_libraries(twilight_audio_engine PRIVATE ${ALSA_LIBRARIES})
endif()

if(TAE_BUILD_NAPI)
  add_library(twilight_audio_node MODULE napi/twilight_audio_node.cpp)
  if(WIN32)
    target_sources(twilight_audio_node PRIVATE napi/node_api_dynamic_win32.cpp)
  endif()
  target_link_libraries(twilight_audio_node PRIVATE twilight_audio_engine)
  target_include_directories(twilight_audio_node PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  target_compile_definitions(twilight_audio_node PRIVATE NAPI_VERSION=10)
  set_target_properties(twilight_audio_node PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    BUILD_RPATH "$ORIGIN"
    INSTALL_RPATH "$ORIGIN"
  )

  if(NOT TAE_NODE_INCLUDE_DIR)
    set(_tae_local_node_api_headers "${CMAKE_CURRENT_SOURCE_DIR}/../node_modules/node-api-headers/include")
    if(EXISTS "${_tae_local_node_api_headers}/node_api.h")
      set(TAE_NODE_INCLUDE_DIR "${_tae_local_node_api_headers}")
    endif()
  endif()

  if(TAE_NODE_INCLUDE_DIR)
    target_include_directories(twilight_audio_node PRIVATE ${TAE_NODE_INCLUDE_DIR})
  else()
    message(FATAL_ERROR "TAE_NODE_INCLUDE_DIR is not set and node_modules/node-api-headers/include was not found.")
  endif()
endif()

message(STATUS "Twilight Audio Engine feature summary:")
message(STATUS "  WASAPI: ${TAE_WASAPI_AVAILABLE}")
message(STATUS "  ASIO: ${TAE_ASIO_AVAILABLE} (SDK: ${TAE_ASIO_SDK_DIR})")
message(STATUS "  CoreAudio: ${TAE_COREAUDIO_AVAILABLE}")
if(TAE_ALSA_AVAILABLE)
  message(STATUS "  ALSA: ${TAE_ALSA_AVAILABLE} (libraries: ${ALSA_LIBRARIES})")
else()
  message(STATUS "  ALSA: ${TAE_ALSA_AVAILABLE}")
endif()
message(STATUS "  FFmpeg: ${FFMPEG_FOUND}")
message(STATUS "  Node-API: ${TAE_BUILD_NAPI}")

if(TAE_BUILD_TESTS)
  enable_testing()
  add_executable(twilight_audio_tests tests/engine_smoke.cpp)
  target_link_libraries(twilight_audio_tests PRIVATE twilight_audio_engine)
  add_test(NAME twilight_audio_engine_smoke COMMAND twilight_audio_tests)

  add_executable(twilight_dsp_tests
    tests/dsp_tests.cpp
    dsp/ChannelRouter.cpp
    dsp/ConvolverProcessor.cpp
    dsp/CrossfeedProcessor.cpp
    dsp/DspChain.cpp
    dsp/FftSpectrumAnalyzer.cpp
    dsp/KissFftAdapter.cpp
    dsp/ParametricEqProcessor.cpp
    dsp/ReplayGainProcessor.cpp
    plugins/PluginRegistry.cpp
  )
  target_include_directories(twilight_dsp_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  target_compile_definitions(twilight_dsp_tests PRIVATE TAE_DSP_CHAIN_TESTS=1)
  target_link_libraries(twilight_dsp_tests PRIVATE ${CMAKE_DL_LIBS})
  add_test(NAME twilight_dsp_unit COMMAND twilight_dsp_tests)

  add_executable(twilight_channel_router_tests
    tests/channel_router_tests.cpp
    dsp/ChannelRouter.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_channel_router_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  add_test(NAME twilight_channel_router_unit COMMAND twilight_channel_router_tests)

  add_executable(twilight_audio_buffer_tests
    tests/audio_buffer_tests.cpp
    core/AudioBuffer.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_audio_buffer_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  add_test(NAME twilight_audio_buffer_unit COMMAND twilight_audio_buffer_tests)

  add_library(twilight_test_gain_dsp_plugin SHARED tests/test_gain_dsp_plugin.cpp)
  target_include_directories(twilight_test_gain_dsp_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  add_library(twilight_test_fault_dsp_plugin SHARED tests/test_fault_dsp_plugin.cpp)
  target_include_directories(twilight_test_fault_dsp_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  add_library(twilight_test_bad_abi_dsp_plugin SHARED tests/test_bad_abi_dsp_plugin.cpp)
  target_include_directories(twilight_test_bad_abi_dsp_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  add_library(twilight_test_invalid_param_dsp_plugin SHARED tests/test_invalid_param_dsp_plugin.cpp)
  target_include_directories(twilight_test_invalid_param_dsp_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  add_library(twilight_crossfeed_dsp_plugin SHARED tests/test_crossfeed_dsp_plugin.cpp)
  target_include_directories(twilight_crossfeed_dsp_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  add_library(twilight_test_crash_dsp_plugin SHARED tests/test_crash_dsp_plugin.cpp)
  target_include_directories(twilight_test_crash_dsp_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  if(WIN32)
    set_target_properties(twilight_test_gain_dsp_plugin PROPERTIES PREFIX "")
    set_target_properties(twilight_test_fault_dsp_plugin PROPERTIES PREFIX "")
    set_target_properties(twilight_test_bad_abi_dsp_plugin PROPERTIES PREFIX "")
    set_target_properties(twilight_test_invalid_param_dsp_plugin PROPERTIES PREFIX "")
    set_target_properties(twilight_crossfeed_dsp_plugin PROPERTIES PREFIX "")
    set_target_properties(twilight_test_crash_dsp_plugin PROPERTIES PREFIX "")
  endif()

  add_executable(twilight_native_dsp_plugin_tests
    tests/native_dsp_plugin_tests.cpp
    plugins/PluginRegistry.cpp
  )
  target_include_directories(twilight_native_dsp_plugin_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
  target_link_libraries(twilight_native_dsp_plugin_tests PRIVATE twilight_audio_engine)
  add_test(
    NAME twilight_native_dsp_plugin_unit
    COMMAND twilight_native_dsp_plugin_tests
      $<TARGET_FILE:twilight_test_gain_dsp_plugin>
      $<TARGET_FILE:twilight_test_fault_dsp_plugin>
      $<TARGET_FILE:twilight_test_bad_abi_dsp_plugin>
      $<TARGET_FILE:twilight_test_invalid_param_dsp_plugin>
      $<TARGET_FILE:twilight_crossfeed_dsp_plugin>
      $<TARGET_FILE:twilight_test_crash_dsp_plugin>
  )
  add_test(
    NAME twilight_native_dsp_plugin_crash_fixture
    COMMAND twilight_native_dsp_plugin_tests
      --expect-crash-fixture
      $<TARGET_FILE:twilight_test_crash_dsp_plugin>
  )

  add_executable(twilight_metadata_tests
    metadata/metadata_tests.cpp
    metadata/AudioMetadataService.cpp
    decoder/SacdIsoDemuxer.cpp
    decoder/DstDecoder.cpp
    decoder/SacdDstDecoderProvider.cpp
    decoder/vendor/dstdec/dstdec.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_metadata_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  if(FFMPEG_FOUND)
    target_compile_definitions(twilight_metadata_tests PRIVATE TAE_HAS_FFMPEG=1)
    target_include_directories(twilight_metadata_tests PRIVATE ${FFMPEG_INCLUDE_DIRS})
    target_link_libraries(twilight_metadata_tests PRIVATE ${FFMPEG_LIBRARIES} ${TAE_FFMPEG_EXTRA_LIBS})
  endif()
  add_test(NAME twilight_metadata_unit COMMAND twilight_metadata_tests)

  add_executable(twilight_bitperfect_tests
    tests/bitperfect_tests.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_bitperfect_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  add_test(NAME twilight_bitperfect_unit COMMAND twilight_bitperfect_tests)

  add_executable(twilight_ffmpeg_decoder_tests
    tests/ffmpeg_decoder_tests.cpp
    tests/AudioFixtureLibrary.cpp
    decoder/FFmpegDecoder.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_ffmpeg_decoder_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  if(FFMPEG_FOUND)
    target_compile_definitions(twilight_ffmpeg_decoder_tests PRIVATE TAE_HAS_FFMPEG=1)
    target_include_directories(twilight_ffmpeg_decoder_tests PRIVATE ${FFMPEG_INCLUDE_DIRS})
    target_link_libraries(twilight_ffmpeg_decoder_tests PRIVATE ${FFMPEG_LIBRARIES} ${TAE_FFMPEG_EXTRA_LIBS})
  endif()
  add_test(NAME twilight_ffmpeg_decoder_unit COMMAND twilight_ffmpeg_decoder_tests)

  add_executable(twilight_dsd_dop_tests
    tests/dsd_dop_tests.cpp
    decoder/DopPacker.cpp
    decoder/DsdReader.cpp
    decoder/SacdIsoDemuxer.cpp
    decoder/DstDecoder.cpp
    decoder/SacdDstDecoderProvider.cpp
    decoder/vendor/dstdec/dstdec.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_dsd_dop_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  add_test(NAME twilight_dsd_dop_unit COMMAND twilight_dsd_dop_tests)

  add_executable(twilight_queue_tests
    tests/queue_tests.cpp
    playlist/QueueManager.cpp
  )
  target_include_directories(twilight_queue_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  add_test(NAME twilight_queue_unit COMMAND twilight_queue_tests)

  add_executable(twilight_backend_factory_tests tests/backend_factory_tests.cpp)
  target_include_directories(twilight_backend_factory_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  target_link_libraries(twilight_backend_factory_tests PRIVATE twilight_audio_engine)
  add_test(NAME twilight_backend_factory_unit COMMAND twilight_backend_factory_tests)

  add_executable(twilight_platform_backend_smoke
    tests/platform_backend_smoke.cpp
    core/AudioTypes.cpp
    output/coreaudio/CoreAudioBackend.cpp
    output/coreaudio/CoreAudioExclusiveBackend.cpp
  )
  target_include_directories(twilight_platform_backend_smoke PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  target_link_libraries(twilight_platform_backend_smoke PRIVATE twilight_audio_engine)
  if(TAE_WASAPI_AVAILABLE)
    target_sources(twilight_platform_backend_smoke PRIVATE
      output/wasapi/WasapiFormatNegotiator.cpp
      output/wasapi/WasapiSharedBackend.cpp
      output/wasapi/WasapiExclusiveBackend.cpp
    )
    target_compile_definitions(twilight_platform_backend_smoke PRIVATE TAE_ENABLE_WASAPI=1)
    target_link_libraries(twilight_platform_backend_smoke PRIVATE ole32 uuid avrt)
  endif()
  if(TAE_COREAUDIO_AVAILABLE)
    target_sources(twilight_platform_backend_smoke PRIVATE output/coreaudio/RealCoreAudioHost.cpp)
    target_compile_definitions(twilight_platform_backend_smoke PRIVATE TAE_ENABLE_COREAUDIO=1)
    target_link_libraries(twilight_platform_backend_smoke PRIVATE
      "-framework CoreAudio"
      "-framework CoreFoundation"
      "-framework AudioToolbox"
      "-framework AudioUnit"
    )
  endif()
  if(TAE_ALSA_AVAILABLE)
    target_sources(twilight_platform_backend_smoke PRIVATE output/alsa/AlsaBackend.cpp)
    target_compile_definitions(twilight_platform_backend_smoke PRIVATE TAE_ENABLE_ALSA=1)
    target_include_directories(twilight_platform_backend_smoke PRIVATE ${ALSA_INCLUDE_DIRS})
    target_link_libraries(twilight_platform_backend_smoke PRIVATE ${ALSA_LIBRARIES})
  endif()
  add_test(NAME twilight_platform_backend_smoke COMMAND twilight_platform_backend_smoke)

  if(TAE_WASAPI_AVAILABLE)
    add_executable(twilight_wasapi_format_negotiator_tests
      tests/wasapi_format_negotiator_tests.cpp
      output/wasapi/WasapiFormatNegotiator.cpp
      core/AudioTypes.cpp
    )
    target_include_directories(twilight_wasapi_format_negotiator_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_compile_definitions(twilight_wasapi_format_negotiator_tests PRIVATE TAE_ENABLE_WASAPI=1)
    target_link_libraries(twilight_wasapi_format_negotiator_tests PRIVATE ole32 uuid)
    add_test(NAME twilight_wasapi_format_negotiator_unit COMMAND twilight_wasapi_format_negotiator_tests)
  endif()

  add_executable(twilight_asio_backend_tests
    tests/asio_backend_tests.cpp
    output/asio/AsioBackend.cpp
    output/asio/DeviceCapabilityCache.cpp
    output/asio/MockAsioHost.cpp
    output/asio/RealAsioHost.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_asio_backend_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  if(TAE_ASIO_AVAILABLE)
    target_compile_definitions(twilight_asio_backend_tests PRIVATE TAE_ENABLE_ASIO=1)
    target_include_directories(twilight_asio_backend_tests PRIVATE
      "${TAE_ASIO_SDK_DIR}/common"
      "${TAE_ASIO_SDK_DIR}/host"
      "${TAE_ASIO_SDK_DIR}/host/pc"
    )
    target_sources(twilight_asio_backend_tests PRIVATE ${TAE_ASIO_SDK_SOURCES})
    target_link_libraries(twilight_asio_backend_tests PRIVATE ole32 uuid winmm)
  endif()
  add_test(NAME twilight_asio_backend_unit COMMAND twilight_asio_backend_tests)

  add_executable(twilight_output_backend_tests
    tests/output_backend_tests.cpp
    output/asio/AsioBackend.cpp
    output/asio/DeviceCapabilityCache.cpp
    output/asio/MockAsioHost.cpp
    output/asio/RealAsioHost.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_output_backend_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  if(TAE_ASIO_AVAILABLE)
    target_compile_definitions(twilight_output_backend_tests PRIVATE TAE_ENABLE_ASIO=1)
    target_include_directories(twilight_output_backend_tests PRIVATE
      "${TAE_ASIO_SDK_DIR}/common"
      "${TAE_ASIO_SDK_DIR}/host"
      "${TAE_ASIO_SDK_DIR}/host/pc"
    )
    target_sources(twilight_output_backend_tests PRIVATE ${TAE_ASIO_SDK_SOURCES})
    target_link_libraries(twilight_output_backend_tests PRIVATE ole32 uuid winmm)
  endif()
  add_test(NAME twilight_output_backend_unit COMMAND twilight_output_backend_tests)

  add_executable(twilight_runtime_queue_reroute_tests
    tests/runtime_queue_reroute_tests.cpp
    core/AudioBuffer.cpp
    core/AudioPipeline.cpp
    core/AudioTypes.cpp
    core/TwilightAudioEngine.cpp
    analysis/BpmAnalyzer.cpp
    decoder/DopPacker.cpp
    decoder/DsdReader.cpp
    decoder/SacdIsoDemuxer.cpp
    decoder/DstDecoder.cpp
    decoder/SacdDstDecoderProvider.cpp
    decoder/vendor/dstdec/dstdec.cpp
    dsp/ChannelRouter.cpp
    dsp/ConvolverProcessor.cpp
    dsp/CrossfeedProcessor.cpp
    dsp/DspChain.cpp
    dsp/FftSpectrumAnalyzer.cpp
    dsp/KissFftAdapter.cpp
    dsp/ParametricEqProcessor.cpp
    dsp/ReplayGainProcessor.cpp
    plugins/PluginRegistry.cpp
    playlist/QueueManager.cpp
  )
  target_include_directories(twilight_runtime_queue_reroute_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  )
  target_link_libraries(twilight_runtime_queue_reroute_tests PRIVATE ${CMAKE_DL_LIBS})
  add_test(NAME twilight_runtime_queue_reroute_unit COMMAND twilight_runtime_queue_reroute_tests)

  add_executable(twilight_dst_decoder_tests
    tests/dst_decoder_tests.cpp
    decoder/DstDecoder.cpp
    decoder/vendor/dstdec/dstdec.cpp
  )
  target_include_directories(twilight_dst_decoder_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  add_test(NAME twilight_dst_decoder_unit COMMAND twilight_dst_decoder_tests)

  add_executable(twilight_coreaudio_backend_tests
    tests/coreaudio_backend_tests.cpp
    output/coreaudio/CoreAudioBackend.cpp
    output/coreaudio/CoreAudioExclusiveBackend.cpp
    output/coreaudio/MockCoreAudioHost.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_coreaudio_backend_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  if(TAE_COREAUDIO_AVAILABLE)
    target_sources(twilight_coreaudio_backend_tests PRIVATE output/coreaudio/RealCoreAudioHost.cpp)
    target_compile_definitions(twilight_coreaudio_backend_tests PRIVATE TAE_ENABLE_COREAUDIO=1)
    target_link_libraries(twilight_coreaudio_backend_tests PRIVATE
      "-framework CoreAudio"
      "-framework CoreFoundation"
      "-framework AudioToolbox"
      "-framework AudioUnit"
    )
  endif()
  add_test(NAME twilight_coreaudio_backend_unit COMMAND twilight_coreaudio_backend_tests)

  add_executable(twilight_alsa_backend_tests
    tests/alsa_backend_tests.cpp
    output/alsa/AlsaBackend.cpp
    output/alsa/MockAlsaHost.cpp
    output/alsa/RealAlsaHost.cpp
    core/AudioTypes.cpp
  )
  target_include_directories(twilight_alsa_backend_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  if(TAE_ALSA_AVAILABLE)
    target_compile_definitions(twilight_alsa_backend_tests PRIVATE TAE_ENABLE_ALSA=1)
    target_include_directories(twilight_alsa_backend_tests PRIVATE ${ALSA_INCLUDE_DIRS})
    target_link_libraries(twilight_alsa_backend_tests PRIVATE ${ALSA_LIBRARIES})
  endif()
  add_test(NAME twilight_alsa_backend_unit COMMAND twilight_alsa_backend_tests)

  add_executable(audio_output_benchmark
    tests/output_backend_benchmark.cpp
  )
  target_include_directories(audio_output_benchmark PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
endif()
