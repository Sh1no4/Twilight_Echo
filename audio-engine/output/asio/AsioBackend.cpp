namespace twilight::audio {

bool asioBackendAvailable() {
#if defined(TAE_ENABLE_ASIO)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
