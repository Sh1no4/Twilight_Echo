<script setup lang="ts">
import { ref, onMounted } from 'vue'

const visualizerRef = ref<HTMLElement | null>(null)
const heatmapRef = ref<HTMLElement | null>(null)

onMounted(() => {
  if (visualizerRef.value) {
    for(let i = 0; i < 18; i++) {
      const bar = document.createElement('div')
      bar.className = 'bar'
      bar.style.animationDuration = (Math.random() * 350 + 250) + 'ms'
      bar.style.animationDelay = '-' + (Math.random() * 800) + 'ms'
      visualizerRef.value.appendChild(bar)
    }
  }

  if (heatmapRef.value) {
    const totalDays = 140
    for(let i = 0; i < totalDays; i++) {
      const cell = document.createElement('div')
      const progress = i / totalDays
      const rand = Math.random() + (progress * 0.4)
      
      let level = ''
      let hours = 0
      
      if (rand > 1.1) { level = 'level-4'; hours = Math.floor(Math.random() * 3 + 6) }
      else if (rand > 0.8) { level = 'level-3'; hours = Math.floor(Math.random() * 2 + 4) }
      else if (rand > 0.5) { level = 'level-2'; hours = Math.floor(Math.random() * 2 + 2) }
      else if (rand > 0.25) { level = 'level-1'; hours = 1 }
      
      cell.className = `heatmap-cell ${level}`
      
      const d = new Date()
      d.setDate(d.getDate() - (totalDays - i - 1))
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      
      if(hours > 0) {
        cell.setAttribute('data-info', `${hours} hours on ${dateStr}`)
      } else {
        cell.setAttribute('data-info', `No activity on ${dateStr}`)
      }
      
      heatmapRef.value.appendChild(cell)
    }
  }
})
</script>

<template>
  <div class="dashboard-wrapper">
    <div class="dashboard">

        <!-- Now Playing Card (Left Top - Horizontal & Wide) -->
        <div class="card now-playing">
            <div class="album-art-container">
                <div class="record-vinyl"></div>
                <div class="album-art">
                    <img src="https://images.unsplash.com/photo-1493225457124-a1a2a5eaebfc?q=80&w=600&auto=format&fit=crop" alt="Album Art">
                </div>
            </div>
            
            <div class="player-content">
                <div class="song-info">
                    <h2>Aura</h2>
                    <p>Bicep</p>
                    <div class="meta">Isles • FLAC 24-bit / 48kHz</div>
                </div>

                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                    <div class="time">
                        <span>03:42</span>
                        <span>05:13</span>
                    </div>
                </div>

                <div class="controls">
                    <button class="control-btn"><i class="ph ph-shuffle"></i></button>
                    <button class="control-btn"><i class="ph-fill ph-skip-back-circle"></i></button>
                    <button class="control-btn play-btn"><i class="ph-fill ph-pause"></i></button>
                    <button class="control-btn"><i class="ph-fill ph-skip-forward-circle"></i></button>
                    <button class="control-btn"><i class="ph ph-repeat"></i></button>
                </div>
            </div>
        </div>

        <!-- Listening Calendar Card (Left Bottom - Under Now Playing) -->
        <div class="card calendar-card">
            <div class="card-header">
                <i class="ph ph-calendar-blank"></i>
                Listening Journey
            </div>

            <div class="heatmap-container">
                <div class="heatmap-labels">
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                </div>
                <div class="heatmap" ref="heatmapRef">
                    <!-- Cells injected via JS -->
                </div>
            </div>

            <div class="calendar-stats">
                <div class="stat">
                    <span class="stat-value">86<span style="font-size:1rem;color:var(--text-muted);font-weight:600;">h</span></span>
                    <span class="stat-label">This Month</span>
                </div>
                <div class="stat">
                    <span class="stat-value">3.1<span style="font-size:1rem;color:var(--text-muted);font-weight:600;">h</span></span>
                    <span class="stat-label">Daily Avg</span>
                </div>
                <div class="stat">
                    <span class="stat-value">12</span>
                    <span class="stat-label">Day Streak</span>
                </div>
            </div>
        </div>

        <!-- Library Overview (Center Top) -->
        <div class="card library-card">
            <div class="card-header">
                <i class="ph ph-books"></i>
                Local Library
            </div>
            
            <div class="library-stats-header">
                <div class="lib-stat">
                    <span>24.5k</span>
                    <label>Tracks</label>
                </div>
                <div class="lib-stat">
                    <span>1,842</span>
                    <label>Albums</label>
                </div>
                <div class="lib-stat">
                    <span>142</span>
                    <label>Days</label>
                </div>
            </div>

            <h3 class="section-title">Recently Added</h3>
            <div class="recent-list">
                <div class="recent-item">
                    <img src="https://images.unsplash.com/photo-1621252179027-94459d278660?q=80&w=200&auto=format&fit=crop" alt="Album">
                    <div class="recent-info">
                        <h4>Random Access Memories</h4>
                        <p>Daft Punk</p>
                    </div>
                </div>
                <div class="recent-item">
                    <img src="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=200&auto=format&fit=crop" alt="Album">
                    <div class="recent-info">
                        <h4>Currents</h4>
                        <p>Tame Impala</p>
                    </div>
                </div>
                <div class="recent-item">
                    <img src="https://images.unsplash.com/photo-1619983081563-430f63602796?q=80&w=200&auto=format&fit=crop" alt="Album">
                    <div class="recent-info">
                        <h4>Discovery</h4>
                        <p>Daft Punk</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Top Tracks (Center Bottom) -->
        <div class="card top-tracks-card">
            <div class="card-header">
                <i class="ph ph-music-notes"></i>
                Top Tracks
            </div>

            <div class="track-list">
                <div class="track-item">
                    <div class="rank">1</div>
                    <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=200&auto=format&fit=crop" alt="Track">
                    <div class="track-info">
                        <h4>Midnight City</h4>
                        <p>M83 • 124 plays</p>
                    </div>
                </div>
                <div class="track-item">
                    <div class="rank">2</div>
                    <img src="https://images.unsplash.com/photo-1493225457124-a1a2a5eaebfc?q=80&w=200&auto=format&fit=crop" alt="Track">
                    <div class="track-info">
                        <h4>Aura</h4>
                        <p>Bicep • 98 plays</p>
                    </div>
                </div>
                <div class="track-item">
                    <div class="rank">3</div>
                    <img src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=200&auto=format&fit=crop" alt="Track">
                    <div class="track-info">
                        <h4>Resonance</h4>
                        <p>HOME • 86 plays</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- DSP Chain Card (Right - Vertical) -->
        <div class="card dsp-chain">
            <div class="card-header">
                <i class="ph ph-sliders-horizontal"></i>
                DSP Chain
            </div>
            
            <div class="dsp-scroll-container">
                <div class="dsp-nodes">
                    <div class="dsp-node active">
                        <i class="ph ph-file-audio"></i>
                        <div class="name">Source File</div>
                        <div class="status-dot"></div>
                    </div>
                    <div class="dsp-node active">
                        <i class="ph ph-wave-sine"></i>
                        <div class="name">SOXR Resampler</div>
                        <div class="status-dot"></div>
                    </div>
                    <div class="dsp-node">
                        <i class="ph ph-faders"></i>
                        <div class="name">10-Band EQ</div>
                        <div class="status-dot"></div>
                    </div>
                    <div class="dsp-node active">
                        <i class="ph ph-headphones"></i>
                        <div class="name">Bauer Crossfeed</div>
                        <div class="status-dot"></div>
                    </div>
                    <div class="dsp-node active">
                        <i class="ph ph-speaker-hifi"></i>
                        <div class="name">ASIO Output</div>
                        <div class="status-dot"></div>
                    </div>
                </div>
            </div>

            <!-- Horizontal Spectrum Analyzer (Right to Left) -->
            <div class="visualizer-container">
                <div class="visualizer-title">
                    Spectrum
                    <i class="ph-fill ph-waveform"></i>
                </div>
                <div class="visualizer" ref="visualizerRef">
                    <!-- Bars injected via JS -->
                </div>
            </div>
        </div>

    </div>
  </div>
</template>

<style scoped>
.dashboard-wrapper {
  /* Light Mode Color Palette variables mapped specifically for the dashboard */
  --card-bg: rgba(255, 255, 255, 0.7);
  --card-border: rgba(255, 255, 255, 0.8);
  --text-main: #1f2937;
  --text-muted: #6b7280;
  --accent: #4f46e5;      /* Indigo */
  --accent-light: #818cf8;
  --accent-glow: rgba(79, 70, 229, 0.15);
  --success: #10b981;

  font-family: 'Inter', sans-serif;
  color: var(--text-main);
  width: 100%;
  height: 100%;
  padding: 2rem 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Updated Grid Layout: 
    Col 1 (Wide, Left): Now Playing (Top), Calendar (Bottom)
    Col 2 (Medium, Center): Library (Top), Top Tracks (Bottom)
    Col 3 (Narrow, Right): DSP Chain (Vertical, Top to Bottom)
*/
.dashboard {
    display: grid;
    grid-template-columns: 1fr 340px 280px;
    grid-template-rows: auto 1fr;
    gap: 1.5rem;
    max-width: 1650px;
    width: 100%;
    margin: 0 auto;
}

.card {
    background: var(--card-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--card-border);
    border-radius: 28px;
    padding: 1.8rem;
    box-shadow: 0 10px 40px rgba(31, 38, 135, 0.06);
    transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 15px 50px rgba(31, 38, 135, 0.1);
}

/* --- Shared Header --- */
.card-header {
    font-family: 'Outfit', sans-serif;
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-main);
}

.card-header i {
    color: var(--accent);
    font-size: 1.4rem;
}

/* --- Now Playing Section (Left Top - Horizontal) --- */
.now-playing {
    grid-column: 1 / 2;
    grid-row: 1 / 2;
    flex-direction: row;
    align-items: center;
    gap: 3rem;
    padding: 2.5rem 3rem;
}

.album-art-container {
    position: relative;
    flex-shrink: 0;
    width: 240px;
    height: 240px;
}

.album-art {
    width: 100%;
    height: 100%;
    border-radius: 20px;
    box-shadow: 0 15px 35px rgba(0,0,0,0.15), 0 0 50px var(--accent-glow);
    overflow: hidden;
    position: relative;
    z-index: 2;
    animation: float 6s ease-in-out infinite;
}

.album-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
}

.album-art:hover img {
    transform: scale(1.05);
}

.record-vinyl {
    position: absolute;
    top: 5%;
    right: -12%;
    width: 220px;
    height: 220px;
    background: #e5e7eb;
    border-radius: 50%;
    z-index: 1;
    border: 2px solid #d1d5db;
    box-shadow: inset 0 0 0 8px #f3f4f6, inset 0 0 0 10px #e5e7eb;
    animation: spin 5s linear infinite;
}

@keyframes spin {
    100% { transform: rotate(360deg); }
}

@keyframes float {
    0% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
    100% { transform: translateY(0px); }
}

.player-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.song-info {
    width: 100%;
    text-align: left;
}

.song-info h2 {
    font-family: 'Outfit', sans-serif;
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
    letter-spacing: -0.5px;
    background: linear-gradient(135deg, #1f2937 0%, #4b5563 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.song-info p {
    color: var(--accent);
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 0.6rem;
}

.song-info .meta {
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 500;
    margin-bottom: 2rem;
    background: rgba(0,0,0,0.04);
    padding: 4px 12px;
    border-radius: 12px;
    display: inline-block;
}

.progress-container {
    width: 100%;
    margin-bottom: 2rem;
}

.progress-bar {
    height: 8px;
    background: rgba(0,0,0,0.06);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    cursor: pointer;
}

.progress-fill {
    position: absolute;
    top: 0; left: 0; height: 100%;
    width: 65%;
    background: linear-gradient(90deg, var(--accent), var(--accent-light));
    border-radius: 4px;
    box-shadow: 0 0 10px var(--accent-glow);
    transition: width 0.1s linear;
}

.time {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-top: 0.8rem;
    font-variant-numeric: tabular-nums;
}

.controls {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 1.5rem;
    width: 100%;
}

.control-btn {
    background: none;
    border: none;
    color: var(--text-main);
    font-size: 1.6rem;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0.7;
}

.control-btn:hover {
    opacity: 1;
    color: var(--accent);
    transform: scale(1.1);
}

.play-btn {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), #6366f1);
    color: white;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 2rem;
    opacity: 1;
    box-shadow: 0 8px 18px var(--accent-glow);
}

.play-btn:hover {
    transform: scale(1.08);
    box-shadow: 0 12px 24px rgba(79, 70, 229, 0.3);
    color: white;
}

/* --- Calendar Section (Left Bottom - Under Now Playing) --- */
.calendar-card {
    grid-column: 1 / 2;
    grid-row: 2 / 3;
}

.heatmap-container {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    flex-grow: 1;
}

.heatmap-labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    padding-top: 0.5rem;
    padding-right: 0.5rem;
}

.heatmap {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18px, 1fr));
    grid-template-rows: repeat(5, 1fr);
    gap: 5px;
    flex-grow: 1;
    width: 100%;
}

:deep(.heatmap-cell) {
    aspect-ratio: 1;
    border-radius: 4px;
    background: rgba(0,0,0,0.04);
    border: 1px solid rgba(0,0,0,0.02);
    transition: all 0.2s;
    cursor: pointer;
    position: relative;
}

:deep(.heatmap-cell:hover) {
    transform: scale(1.4);
    z-index: 10;
    border-radius: 6px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

:deep(.heatmap-cell::after) {
    content: attr(data-info);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%) translateY(5px);
    background: #1f2937;
    color: #fff;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 20;
}

:deep(.heatmap-cell:hover::after) {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

:deep(.level-1) { background: rgba(79, 70, 229, 0.2); border-color: rgba(79, 70, 229, 0.1); }
:deep(.level-2) { background: rgba(79, 70, 229, 0.45); border-color: rgba(79, 70, 229, 0.2); }
:deep(.level-3) { background: rgba(79, 70, 229, 0.75); border-color: rgba(79, 70, 229, 0.4); }
:deep(.level-4) { background: rgba(79, 70, 229, 1); box-shadow: 0 0 12px var(--accent-glow); border-color: var(--accent); }

.calendar-stats {
    display: flex;
    justify-content: space-around;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(0,0,0,0.06);
}

.stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
}

.stat-value {
    font-family: 'Outfit', sans-serif;
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text-main);
}

.stat-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* --- Library Overview Section (Center Top) --- */
.library-card {
    grid-column: 2 / 3;
    grid-row: 1 / 2;
}

.library-stats-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    background: rgba(0,0,0,0.02);
    padding: 1rem;
    border-radius: 16px;
}

.lib-stat { text-align: center; }
.lib-stat span { display: block; font-weight: 700; font-size: 1.1rem; color: var(--accent); }
.lib-stat label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; }

.section-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 1rem;
}

.recent-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.recent-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    border-radius: 12px;
    transition: background 0.2s;
    cursor: pointer;
}

.recent-item:hover { background: rgba(0,0,0,0.04); }

.recent-item img {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.recent-info h4 {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
    color: var(--text-main);
}

.recent-info p {
    font-size: 0.75rem;
    color: var(--text-muted);
}

/* --- Top Tracks Section (Center Bottom) --- */
.top-tracks-card {
    grid-column: 2 / 3;
    grid-row: 2 / 3;
}

.track-list {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
}

.track-item {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.track-item .rank {
    font-family: 'Outfit', sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-muted);
    width: 20px;
    text-align: center;
}

.track-item img {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
}

.track-info { flex-grow: 1; }

.track-info h4 {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 0.1rem;
}

.track-info p {
    font-size: 0.75rem;
    color: var(--accent);
    font-weight: 500;
}

/* --- DSP Chain Section (Right - Vertical) --- */
.dsp-chain {
    grid-column: 3 / 4;
    grid-row: 1 / 3;
    padding: 1.5rem;
}

.dsp-scroll-container {
    overflow-y: auto;
    overflow-x: hidden;
    flex-grow: 1;
    padding-right: 0.5rem;
    margin-bottom: 1.5rem;
    scrollbar-width: thin;
    scrollbar-color: var(--accent-light) rgba(0,0,0,0.05);
}

.dsp-scroll-container::-webkit-scrollbar { width: 4px; }
.dsp-scroll-container::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); border-radius: 2px; }
.dsp-scroll-container::-webkit-scrollbar-thumb { background: var(--accent-light); border-radius: 2px; }

.dsp-nodes {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    position: relative;
    padding: 0.5rem 0;
}

/* Vertical Connecting line */
.dsp-nodes::before {
    content: '';
    position: absolute;
    top: 0; bottom: 0; left: 50%;
    width: 2px;
    background: rgba(0,0,0,0.06);
    z-index: 0;
    transform: translateX(-50%);
}

.dsp-node {
    position: relative;
    z-index: 1;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid rgba(0,0,0,0.05);
    padding: 0.8rem 1rem;
    border-radius: 14px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.8rem;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(0,0,0,0.02);
}

.dsp-node:hover {
    background: #ffffff;
    transform: translateX(-4px);
    box-shadow: 0 8px 15px rgba(0,0,0,0.05);
}

.dsp-node.active {
    border-color: var(--accent);
    background: #fff;
    box-shadow: 0 6px 16px var(--accent-glow);
}

.dsp-node i {
    font-size: 1.4rem;
    color: var(--text-muted);
    transition: color 0.3s;
}

.dsp-node.active i {
    color: var(--accent);
}

.dsp-node .name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-main);
    line-height: 1.2;
}

.dsp-node .status-dot {
    position: absolute;
    top: 50%; right: -4px;
    transform: translateY(-50%);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(0,0,0,0.1);
}

.dsp-node.active .status-dot {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
    right: -6px;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
}

/* --- Horizontal Spectrum Analyzer (Right to Left) --- */
.visualizer-container {
    width: 100%;
    margin-top: auto;
    border-top: 1px solid rgba(0,0,0,0.05);
    padding-top: 1.5rem;
}

.visualizer-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--text-muted);
    margin-bottom: 1rem;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    justify-content: flex-end; /* Align title to the right */
    gap: 0.5rem;
    padding-right: 0.5rem;
}

.visualizer-title i {
    color: var(--accent);
    font-size: 1rem;
}

.visualizer {
    display: flex;
    flex-direction: column; /* Stack bars vertically */
    align-items: flex-end;  /* Align bars to the right */
    gap: 4px;
    width: 100%;
    padding-right: 0.5rem;
}

:deep(.bar) {
    height: 5px; /* Fixed height for horizontal bars */
    background: linear-gradient(to left, var(--accent), var(--accent-light)); /* Gradient right to left */
    border-radius: 3px 0 0 3px;
    animation: sound-horizontal 0ms -800ms linear infinite alternate;
}

@keyframes sound-horizontal {
    0% { width: 10px; opacity: 0.4; }
    100% { width: 90px; opacity: 1; } /* Animate width growing to the left */
}

/* Responsive */
@media (max-width: 1400px) {
    .dashboard {
        grid-template-columns: 1fr 280px;
    }
    .library-card, .top-tracks-card { grid-column: 2 / 3; }
    .dsp-chain { grid-column: 1 / -1; grid-row: 3 / 4; }
    .dsp-nodes { flex-direction: row; }
    .dsp-nodes::before { top: 50%; bottom: auto; left: 0; right: 0; width: 100%; height: 2px; transform: translateY(-50%); }
    .dsp-node { flex-direction: column; }
    .visualizer { flex-direction: row; align-items: flex-end; padding-right: 0; }
    .visualizer-title { justify-content: center; padding-right: 0; }
    :deep(.bar) { height: auto; width: 4px; background: linear-gradient(to top, var(--accent), var(--accent-light)); border-radius: 2px 2px 0 0; animation: sound 0ms -800ms linear infinite alternate; }
    @keyframes sound { 0% { height: 10px; opacity: 0.4; } 100% { height: 50px; opacity: 1; } }
}
@media (max-width: 950px) {
    .dashboard {
        grid-template-columns: 1fr;
    }
    .library-card, .top-tracks-card, .now-playing, .calendar-card, .dsp-chain {
        grid-column: 1 / 2;
        grid-row: auto;
    }
    .now-playing {
        flex-direction: column;
        text-align: center;
    }
    .now-playing .controls { justify-content: center; }
    .now-playing .record-vinyl { display: none; }
}
</style>
