export function createVisibilityPollingController(options: {
  isHidden: () => boolean
  stop: () => void
  resume: () => void
}) {
  return {
    shouldPoll: () => !options.isHidden(),
    onVisibilityChange: () => {
      if (options.isHidden()) options.stop()
      else options.resume()
    }
  }
}
