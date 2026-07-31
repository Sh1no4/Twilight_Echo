cmake_minimum_required(VERSION 3.25)

project(TwilightAsioAbiFixture LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The ASIO ABI fixture requires MSVC on Windows x64")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(TAE_AUDIO_ENGINE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_library(twilight_asio_fake_driver SHARED FakeAsioDriver.cpp)
target_include_directories(twilight_asio_fake_driver PRIVATE "${TAE_AUDIO_ENGINE_ROOT}")
set_target_properties(twilight_asio_fake_driver PROPERTIES OUTPUT_NAME "twilight_asio_fake_driver")

add_executable(twilight_asio_abi_manifest "${TAE_AUDIO_ENGINE_ROOT}/output/asio/abi/AsioAbiManifest.cpp")
target_include_directories(twilight_asio_abi_manifest PRIVATE "${TAE_AUDIO_ENGINE_ROOT}")
