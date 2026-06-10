
with open('d:\\Twilight_Echo-main\\src\\main\\audioEngineManager.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_str = '''        perfectReasonCode: isForcedPcm
          ? 'dsd_converted_to_pcm'
        perfectReason: sourceIsDsd
          ? 'DSD 当前已转换为 PCM 输出'
          : this.playbackInfo.outputInfo.perfectReason,
        capabilityReason: sourceIsDsd
          ? 'DSD 当前已转换为 PCM 输出'
          : this.playbackInfo.outputInfo.capabilityReason
      }
      this.syncPlaybackOutputMirrorsFromOutputInfo()
    }'''

new_str = '''        perfectReasonCode: isForcedPcm
          ? 'dsd_converted_to_pcm'
          : this.playbackInfo.outputInfo.perfectReasonCode === 'dsd_converted_to_pcm'
            ? ''
            : this.playbackInfo.outputInfo.perfectReasonCode,
        perfectReason: isForcedPcm
          ? 'DSD 当前已转换为 PCM 输出'
          : this.playbackInfo.outputInfo.perfectReason === 'DSD 当前已转换为 PCM 输出'
            ? ''
            : this.playbackInfo.outputInfo.perfectReason,
        capabilityReason: isForcedPcm
          ? 'DSD 当前已转换为 PCM 输出'
          : this.playbackInfo.outputInfo.capabilityReason === 'DSD 当前已转换为 PCM 输出'
            ? ''
            : this.playbackInfo.outputInfo.capabilityReason
      }
      this.syncPlaybackOutputMirrorsFromOutputInfo()
    }'''

content = content.replace(old_str, new_str)
with open('d:\\Twilight_Echo-main\\src\\main\\audioEngineManager.ts', 'w', encoding='utf-8') as f:
    f.write(content)

