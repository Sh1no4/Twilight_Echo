namespace twilight::audio {

bool coreAudioBackendAvailable() {
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
