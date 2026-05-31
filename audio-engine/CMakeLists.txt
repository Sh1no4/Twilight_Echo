cmake_minimum_required(VERSION 3.25)

project(TwilightAudioEngine VERSION 0.1.0 LANGUAGES CXX)

option(TAE_BUILD_NAPI "Build the Node-API bridge" OFF)
option(TAE_BUILD_TESTS "Build Twilight Audio Engine tests" ON)
option(TAE_ENABLE_WASAPI "Enable the Windows WASAPI backend" ON)
option(TAE_ENABLE_ASIO "Enable optional ASIO backend when the SDK is available" OFF)
option(TAE_ENABLE_COREAUDIO "Enable the macOS CoreAudio backend" ON)
option(TAE_ENABLE_ALSA "Enable the Linux ALSA backend" ON)

set(TAE_NODE_INCLUDE_DIR "" CACHE PATH "Path to Node-API headers")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(twilight_audio_engine SHARED
  core/AudioBuffer.cpp
  core/AudioPipeline.cpp
  core/TwilightAudioEngine.cpp
  decoder/FFmpegDecoder.cpp
  devices/DeviceManager.cpp
  dsp/DspChain.cpp
  dsp/SpectrumAnalyzer.cpp
  metadata/AudioMetadataService.cpp
  output/OutputBackendFactory.cpp
  output/wasapi/WasapiFormatNegotiator.cpp
  output/wasapi/WasapiSharedBackend.cpp
  output/wasapi/WasapiExclusiveBackend.cpp
  output/asio/AsioBackend.cpp
  output/coreaudio/CoreAudioBackend.cpp
  output/alsa/AlsaBackend.cpp
  playlist/QueueManager.cpp
  plugins/PluginRegistry.cpp
  utils/StringUtils.cpp
)

target_include_directories(twilight_audio_engine
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_definitions(twilight_audio_engine PRIVATE TAE_BUILDING_LIBRARY=1)

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
if(FFMPEG_FOUND)
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_HAS_FFMPEG=1)
  target_include_directories(twilight_audio_engine PRIVATE ${FFMPEG_INCLUDE_DIRS})
  target_link_libraries(twilight_audio_engine PRIVATE ${FFMPEG_LIBRARIES})
else()
  message(WARNING "FFmpeg development libraries were not found; native playback will report TAE_RESULT_BACKEND_UNAVAILABLE.")
endif()

if(WIN32 AND TAE_ENABLE_WASAPI)
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_WASAPI=1)
  target_link_libraries(twilight_audio_engine PRIVATE ole32 uuid avrt)
endif()

if(APPLE AND TAE_ENABLE_COREAUDIO)
  target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_COREAUDIO=1)
  target_link_libraries(twilight_audio_engine PRIVATE "-framework CoreAudio" "-framework AudioToolbox")
endif()

if(UNIX AND NOT APPLE AND TAE_ENABLE_ALSA)
  find_package(ALSA QUIET)
  if(ALSA_FOUND)
    target_compile_definitions(twilight_audio_engine PRIVATE TAE_ENABLE_ALSA=1)
    target_include_directories(twilight_audio_engine PRIVATE ${ALSA_INCLUDE_DIRS})
    target_link_libraries(twilight_audio_engine PRIVATE ${ALSA_LIBRARIES})
  endif()
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

if(TAE_BUILD_TESTS)
  enable_testing()
  add_executable(twilight_audio_tests tests/engine_smoke.cpp)
  target_link_libraries(twilight_audio_tests PRIVATE twilight_audio_engine)
  add_test(NAME twilight_audio_engine_smoke COMMAND twilight_audio_tests)
endif()
