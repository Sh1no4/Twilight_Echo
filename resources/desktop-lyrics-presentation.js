;(function (root) {
  'use strict'

  var TRAILING_LINE_SECONDS = 4

  function clamp01(value) {
    if (!isFinite(value)) return 0
    return Math.min(1, Math.max(0, value))
  }

  function lineEndTime(lines, index) {
    var line = lines[index]
    if (!line || line.time == null || !isFinite(line.time)) return null
    for (var ahead = index + 1; ahead < lines.length; ahead += 1) {
      var candidate = lines[ahead].time
      if (candidate != null && isFinite(candidate) && candidate > line.time) return candidate
    }
    var words = line.words
    if (words && words.length) {
      var last = words[words.length - 1]
      if (last.time != null && isFinite(last.time)) {
        return Math.max(line.time + 0.5, last.time + TRAILING_LINE_SECONDS)
      }
    }
    return line.time + TRAILING_LINE_SECONDS
  }

  function calculateLineProgress(lines, activeIndex, time) {
    var line = lines[activeIndex]
    if (!hasWordTiming(line) || line.time == null || !isFinite(line.time)) return 0
    var start = line.time
    var end = lineEndTime(lines, activeIndex)
    if (end == null || time < start) return 0
    if (time >= end) return 1

    var words = line.words

    var totalWeight = 0
    var completedWeight = 0
    for (var index = 0; index < words.length; index += 1) {
      var word = words[index]
      var weight = Math.max(1, String(word.text || '').replace(/\s+/g, '').length)
      totalWeight += weight
      var wordStart = word.time != null && isFinite(word.time) ? word.time : start
      if (time <= wordStart) continue

      var next = words[index + 1]
      var wordEnd =
        next && next.time != null && isFinite(next.time)
          ? next.time
          : Math.max(wordStart + 0.25, end)
      var localProgress = clamp01((time - wordStart) / Math.max(0.001, wordEnd - wordStart))
      completedWeight += weight * localProgress
    }
    return clamp01(completedWeight / Math.max(1, totalWeight))
  }

  function hasWordTiming(line) {
    if (!line || !Array.isArray(line.words) || line.words.length === 0) return false
    for (var index = 0; index < line.words.length; index += 1) {
      if (line.words[index].time == null || !isFinite(line.words[index].time)) return false
    }
    return true
  }

  function resolveNetEaseRows(lines, activeIndex, options) {
    var showTranslation = !options || options.showTranslation !== false
    var rows = []
    if (!lines.length) {
      rows.push({ lineIndex: null, text: '', isTranslation: false, isActive: false })
      return rows
    }

    var currentIndex = activeIndex >= 0 ? activeIndex : lines[0].time == null ? 0 : -1
    if (currentIndex < 0) {
      rows.push({ lineIndex: 0, text: lines[0].text, isTranslation: false, isActive: false })
      if (lines.length > 1) {
        rows.push({ lineIndex: 1, text: lines[1].text, isTranslation: false, isActive: false })
      }
      return rows
    }

    var current = lines[currentIndex]
    rows.push({
      lineIndex: currentIndex,
      text: current.text,
      isTranslation: false,
      isActive: true
    })

    if (showTranslation && current.translation) {
      rows.push({
        lineIndex: currentIndex,
        text: current.translation,
        isTranslation: true,
        isActive: true
      })
    } else if (lines[currentIndex + 1]) {
      rows.push({
        lineIndex: currentIndex + 1,
        text: lines[currentIndex + 1].text,
        isTranslation: false,
        isActive: false
      })
    }
    return rows
  }

  var presentation = {
    TRAILING_LINE_SECONDS: TRAILING_LINE_SECONDS,
    calculateLineProgress: calculateLineProgress,
    hasWordTiming: hasWordTiming,
    resolveNetEaseRows: resolveNetEaseRows
  }

  root.TwilightDesktopLyricsPresentation = presentation
  if (typeof module === 'object' && module.exports) module.exports = presentation
})(globalThis)
