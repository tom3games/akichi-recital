import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）。偽マイクの入力は鳴らない
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// node verify.mjs  （先に AR_TMP=<dir> node test-analyzer.mjs で偽マイク用の WAV を作る）
import { chromium, webkit } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const PORT = 6331
const WAVS = (process.env.AR_TMP || tmpdir() + '/akichi-recital') + '/'
if (!existsSync(WAVS + 'mic_wobble.wav')) execFileSync(process.execPath, ['test-analyzer.mjs'], { cwd: ROOT, env: { ...process.env, AR_TMP: WAVS.slice(0, -1) }, stdio: 'ignore' })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) }
async function open(browser, opts = {}, { tut = true, init, route } = {}) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  if (route) await ctx.route(route[0], r => r.fulfill({ body: readFileSync(route[1]), contentType: 'audio/wav' }))
  await muteContext(ctx)
  await ctx.addInitScript(tut => { try { localStorage.clear(); if (tut) localStorage.setItem('ar_tut', '1') } catch (e) {} }, tut)
  if (init) await ctx.addInitScript(init)
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)|ofuse|x\.com/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0); await p.waitForFunction(() => window.__arReady && !document.getElementById('vTitle').hidden, null, { timeout: 15000 })
  return p
}
// 本物の指（座標を出してから押す）
async function press(p, id, touch) { const r = await p.evaluate(id => ar.xy(id), id); expect(r.w > 0 && r.h > 0, id + ' hidden'); if (touch) await p.touchscreen.tap(r.x, r.y); else await p.mouse.click(r.x, r.y); return r }
const visible = (p, id) => p.evaluate(id => { const e = document.getElementById(id); return !!e && !e.hidden && !e.closest('[hidden]') }, id)
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('main:not([hidden]) button,main:not([hidden]) a,main:not([hidden]) .paper,#bMute')) { if (!el.offsetParent && el.id !== 'bMute') continue; const r = el.getBoundingClientRect(); if (!r.width) continue; if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
// 重なり: 号外の紙と下のボタンが重ならない
const noOverlap = q => q.evaluate(() => { const a = document.getElementById('paper').getBoundingClientRect(), b = document.querySelector('.rbtns').getBoundingClientRect(); return { paperBottom: Math.round(a.bottom), btnTop: Math.round(b.top), ok: a.bottom <= b.top + 2 } })
// 遊び中に同時に見えている文字の数（テロップと飛ばす案内まで）
const textCount = q => q.evaluate(() => [...document.querySelectorAll('#vSus:not([hidden]) #susTxt, #vSus:not([hidden]) #susSkip, #vShow:not([hidden]) #telop.in span, #vSing:not([hidden]) #count:not([hidden]), #vSing:not([hidden]) #singCue:not([hidden]), #vSing:not([hidden]) #fingerTip:not([hidden])')].filter(e => e.textContent.trim()).length)

// ================= 1. Chromium: 本物のマイクの道（偽マイクに WAV を流す） =================
async function micRound(wav, name, { tut = false } = {}) {
  // この Mac では Chromium の偽マイク（--use-file-for-fake-audio-capture）が getUserMedia で止まる（映像は通る・音声だけ応答なし。2026-11-08 確認）。
  // なので getUserMedia だけ差し替え、WAV を流す <audio>（無音のまま）の captureStream を「マイク」として返す。そこから先（録音・分析・演出・結果）は本物の道
  const b = await chromium.launch({ ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--autoplay-policy=no-user-gesture-required'] })
  const p = await open(b, {}, { tut: !tut, route: [/__mic\.wav/, WAVS + wav], init: () => { navigator.mediaDevices.getUserMedia = async c => { window.__gumArgs = c; const a = new Audio('/__mic.wav'); a.loop = true; await a.play(); window.__fakeMic = a; return a.captureStream() } } })
  const out = {}
  if (tut) {
    await press(p, 'bMic')
    await t(`マイク(${name}): 初回は説明が出る（PC の言い方）`, async () => { expect(await visible(p, 'pTut'), 'no tut'); const s = await p.textContent('#tutSub'); expect(/パソコン/.test(s), s); await p.screenshot({ path: `${ROOT}/shots/v-tut.png` }); return s })
    await press(p, 'bTutOk')
  } else await press(p, 'bMic')
  await p.waitForFunction(() => window.__micOk, null, { timeout: 8000 })
  await p.waitForFunction(() => !document.getElementById('count').hidden, null, { timeout: 4000 })
  out.countText = await textCount(p)
  await p.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 5000 })
  await p.waitForTimeout(1500)
  if (name === 'wobble') await p.screenshot({ path: `${ROOT}/shots/v-rec.png` })
  out.recText = await textCount(p)
  // 判定の間: 録音が終わると出る
  await p.waitForFunction(() => !document.getElementById('vSus').hidden, null, { timeout: 8000 })
  const susT0 = Date.now()
  await p.waitForFunction(() => window.__sus && window.__sus.variant, null, { timeout: 5000 })
  out.susVariant = await p.evaluate(() => window.__sus.variant)
  out.drum0 = await p.evaluate(() => Snd.played.drumroll || 0)
  if (name === 'sine') {
    // 本物のタップで飛ばす
    await p.waitForTimeout(700); await p.mouse.click(200, 400)
    await p.waitForFunction(() => !document.getElementById('vShow').hidden, null, { timeout: 1500 })
    out.susSkipMs = Date.now() - susT0; out.susSkipped = await p.evaluate(() => window.__sus.skipped)
  } else {
    await p.waitForTimeout(1300)
    out.susText = await textCount(p)
    out.cricket = await p.evaluate(() => !!(Snd.loops.cricket))
    out.drum = await p.evaluate(() => Snd.played.drumroll || 0)
    if (name === 'wobble' || name === 'silence') await p.screenshot({ path: `${ROOT}/shots/v-sus-mic-${name}.png` })
    await p.waitForFunction(() => !document.getElementById('vShow').hidden, null, { timeout: 6000 })
    out.susMs = Date.now() - susT0; out.susLog = await p.evaluate(() => window.__sus)
  }
  await p.waitForFunction(() => !document.getElementById('vShow').hidden, null, { timeout: 12000 })
  await p.waitForTimeout(1200)
  out.showText = await textCount(p)
  if (name === 'wobble') await p.screenshot({ path: `${ROOT}/shots/v-show.png` })
  // 飛ばす（本物のタップ）
  await p.mouse.click(200, 600)
  await p.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 8000 })
  await p.waitForTimeout(300)
  Object.assign(out, await p.evaluate(() => ({ gum: window.__gumArgs, r: window.__lastResult, path: window.__lastPath, buf: ar.recBufLen(), photo: (document.getElementById('rPhoto').src || '').length, replayDisabled: document.getElementById('bReplay').disabled, muteOk: window.__muteOk(), tm: window.__tmLog.map(e => e.name) })))
  await p.screenshot({ path: `${ROOT}/shots/v-mic-${name}.png` })
  if (!out.replayDisabled) { const before = await p.evaluate(() => Snd.played.replay || 0); await press(p, 'bReplay'); out.replayCalls = (await p.evaluate(() => Snd.played.replay || 0)) - before; out.muteAfterReplay = await p.evaluate(() => window.__muteOk()) }
  out.errs = p.errs
  await b.close()
  return out
}
const wob = await micRound('mic_wobble.wav', 'wobble', { tut: true })
await t('マイク: エコー消し・雑音消し・自動音量を切って頼む', async () => { const c = wob.gum && wob.gum.audio; expect(c && c.echoCancellation === false && c.noiseSuppression === false && c.autoGainControl === false, wob.gum); return c })
await t('マイク(大声でうねる): 録音→分析→上の段（7以上）', async () => { expect(wob.r && wob.r.kind === 'tier' && wob.r.tier >= 7, wob.r); return { r: wob.r, path: wob.path } })
await t('マイク: 録音がメモリに残り「自分の歌を聞く」が押せて鳴らす処理が呼ばれる', async () => { expect(wob.buf > 48000 * 3 && !wob.replayDisabled && wob.replayCalls === 1, wob); return { samples: wob.buf, replayCalls: wob.replayCalls } })
await t('マイク: 結果の写真がある', async () => { expect(wob.photo > 5000, wob.photo); return wob.photo })
await t('マイク: 無音のまま（muteOk・聞いた後も）', async () => { expect(wob.muteOk && wob.muteAfterReplay, wob) })
await t('マイク: 計測に開始と終了が残る', async () => { expect(wob.tm.includes('game_start') && wob.tm.includes('game_end'), wob.tm); return wob.tm })
await t('マイク: 画面の文字は同時に2つまで（カウント・録音中・破壊）', async () => { expect(wob.countText <= 2 && wob.recText <= 2 && wob.showText <= 2, wob); return [wob.countText, wob.recText, wob.showText] })
await t('マイク: エラーなし', async () => { expect(!wob.errs.length, wob.errs.join('|')) })
await t('マイク(上の段): 録音の後に判定の間（ドラムロール・2.5〜4.2秒・自然に破壊へ）', async () => { expect(wob.susVariant === 'tier' && wob.drum >= 1 && !wob.cricket && wob.susMs >= 2400 && wob.susMs <= 4300 && !wob.susLog.skipped, wob); return { ms: wob.susMs, dur: wob.susLog.dur, drum: wob.drum, text: wob.susText } })
await t('マイク: 判定の間も文字は2つまで', async () => { expect(wob.susText <= 2, wob.susText); return wob.susText })
const sine = await micRound('mic_sine.wav', 'sine')
await t('マイク(音の合った純音): 普通に上手かった', async () => { expect(sine.r && sine.r.kind === 'good', sine.r); return sine.r })
await t('マイク(上手い): 判定の間は good の型で、本物のタップで飛ばせて結果まで行く', async () => { expect(sine.susVariant === 'good' && sine.susSkipped === true && sine.susSkipMs < 2400 && sine.r, sine); return { variant: sine.susVariant, skipMs: sine.susSkipMs } })
const sil = await micRound('mic_silence.wav', 'silence')
await t('マイク(無音): 歌ってない', async () => { expect(sil.r && sil.r.kind === 'none', sil.r); return sil.r })
await t('マイク(無音): 歌ってないでも判定の間がある（コオロギ・ドラムロールなし）', async () => { expect(sil.susVariant === 'none' && sil.cricket && sil.drum === sil.drum0 && sil.susMs >= 2200 && sil.susMs <= 4300, sil); return { ms: sil.susMs, cricket: sil.cricket } })
await t('マイク(無音・純音): エラーなし', async () => { expect(!sine.errs.length && !sil.errs.length, sine.errs.concat(sil.errs).join('|')) })

// ================= 2. Chromium: 共通の確認・指で歌う・画面の収まり =================
const browser = await chromium.launch(MUTE_LAUNCH)
{
  const p = await open(browser)
  await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
  await t('ブラウザの拡大が起きない', async () => {
    const r = await p.evaluate(() => {
      const vp = document.querySelector('meta[name=viewport]').content
      const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
      const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
      const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
      return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
    })
    expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', r)
  })
  await t('OGP 一式がある', async () => {
    const r = await p.evaluate(() => ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => !!document.querySelector(`meta[property="${k}"]`)).concat(!!document.querySelector('meta[name="twitter:card"]')))
    expect(r.every(Boolean), r)
  })
  await t('マイクの横にプライバシーの一行がある', async () => { const s = await p.textContent('#tPriv'); expect(/端末の外に出ません/.test(s), s); return s })
  await t('画面に「AI」「画像生成」が出ない', async () => { const s = await p.evaluate(() => document.body.innerText + [...document.querySelectorAll('[aria-label],img[alt]')].map(e => e.getAttribute('aria-label') || e.alt).join(' ')); expect(!/\bAI\b|画像生成/.test(s), s.match(/.{0,10}(AI|画像生成).{0,10}/)); })
  await t('点の取り方を書かない（説明・遊び方・OGP・結果に大声/音痴/外す/暴れる が無い。ゲージ名は除く）', async () => {
    const bad = await p.evaluate(() => { const re = /大声|音痴|外し|外す|暴れる|壊れる。|louder|off-key|wilder|wild =/i, out = []
      for (const lg of ['ja', 'en']) for (const [k, v] of Object.entries(D.ui[lg])) { if (/^g_/.test(k)) continue; const s = [].concat(typeof v === 'function' ? v('x', 'y') : v).join(' '); if (re.test(s)) out.push(lg + '.' + k + ':' + s) }
      for (const m of document.querySelectorAll('meta[name=description],meta[property="og:description"],meta[name="twitter:description"]')) if (re.test(m.content)) out.push(m.content)
      if (document.getElementById('rHint')) out.push('rHint')
      return out })
    expect(!bad.length, bad.join(' | '))
  })
  // 指で歌う（本物のマウスでボタンを押したまま動かす）
  async function fingerRound(kind) {
    await press(p, 'bFinger')
    await p.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 5000 })
    const r = await p.evaluate(() => ar.xy('bHeart'))
    if (kind !== 'none') {
      await p.mouse.move(r.x, r.y); await p.mouse.down()
      const t0 = Date.now(); let i = 0
      while (Date.now() - t0 < 5200) {
        if (kind === 'wild') { i++; await p.mouse.move(r.x + Math.sin(i * 1.9) * 70, r.y + Math.cos(i * 1.3) * 60, { steps: 2 }) }
        else await p.waitForTimeout(16)
        await p.waitForTimeout(16)
      }
      await p.mouse.up()
    }
    await p.waitForFunction(() => !document.getElementById('vSus').hidden, null, { timeout: 9000 })
    const susT0 = Date.now()
    await p.waitForFunction(() => window.__sus && window.__sus.variant, null, { timeout: 3000 })
    const susVariant = await p.evaluate(() => window.__sus.variant)
    let susSkipped = false
    if (kind === 'wild') { await p.waitForTimeout(1200); await p.screenshot({ path: `${ROOT}/shots/v-sus-finger-wild.png` }); await p.mouse.click(200, 400); await p.waitForFunction(() => !document.getElementById('vShow').hidden, null, { timeout: 1500 }); susSkipped = await p.evaluate(() => window.__sus.skipped) }
    await p.waitForFunction(() => !document.getElementById('vShow').hidden || !document.getElementById('vResult').hidden, null, { timeout: 9000 })
    const susMs = Date.now() - susT0
    if (kind === 'wild') await p.screenshot({ path: `${ROOT}/shots/v-finger-show.png` })
    await p.evaluate(() => ar.skip())
    await p.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 8000 })
    const out = await p.evaluate(() => ({ r: window.__lastResult, replay: document.getElementById('bReplay').disabled, txt: document.getElementById('bReplay').textContent, fizzle: window.__sus.fizzle || 0 }))
    Object.assign(out, { susVariant, susSkipped, susMs })
    await p.screenshot({ path: `${ROOT}/shots/v-finger-${kind}.png` })
    await p.evaluate(() => { document.getElementById('vResult').hidden = true; document.getElementById('vTitle').hidden = false })
    return out
  }
  const still = await fingerRound('still')
  await t('心の声: じっと押し続ける → 普通に上手かった', async () => { expect(still.r.kind === 'good' && still.r.finger, still.r); return still.r })
  await t('心の声: 録音は無いので聞くボタンは押せない', async () => { expect(still.replay && /録音できません/.test(still.txt), still) })
  const wild = await fingerRound('wild')
  await t('心の声: 激しく動かす → 上の段（7以上）', async () => { expect(wild.r.kind === 'tier' && wild.r.tier >= 7, wild.r); return wild.r })
  const none = await fingerRound('none')
  await t('心の声: 押さない → 歌ってない（何もしないと最低）', async () => { expect(none.r.kind === 'none', none.r); return none.r })
  await t('心の声: 判定の間が結果に合った型で出る（上手い=しぼむ・暴れ=本物のクリックで飛ばす・無言=コオロギ）', async () => {
    expect(still.susVariant === 'good' && still.fizzle === 1 && still.susMs >= 2400 && still.susMs <= 4300, still)
    expect(wild.susVariant === 'tier' && wild.susSkipped === true && wild.susMs < 2600, wild)
    expect(none.susVariant === 'none' && none.susMs >= 2200 && none.susMs <= 4300, none)
    return { still: still.susMs, wildSkip: wild.susMs, none: none.susMs }
  })
  // 結果の中身
  await p.evaluate(() => { ar.dbg.pause(false); ar.showWith({}) })
  await p.waitForTimeout(400); await p.evaluate(() => ar.skip())
  await p.waitForFunction(() => !document.getElementById('vResult').hidden)
  await t('結果: Xでポストの文に結果と URL とハッシュタグ', async () => { const u = await p.evaluate(() => ar.postUrl()); const d = decodeURIComponent(u); expect(/x\.com\/intent\/post/.test(u) && /地球が滅んだ/.test(d) && /akichi-recital/.test(d) && /hashtags=空き地リサイタル/.test(d), d); return d.slice(0, 120) })
  await t('結果: 画像を保存（1080x1350 の号外）', async () => { const s = await p.evaluate(async () => { const c = await ar.makeCard(); return [c.width, c.height, c.toDataURL('image/png').length] }); expect(s[0] === 1080 && s[1] === 1350 && s[2] > 80000, s); return s })
  await t('結果: 画像保存ボタンを押すとファイルができる', async () => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), press(p, 'bSave')]); return dl.suggestedFilename() })
  await t('結果: ゲージ4本と読みが出る', async () => { const n = await p.$$eval('#rGauges .bar', e => e.length); const rd = await p.$$eval('#rGauges .rd', e => e.map(x => x.textContent)); expect(n === 4 && rd.every(Boolean), rd); return rd })
  await t('結果: 支援リンク「作者にのど飴をおごる」', async () => { const s = await p.textContent('#tmSupport'); expect(/のど飴/.test(s), s); return s })
  // 英語
  await p.evaluate(() => { document.getElementById('vResult').hidden = true; document.getElementById('vTitle').hidden = false })
  await press(p, 'bLang')
  await t('英語に切り替わる', async () => { const s = await p.textContent('#tMic'); expect(/Sing into the mic/.test(s), s); return s })
  await press(p, 'bLang')
  await t('Chromium: 最後まで無音', async () => { expect(await p.evaluate(() => window.__muteOk()), 'muteOk false') })
  await t('Chromium: 通しでエラーなし', async () => { expect(!p.errs.length, p.errs.join('|')) })
  await p.close()
}
// ロード画面: 音が1つ届かなくても12秒で必ず消える
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await muteContext(ctx)
  await ctx.route('**/snd/boom.mp3*', () => {})   // 返事をしない
  const p = await ctx.newPage(); const t0 = Date.now(); await p.goto(URL0)
  const early = await p.evaluate(() => !document.getElementById('vLoad').hidden)
  await p.screenshot({ path: `${ROOT}/shots/v-load.png` })
  await p.waitForFunction(() => document.getElementById('vLoad').hidden, null, { timeout: 15000 }).catch(() => {})
  const sec = (Date.now() - t0) / 1000, bar = await p.evaluate(() => document.querySelector('#loadBar i').style.width)
  await t('ロード画面: 最初に出て、素材が1つ届かなくても13秒以内に消える', async () => { expect(early && sec < 13.5, { early, sec }); return { sec: +sec.toFixed(1), bar } })
  await ctx.close()
}
// 画面の収まり: スマホ縦3サイズ × 全画面
const sus = {}
for (const [w, h, name] of [[360, 640, 'small'], [390, 844, 'phone'], [430, 932, 'max']]) {
  const q = await open(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await press(q, 'bHow', true); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` }); await press(q, 'bHowClose', true)
  await q.evaluate(() => { document.getElementById('tutSub') && (document.getElementById('pTut').hidden = false) }); views.tut = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-tut.png` }); await q.evaluate(() => { document.getElementById('pTut').hidden = true })
  await q.evaluate(() => { document.getElementById('denT').textContent = 'マイクが使えませんでした'; document.getElementById('denB').textContent = D.ui.ja.deniedB; document.getElementById('pDenied').hidden = false }); views.denied = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-denied.png` }); await q.evaluate(() => { document.getElementById('pDenied').hidden = true })
  await press(q, 'bFinger', true); await q.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 5000 })
  views.finger = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-finger.png` })
  const heartIn = await q.evaluate(() => { const r = ar.xy('bHeart'); return r.y + r.h / 2 <= innerHeight && r.y - r.h / 2 >= 0 })
  await q.waitForFunction(() => !document.getElementById('vShow').hidden || !document.getElementById('vResult').hidden, null, { timeout: 9000 })
  // 判定の間のコマ（時計を止めて進める）
  for (const [k, f, secs] of [['t10', {}, [1.4, 3.2, 3.45]], ['t3', { loudDb: -24, devMean: 18, unsteady: 0.5, rangeSemis: 5, jumpsPerSec: 0.2, harsh: 0.05 }, [3.2]], ['good', { loudDb: -26, devMean: 6, unsteady: 0.2, rangeSemis: 5, jumpsPerSec: 0, harsh: 0, jitter: 10, voicedRatio: 0.9 }, [2.2, 3.3]], ['none', { actFrac: 0.02, loudDb: -60 }, [1.9]]]) {
    await q.evaluate(f => { ar.dbg.pause(true); return ar.susWith(f) }, f)
    let done = 0
    for (const sec of secs) {
      await q.evaluate(n => ar.dbg.step(n), Math.round((sec - done) * 60)); done = sec
      await q.waitForTimeout(80)
      const tag = `${k}-${sec}`
      views['sus-' + tag] = await fit(q)
      const st = await q.evaluate(() => ({ on: !document.getElementById('vSus').hidden, v: window.__sus.variant, txt: document.getElementById('susTxt').textContent, needle: +ar.V.needle?.toFixed?.(2), shake: +ar.V.shake.toFixed(3), hold: ar.V.hold, fur: +ar.V.fur.toFixed(2) }))
      sus[`${name}-${tag}`] = st
      await q.screenshot({ path: `${ROOT}/shots/sus-${name}-${tag}.png` })
    }
    await q.evaluate(() => { ar.dbg.pause(false); ar.skip(); ar.skip() }); await q.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 8000 })
  }
  for (const [k, f] of [['t10', {}], ['t4', { loudDb: -24, devMean: 20, unsteady: 0.6, rangeSemis: 6, jumpsPerSec: 0.3, harsh: 0.1 }], ['good', { loudDb: -26, devMean: 6, unsteady: 0.2, rangeSemis: 5, jumpsPerSec: 0, harsh: 0, jitter: 10, voicedRatio: 0.9 }], ['none', { actFrac: 0.02, loudDb: -60 }]]) {
    await q.evaluate(f => ar.showWith(f), f); await q.waitForTimeout(900)
    if (k === 't10') { views.show = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-show.png` }) }
    await q.evaluate(() => ar.skip()); await q.waitForFunction(() => !document.getElementById('vResult').hidden); await q.waitForTimeout(700)
    views['result-' + k] = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result-${k}.png` })
    await t(`号外とボタンが重ならない ${name} ${k}`, async () => { const r = await noOverlap(q); expect(r.ok, r) })
  }
  await q.evaluate(() => document.getElementById('bLang').click()); await q.waitForTimeout(200)
  views['result-en'] = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result-en.png` })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, r) })
  await t(`${name}: 心のマイクが画面内`, async () => { expect(heartIn, heartIn) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
await t('判定の間(コマ): 上の段ほど揺れが強く、針が振り切れる', async () => { const a = sus['phone-t10-3.2'], b = sus['phone-t3-3.2'], c = sus['phone-t10-3.45']; expect(a.v === 'tier' && a.shake > b.shake * 2 && c.needle >= 1, { a, b, c }); return { t10: a.shake, t3: b.shake, pinned: c.needle } })
await t('判定の間(コマ): 上手いは途中でしぼむ（あれ？）', async () => { const a = sus['phone-good-2.2'], b = sus['phone-good-3.3']; expect(a.txt === '判定中…' && b.txt === '…あれ？' && b.needle < -0.5, { a, b }); return { a: a.txt, b: b.txt } })
await t('判定の間(コマ): 歌ってないは針がほぼ動かず、町も息をのまない', async () => { const a = sus['phone-none-1.9']; expect(a.v === 'none' && a.needle < -0.85 && a.hold === 0, a); return a })
await browser.close()

// ================= 3. WebKit（iPhone 相当）: マイク拒否と心の声 =================
const wb = await webkit.launch()
{
  // a) そのままの WebKit（マイクの許可が無い）
  const wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await press(wp, 'bMic', true)
  await wp.waitForFunction(() => !document.getElementById('pDenied').hidden || window.__micOk, null, { timeout: 10000 }).catch(() => {})
  const st = await wp.evaluate(() => ({ denied: !document.getElementById('pDenied').hidden, micOk: !!window.__micOk, body: document.getElementById('denB').textContent }))
  await wp.screenshot({ path: `${ROOT}/shots/v-webkit-denied.png` })
  await t('WebKit: マイクが使えない時に案内が出る（または使える）', async () => { expect(st.denied || st.micOk, st); return st })
  await t('WebKit: タップで鳴らす操作の後も無音', async () => { expect(await wp.evaluate(() => window.__muteOk()), 'muteOk false') })
  await t('WebKit: エラーなし（拒否）', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
  await wp.close()
  // a2) 許可した WebKit: 本物の getUserMedia（WebKit の模擬マイク）で録音から結果まで
  {
    const wm = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['microphone'] })
    await press(wm, 'bMic', true)
    await wm.waitForFunction(() => window.__micOk || !document.getElementById('pDenied').hidden, null, { timeout: 10000 }).catch(() => {})
    const ok = await wm.evaluate(() => !!window.__micOk)
    let rr = null
    if (ok) {
      await wm.waitForFunction(() => !document.getElementById('vShow').hidden || !document.getElementById('pDenied').hidden, null, { timeout: 15000 }).catch(() => {})
      await wm.evaluate(() => ar.skip())
      await wm.waitForFunction(() => !document.getElementById('vResult').hidden || !document.getElementById('pDenied').hidden, null, { timeout: 8000 }).catch(() => {})
      rr = await wm.evaluate(() => ({ r: window.__lastResult, path: window.__lastPath, buf: ar.recBufLen(), recFail: window.__recFail || 0 }))
      await wm.screenshot({ path: `${ROOT}/shots/v-webkit-mic.png` })
    }
    // Playwright の WebKit は AudioContext を無音のため止めており、MediaRecorder も 0 バイトを返す（この版の WebKit に AAC の書き出しが無い）。
    // 本物の Safari では AudioContext が動くので PCM の道を通る。ここでは「マイクが取れて5秒録り、取れなかった時は止まらず案内に落ちる」を見る
    const den = await wm.evaluate(() => ({ shown: !document.getElementById('pDenied').hidden, t: document.getElementById('denT').textContent, fingerBtn: document.getElementById('bDenFinger').textContent }))
    await t('WebKit: 本物の getUserMedia（模擬マイク）が取れて録音まで進み、結果か「録音できませんでした」の案内に着地する', async () => { expect(ok && rr && (rr.r ? rr.buf > 0 : rr.recFail === 1 && den.shown && /録音できません/.test(den.t)), { rr, den }); return { rr, den } })
    await t('WebKit: マイクの後も無音', async () => { expect(await wm.evaluate(() => window.__muteOk()), 'muteOk false') })
    await t('WebKit: エラーなし（マイク）', async () => { expect(wm.errs.length === 0, wm.errs.join('|')) })
    await wm.close()
  }
  // b) 明示的に拒否 → 「心の声で歌う」で最後まで
  const wp2 = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { init: () => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) } })
  await press(wp2, 'bMic', true)
  await wp2.waitForFunction(() => !document.getElementById('pDenied').hidden, null, { timeout: 5000 })
  await t('WebKit: 拒否で「マイクが使えませんでした」と設定の案内', async () => { const s = await wp2.textContent('#denB'); expect(/設定/.test(s), s); return s })
  await press(wp2, 'bDenFinger', true)
  await wp2.waitForFunction(() => document.getElementById('recBar').classList.contains('on'), null, { timeout: 5000 })
  const r = await wp2.evaluate(() => ar.xy('bHeart'))
  // 本物の指: 押したまま揺らす（WebKit はマウスで pointer を送る）
  await wp2.mouse.move(r.x, r.y); await wp2.mouse.down()
  for (let i = 0; i < 140; i++) { await wp2.mouse.move(r.x + Math.sin(i * 1.7) * 60, r.y + Math.cos(i * 1.1) * 50, { steps: 2 }); await wp2.waitForTimeout(18) }
  await wp2.mouse.up()
  await wp2.waitForFunction(() => !document.getElementById('vShow').hidden || !document.getElementById('vResult').hidden, null, { timeout: 9000 })
  await wp2.touchscreen.tap(200, 600)
  await wp2.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 8000 })
  const res = await wp2.evaluate(() => window.__lastResult)
  await wp2.screenshot({ path: `${ROOT}/shots/v-webkit-finger.png` })
  await t('WebKit: 拒否 → 心の声で最後まで遊べる（揺らすと壊れる）', async () => { expect(res && res.finger && res.kind === 'tier' && res.tier >= 5, res); return res })
  await t('WebKit: 2本指の touchmove を止める', async () => {
    const v = await wp2.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
    expect(v, v)
  })
  await t('WebKit: 最後まで無音', async () => { expect(await wp2.evaluate(() => window.__muteOk()), 'muteOk false') })
  await t('WebKit: エラーなし（心の声）', async () => { expect(wp2.errs.length === 0, wp2.errs.join('|')) })
  await wp2.close()
}
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
