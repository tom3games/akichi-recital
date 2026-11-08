// 公開版の最初の読み込みを測る（無音）。キャッシュなしの新しい状態で、回線と端末の遅さを再現する
// node loadtime.mjs <URL> <準備完了の式 例 window.__kobReady> [回数]
import { createRequire } from 'node:module'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const { chromium } = createRequire(process.env.HOME + '/tools/pw/')('playwright')
const [url, ready, times = '3'] = process.argv.slice(2)
if (!url || !ready) { console.log('node loadtime.mjs <URL> <準備完了の式> [回数]'); process.exit(2) }
const CASES = [['10Mbps', 10, 40, 1], ['3Mbps+CPU4倍遅', 3, 150, 4]]
// 既定のソフト描画だと GPU の初期化で数秒遅く出る。実機に近づけるため GPU を使う
const b = await chromium.launch({ ...MUTE_LAUNCH, channel: 'chromium', args: [...(MUTE_LAUNCH.args || []), '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [name, mbps, rtt, cpu] of CASES) {
  const secs = []; let last = null
  for (let i = 0; i < +times; i++) {
    const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, hasTouch: true })
    await muteContext(ctx)
    const p = await ctx.newPage(), c = await ctx.newCDPSession(p), reqs = new Map(); let errs = 0
    await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true })
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 })
    await c.send('Emulation.setCPUThrottlingRate', { rate: cpu })
    c.on('Network.requestWillBeSent', e => { if (!e.request.url.startsWith('blob:') && !e.request.url.startsWith('data:')) reqs.set(e.requestId, { u: e.request.url, n: 0 }) })
    c.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) r.n = e.encodedDataLength })
    p.on('pageerror', () => errs++)
    const t0 = Date.now()
    await p.goto(url, { waitUntil: 'commit' })
    await p.waitForFunction(ready, null, { timeout: 60000 }); const s = (Date.now() - t0) / 1000; secs.push(s)
    const at = { reqs: reqs.size, mb: [...reqs.values()].reduce((a, r) => a + r.n, 0) / 1e6 }
    await p.waitForTimeout(500)
    last = { ...at, errs, top: [...reqs.values()].sort((a, c) => c.n - a.n).slice(0, 5).map(r => `${(r.n / 1024).toFixed(0)}KB ${new URL(r.u).pathname.split('/').pop()}`) }
    await ctx.close()
  }
  console.log(`${name}: 準備完了 ${secs.map(s => s.toFixed(1)).join(' / ')} 秒、準備完了までの通信 ${last.reqs}件 ${last.mb.toFixed(2)}MB、エラー ${last.errs}`)
  console.log('  大きい順: ' + last.top.join(', '))
}
await b.close()
