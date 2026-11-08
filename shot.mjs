import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 場面ごとのスクショ。node shot.mjs [幅 高さ]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname, PORT = 6332
mkdirSync(ROOT + '/shots', { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const w = +(process.argv[2] || 390), h = +(process.argv[3] || 844)
const b = await chromium.launch(MUTE_LAUNCH)
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await muteContext(ctx)
await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('ar_tut', '1') } catch (e) {} })
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
const T0 = Date.now(); await p.goto(`http://localhost:${PORT}/`); console.log('goto', Date.now() - T0); await p.waitForFunction(() => window.__arReady && !document.getElementById('vTitle').hidden, null, { timeout: 15000 })
console.log('ready', Date.now() - T0); await p.waitForTimeout(600)
const tag = `${w}x${h}`
await p.screenshot({ path: `${ROOT}/shots/s-${tag}-title.png` })
const scenes = [
  ['t2', { tier: 2 }, { loudDb: -26, devMean: 20, unsteady: 0.6, rangeSemis: 6, jumpsPerSec: 0.3, harsh: 0.1 }],
  ['t6', {}, { loudDb: -14, devMean: 24, unsteady: 0.7, rangeSemis: 10, jumpsPerSec: 0.8, harsh: 0.2 }],
  ['t7', {}, { loudDb: -12, devMean: 26, unsteady: 0.8, rangeSemis: 12, jumpsPerSec: 1, harsh: 0.3 }],
  ['t10', {}, { ufo: true, encore: false }],
  ['good', {}, { loudDb: -26, devMean: 6, unsteady: 0.2, rangeSemis: 5, jumpsPerSec: 0, harsh: 0, jitter: 10, voicedRatio: 0.9 }],
  ['none', {}, { actFrac: 0.02, loudDb: -60 }],
]
for (const [name, , f] of scenes) {
  const R = await p.evaluate(f => { const R = ar.showWith(f); return { kind: R.kind, tier: R.tier, D: R.D } }, f)
  // 最後の段の途中で撮る
  await p.waitForFunction(() => document.getElementById('vResult').hidden === false, null, { timeout: 30000 }).catch(() => {})
  await p.screenshot({ path: `${ROOT}/shots/s-${tag}-${name}-result.png` })
  console.log(name, JSON.stringify(R))
}
console.log('errors', errs.length ? errs : 'none')
await b.close(); server.kill()
