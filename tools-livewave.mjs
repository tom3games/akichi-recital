import './mute-auto.mjs'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
import { chromium, webkit } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
const ROOT = import.meta.dirname, PORT = 6339
const WAVS = (process.env.AR_TMP || tmpdir() + '/akichi-recital') + '/'
if (!existsSync(WAVS + 'mic_wobble.wav')) execFileSync(process.execPath, ['test-analyzer.mjs'], { cwd: ROOT, env: { ...process.env, AR_TMP: WAVS.slice(0, -1) }, stdio: 'ignore' })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const res = []
const ink = id => document => 0
async function probe(p) {
  return p.evaluate(() => {
    const cnt = id => { const c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n }
    const b = document.getElementById('liveBox').getBoundingClientRect(), rb = document.getElementById('reqPaper').getBoundingClientRect()
    return { boxHidden: document.getElementById('liveBox').hidden, top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), reqBottom: Math.round(rb.bottom), wavePx: cnt('liveWave'), scopePx: cnt('liveScope'), rings: ar.V.rings.length, sw: document.documentElement.scrollWidth, W: innerWidth }
  })
}
for (const [eng, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const b = await eng.launch(eng === chromium ? { ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--autoplay-policy=no-user-gesture-required'] } : {})
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 430, height: 932 }]) {
    const ctx = await b.newContext({ locale: 'ja-JP', viewport: vp, hasTouch: eng === webkit })
    await ctx.route(/__mic\.wav/, r => r.fulfill({ body: readFileSync(WAVS + 'mic_wobble.wav'), contentType: 'audio/wav' }))
    await muteContext(ctx)
    await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('ar_tut', '1') } catch (e) {} })
    if (eng === chromium) await ctx.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { const a = new Audio('/__mic.wav'); a.loop = true; await a.play(); return a.captureStream() } })
    const p = await ctx.newPage(); const errs = []
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
    await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__arReady && !document.getElementById('vTitle').hidden)
    const tag = `${name}-${vp.width}x${vp.height}`
    if (eng === chromium) {
      const r = await p.evaluate(() => ar.xy('bMic')); await p.mouse.click(r.x, r.y)
      await p.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 9000 })
      const before = await p.evaluate(() => document.getElementById('liveBox').hidden)
      await p.waitForTimeout(2600)
      const pr = await probe(p); await p.screenshot({ path: `${ROOT}/shots/live-${tag}.png` })
      res.push({ tag, mode: 'mic', ...pr, errs })
    } else {
      const r = await p.evaluate(() => ar.xy('bFinger')); await p.touchscreen.tap(r.x, r.y)
      await p.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 9000 })
      const h = await p.evaluate(() => ar.xy('bHeart'))
      await p.mouse.move(h.x, h.y); await p.mouse.down()
      for (let i = 0; i < 120; i++) { await p.mouse.move(h.x + Math.sin(i / 3) * 50, h.y + Math.cos(i / 4) * 40); await p.waitForTimeout(18) }
      const pr = await probe(p); await p.screenshot({ path: `${ROOT}/shots/live-${tag}.png` }); await p.mouse.up()
      res.push({ tag, mode: 'finger', ...pr, errs })
    }
    await p.waitForFunction(() => !document.getElementById('vSing') || document.getElementById('vSing').hidden, null, { timeout: 9000 }).catch(() => {})
    res[res.length - 1].hiddenAfter = await p.evaluate(() => document.getElementById('liveBox').hidden)
    await ctx.close()
  }
  await b.close()
}
server.kill()
for (const r of res) console.log(JSON.stringify(r))
