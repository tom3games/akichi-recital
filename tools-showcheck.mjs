import './mute-auto.mjs'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ROOT = import.meta.dirname, PORT = 6338
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH)
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } }); await muteContext(ctx)
await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('ar_tut', '1') } catch (e) {} })
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__arReady && !document.getElementById('vTitle').hidden)
// マイクの道の波形: 歌の画面で合成の声（220Hz＋揺れ）を流し込む
await p.evaluate(() => { document.querySelectorAll('main').forEach(m => m.hidden = m.id !== 'vSing'); ar.V.mode = 'sing' })
await p.evaluate(async () => { const sr = 48000; let ph = 0; const t0 = performance.now(); window.__t0 = t0
  for (let k = 0; k < 60; k++) { const d = new Float32Array(2048), a = 0.05 + 0.3 * Math.abs(Math.sin(k / 9)), f = 220 + 60 * Math.sin(k / 7); for (let i = 0; i < 2048; i++) { ph += 2 * Math.PI * f / sr; d[i] = a * (Math.sin(ph) + 0.4 * Math.sin(2 * ph)) } ar.liveFeed(d); await new Promise(r => setTimeout(r, 43)) } })
await p.screenshot({ path: `${ROOT}/shots/live-mic-synth.png`, clip: { x: 0, y: 200, width: 390, height: 140 } })
const scenes = { t2: { loudDb: -26, devMean: 20, unsteady: 0.6, rangeSemis: 6, jumpsPerSec: 0.3, harsh: 0.1 }, t6: { loudDb: -14, devMean: 24, unsteady: 0.7, rangeSemis: 10, jumpsPerSec: 0.8, harsh: 0.2 } }
const out = []
for (const [name, f] of Object.entries(scenes)) {
  const R = await p.evaluate(f => { const R = ar.showWith({ ufo: false, encore: false, ...f }); return { tier: R.tier, kind: R.kind } }, f)
  const log = []
  for (const ms of [300, 1200, 2400, 3600]) { await p.waitForTimeout(ms - (log.length ? [300, 1200, 2400, 3600][log.length - 1] : 0)); log.push(await p.evaluate(() => ({ zoom: +ar.V.zoom.toFixed(2), big: ar.V.rings.filter(r => r.big).length, maxR: Math.round(Math.max(0, ...ar.V.rings.map(r => r.r))), sing: ar.V.sing }))); await p.screenshot({ path: `${ROOT}/shots/showpull-${name}-${ms}.png` }) }
  out.push({ name, ...R, log })
  await p.evaluate(() => ar.skip()); await p.waitForTimeout(500)
}
console.log(JSON.stringify(out, null, 0)); console.log('errs', errs)
await b.close(); server.kill()
