// 歌声の分析（端末の中だけで計算する。ブラウザと Node の両方で動く）
// analyze(Float32Array, sampleRate) → 声量・音程・暴れ方などの数字
// judge(features, request) → { kind: 'none' | 'good' | 'tier', tier: 0..10, D: 0..100, gauges }
// 大きい声 × 音を外す × 暴れる ほど D（破壊度）が上がる。安定して音が合っていて声量がほどほどなら「普通に上手かった」
;(function (root) {
  const HOP = 0.02            // 20ms ごとに1コマ
  const F0_MIN = 70, F0_MAX = 1100
  const ACTIVE_DB = -44       // これより小さいコマは「歌っていない」
  const YIN_TH = 0.15, VOICED_AP = 0.22
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v
  const lin = (v, a, b) => clamp01((v - a) / (b - a))

  // 16kHz 付近まで間引く（音程を取るだけなので十分。計算が 1/9 になる）
  function decimate(x, sr) {
    const f = Math.max(1, Math.floor(sr / 16000))
    if (f === 1) return { y: x, sr }
    const n = Math.floor(x.length / f), y = new Float32Array(n)
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += x[i * f + k]; y[i] = s / f }
    return { y, sr: sr / f }
  }

  // YIN（自己相関の差分を正規化して、いちばん深い谷を基本周期にする）
  function yin(y, start, W, tMin, tMax, d) {
    for (let t = 1; t <= tMax; t++) {
      let s = 0
      for (let j = 0; j < W; j++) { const v = y[start + j] - y[start + j + t]; s += v * v }
      d[t] = s
    }
    d[0] = 1; let run = 0
    for (let t = 1; t <= tMax; t++) { run += d[t]; d[t] = run > 0 ? d[t] * t / run : 1 }
    let best = -1
    for (let t = tMin; t <= tMax; t++) {
      if (d[t] < YIN_TH) { while (t + 1 <= tMax && d[t + 1] < d[t]) t++; best = t; break }
    }
    if (best < 0) { let m = Infinity; for (let t = tMin; t <= tMax; t++) if (d[t] < m) { m = d[t]; best = t } }
    const ap = d[best]
    let tt = best
    if (best > tMin && best < tMax) { const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c; if (den > 0) tt = best + 0.5 * (a - c) / den }
    return { tau: tt, ap }
  }

  const median = a => { if (!a.length) return 0; const s = Array.from(a).sort((p, q) => p - q); return s[s.length >> 1] }
  const pct = (a, p) => { if (!a.length) return 0; const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] }
  const wrap50 = c => { let r = ((c % 100) + 100) % 100; return r >= 50 ? r - 100 : r }

  function analyze(x, sr) {
    const hop = Math.round(sr * HOP), nF = Math.max(0, Math.floor((x.length - hop) / hop))
    // 1) 音量（元の帯域で 20ms ごとの RMS）
    const db = new Float32Array(nF)
    for (let i = 0; i < nF; i++) { let s = 0; const o = i * hop; for (let j = 0; j < hop; j++) { const v = x[o + j]; s += v * v } db[i] = 10 * Math.log10(s / hop + 1e-12) }
    const floor = pct(db, 0.1)
    const active = new Uint8Array(nF)
    let nAct = 0
    // 部屋の雑音がずっと鳴っている時は、それより 6dB 上だけ数える（ただし -36dB より上は必ず数える）
    const thr = Math.max(ACTIVE_DB, Math.min(floor + 6, -36))
    for (let i = 0; i < nF; i++) if (db[i] > thr) { active[i] = 1; nAct++ }
    // 2) 音程（YIN）
    const { y, sr: sr2 } = decimate(x, sr)
    const W = Math.round(0.032 * sr2), tMin = Math.floor(sr2 / F0_MAX), tMax = Math.ceil(sr2 / F0_MIN)
    const d = new Float32Array(tMax + 2), hop2 = sr2 * HOP
    const cents = new Float32Array(nF).fill(NaN), apA = new Float32Array(nF).fill(1)
    for (let i = 0; i < nF; i++) {
      if (!active[i]) continue
      const st = Math.round(i * hop2 + hop2 / 2 - W / 2)
      if (st < 0 || st + W + tMax + 1 >= y.length) continue
      const r = yin(y, st, W, tMin, tMax, d); apA[i] = r.ap
      const f0 = sr2 / r.tau
      if (r.ap < VOICED_AP && f0 >= F0_MIN && f0 <= F0_MAX) cents[i] = 1200 * Math.log2(f0 / 440)
    }
    // 3) ゆらぎを均す（中央値5コマ → 平均9コマ = 180ms。ビブラートはここで消える）
    const med = new Float32Array(nF).fill(NaN)
    for (let i = 0; i < nF; i++) {
      if (isNaN(cents[i])) continue
      const w = []; for (let k = -2; k <= 2; k++) { const v = cents[i + k]; if (v === v && v !== undefined) w.push(v) }
      med[i] = median(w)
    }
    const sm = new Float32Array(nF).fill(NaN)
    for (let i = 0; i < nF; i++) {
      if (isNaN(med[i])) continue
      let s = 0, n = 0; for (let k = -4; k <= 4; k++) { const v = med[i + k]; if (v === v && v !== undefined) { s += v; n++ } }
      sm[i] = s / n
    }
    // 4) 数える
    const voiced = [], steady = [], jitters = []
    let nVoiced = 0, nUnsteady = 0, jumps = 0, loudN = 0, loudHarsh = 0, slopeSum = 0
    for (let i = 0; i < nF; i++) {
      if (active[i] && db[i] > -22) { loudN++; if (isNaN(cents[i]) || apA[i] > 0.3) loudHarsh++ }
      if (isNaN(sm[i])) continue
      nVoiced++; voiced.push(med[i])
      const a = sm[i - 1], b = sm[i + 1]
      const slope = (a === a && b === b && a !== undefined && b !== undefined) ? Math.abs(b - a) / (2 * HOP) : (a === a && a !== undefined ? Math.abs(sm[i] - a) / HOP : (b === b && b !== undefined ? Math.abs(b - sm[i]) / HOP : 0))
      slopeSum += Math.min(slope, 3000)
      if (slope < 250) steady.push(sm[i]); else nUnsteady++
      const pc = cents[i - 1]
      if (pc === pc && pc !== undefined && cents[i] === cents[i]) {
        const dd = Math.abs(cents[i] - pc)
        if (dd > 350) jumps++; else jitters.push(dd)
      }
    }
    // 自分の基準で合っているか（440Hz に合っていなくても、全体がずれているだけなら許す）
    let devMean = 50
    if (steady.length >= 5) {
      devMean = Infinity
      for (let o = -50; o < 50; o += 2) { let s = 0; for (const c of steady) s += Math.abs(wrap50(c - o)); s /= steady.length; if (s < devMean) devMean = s }
    }
    const dur = nF * HOP || 1
    const actFrac = nF ? nAct / nF : 0
    const voicedRatio = nAct ? nVoiced / nAct : 0
    const unsteady = nVoiced ? nUnsteady / nVoiced : 1
    const rangeSemis = voiced.length >= 5 ? (pct(voiced, 0.95) - pct(voiced, 0.05)) / 100 : 0
    const actDb = []; for (let i = 0; i < nF; i++) if (active[i]) actDb.push(db[i])
    const loudDb = actDb.length ? pct(actDb, 0.8) : -100
    const harsh = loudN ? loudHarsh / loudN : 0
    // 一番長く声を出し続けた秒数
    let run = 0, longest = 0; for (let i = 0; i < nF; i++) { run = active[i] ? run + 1 : 0; if (run > longest) longest = run }
    // 最初と最後の1.5秒の声量の差（最後に爆発のリクエスト用）
    const q = Math.round(1.5 / HOP), avgDb = (a, b) => { let s = 0, n = 0; for (let i = a; i < b && i < nF; i++) { s += Math.max(db[i], -60); n++ } return n ? s / n : -60 }
    return {
      dur, actFrac, voicedRatio, unsteady, devMean, rangeSemis,
      jumpsPerSec: jumps / dur, drift: nVoiced ? slopeSum / nVoiced : 0, jitter: median(jitters), harsh, loudDb, peakDb: actDb.length ? Math.max(...actDb) : -100,
      medianHz: voiced.length ? 440 * Math.pow(2, median(voiced) / 1200) : 0,
      longestSec: longest * HOP, riseDb: avgDb(nF - q, nF) - avgDb(0, q),
      track: Array.from(sm, v => v === v ? Math.round(v) : null), level: Array.from(db, v => Math.round(v * 10) / 10),
    }
  }

  // ゲージ（0..100）
  function gauges(f) {
    const vol = 100 * lin(f.loudDb, -42, -12)
    const offTune = 60 * lin(f.devMean, 8, 24) + 40 * lin(f.unsteady, 0.4, 0.85)
    const noPitch = 100 * (1 - f.voicedRatio) * lin(f.actFrac, 0.05, 0.3)
    const lost = Math.max(offTune * Math.min(1, f.voicedRatio * 1.5), noPitch)
    const wild = 100 * (0.3 * lin(f.rangeSemis, 4, 24) + 0.25 * lin(f.jumpsPerSec, 0, 2) + 0.1 * lin(f.jitter, 10, 60) + 0.15 * lin(f.drift || 0, 300, 1000) + 0.2 * lin(f.harsh, 0, 0.6) + 0.15 * lin(f.harsh, 0.6, 0.95))
    const persist = 100 * lin(f.actFrac, 0.05, 0.85)
    const r = v => Math.round(Math.max(0, Math.min(100, v)))
    return { vol: r(vol), lost: r(lost), wild: r(wild), persist: r(persist) }
  }

  // リクエスト（毎回くじで1つ。満たすと破壊度 +8）
  const REQUESTS = {
    high: f => f.medianHz > 380,
    low: f => f.medianHz > 0 && f.medianHz < 170,
    long: f => f.longestSec >= 3.2,
    jump: f => f.jumpsPerSec * f.dur >= 3,
    finale: f => f.riseDb >= 8,
  }
  const TIER_AT = [10, 20, 30, 40, 50, 58, 66, 74, 82, 90]

  function judge(f, request) {
    const g = f.gauges || gauges(f)
    const reqOk = !!(request && REQUESTS[request] && f.actFrac > 0.12 && REQUESTS[request](f))
    if (f.actFrac < 0.1 || g.vol < 10) return { kind: 'none', tier: -1, D: 0, gauges: g, reqOk: false, whisper: f.actFrac >= 0.1 }
    const good = f.actFrac >= 0.4 && f.voicedRatio >= 0.65 && f.devMean <= 18 && f.unsteady <= 0.55 && g.wild <= 40 && g.vol >= 18 && g.vol <= 85
    const v = g.vol / 100, L = g.lost / 100, Wd = g.wild / 100, P = g.persist / 100
    const chaos = 1 - (1 - L) * (1 - Wd)
    let D = 100 * v * (0.25 + 0.75 * chaos) * (0.55 + 0.45 * P)
    if (reqOk) D += 8
    D = Math.max(0, Math.min(100, D))
    if (good) return { kind: 'good', tier: -1, D: Math.round(D), gauges: g, reqOk }
    let tier = 0; for (const t of TIER_AT) if (D >= t) tier++
    return { kind: 'tier', tier, D: Math.round(D), gauges: g, reqOk }
  }

  // 指で歌う（マイクが無い時）。押している間の動きから同じ形の数字を作る
  // samples: [{t 秒, x, y, down, p 押す強さ}]  を60Hzで
  function fromFinger(samples, dur = 5) {
    const n = samples.length || 1
    let down = 0, dist = 0, turns = 0, lastDir = 0, maxR = 0, cx = 0, cy = 0, cn = 0, press = 0
    for (const s of samples) if (s.down) { cx += s.x; cy += s.y; cn++ }
    cx /= cn || 1; cy /= cn || 1
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]; if (!s.down) continue
      down++; press += s.p || 0
      maxR = Math.max(maxR, Math.hypot(s.x - cx, s.y - cy))
      const pv = samples[i - 1]
      if (pv && pv.down) {
        const dx = s.x - pv.x, dy = s.y - pv.y, m = Math.hypot(dx, dy); dist += m
        if (m > 1.5) { const dir = Math.sign(Math.abs(dx) > Math.abs(dy) ? dx : dy) * (Math.abs(dx) > Math.abs(dy) ? 1 : 2); if (lastDir && dir !== lastDir) turns++; lastDir = dir }
      }
    }
    const held = down / n, heldSec = held * dur
    const speed = heldSec > 0.05 ? dist / heldSec : 0
    const p = down ? press / down : 0
    const f = {
      dur, actFrac: held, voicedRatio: 1, unsteady: Math.min(1, turns / Math.max(1, heldSec) / 8), devMean: 8 + Math.min(1, turns / Math.max(1, heldSec) / 6) * 26,
      rangeSemis: Math.min(30, maxR / 6), jumpsPerSec: Math.min(3, speed / 900), jitter: 10 + Math.min(1, turns / Math.max(1, heldSec) / 10) * 60, harsh: Math.min(1, speed / 2600),
      drift: Math.min(1500, speed / 2), loudDb: held > 0.02 ? -34 + 24 * Math.min(1, speed / 1400) + 8 * Math.max(0, p - 0.5) : -100, medianHz: 200 + maxR * 3, longestSec: heldSec, riseDb: 0, finger: true,
    }
    f.gauges = gauges(f)
    return f
  }

  const api = { analyze, gauges, judge, fromFinger, REQUESTS: Object.keys(REQUESTS), TIER_AT, HOP }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.Analyzer = api
})(typeof window !== 'undefined' ? window : globalThis)
