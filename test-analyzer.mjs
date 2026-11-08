// 分析器の単体テスト。node test-analyzer.mjs
// 合成した声で判定を確かめる。先に「生成器が狙った音程と音量を本当に出しているか」を別の方法で測る（ship の教訓: 生成器が嘘をつくと全部狂う）
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
const OUT = (process.env.AR_TMP || tmpdir() + '/akichi-recital') + '/'
const require = createRequire(import.meta.url)
const A = require('./analyzer.js')
const SR = 48000, DUR = 5
let pass = 0, fail = 0
const ok = (name, c, info) => { if (c) pass++; else fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`) }

// 再現できる乱数
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12)

// 声に近い音: 倍音 1/k を8本。fAt(t) が瞬間の基本周波数、aAt(t) が振幅
function voice(fAt, aAt, { harm = 8, noise = 0.0002, seed = 1 } = {}) {
  const n = SR * DUR, x = new Float32Array(n), R = rng(seed); let ph = 0
  let norm = 0; for (let k = 1; k <= harm; k++) norm += 1 / k
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = fAt(t); ph += 2 * Math.PI * f / SR
    let s = 0; for (let k = 1; k <= harm; k++) if (f * k < SR / 2) s += Math.sin(k * ph) / k
    x[i] = aAt(t) * s / norm * 1.6 + (R() * 2 - 1) * noise
  }
  return x
}
const rmsDb = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / (b - a) + 1e-12) }
// 生成器の確認用: 指定の時刻まわり 80ms で、狙った周波数 ±150c を 5c 刻みに走査して一番強い所（DFT の1点ずつ）
function peakCents(x, t, f0, span = 150) {
  const c0 = Math.round(t * SR), N = Math.round(0.08 * SR), st = c0 - N / 2
  let best = -1, bc = 0
  for (let c = -span; c <= span; c += 5) {
    const f = f0 * Math.pow(2, c / 1200); let re = 0, im = 0
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), v = x[st + i] * w, a = 2 * Math.PI * f * i / SR; re += v * Math.cos(a); im -= v * Math.sin(a) }
    const m = re * re + im * im; if (m > best) { best = m; bc = c }
  }
  return bc
}
function zcHz(x) { let z = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) z++; return z / DUR }

// ---- 信号 ----
const S = {}
// 1. 音の合った純音（440Hz・ほどほどの声量）
S.sine = (() => { const x = new Float32Array(SR * DUR); for (let i = 0; i < x.length; i++) x[i] = 0.08 * Math.sin(2 * Math.PI * 440 * i / SR); return x })()
// 2. 音の合ったメロディ（ドレミファソファミレ・ビブラート ±35c 5.5Hz・音の間は 60ms でなめらかに）
const MEL = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64]
const melF = (offs = () => 0, vib = 35) => t => {
  const k = Math.min(MEL.length - 1, Math.floor(t / 0.5)), u = t - k * 0.5
  const prev = MEL[Math.max(0, k - 1)] + offs(Math.max(0, k - 1)) / 100, cur = MEL[k] + offs(k) / 100
  const m = u < 0.06 ? prev + (cur - prev) * (u / 0.06) : cur
  return midiHz(m) * Math.pow(2, vib * Math.sin(2 * Math.PI * 5.5 * t) / 1200)
}
S.melody = voice(melF(), t => 0.07)
// 3. 大声・音がずれてふらふら（300Hz から +37c ずれ、±180c を 1.3Hz でうねり、さらにゆっくり迷う）
const WALK = (() => { const R = rng(7); let walk = 0; const W = []; for (let i = 0; i <= 501; i++) { walk += (R() - 0.5) * 60; walk *= 0.97; W.push(walk) } return W })()
const wobC = t => 37 + 180 * Math.sin(2 * Math.PI * 1.3 * t) + WALK[Math.floor(t * 100)]
S.wobble = voice(t => 300 * Math.pow(2, wobC(t) / 1200), t => 0.55, { seed: 3 })
// 4. 叫び（白いノイズ・大声）
S.scream = (() => { const R = rng(11), x = new Float32Array(SR * DUR); for (let i = 0; i < x.length; i++) x[i] = (R() * 2 - 1) * 0.5; return x })()
// 5. 無音（ほぼ 0）
S.silence = (() => { const R = rng(5), x = new Float32Array(SR * DUR); for (let i = 0; i < x.length; i++) x[i] = (R() * 2 - 1) * 0.0001; return x })()
// 6. ささやき（小さいノイズ -40dB 前後）
S.whisper = (() => { const R = rng(9), x = new Float32Array(SR * DUR); for (let i = 0; i < x.length; i++) x[i] = (R() * 2 - 1) * 0.017; return x })()
// 7. 大声で音は合っている（声量だけ大きい）
S.loudGood = voice(melF(), t => 0.6, { seed: 4 })
// 8. 大声・音を外して飛び回る（各音を ±45c 外し、1オクターブ以上飛ぶ）
S.offJump = (() => { const R = rng(21), offs = MEL.map(() => (R() * 2 - 1) * 45), oct = MEL.map((_, i) => (i % 3 === 1 ? 12 : i % 3 === 2 ? -7 : 0)); return voice(t => { const k = Math.min(MEL.length - 1, Math.floor(t / 0.5)); return midiHz(MEL[k] + oct[k] + offs[k] / 100) * Math.pow(2, 25 * Math.sin(2 * Math.PI * 6 * t) / 1200) }, t => 0.5, { seed: 6 }) })()
// 9. 1秒だけ叫んで黙る（ねばりが無い）
S.short = (() => { const x = S.scream.slice(); for (let i = SR; i < x.length; i++) x[i] = x[i] * 0.0002; return x })()

// ---- まず生成器を確かめる ----
ok('生成器: 純音 440Hz（ゼロ交差）', Math.abs(zcHz(S.sine) - 440) < 1, zcHz(S.sine).toFixed(1) + 'Hz')
ok('生成器: 純音の音量 -25dB 前後', Math.abs(rmsDb(S.sine) - 20 * Math.log10(0.08 / Math.SQRT2)) < 0.2, rmsDb(S.sine).toFixed(1) + 'dB')
{ const got = [0.25, 1.25, 2.25, 4.25].map(t => peakCents(S.melody, t, midiHz(MEL[Math.floor(t / 0.5)])))
  ok('生成器: メロディの音が狙いどおり（ずれ ±40c 以内・ビブラート込み）', got.every(c => Math.abs(c) <= 40), got) }
{ const got = [0.3, 1.8, 3.3].map(t => { const k = Math.floor(t / 0.5); return peakCents(S.melody, t, midiHz(MEL[k])) })
  ok('生成器: メロディのビブラートの中心は 0c', Math.abs(got.reduce((a, b) => a + b) / got.length) <= 30, got) }
{ const ts = [0.2, 0.6, 1.0, 2.3, 3.9], got = ts.map(t => peakCents(S.wobble, t, 300, 450) - Math.round(wobC(t)))
  ok('生成器: うねる音が狙いどおりの高さ（各時刻で ±60c）', got.every(c => Math.abs(c) <= 60), got)
  const cs = []; for (let t = 0.1; t < 4.9; t += 0.1) cs.push(wobC(t)); ok('生成器: うねりの幅が 2.5 半音以上', (Math.max(...cs) - Math.min(...cs)) / 100 >= 2.5, ((Math.max(...cs) - Math.min(...cs)) / 100).toFixed(1)) }
ok('生成器: うねる音は大声（-12dB より大きい）', rmsDb(S.wobble) > -12, rmsDb(S.wobble).toFixed(1))
ok('生成器: 叫びは大声', rmsDb(S.scream) > -12, rmsDb(S.scream).toFixed(1))
ok('生成器: 無音は -75dB 以下', rmsDb(S.silence) < -75, rmsDb(S.silence).toFixed(1))
ok('生成器: ささやきは -45〜-38dB', rmsDb(S.whisper) > -45 && rmsDb(S.whisper) < -38, rmsDb(S.whisper).toFixed(1))
{ const off = [0.25, 0.75, 1.25].map((t, i) => { const k = Math.floor(t / 0.5); return peakCents(S.offJump, t, midiHz(MEL[k] + (k % 3 === 1 ? 12 : k % 3 === 2 ? -7 : 0))) })
  ok('生成器: 外す音は各音で ±50c 以内に狙いどおり外れている', off.every(c => Math.abs(c) <= 60) && off.some(c => Math.abs(c) >= 15), off) }

// ---- 分析と判定 ----
const res = {}
for (const [k, x] of Object.entries(S)) {
  const t0 = performance.now(), f = A.analyze(x, SR), ms = performance.now() - t0, j = A.judge(f, null)
  res[k] = { f, j, ms }
  console.log(`  ${k.padEnd(9)} ${j.kind.padEnd(4)} tier=${String(j.tier).padStart(2)} D=${String(j.D).padStart(3)} vol=${j.gauges.vol} lost=${j.gauges.lost} wild=${j.gauges.wild} persist=${j.gauges.persist} | dev=${f.devMean.toFixed(1)}c unsteady=${f.unsteady.toFixed(2)} voiced=${f.voicedRatio.toFixed(2)} range=${f.rangeSemis.toFixed(1)} jumps/s=${f.jumpsPerSec.toFixed(2)} harsh=${f.harsh.toFixed(2)} med=${f.medianHz.toFixed(0)}Hz ${ms.toFixed(0)}ms`)
}
ok('純音（音が合っている・ほどほど）→ 普通に上手かった', res.sine.j.kind === 'good', res.sine.j)
ok('純音の音程を 440Hz と読む', Math.abs(res.sine.f.medianHz - 440) < 3, res.sine.f.medianHz.toFixed(1))
ok('メロディ（音が合っている・ビブラート）→ 普通に上手かった', res.melody.j.kind === 'good', res.melody.j)
ok('メロディの音程の中心を読む（C4〜G4 の間）', res.melody.f.medianHz > 255 && res.melody.f.medianHz < 400, res.melody.f.medianHz.toFixed(0))
ok('大声でうねる音 → 上の段（8以上）', res.wobble.j.kind === 'tier' && res.wobble.j.tier >= 8, res.wobble.j)
ok('叫び（ノイズ）→ 上の段（8以上）', res.scream.j.kind === 'tier' && res.scream.j.tier >= 8, res.scream.j)
ok('大声で外して飛ぶ → 上の段（8以上）', res.offJump.j.kind === 'tier' && res.offJump.j.tier >= 8, res.offJump.j)
ok('無音 → 歌ってない', res.silence.j.kind === 'none', res.silence.j)
ok('ささやき → 歌ってない', res.whisper.j.kind === 'none', res.whisper.j)
ok('大声で音は合っている → 上手い判定にならず、破壊は中くらいまで（5以下）', res.loudGood.j.kind === 'tier' && res.loudGood.j.tier <= 5, res.loudGood.j)
ok('1秒だけ叫ぶ → 5秒叫ぶより低い', res.short.j.D < res.scream.j.D && res.short.j.kind === 'tier', [res.short.j.D, res.scream.j.D])
ok('迷子度: 外す方が合っている方より高い', res.offJump.j.gauges.lost > res.loudGood.j.gauges.lost + 20 && res.wobble.j.gauges.lost > res.loudGood.j.gauges.lost + 40, [res.offJump.j.gauges.lost, res.wobble.j.gauges.lost, res.loudGood.j.gauges.lost])
ok('暴れ度: 飛ぶ方が合っている方より高い', res.offJump.j.gauges.wild > res.loudGood.j.gauges.wild + 20, [res.offJump.j.gauges.wild, res.loudGood.j.gauges.wild])
ok('声量: 大声 > ほどほど', res.loudGood.j.gauges.vol > res.melody.j.gauges.vol + 30, [res.loudGood.j.gauges.vol, res.melody.j.gauges.vol])
ok('同じ声なら同じ結果', JSON.stringify(A.judge(A.analyze(S.wobble, SR))) === JSON.stringify(res.wobble.j))
ok('5秒の分析が 600ms 以内（Node）', Object.values(res).every(r => r.ms < 600), Object.fromEntries(Object.entries(res).map(([k, r]) => [k, Math.round(r.ms)])))
// 44.1kHz（iPhone の一部）でも同じ判定
{ const n = 44100 * DUR, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.08 * Math.sin(2 * Math.PI * 440 * i / 44100); const f = A.analyze(x, 44100); ok('44.1kHz の純音も 440Hz・上手い', Math.abs(f.medianHz - 440) < 3 && A.judge(f).kind === 'good', [f.medianHz.toFixed(1), A.judge(f).kind]) }
// 短い録音（3秒で止まった時）でも落ちない
// スマホで自動音量を切って録ると、普通に歌っても -45dB 前後で入る。音程があれば「歌ってない」にしない（2026-11-09 本人「歌ったのに歌ってないって出る」）
{ const n = SR * DUR, x = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const f0 = 330 * Math.pow(2, Math.sin(2 * Math.PI * 0.7 * i / SR) * 0.4); ph += 2 * Math.PI * f0 / SR; x[i] = 0.0075 * Math.sin(ph) + 0.002 * Math.sin(2 * ph) }
  const db = rmsDb(x); const j = A.judge(A.analyze(x, SR)); ok('小さく入った歌声（-45dB 前後・音程あり）は歌ってない扱いにしない', db < -42 && db > -48 && j.kind !== 'none', [db.toFixed(1), j.kind, j.tier]) }
{ const f = A.analyze(S.scream.slice(0, SR * 3), SR); ok('3秒しか録れなくても判定できる', A.judge(f).kind === 'tier') }
{ const f = A.analyze(new Float32Array(0), SR); ok('空の録音 → 歌ってない（落ちない）', A.judge(f).kind === 'none') }

// リクエスト
ok('リクエスト「高い声」: 440Hz の純音で達成・メロディ(C4付近)では未達', A.judge(res.sine.f, 'high').reqOk && !A.judge(res.melody.f, 'high').reqOk)
ok('リクエスト「伸ばせ」: 純音で達成・1秒叫びでは未達', A.judge(res.sine.f, 'long').reqOk && !A.judge(res.short.f, 'long').reqOk)
ok('リクエスト「音を飛ばせ」: 飛ぶ方で達成・合っているメロディでは未達', A.judge(res.offJump.f, 'jump').reqOk && !A.judge(res.melody.f, 'jump').reqOk, [res.offJump.f.jumpsPerSec * 5, res.melody.f.jumpsPerSec * 5])
ok('リクエスト達成で破壊度 +8', A.judge(res.wobble.f, 'low').D === res.wobble.j.D || A.judge(res.offJump.f, 'jump').D === Math.min(100, res.offJump.j.D + 8), [A.judge(res.offJump.f, 'jump').D, res.offJump.j.D])

// 指で歌う
const fing = (fn, dur = 5) => { const a = []; for (let i = 0; i < dur * 60; i++) a.push(fn(i / 60)); return A.judge(A.fromFinger(a, dur)) }
const still = fing(t => ({ t, x: 200, y: 400, down: true, p: 0.5 }))
const wiggle = fing(t => ({ t, x: 200 + 140 * Math.sin(t * 2 * Math.PI * 5.2) + 60 * Math.sin(t * 17), y: 400 + 120 * Math.cos(t * 2 * Math.PI * 3.7), down: true, p: 0.5 }))
const none = fing(t => ({ t, x: 0, y: 0, down: false, p: 0 }))
const brief = fing(t => ({ t, x: 200 + 140 * Math.sin(t * 30), y: 400, down: t < 0.8, p: 0.5 }))
console.log('  finger still', JSON.stringify(still), '\n  finger wiggle', JSON.stringify(wiggle), '\n  finger brief', JSON.stringify(brief))
ok('指: じっと押し続ける → 普通に上手かった', still.kind === 'good', still.kind)
ok('指: 激しく揺らす → 上の段（8以上）', wiggle.kind === 'tier' && wiggle.tier >= 8, wiggle.tier)
ok('指: 押さない → 歌ってない', none.kind === 'none')
ok('指: 少しだけ → 激しく揺らし続けるより低い', brief.D < wiggle.D, [brief.D, wiggle.D])

// ブラウザのテスト用に WAV を書き出す（Chromium の偽マイクに流す）
mkdirSync(OUT, { recursive: true })
function wav(x, path, sr = SR) {
  const n = x.length, b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2)
  writeFileSync(OUT + path, b)
}
// 偽マイクはファイルを繰り返すので、5秒より少し長く同じ性質が続くように2回つなぐ
const twice = x => { const y = new Float32Array(x.length * 2); y.set(x); y.set(x, x.length); return y }
wav(twice(S.wobble), 'mic_wobble.wav'); wav(twice(S.sine), 'mic_sine.wav'); wav(twice(S.silence), 'mic_silence.wav')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
