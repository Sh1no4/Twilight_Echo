namespace twilight::audio {

bool alsaBackendAvailable() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
