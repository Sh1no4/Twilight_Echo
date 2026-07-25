# Sleep Timer And Mute

The PlayerBar sleep timer can stop playback after a selected number of minutes, at the end
of the current track, or after the queue finishes. The player sends boundary events to the
main process, so the timer state remains observable while the renderer is restarted.

The default duration and fade-out time are configured in Settings > Playback. Duration is
limited to 1-720 minutes and fade-out to 0-120 seconds. A fade temporarily lowers the
application volume, stops playback, then restores the selected volume for the next manual
playback. If the player is already muted (or volume is 0), fade ends immediately without an
audible ramp. Cancelling a timer leaves playback unchanged and reports the cancellation in the
PlayerBar.

The PlayerBar mute button saves the last audible application volume. Clicking it again, or
raising volume from zero, restores that remembered level. Playback-session persistence keeps
an active timer and re-arms its minute schedule after session restore.
