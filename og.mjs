import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// SNS 用の画像 og.png（1200x630）。一番おもしろい場面＝地球が割れて、ビールケースに乗った歌い手だけが宇宙で歌い続けている瞬間。node og.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const ROOT = import.meta.dirname, PORT = 6338
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH)
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 520, height: 640 }, deviceScaleFactor: 2 })
await muteContext(ctx)
await ctx.addInitScript(() => { try { localStorage.setItem('ar_tut', '1') } catch (e) {} })
const p = await ctx.newPage()
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__arReady && !document.getElementById('vTitle').hidden)
await p.evaluate(() => { ar.showWith({ ufo: false, encore: false }) })
await p.waitForFunction(() => ar.V.earthBoom > 0.97, null, { timeout: 30000 })
await p.evaluate(() => { ar.dbg.pause(true); ar.V.level = 0.95; ar.V.mouthOverride = 1; for (let i = 0; i < 3; i++) ar.V.rings.push({ r: 30 + i * 45, a: 0.8 - i * 0.2, w: 3, v: 0 }); ['vShow', 'bMute'].forEach(id => document.getElementById(id).style.visibility = 'hidden') })
await p.waitForTimeout(300)
const shot = await p.screenshot({ type: 'png' })
const og = await b.newPage({ viewport: { width: 1200, height: 630 } })
await og.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Yusei+Magic&family=Shippori+Mincho+B1:wght@800&family=Zen+Kaku+Gothic+New:wght@700;900&display=swap" rel="stylesheet"><style>
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;overflow:hidden;background:#07070f;font-family:"Zen Kaku Gothic New",sans-serif;position:relative}
.shot{position:absolute;left:0;top:0;width:620px;height:630px;background:url(data:image/png;base64,${shot.toString('base64')}) center/cover}
.fade{position:absolute;left:470px;top:0;width:160px;height:630px;background:linear-gradient(90deg,rgba(7,7,15,0),#0b0b18)}
.r{position:absolute;left:600px;top:0;right:0;bottom:0;background:#0b0b18}
.sign{position:absolute;left:640px;top:70px;width:520px;padding:24px 22px 20px;background:#c99c62;background-image:repeating-linear-gradient(90deg,rgba(80,50,20,.07) 0 2px,transparent 2px 9px);transform:rotate(-2.5deg);box-shadow:0 18px 30px -12px rgba(0,0,0,.8);text-align:center}
h1{font-family:"Yusei Magic";font-weight:400;font-size:70px;line-height:1.05;color:#1d1a24;white-space:nowrap}
h1 small{display:block;font-size:34px;color:#c4302b;margin-top:8px}
.paper{position:absolute;left:690px;top:356px;width:440px;background:#f2ecdf;padding:16px 20px 18px;transform:rotate(1.5deg);box-shadow:0 18px 30px -12px rgba(0,0,0,.8)}
.paper .m{display:flex;gap:10px;align-items:center;border-bottom:4px double #231f2b;padding-bottom:6px;font-family:"Shippori Mincho B1";font-weight:800;font-size:22px}
.paper .m b{background:#c4302b;color:#fff;padding:1px 8px;font-size:20px}
.paper h2{font-family:"Shippori Mincho B1";font-weight:800;font-size:64px;line-height:1.1;margin-top:8px;color:#231f2b}
.paper p{font-weight:700;font-size:22px;color:#3b3640;margin-top:6px}
</style></head><body>
<div class="r"></div><div class="shot"></div><div class="fade"></div>
<div class="sign"><h1>空き地リサイタル<small>〜歌声を響かせろ！〜</small></h1></div>
<div class="paper"><div class="m">空き地新聞<b>号外</b></div><h2>地球が滅んだ</h2><p>5秒歌っただけなのに</p></div>
</body></html>`, { waitUntil: 'networkidle' })
await og.evaluate(() => document.fonts.ready)
await og.screenshot({ path: ROOT + '/og.png' })
console.log('og.png', readFileSync(ROOT + '/og.png').length)
await b.close(); server.kill()
