// Outbound text shaping for messaging apps, ported from OpenCharaAgent
// (chara/messaging/text.py and filters.py).
//
// Platforms limit a message in UTF-16 code units, which is exactly a JS
// string's length; the splitter only has to avoid cutting a surrogate pair.

const PREFERRED_BREAKS = new Set(['。', '！', '？', '.', '!', '?', '\n', ';', '；'])
const FENCE = '```'

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff

/**
 * For each cut position i (between text[i-1] and text[i]), the opening index
 * of the ``` fence that cut would tear apart, else -1. A cut at the fence's own
 * opening (send it whole in the next chunk) or right after its closing line is
 * fine; an unclosed fence runs to the end of the text.
 */
function fencedCutMap(text) {
  const n = text.length
  const inside = new Array(n + 1).fill(-1)
  let pos = 0
  let openAt = -1
  for (const line of text.split(/(?<=\n)/)) {
    if (line.trimStart().startsWith(FENCE)) {
      if (openAt < 0) {
        openAt = pos
      } else {
        const closeEnd = pos + line.length
        for (let i = openAt + 1; i < closeEnd; i++) inside[i] = openAt
        openAt = -1
      }
    }
    pos += line.length
  }
  if (openAt >= 0) for (let i = openAt + 1; i <= n; i++) inside[i] = openAt
  return inside
}

/**
 * Split outbound text for a platform cap, preferring sentence breaks and
 * avoiding a cut inside a ``` block when reasonably possible.
 * @param {string} text
 * @param {number} maxLength - in UTF-16 code units.
 * @returns {string[]}
 */
export function splitText(text, maxLength) {
  if (!(maxLength > 0)) throw new RangeError('maxLength must be positive')
  if (!text) return []
  if (text.length <= maxLength) return [text]
  const fenceAt = fencedCutMap(text)
  const chunks = []
  const n = text.length
  let start = 0
  while (start < n) {
    let end = Math.min(start + maxLength, n)
    if (end < n && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1
    if (end <= start) end = start + (isHighSurrogate(text.charCodeAt(start)) ? 2 : 1)
    if (end >= n) {
      chunks.push(text.slice(start))
      break
    }
    let cut = 0
    for (let i = end; i > start; i--) {
      if (PREFERRED_BREAKS.has(text[i - 1]) && fenceAt[i] < 0) { cut = i; break }
    }
    if (!cut && fenceAt[end] > start) cut = fenceAt[end] // cut before the fence rather than tearing it
    if (!cut) {
      for (let i = end; i > start; i--) {
        if (PREFERRED_BREAKS.has(text[i - 1])) { cut = i; break }
      }
    }
    if (cut <= start) cut = end
    chunks.push(text.slice(start, cut))
    start = cut
  }
  return chunks.filter(Boolean)
}

// A string that is only a "silence narration" token: *(silent)*, (no reply),
// a bare "." or the muted-speaker emoji. In a bot-to-bot chat such a token
// mirrors back and forth until a model fails, so it is dropped before sending.
const SILENCE_NARRATION = /^[\s*_~`]*\(?\s*(silent|silence|no\s+response|no\s+reply|nothing\s+to\s+say)\s*\.?\)?[\s*_~`]*$|^[\s*_~`]*[\u{1F507}.…]+[\s*_~`]*$/iu
const MAX_SILENCE_LEN = 64

/** Whether `content` is nothing but a silence token (empty counts too). */
export function isSilenceNarration(content) {
  const stripped = String(content ?? '').trim()
  if (!stripped) return true
  if ([...stripped].length > MAX_SILENCE_LEN) return false
  return SILENCE_NARRATION.test(stripped)
}
