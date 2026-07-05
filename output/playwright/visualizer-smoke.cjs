(async (page) => {
  await page.goto('file:///D:/Twilight_Echo-main/resources/audio-visualizer/index.html');
  await page.evaluate(() => {
    const bins = 2048;
    let t = 0;
    window.postMessage({
      kind: 'track',
      track: {
        title: 'Visualizer smoothing check',
        artist: 'Twilight Echo',
        quality: 'FLAC / 24-bit / 48kHz',
        duration: '4:24',
        durationSeconds: 264,
        samplerate: '48.0 kHz',
        bitdepth: '24-bit',
        format: 'FLAC'
      }
    }, '*');
    window.postMessage({ kind: 'playback', isPlaying: true, position: 128, duration: 264 }, '*');
    clearInterval(window.__twilightVizInterval);
    window.__twilightVizInterval = setInterval(() => {
      t += 0.05;
      const data = Array.from({ length: bins }, (_, i) => {
        const x = i / (bins - 1);
        const bass = Math.exp(-Math.pow((x - 0.08 - Math.sin(t * 1.4) * 0.02) / 0.035, 2));
        const mid = 0.55 * Math.exp(-Math.pow((x - 0.36 - Math.sin(t * 0.9) * 0.04) / 0.06, 2));
        const high = 0.28 * Math.exp(-Math.pow((x - 0.72 - Math.cos(t * 1.2) * 0.05) / 0.09, 2));
        const texture = 0.04 * (Math.sin(i * 0.13 + t * 7) + 1);
        return Math.max(0, Math.min(1, bass + mid + high + texture));
      });
      const waveform = Array.from({ length: 96 }, (_, i) => 0.5 + Math.sin(i * 0.4 + t * 8) * 0.28);
      window.postMessage({ kind: 'spectrum', data, waveform, sampleRate: 48000, active: true }, '*');
      window.postMessage({ kind: 'playback', isPlaying: true, position: 128 + t, duration: 264 }, '*');
    }, 50);
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'D:/Twilight_Echo-main/output/playwright/visualizer-smoothing.png', fullPage: true });
})
