import './mute-auto.mjs'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 公開URLの確認。node live.mjs（ログインしていないブラウザで見る）。SKIPGH=1 で GitHub ページの確認を省く
// akichi-recital ar を置き換え、「遊びの通し」をゲームに合わせて書く
import { chromium, webkit } from 'playwright'
import { execSync } from 'node:child_process'
// 個人のアカウント名は公開リポジトリに書かない。実行時に gh から取る（2026-11-02 live.mjs に名前が文字で入ったまま5本公開していた）
const OWNER = (() => { try { return execSync('gh api user -q .login', { encoding: 'utf8' }).trim().toLowerCase() } catch { return '' } })()
const URL0 = 'https://tom3games.github.io/akichi-recital/'
const out = []
for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await bt.launch(bt === chromium ? MUTE_LAUNCH : {}), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('requestfailed', r => errs.push('fail ' + r.url()))
  await p.goto(URL0 + '?t=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__arReady, null, { timeout: 15000 })
  // 遊びの通し: 心の声で5秒揺らす → 飛ばす → 結果
  await p.evaluate(() => document.getElementById('bFinger').click())
  const tp = await p.evaluate(() => document.getElementById('pTut').hidden); if (!tp) await p.evaluate(() => document.getElementById('bTutOk').click())
  await p.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 6000 })
  const r = await p.evaluate(() => ar.xy('bHeart')); await p.mouse.move(r.x, r.y); await p.mouse.down()
  for (let i = 0; i < 120; i++) { await p.mouse.move(r.x + Math.sin(i * 1.7) * 60, r.y + Math.cos(i) * 50, { steps: 2 }); await p.waitForTimeout(20) }
  await p.mouse.up()
  await p.waitForFunction(() => !document.getElementById('vShow').hidden, null, { timeout: 9000 }); await p.evaluate(() => ar.skip())
  await p.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 8000 })
  out.push(name + ': result ' + JSON.stringify(await p.evaluate(() => window.__lastResult)) + ' muteOk=' + (await p.evaluate(() => window.__muteOk())))
  await p.screenshot({ path: `shots/live-${name}.png` })
  const og = await p.evaluate(async () => { const r = await fetch(document.querySelector('meta[property="og:image"]').content); return r.status + ' ' + r.headers.get('content-type') })
  out.push(`${name}: og=${og} errors=${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
if (process.env.SKIPGH) { console.log(out.join('\n')); process.exit(0) }
// ログアウト状態でリポジトリ・更新履歴に個人のIDが出ていないか
const b = await chromium.launch(MUTE_LAUNCH), p = await b.newPage()
for (const u of ['https://github.com/tom3games/akichi-recital', 'https://github.com/tom3games/akichi-recital/commits/main']) {
  const res = await p.goto(u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
  out.push(`${u} status=${res.status()} owner=${OWNER && (await p.content()).toLowerCase().includes(OWNER) ? 'FOUND' : 'none'}`)
}
await b.close()
console.log(out.join('\n'))
