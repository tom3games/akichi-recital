// 空き地リサイタル 本体。描画は canvas 2D（手で描いた形）、分析は analyzer.js、文言は data.js
'use strict'
;(() => {
  window.__jsUp = true
  const $ = id => document.getElementById(id)
  const AN = window.Analyzer
  const LS = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} } }
  let lang = LS.get('ar_lang') || (/^ja/i.test(navigator.language || '') ? 'ja' : 'en')
  const T = k => D.ui[lang][k]
  const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window
  const rnd = (a, b) => a + Math.random() * (b - a)
  const pick = a => a[Math.floor(Math.random() * a.length)]
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3)

  // ---------------- 音 ----------------
  const S = f => 'snd/' + f + '.mp3?v=1'
  Snd.def({
    crow: [S('crow1'), S('crow2')], crows: S('crows'), flap: S('flap'), glass: [S('glass1'), S('glass2'), S('glass3')], chime: S('chime'),
    howl: [S('howl1'), S('howl2')], bark: S('bark'), zap: S('zap'), snap: S('snap'), creak: S('creak'), rubble: S('rubble'), station: S('station'),
    whistle: S('whistle'), siren: S('siren'), crack: [S('crack1'), S('crack2')], boom: S('boom'), clap: S('clap'), giggle: S('giggle'), cat: S('cat'),
    jinBig: S('jin_big'), jinMeh: S('jin_meh'), jinMid: S('jin_mid'), ufo: S('ufo'), slam: S('slam'), tick: S('tick'), go: S('go'),
  })
  const AMB = S('amb_street'), BIRDS = S('amb_birds'), BGM = S('bgm_title')
  let muted = LS.get('ar_mute') === '1'
  Snd.setMute(muted)
  function bedOn(withBgm) {
    Snd.loop('amb', AMB, 0.22); Snd.loop('birds', BIRDS, 0.08)
    Snd.loop('bgm', withBgm ? BGM : null, 0.2)
  }
  function bedOff() { Snd.loop('amb', null, 0, 0.15); Snd.loop('birds', null, 0, 0.15); Snd.loop('bgm', null, 0, 0.15) }

  // 読み込み（最初に要る音を先に取ってくる。本物の件数でバーが進む。12秒で必ず消す）
  const preUrls = [...new Set(Object.values(Snd.files).flat().concat([AMB, BIRDS]))]
  Snd.pre = {}
  let loaded = 0, bootDone = false
  function bootProgress() { $('loadBar').firstElementChild.style.width = Math.round(100 * loaded / (preUrls.length + 1)) + '%' }
  const fontsP = (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => { loaded++; bootProgress() })
  const sndP = Promise.all(preUrls.map(u => fetch(u).then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) Snd.pre[u] = b }).catch(() => {}).then(() => { loaded++; bootProgress() })))
  Promise.race([Promise.all([fontsP, sndP]), new Promise(r => setTimeout(r, 12000))]).then(finishBoot)
  function finishBoot() {
    if (bootDone) return; bootDone = true
    $('vLoad').hidden = true; goTitle()
    // BGM は重いので後から
    fetch(BGM).then(r => r.arrayBuffer()).then(b => { Snd.pre[BGM] = b }).catch(() => {})
  }

  // ---------------- 画面 ----------------
  const cv = $('stage'), g = cv.getContext('2d')
  let W = 390, H = 844, DPR = 1, U = 1
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR)
    U = Math.min(W / 390, H / 640)
  }
  addEventListener('resize', resize); resize()

  const views = ['vTitle', 'vSing', 'vShow', 'vResult']
  function show(id) { for (const v of views) $(v).hidden = v !== id }
  function modal(id, on) { $(id).hidden = !on }
  let toastT = 0
  function toast(s) { const t = $('toast'); t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true }, 1600) }

  // ---------------- 世界の状態 ----------------
  const V = {
    t: 0, mode: 'title', level: 0, lvRaw: 0, hype: 0, zoom: 1, camY: 0, shake: 0, flash: 0, dark: 0, redSky: 0, space: 0,
    rings: [], leaves: [], parts: [], crows: [], dogs: 0, speaker: 0, angry: 0, bubble: null, broken: 0, cutWires: 0, blackout: 0,
    sway: 0, train: { x: -900, v: 0, stop: false, spark: 0 }, moonZoom: 0, moonCrack: 0, earthCrack: 0, earthBoom: 0, encore: 0,
    ufo: null, catState: 'sit', catT: 0, earsCover: 0, clap: 0, shrug: 0, cans: 0, yawn: 0, sing: 0,
  }
  function resetWorld() {
    Object.assign(V, { level: 0, lvRaw: 0, hype: 0, zoom: 1, camY: 0, shake: 0, flash: 0, dark: 0, redSky: 0, space: 0, dogs: 0, speaker: 0, angry: 0, bubble: null, broken: 0, cutWires: 0, blackout: 0, sway: 0, moonZoom: 0, moonCrack: 0, earthCrack: 0, earthBoom: 0, encore: 0, ufo: null, catState: 'sit', earsCover: 0, clap: 0, shrug: 0, cans: 0, yawn: 0, sing: 0 })
    V.rings = []; V.leaves = []; V.parts = []
    V.train = { x: -900, v: 0, stop: false, spark: 0 }
    later.length = 0; tweens.length = 0
    V.crows = [-60, -34, -8, 22, 52].map((x, i) => ({ x, y: 0, vy: 0, rot: 0, fall: false, hop: 0, ph: i * 1.7 }))
  }
  // 世界の時計で動く予定と変化（setTimeout を使わない。止める・進めるが効く）
  const later = [], tweens = []
  function after(sec, fn) { later.push({ t: V.t + sec, fn }) }
  function tween(sec, fn) { tweens.push({ t0: V.t, d: sec, fn }) }
  resetWorld()

  // ---------------- 描画 ----------------
  const INK = '#231f2b'
  const GY = () => H * (H / W > 1.9 ? 0.75 : H / W > 1.6 ? 0.68 : 0.73) - (1 - V.zoom) * H * 0.16
  function layer(depth) {
    const z = V.zoom + (1 - V.zoom) * depth * 0.75
    const s = U * z
    const sx = (Math.random() - 0.5) * V.shake * 14, sy = (Math.random() - 0.5) * V.shake * 14
    g.setTransform(DPR * s, 0, 0, DPR * s, DPR * (W / 2 + sx), DPR * (GY() + sy - V.camY * U * (1 - depth * 0.5)))
    return s
  }
  function P(fill, stroke = INK, lw = 2) { if (fill) { g.fillStyle = fill; g.fill() } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke() } }
  function rr(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h) }
  function ell(x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2) }
  const mix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * clamp(t, 0, 1)).toString(16).padStart(2, '0')).join('') }

  // 家並み（左右に続く。ズームアウトで見える）
  const HOUSES = (() => {
    const out = [], R = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647 })()
    const roofs = ['#4a5878', '#7a4a3c', '#5b6b4a', '#3f4d63', '#8a5a3a', '#55607a'], walls = ['#e8dcc8', '#d9cfbf', '#efe6d3', '#cfd6d8', '#e6d2b8']
    for (let x = -900; x < 900; x += 0) {
      const w = 110 + R() * 70
      if (x + w > -235 && x < 250) { x = 250; continue }   // 空き地の真後ろは手で置く
      out.push({ x, w, h: 120 + R() * 70, roof: roofs[Math.floor(R() * roofs.length)], wall: walls[Math.floor(R() * walls.length)], ph: R() * 6, two: R() > 0.35 })
      x += w + 8 + R() * 26
    }
    // 空き地の後ろの2軒（右の家の2階から苦情が来る）
    out.push({ x: -232, w: 170, h: 170, roof: '#4a5878', wall: '#e8dcc8', ph: 1, two: true, main: 'L' })
    out.push({ x: 52, w: 186, h: 190, roof: '#7a4a3c', wall: '#efe6d3', ph: 2, two: true, main: 'R' })
    return out
  })()
  const TOWERS = (() => { const out = []; let x = -1100; let s = 3; const R = () => (s = (s * 16807) % 2147483647) / 2147483647; while (x < 1100) { const w = 40 + R() * 60; out.push({ x, w, h: 120 + R() * 260, ph: R() * 6, c: ['#5d6185', '#4d5274', '#6a6a8c', '#575b7d'][Math.floor(R() * 4)] }); x += w + 6 + R() * 30 } return out })()

  function drawSky() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0)
    const gr = g.createLinearGradient(0, 0, 0, H)
    const top = mix('#2b2f55', '#3a0f22', V.redSky), mid = mix('#c86a5a', '#d2402a', V.redSky), low = mix('#f3be7c', '#ff9a3c', V.redSky)
    gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(0.8, low)
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
    // 一番星と月
    g.fillStyle = 'rgba(255,248,230,.8)'; for (const [x, y] of [[0.14, 0.08], [0.33, 0.15], [0.86, 0.06], [0.58, 0.04]]) { g.beginPath(); g.arc(x * W, y * H, 1.3, 0, 7); g.fill() }
    const mr = 20 * U * (1 + V.moonZoom * 2.2), mx = W * (0.74 - V.moonZoom * 0.24), my = H * (0.15 + V.moonZoom * 0.12)
    g.save(); g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fillStyle = '#f6efd8'; g.fill(); g.lineWidth = 2; g.strokeStyle = INK; g.stroke(); g.clip()
    g.fillStyle = 'rgba(180,170,140,.45)'; for (const [a, b, r] of [[-.35, -.2, .22], [.3, .25, .16], [.1, -.4, .1], [-.2, .4, .13]]) { g.beginPath(); g.arc(mx + a * mr, my + b * mr, r * mr, 0, 7); g.fill() }
    g.restore()
    if (V.moonCrack > 0) {
      g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath()
      const k = V.moonCrack, pts = [[-.95, -.1], [-.5, .05], [-.2, -.25], [.1, .1], [.4, -.05], [.95, .2]]
      pts.forEach(([a, b], i) => { if (i / (pts.length - 1) <= k) { const X = mx + a * mr, Y = my + b * mr; i ? g.lineTo(X, Y) : g.moveTo(X, Y) } })
      g.moveTo(mx - .2 * mr, my - .25 * mr); if (k > .5) g.lineTo(mx - .1 * mr, my - .7 * mr)
      g.moveTo(mx + .1 * mr, my + .1 * mr); if (k > .7) g.lineTo(mx + .25 * mr, my + .6 * mr)
      g.stroke()
    }
  }
  function drawTowers() {
    const s = layer(0.85); void s
    const sway = V.sway
    for (const b of TOWERS) {
      const k = Math.sin(V.t * 5 + b.ph) * sway * 0.06
      g.save(); g.translate(b.x + b.w / 2, -70); g.transform(1, 0, k, 1, 0, 0)
      rr(-b.w / 2, -b.h, b.w, b.h, 1); P(mix(b.c, '#2a2238', V.dark * 0.6), null)
      g.fillStyle = V.blackout ? 'rgba(40,40,60,.6)' : 'rgba(255,220,140,.55)'
      for (let y = -b.h + 10; y < -12; y += 14) for (let x = -b.w / 2 + 6; x < b.w / 2 - 8; x += 11) if ((x * 7 + y * 3 + b.ph * 100) % 5 > 1.4) g.fillRect(x, y, 5, 6)
      g.restore()
    }
  }
  function drawViaduct() {
    layer(0.7)
    const y = -120
    g.fillStyle = mix('#8d8a9a', '#3a3045', V.dark * 0.5)
    g.fillRect(-1400, y, 2800, 9)
    for (let x = -1400; x < 1400; x += 70) g.fillRect(x, y + 9, 7, 60)
    // 新幹線
    const tr = V.train
    g.save(); g.translate(tr.x, y - 1)
    rr(-160, -13, 320, 13, 6); P('#f4f6f8', INK, 1.2)
    g.beginPath(); g.moveTo(160, -13); g.quadraticCurveTo(205, -10, 212, 0); g.lineTo(160, 0); g.closePath(); P('#f4f6f8', INK, 1.2)
    g.fillStyle = '#2b5fae'; g.fillRect(-160, -5, 360, 2.2)
    g.fillStyle = '#334'; for (let x = -150; x < 150; x += 12) g.fillRect(x, -11, 6, 3.5)
    if (tr.spark > 0) { g.fillStyle = `rgba(255,220,120,${tr.spark})`; for (let i = 0; i < 10; i++) { g.beginPath(); g.arc(rnd(-150, 200), rnd(-2, 4), rnd(1, 3), 0, 7); g.fill() } }
    g.restore()
  }
  function drawHouse(h) {
    const k = Math.sin(V.t * 6 + h.ph) * V.sway * 0.05
    g.save(); g.translate(h.x + h.w / 2, -40); g.transform(1, 0, k, 1, 0, 0)
    const w = h.w, ht = h.h
    rr(-w / 2, -ht, w, ht, 2); P(mix(h.wall, '#3b3348', V.dark * 0.55))
    g.beginPath(); g.moveTo(-w / 2 - 12, -ht); g.lineTo(-w / 2 + 18, -ht - 46); g.lineTo(w / 2 - 18, -ht - 46); g.lineTo(w / 2 + 12, -ht); g.closePath(); P(mix(h.roof, '#221d2c', V.dark * 0.5))
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1.2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-w / 2 - 12 + i * 7, -ht - i * 11.5); g.lineTo(w / 2 + 12 - i * 7, -ht - i * 11.5); g.stroke() }
    // 窓
    const rows = h.two ? [-ht + 26, -ht + 90] : [-ht + 40]
    let wi = 0
    for (const wy of rows) for (let wx = -w / 2 + 18; wx < w / 2 - 40; wx += 52) {
      const lit = !V.blackout && ((wi * 3 + Math.floor(h.ph * 10)) % 4 !== 0)
      const isMan = h.main === 'R' && wy === rows[0] && wi === 1
      rr(wx, wy, 34, 30, 1); P(isMan && V.angry > 0 ? '#5a4a40' : lit ? '#ffd98a' : '#5b5c74', INK, 1.8)
      if (isMan && V.angry > 0) drawMan(wx + 17, wy + 30, V.angry)
      g.strokeStyle = INK; g.lineWidth = 1.2; g.beginPath(); g.moveTo(wx + 17, wy); g.lineTo(wx + 17, wy + 30); g.stroke()
      if (V.broken > 0) {
        g.strokeStyle = 'rgba(30,25,35,.85)'; g.lineWidth = 1.1; g.beginPath()
        const cx = wx + 9 + (wi % 3) * 8, cy = wy + 12
        for (let a = 0; a < 6; a++) { const an = a * 1.05 + wi; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * 20 * V.broken, cy + Math.sin(an) * 18 * V.broken) }
        g.stroke()
        if (V.broken > 0.6) { g.fillStyle = 'rgba(40,30,40,.65)'; g.beginPath(); g.moveTo(cx - 6, cy - 4); g.lineTo(cx + 5, cy - 8); g.lineTo(cx + 3, cy + 6); g.closePath(); g.fill() }
      }
      wi++
    }
    g.restore()
  }
  function drawMan(x, y, a) {
    // 窓から怒るおじさん（ランニングシャツ）
    g.save(); g.translate(x, y + (1 - a) * 20)
    ell(0, -8, 13, 10); P('#f4f1ea')
    g.beginPath(); g.arc(0, -24, 9, 0, 7); P('#e9b98f')
    g.fillStyle = INK; g.fillRect(-6, -27, 4, 2); g.fillRect(2, -27, 4, 2)
    ell(0, -19, 3, 2.5 + a * 2); P('#7b2a28', INK, 1)
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(-8, -31); g.lineTo(-2, -29); g.moveTo(8, -31); g.lineTo(2, -29); g.stroke()
    g.beginPath(); g.moveTo(12, -12); g.lineTo(22, -30 - Math.sin(V.t * 18) * 3); P(null, INK, 4)
    g.restore()
  }
  function drawPolesAndWires() {
    layer(0.15)
    const poles = [-150, 250], top = -340
    for (const x of poles) {
      g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x - 4, top); g.lineTo(x + 4, top); g.lineTo(x + 6, 0); g.closePath(); P('#6b6258')
      rr(x - 22, top + 18, 44, 5, 1); P('#5a5148', INK, 1.5)
    }
    // 町内放送のスピーカー（左の電柱）
    g.save(); g.translate(-150, -282)
    const sp = V.speaker
    g.beginPath(); g.moveTo(4, -6); g.lineTo(28, -16 - sp * 2); g.lineTo(28, 16 + sp * 2); g.lineTo(4, 6); g.closePath(); P('#d9dadf')
    ell(28, 0, 4, 16 + sp * 2); P('#9a9ca6')
    if (sp > 0) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.5; for (let i = 0; i < 3; i++) { const r = 12 + ((V.t * 60 + i * 12) % 36); g.globalAlpha = 1 - r / 48; g.beginPath(); g.arc(30, 0, r, -0.6, 0.6); g.stroke() } g.globalAlpha = 1 }
    g.restore()
    // 電線（切れると垂れる）
    g.strokeStyle = '#1d1a22'; g.lineWidth = 1.6
    for (const dy of [0, 12]) {
      const y = top + 26 + dy
      if (V.cutWires < 0.01) {
        g.beginPath(); g.moveTo(-900, y + 18); g.quadraticCurveTo(-525, y + 50, -150, y)
        g.quadraticCurveTo(50, y + 30 + Math.sin(V.t * 3) * V.level * 6, 250, y); g.quadraticCurveTo(575, y + 40, 900, y + 10); g.stroke()
      } else {
        const k = V.cutWires
        g.beginPath(); g.moveTo(-150, y); g.quadraticCurveTo(-110, y + 60 * k, -100 + Math.sin(V.t * 4 + dy) * 8 * k, y + 160 * k); g.stroke()
        g.beginPath(); g.moveTo(250, y); g.quadraticCurveTo(200, y + 60 * k, 190 + Math.sin(V.t * 4.3 + dy) * 8 * k, y + 170 * k); g.stroke()
        g.beginPath(); g.moveTo(-900, y + 18); g.quadraticCurveTo(-525, y + 50, -150, y); g.moveTo(250, y); g.quadraticCurveTo(575, y + 40, 900, y + 10); g.stroke()
      }
    }
    // カラス
    for (const c of V.crows) {
      const wireY = top + 26 + 22 + c.x * 0.02
      g.save(); g.translate(c.x, wireY + c.y - Math.abs(Math.sin(c.hop)) * 6); g.rotate(c.rot)
      ell(0, -9, 9, 7); P('#1d1a22', '#000', 1)
      g.beginPath(); g.arc(7, -17, 5, 0, 7); P('#1d1a22', '#000', 1)
      g.beginPath(); g.moveTo(11, -18); g.lineTo(18, -16); g.lineTo(11, -15); P('#3a3640', null)
      g.fillStyle = c.fall ? '#fff' : '#ddd'; g.beginPath(); g.arc(8.5, -18, 1.2, 0, 7); g.fill()
      if (c.fall) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(7, -20); g.lineTo(10, -16); g.moveTo(10, -20); g.lineTo(7, -16); g.stroke() }
      g.beginPath(); g.moveTo(-8, -8); g.lineTo(-17, -4); g.lineTo(-8, -4); P('#1d1a22', null)
      g.restore()
    }
  }
  function drawLot() {
    layer(0)
    // 地面
    const gr = g.createLinearGradient(0, -40, 0, 260); gr.addColorStop(0, mix('#7c9a45', '#3a3a2a', V.dark * .6)); gr.addColorStop(1, mix('#4f6b2b', '#22261a', V.dark * .6))
    g.fillStyle = gr; g.fillRect(-1600, -40, 3200, 1400)
    g.fillStyle = 'rgba(150,120,80,.5)'; ell(10, 6, 120, 14); g.fill(); ell(-140, 40, 60, 8); g.fill()
    // ブロック塀
    g.save(); g.translate(0, -40)
    for (let x = -700; x < 700; x += 0) { const w = 40; rr(x, -58, w, 19, 0); P(mix('#b2aca2', '#4b4652', V.dark * .5), '#6f6a62', 1); rr(x + 20, -39, w, 19, 0); P(mix('#aaa49a', '#47424e', V.dark * .5), '#6f6a62', 1); rr(x, -20, w, 20, 0); P(mix('#b2aca2', '#4b4652', V.dark * .5), '#6f6a62', 1); x += w }
    g.restore()
    // 柿の木（左奥）
    g.save(); g.translate(-200, -98)
    g.beginPath(); g.moveTo(-5, 60); g.lineTo(-3, -10); g.lineTo(4, -10); g.lineTo(6, 60); P('#5a4232')
    for (const [x, y, r] of [[-26, -30, 30], [12, -44, 34], [30, -18, 26], [-8, -10, 26]]) { g.beginPath(); g.arc(x, y, r, 0, 7); P(mix('#5e8a3a', '#2d3a26', V.dark * .6), INK, 1.6) }
    g.fillStyle = '#e8782a'; for (const [x, y] of [[-20, -30], [18, -50], [34, -16], [-2, -6], [6, -30]]) { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill() }
    g.restore()
    // 猫（塀の上）
    drawCat(-120, -98)
    // 自動販売機
    g.save(); g.translate(196, -2)
    rr(-30, -150, 60, 150, 3); P(mix('#d8dde3', '#5a5d6c', V.dark * .5))
    rr(-24, -142, 48, 58, 2); P(V.blackout ? '#3d4050' : '#f5f7fa', INK, 1.4)
    const cansC = ['#c4302b', '#2b5fae', '#e7b43b', '#3a8a5a', '#8a3a8a', '#e86a2a']
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { rr(-20 + c * 11, -136 + r * 18, 7, 13, 2); P(cansC[(r * 4 + c) % 6], null) }
    rr(-24, -76, 48, 8, 1); P('#6b7080', null); rr(-18, -40, 36, 14, 2); P('#2a2a33', INK, 1.2)
    g.fillStyle = V.blackout ? '#555' : '#7cf07c'; g.fillRect(12, -64, 6, 4)
    g.restore()
    // 水たまり（声で波紋）
    g.save(); g.translate(-70, 60)
    ell(0, 0, 54, 10); g.fillStyle = mix('#c88a72', '#5a2a30', V.redSky); g.fill(); g.strokeStyle = 'rgba(40,30,30,.5)'; g.lineWidth = 1.2; g.stroke()
    g.strokeStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 3; i++) { const k = ((V.t * (0.6 + V.level * 2) + i / 3) % 1); g.globalAlpha = (1 - k) * (0.25 + V.level); ell(6, 0, 6 + k * 44, 1.5 + k * 8); g.stroke() } g.globalAlpha = 1
    g.restore()
    // おばあちゃん（左）
    drawGrandma(-128, 2)
    // 子ども（右・リクエストの紙）
    drawKid(112, 4)
    // 歌う人
    drawSinger(0, 8, 1)
    // 手前の草
    g.strokeStyle = mix('#3f5a22', '#1d2214', V.dark * .6); g.lineWidth = 2.2
    for (let x = -260; x < 260; x += 13) { const b = Math.sin(x * 1.7) * 6, wv = Math.sin(V.t * 2 + x) * (2 + V.level * 8); g.beginPath(); g.moveTo(x, 150); g.quadraticCurveTo(x + b, 130, x + b + wv, 112 + Math.cos(x) * 8); g.stroke() }
  }
  function drawCat(x, y) {
    g.save(); g.translate(x, y)
    if (V.catState === 'gone') { g.restore(); return }
    const flat = V.level > 0.5 || V.hype > 0.5
    ell(0, -10, 14, 10); P('#e6a24a')
    g.beginPath(); g.arc(12, -22, 8, 0, 7); P('#e6a24a')
    g.beginPath(); if (flat) { g.moveTo(6, -27); g.lineTo(2, -30); g.lineTo(9, -30); g.moveTo(15, -28); g.lineTo(20, -31); g.lineTo(19, -26) } else { g.moveTo(6, -27); g.lineTo(7, -36); g.lineTo(11, -29); g.moveTo(14, -29); g.lineTo(19, -36); g.lineTo(19, -26) } P('#e6a24a')
    if (V.yawn > 0) { ell(14, -19, 2.5, 3 * V.yawn); P('#7b2a28', INK, 1) }
    g.fillStyle = INK; g.fillRect(9, -24, 2, flat ? 1 : 2.5); g.fillRect(15, -24, 2, flat ? 1 : 2.5)
    g.beginPath(); g.moveTo(-13, -8); g.quadraticCurveTo(-26, -4, -22, 10 + Math.sin(V.t * 3) * 3); P(null, '#e6a24a', 4); g.beginPath(); g.moveTo(-13, -8); g.quadraticCurveTo(-26, -4, -22, 10 + Math.sin(V.t * 3) * 3); P(null, INK, 1)
    g.restore()
  }
  function drawGrandma(x, y) {
    g.save(); g.translate(x, y)
    rr(-16, -36, 32, 6, 2); P('#7d6a55'); g.beginPath(); g.moveTo(-14, -30); g.lineTo(-18, 0); g.moveTo(14, -30); g.lineTo(18, 0); P(null, '#5b4a3a', 3)
    rr(-14, -76, 28, 44, 10); P('#7d5a8c')
    g.beginPath(); g.arc(0, -90, 13, 0, 7); P('#efc9a4')
    g.beginPath(); g.arc(0, -96, 13, Math.PI, 0); P('#c9c6cf'); g.beginPath(); g.arc(0, -108, 6, 0, 7); P('#c9c6cf')
    g.strokeStyle = INK; g.lineWidth = 1.4; g.beginPath(); g.arc(-5, -90, 3.5, 0, 7); g.arc(5, -90, 3.5, 0, 7); g.stroke()
    const e = V.earsCover, cl = V.clap
    if (e > 0.3) { g.beginPath(); g.moveTo(-12, -66); g.lineTo(-16, -84); P(null, '#7d5a8c', 7); g.beginPath(); g.moveTo(12, -66); g.lineTo(16, -84); P(null, '#7d5a8c', 7); ell(-14, -88, 4, 5); P('#efc9a4', INK, 1.2); ell(14, -88, 4, 5); P('#efc9a4', INK, 1.2) }
    else { const c = cl > 0 ? Math.abs(Math.sin(V.t * 6)) * 6 : 0; g.beginPath(); g.moveTo(-10, -60); g.lineTo(-4 + c, -50); P(null, '#7d5a8c', 7); g.beginPath(); g.moveTo(10, -60); g.lineTo(4 - c, -50); P(null, '#7d5a8c', 7) }
    g.beginPath(); if (e > 0.3) { g.moveTo(-4, -82); g.lineTo(4, -82) } else { g.arc(0, -84, 3, 0.2, Math.PI - 0.2) } P(null, INK, 1.4)
    g.restore()
  }
  function drawKid(x, y) {
    g.save(); g.translate(x, y)
    g.beginPath(); g.moveTo(-6, -30); g.lineTo(-7, 0); g.moveTo(6, -30); g.lineTo(7, 0); P(null, '#2c3a5a', 6)
    rr(-12, -62, 24, 34, 6); P('#3a8a6a')
    g.beginPath(); g.arc(0, -74, 12, 0, 7); P('#f0c49c')
    g.beginPath(); g.arc(0, -78, 12, Math.PI, 0); P('#d2453a'); rr(0, -80, 18, 4, 2); P('#d2453a')
    g.fillStyle = INK; g.fillRect(-5, -75, 2, 2.5); g.fillRect(3, -75, 2, 2.5)
    const up = V.shrug > 0 ? 1 : 0
    // リクエストの紙を両手で上げる
    g.beginPath(); g.moveTo(-10, -56); g.lineTo(-18, -84 - up * 4); g.moveTo(10, -56); g.lineTo(18, -84 - up * 4); P(null, '#3a8a6a', 6)
    g.save(); g.translate(0, -100 - up * 4); g.rotate(-0.06)
    rr(-24, -14, 48, 28, 1); P('#fbf8f0', INK, 1.4)
    g.strokeStyle = '#c4302b'; g.lineWidth = 2; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(-17, -5 + i * 10); g.lineTo(15 - i * 8, -5 + i * 10); g.stroke() }
    g.restore()
    g.restore()
  }
  // 歌う人: 金のスパンコールのジャケット・リーゼント・サングラス。ビールケースの上
  function drawSinger(x, y, sc) {
    const m = V.mouthOverride != null ? V.mouthOverride : clamp(V.level * 1.25, 0, 1)
    const lean = Math.sin(V.t * 2.2) * 2 + m * 4, hype = Math.max(V.hype, m)
    g.save(); g.translate(x, y); g.scale(sc, sc)
    // ビールケース（黄色・中身なし）
    rr(-30, -36, 60, 36, 3); P('#e8b83a')
    g.fillStyle = '#b8862a'; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { rr(-24 + c * 13, -30 + r * 14, 9, 9, 2); g.fill() }
    // アンプ（メーターの針が声量）
    g.save(); g.translate(-58, 0)
    rr(-20, -46, 40, 46, 3); P('#26232c')
    g.fillStyle = '#3c3843'; for (let i = 0; i < 4; i++) g.fillRect(-15, -22 + i * 5, 30, 2.5)
    rr(-14, -42, 28, 14, 2); P('#f3e9c9', INK, 1.2)
    const na = -1.0 + m * 2.0
    g.strokeStyle = '#c4302b'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -29); g.lineTo(Math.sin(na) * 11, -29 - Math.cos(na) * 11); g.stroke()
    g.restore()
    // マイクのコード
    g.beginPath(); g.moveTo(-40, -20); g.bezierCurveTo(-30, 10, 30, 0, 26, -60); g.bezierCurveTo(28, -80, 34, -100, 24, -114); P(null, '#151318', 1.8)
    g.translate(0, -36); g.rotate(lean * 0.012)
    // 脚（ベルボトム）
    g.beginPath(); g.moveTo(-14, -56); g.lineTo(-17, -6); g.lineTo(-26, 0); g.lineTo(-6, 0); g.lineTo(-4, -40); g.lineTo(4, -40); g.lineTo(6, 0); g.lineTo(26, 0); g.lineTo(17, -6); g.lineTo(14, -56); g.closePath(); P('#1f1d26')
    // 胴（ジャケット）
    g.beginPath(); g.moveTo(-22, -116); g.quadraticCurveTo(-26, -80, -18, -54); g.lineTo(18, -54); g.quadraticCurveTo(26, -80, 22, -116); g.quadraticCurveTo(0, -122, -22, -116); P('#e7b43b')
    g.fillStyle = 'rgba(255,250,210,.9)'
    for (let i = 0; i < 26; i++) { const sx = -18 + ((i * 37) % 36), sy = -112 + ((i * 53) % 56), tw = (Math.sin(V.t * 8 + i) + 1) / 2; g.globalAlpha = 0.35 + tw * 0.65; g.fillRect(sx, sy, 2, 2) } g.globalAlpha = 1
    g.beginPath(); g.moveTo(-8, -116); g.lineTo(0, -94); g.lineTo(8, -116); P('#fbf8f0', INK, 1.4)
    g.beginPath(); g.moveTo(-6, -112); g.lineTo(0, -108); g.lineTo(-6, -104); g.closePath(); g.moveTo(6, -112); g.lineTo(0, -108); g.lineTo(6, -104); g.closePath(); P('#c4302b', INK, 1)
    // 上げる腕（左）: 盛り上がるほど高く
    const up = clamp(hype, 0, 1), ang = -0.3 - up * 2.1 + Math.sin(V.t * 7) * up * 0.15
    const ex = -22 + Math.cos(Math.PI + ang * -1) * 0, sx0 = -20, sy0 = -110
    const elx = sx0 - 16 + up * 2, ely = sy0 + 22 - up * 40
    const hx = elx - 6 + up * 4, hy = ely + 22 - up * 46
    void ex; void ang
    g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(elx, ely); g.lineTo(hx, hy); P(null, '#e7b43b', 9); g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(elx, ely); g.lineTo(hx, hy); P(null, INK, 1.2)
    g.beginPath(); g.arc(hx, hy, 4.5, 0, 7); P('#efc29a', INK, 1.2)
    // 頭
    const hy0 = -138
    g.beginPath(); g.arc(0, hy0, 18, 0, 7); P('#efc29a')
    // リーゼント
    g.beginPath(); g.moveTo(-17, hy0 - 2); g.quadraticCurveTo(-22, hy0 - 26, 2, hy0 - 28); g.quadraticCurveTo(30, hy0 - 34, 34, hy0 - 20); g.quadraticCurveTo(22, hy0 - 22, 16, hy0 - 12); g.quadraticCurveTo(4, hy0 - 16, -6, hy0 - 10); g.quadraticCurveTo(-12, hy0 - 4, -17, hy0 - 2); P('#18161d')
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-8, hy0 - 22); g.quadraticCurveTo(10, hy0 - 30, 26, hy0 - 26); g.stroke()
    // サングラス
    rr(-14, hy0 - 6, 12, 8, 3); P('#1b1a22', INK, 1.2); rr(2, hy0 - 6, 12, 8, 3); P('#1b1a22', INK, 1.2)
    g.strokeStyle = INK; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-2, hy0 - 3); g.lineTo(2, hy0 - 3); g.stroke()
    g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(-11, hy0 - 5, 3, 1.5); g.fillRect(5, hy0 - 5, 3, 1.5)
    // 眉（盛り上がると上がる）
    g.beginPath(); g.moveTo(-14, hy0 - 10 - up * 3); g.lineTo(-3, hy0 - 8 - up * 1); g.moveTo(14, hy0 - 10 - up * 3); g.lineTo(3, hy0 - 8 - up * 1); P(null, INK, 2.2)
    // 口
    ell(0, hy0 + 9 + m * 2, 4 + m * 5, 1.6 + m * 9); P('#6e1f24', INK, 1.4)
    if (m > 0.2) { g.save(); ell(0, hy0 + 9 + m * 2, 4 + m * 5, 1.6 + m * 9); g.clip(); g.fillStyle = '#fff'; g.fillRect(-10, hy0 + 7 + m * 2 - m * 9, 20, 3); g.fillStyle = '#d0595c'; ell(0, hy0 + 12 + m * 10, 5, 3); g.fill(); g.restore() }
    // マイクを持つ腕（右）
    g.beginPath(); g.moveTo(20, -110); g.lineTo(32, -92); g.lineTo(22, -112); P(null, '#e7b43b', 9); g.beginPath(); g.moveTo(20, -110); g.lineTo(32, -92); g.lineTo(22, -112); P(null, INK, 1.2)
    g.beginPath(); g.moveTo(21, -113); g.lineTo(15, -124); P(null, '#2a2730', 5)
    g.beginPath(); g.arc(12, -129, 6, 0, 7); P('#d9dce2', INK, 1.4); g.strokeStyle = '#8a8f98'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(8, -131); g.lineTo(16, -127); g.moveTo(9, -126); g.lineTo(15, -132); g.stroke()
    g.beginPath(); g.arc(22, -113, 4.5, 0, 7); P('#efc29a', INK, 1.2)
    g.restore()
  }
  // 声の輪・葉っぱ・破片
  function drawFx() {
    layer(0)
    const mx = 6, my = -168
    for (const r of V.rings) { g.globalAlpha = clamp(r.a, 0, 1); g.strokeStyle = r.c || '#fff8e6'; g.lineWidth = r.w; g.beginPath(); g.arc(mx, my, r.r, 0, 7); g.stroke() }
    g.globalAlpha = 1
    for (const l of V.leaves) { g.save(); g.translate(l.x, l.y); g.rotate(l.rot); ell(0, 0, 5, 2.4); P(l.c, null); g.restore() }
    for (const p of V.parts) {
      g.globalAlpha = clamp(p.life, 0, 1)
      if (p.k === 'shard') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.moveTo(-4, -3); g.lineTo(5, -1); g.lineTo(-1, 5); g.closePath(); P('rgba(220,235,255,.9)', '#56607a', 0.8); g.restore() }
      else if (p.k === 'spark') { g.fillStyle = '#ffe9a0'; g.beginPath(); g.arc(p.x, p.y, 2, 0, 7); g.fill() }
      else if (p.k === 'feather') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); ell(0, 0, 6, 1.8); P('#1d1a22', null); g.restore() }
      else if (p.k === 'dust') { g.fillStyle = 'rgba(200,190,170,.5)'; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill() }
      else if (p.k === 'can') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); rr(-3.5, -6, 7, 12, 2); P(p.c, INK, 0.8); g.restore() }
      else if (p.k === 'howl') { g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(p.x, p.y, 6 + i * 6 + Math.max(0, 2 - p.life) * 8, -2.4, -0.7); g.stroke() } }
      else if (p.k === 'dog') { drawDog(p.x, p.y, p.life) }
    }
    g.globalAlpha = 1
    // 苦情の吹き出し
    if (V.bubble) {
      const b = V.bubble
      g.save(); g.translate(b.x, b.y)
      g.font = `900 ${b.size}px ${getComputedStyle(document.body).fontFamily}`
      const w = g.measureText(b.text).width + 16
      rr(-w / 2, -b.size - 8, w, b.size + 14, 6); P('#fff', INK, 2)
      g.beginPath(); g.moveTo(-4, 6); g.lineTo(6, 6); g.lineTo(-10, 18); g.closePath(); P('#fff', null); g.fillStyle = INK; g.textAlign = 'center'; g.fillText(b.text, 0, 0)
      g.restore()
    }
  }
  function drawDog(x, y, life) {
    // 座って空を向いて遠吠えする犬（横向き）
    g.save(); g.translate(x, y); g.scale(1.4, 1.4); g.globalAlpha = clamp(life * 2, 0, 1)
    const C = '#c9a27a', D2 = '#8a6a4a'
    g.beginPath(); g.moveTo(-12, 0); g.quadraticCurveTo(-16, -6, -20, -4); P(null, C, 3.5)
    ell(-4, -6, 11, 7, -0.5); P(C, INK, 1.3)
    g.beginPath(); g.moveTo(2, -1); g.lineTo(3, 0); g.moveTo(-9, -1); g.lineTo(-10, 0); P(null, INK, 3)
    g.beginPath(); g.moveTo(1, -10); g.lineTo(5, -20); g.lineTo(11, -18); g.lineTo(9, -8); g.closePath(); P(C, INK, 1.3)
    g.save(); g.translate(8, -22); g.rotate(-0.9)
    ell(0, 0, 6.5, 5.5); P(C, INK, 1.3)
    rr(4, -3, 8, 5, 2); P(C, INK, 1.2)
    g.beginPath(); g.arc(12, -1, 1.4, 0, 7); g.fillStyle = INK; g.fill()
    g.beginPath(); g.moveTo(-3, -4); g.quadraticCurveTo(-8, -2, -6, 4); P(D2, INK, 1)
    g.fillStyle = INK; g.fillRect(1, -3, 1.5, 1.5)
    g.restore(); g.restore()
  }
  // 宇宙（月と地球）
  // 割れ目のギザギザ（中心から外へ）。dir=1 で外向き、-1 で内向きに辿る
  function jag(a, dir) { const R = Math.min(W, H) * 0.3, pts = []; for (let i = 1; i <= 5; i++) { const r = R * i / 5, off = i === 5 ? 0 : ((Math.sin(a * 13 + i * 7) > 0 ? 1 : -1) * 0.09); pts.push([Math.cos(a + off) * r, Math.sin(a + off) * r]) } if (dir < 0) pts.reverse().push([0, 0]); for (const [x, y] of pts) g.lineTo(x, y) }
  const FRAGS = (() => { const n = 7, out = []; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; out.push({ a0, a1, dir: (a0 + a1) / 2, rot: (i % 2 ? 1 : -1) * (0.2 + i * 0.05), jag: [0.3, 0.55, 0.8].map(k => 0.85 + ((i * 7 + k * 10) % 3) * 0.06) }) } return out })()
  function drawSpace() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0)
    const gr = g.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.42, Math.max(W, H)); gr.addColorStop(0, '#1d2244'); gr.addColorStop(1, '#07070f')
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
    g.fillStyle = '#fff'; for (let i = 0; i < 90; i++) { const x = (i * 97.3) % W, y = (i * 211.7) % H, tw = (Math.sin(V.t * 2 + i) + 1) / 2; g.globalAlpha = 0.3 + tw * 0.6; g.fillRect(x, y, i % 7 ? 1 : 2, i % 7 ? 1 : 2) } g.globalAlpha = 1
    const sx = (Math.random() - 0.5) * V.shake * 16, sy = (Math.random() - 0.5) * V.shake * 16
    const cx = W / 2 + sx, cy = H * 0.42 + sy, R = Math.min(W, H) * 0.3
    // 月（ヒビ入り）
    const mx = cx + R * 1.25, my = cy - R * 1.05, mr = R * 0.26
    g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fillStyle = '#e9e2cc'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke()
    g.beginPath(); g.moveTo(mx - mr, my); g.lineTo(mx - mr * .3, my + mr * .1); g.lineTo(mx, my - mr * .3); g.lineTo(mx + mr * .4, my + mr * .05); g.lineTo(mx + mr, my + mr * .2); g.stroke()
    const boom = V.earthBoom, back = V.encore
    const sep = boom * (1 - back) * R * 1.4
    g.save(); g.translate(cx, cy)
    const earth = (clipFn) => {
      g.save(); if (clipFn) clipFn()
      g.beginPath(); g.arc(0, 0, R, 0, 7); g.fillStyle = '#2f6fb6'; g.fill(); g.clip()
      g.fillStyle = '#5aa35a'
      for (const blob of [[[-.6, -.5], [-.35, -.72], [-.2, -.7], [.1, -.5], [.05, -.32], [-.1, -.2], [-.3, -.28], [-.5, -.15]], [[.25, -.1], [.45, -.32], [.6, -.3], [.78, -.05], [.75, .15], [.6, .3], [.5, .48], [.35, .4], [.2, .3]], [[-.7, .2], [-.5, .1], [-.35, .15], [-.28, .35], [-.3, .55], [-.48, .66], [-.6, .6]]]) { g.beginPath(); const n = blob.length; for (let i = 0; i <= n; i++) { const p0 = blob[i % n], p1 = blob[(i + 1) % n], mxp = (p0[0] + p1[0]) / 2 * R, myp = (p0[1] + p1[1]) / 2 * R; if (!i) g.moveTo(mxp, myp); else g.quadraticCurveTo(p0[0] * R, p0[1] * R, mxp, myp) } g.closePath(); g.fill() }
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 5; for (const [a, b, l] of [[-.4, -.82, .5], [.1, .62, .6], [.45, -.6, .3]]) { g.beginPath(); g.moveTo((a - l / 2) * R, b * R); g.quadraticCurveTo(a * R, (b - .05) * R, (a + l / 2) * R, b * R); g.stroke() }
      g.fillStyle = 'rgba(0,0,30,.18)'; g.beginPath(); g.arc(R * .35, R * .3, R, 0, 7); g.fill()
      g.restore()
    }
    if (boom <= 0.001 || back >= 0.999) {
      earth()
      g.beginPath(); g.arc(0, 0, R, 0, 7); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke()
      if (V.earthCrack > 0) {
        const k = V.earthCrack
        g.strokeStyle = '#ffb347'; g.lineWidth = 3 + k * 3; g.shadowColor = '#ff7a1a'; g.shadowBlur = 18 * k
        g.beginPath(); const pts = [[-1, -.2], [-.6, -.05], [-.35, -.3], [-.05, 0], [.2, -.2], [.5, .1], [.75, -.05], [1, .15]]
        pts.forEach(([a, b], i) => { if (i / (pts.length - 1) <= k + 0.01) { i ? g.lineTo(a * R, b * R) : g.moveTo(a * R, b * R) } }); g.stroke(); g.shadowBlur = 0
      }
    } else {
      for (const f of FRAGS) {
        const d = sep * (0.7 + (f.rot > 0 ? 0.3 : 0)), ox = Math.cos(f.dir) * d, oy = Math.sin(f.dir) * d
        g.save(); g.translate(ox, oy); g.rotate(f.rot * boom * (1 - back) * 1.5)
        const edge = () => { g.beginPath(); g.moveTo(0, 0); jag(f.a0, 1); g.arc(0, 0, R, f.a0, f.a1); jag(f.a1, -1); g.closePath() }
        earth(() => { edge(); g.clip() })
        edge(); g.strokeStyle = '#ffb347'; g.lineWidth = 2.5; g.stroke()
        g.restore()
      }
      // 破片の粒
      g.fillStyle = '#9a8a7a'; for (let i = 0; i < 40; i++) { const a = i * 2.4, d = sep * (0.5 + (i % 5) * 0.25); g.fillRect(Math.cos(a) * d, Math.sin(a) * d, 3, 3) }
    }
    g.restore()
    // 歌う人（宇宙に浮かぶ・まだ歌っている）
    if (V.space >= 1) {
      g.save()
      const s = boom > 0 && back < 1 ? 0.8 * U : 0.22 * U
      const px = boom > 0 && back < 1 ? cx : cx, py = boom > 0 && back < 1 ? cy + 90 * U : cy - R + 2
      g.setTransform(DPR * s, 0, 0, DPR * s, DPR * px, DPR * py)
      g.rotate(boom > 0 && back < 1 ? Math.sin(V.t * 0.8) * 0.25 : 0)
      drawSinger(0, 0, 1)
      g.restore()
      g.setTransform(DPR, 0, 0, DPR, 0, 0)
      // 宇宙でも声の輪
      g.strokeStyle = 'rgba(255,248,230,.7)'; g.lineWidth = 2
      for (const r of V.rings) { g.globalAlpha = clamp(r.a, 0, 1) * 0.8; g.beginPath(); g.arc(px + 4 * s, py - 168 * s, r.r * s * 1.4, 0, 7); g.stroke() } g.globalAlpha = 1
    }
    drawUfo()
  }
  function drawUfo() {
    if (!V.ufo) return
    g.setTransform(DPR, 0, 0, DPR, 0, 0)
    const u = V.ufo, x = W * u.x, y = H * u.y, s = U
    if (u.beam > 0) { g.fillStyle = `rgba(190,255,200,${0.28 * u.beam})`; g.beginPath(); g.moveTo(x - 16 * s, y + 8 * s); g.lineTo(x + 16 * s, y + 8 * s); g.lineTo(x + 60 * s, y + 210 * s); g.lineTo(x - 60 * s, y + 210 * s); g.closePath(); g.fill() }
    g.save(); g.translate(x, y); g.scale(s, s)
    ell(0, 0, 46, 12); P('#b9c0cc'); ell(0, -8, 20, 14); P('rgba(170,230,255,.85)')
    // 宇宙人（契約書を持つ）
    g.beginPath(); g.arc(0, -10, 6, 0, 7); P('#8fd18a', INK, 1.2); g.fillStyle = INK; g.fillRect(-3.5, -12, 2, 3); g.fillRect(1.5, -12, 2, 3)
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(i * 16, 4, 3, 0, 7); g.fillStyle = (Math.floor(V.t * 6) + i) % 2 ? '#ffe36a' : '#ff6a6a'; g.fill() }
    if (u.paper) { g.save(); g.translate(30, 22 + Math.sin(V.t * 3) * 3); g.rotate(0.2); rr(-12, -8, 24, 16, 1); P('#fbf8f0', INK, 1.2); g.strokeStyle = '#c4302b'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-7, -2); g.lineTo(7, -2); g.moveTo(-7, 3); g.lineTo(3, 3); g.stroke(); g.restore() }
    g.restore()
  }
  function render() {
    if (V.space < 1) {
      drawSky(); drawTowers(); drawViaduct()
      layer(0.3); for (const h of HOUSES) drawHouse(h)
      drawPolesAndWires(); drawLot(); drawFx()
      if (V.ufo && V.space < 1) drawUfo()
      if (V.dark > 0) { g.setTransform(DPR, 0, 0, DPR, 0, 0); g.fillStyle = `rgba(20,10,40,${V.dark * 0.35})`; g.fillRect(0, 0, W, H) }
    }
    if (V.space > 0) { if (V.space < 1) { g.save(); g.globalAlpha = V.space; drawSpace(); g.restore() } else drawSpace() }
    if (V.flash > 0) { g.setTransform(DPR, 0, 0, DPR, 0, 0); g.fillStyle = `rgba(255,255,255,${V.flash})`; g.fillRect(0, 0, W, H) }
  }

  // ---------------- 動き（固定60Hz） ----------------
  const DT = 1 / 60
  function stepWorld() {
    V.t += DT
    // 声に反応
    const lv = V.level
    if (V.mode === 'sing' || V.mode === 'title' || V.sing > 0) {
      if (Math.random() < lv * 0.5 && lv > 0.18) V.rings.push({ r: 14, a: 0.9, w: 2 + lv * 5, v: 120 + lv * 260 })
      if (lv > 0.4 && Math.random() < lv * 0.35) V.leaves.push({ x: -200 + rnd(-30, 30), y: -150 + rnd(-30, 30), vx: rnd(40, 140) * (Math.random() < .5 ? 1 : -1) * (0.5 + lv), vy: rnd(-60, 10), rot: rnd(0, 6), vr: rnd(-6, 6), c: pick(['#5e8a3a', '#e8782a', '#a3b04a']) })
      for (const c of V.crows) if (!c.fall) c.hop = lv > 0.5 ? c.hop + DT * 14 * lv : c.hop * 0.9
      V.earsCover += ((lv > 0.62 ? 1 : 0) - V.earsCover) * 0.08
      V.angry = V.mode === 'sing' ? (lv > 0.8 ? Math.min(1, V.angry + 0.05) : Math.max(0, V.angry - 0.01)) : V.angry
    }
    for (const r of V.rings) { r.r += r.v * DT; r.a -= DT * 1.1 }
    V.rings = V.rings.filter(r => r.a > 0)
    for (const l of V.leaves) { l.x += l.vx * DT; l.y += l.vy * DT; l.vy += 40 * DT; l.rot += l.vr * DT }
    V.leaves = V.leaves.filter(l => l.y < 200 && Math.abs(l.x) < 700).slice(-60)
    for (const p of V.parts) { p.x += (p.vx || 0) * DT; p.y += (p.vy || 0) * DT; if (p.g) p.vy += p.g * DT; p.rot = (p.rot || 0) + (p.vr || 0) * DT; p.life -= DT * (p.decay || 0.7) }
    V.parts = V.parts.filter(p => p.life > 0).slice(-260)
    for (const c of V.crows) if (c.fall) { c.vy += 900 * DT; c.y += c.vy * DT; c.rot += 6 * DT; if (c.y > 330) { c.y = 330; c.vy = 0 } }
    V.shake *= 0.9; if (V.shake < 0.01) V.shake = 0
    V.flash = Math.max(0, V.flash - DT * 1.6)
    // 通りすぎる新幹線（ふだん）
    const tr = V.train
    if (!tr.stop) { tr.x += (tr.v || 420) * DT; if (tr.x > 1500) tr.x = -1500 - rnd(0, 1500) }
    else { tr.v *= 0.93; tr.x += tr.v * DT; tr.spark = Math.max(0, tr.spark - DT * 0.8) }
    if (V.ufo) { const u = V.ufo; u.x += (u.tx - u.x) * 0.05; u.y += (u.ty - u.y) * 0.05 }
    if (V.yawn > 0 && V.mode !== 'show') V.yawn = Math.max(0, V.yawn - DT * 0.5)
    for (let i = later.length - 1; i >= 0; i--) if (later[i].t <= V.t) { const f = later[i].fn; later.splice(i, 1); try { f() } catch (e) { console.warn(e) } }
    for (let i = tweens.length - 1; i >= 0; i--) { const w = tweens[i], k = Math.min(1, (V.t - w.t0) / w.d); try { w.fn(k) } catch (e) {} if (k >= 1) tweens.splice(i, 1) }
    // 台本
    if (show_ && show_.next) show_.tick(DT)
    if (singer_) singer_(DT)
  }
  let paused = false, acc = 0, last = performance.now()
  function frame(now) {
    const d = Math.min(0.25, (now - last) / 1000); last = now
    if (!paused) { acc += d; let n = 0; while (acc >= DT && n++ < 8) { stepWorld(); acc -= DT } if (n >= 8) acc = 0 }
    requestAnimationFrame(frame)
    try { render() } catch (e) { if (!frame.err) { frame.err = 1; console.error(e) } }
  }
  requestAnimationFrame(frame)

  // ---------------- タイトル ----------------
  function applyLang() {
    document.documentElement.lang = lang
    $('loadTxt').textContent = T('loading')
    $('tT1').textContent = T('title1'); $('tT2').textContent = T('title2'); $('tLead').textContent = T('lead')
    $('tMic').textContent = T('mic'); $('tPriv').textContent = T('privacy'); $('bFinger').textContent = T('finger')
    $('bHow').textContent = T('how'); $('bHow2').textContent = T('how'); $('bLang').textContent = T('lang'); $('aPriv').textContent = T('privacyLink')
    $('recTxt').textContent = T('rec'); $('reqLbl').textContent = T('req'); $('fingerTip').textContent = T('fingerSing'); $('bHeart').textContent = T('fingerBtn')
    $('skipHint').textContent = T('skip')
    $('tutT').textContent = T('tutT'); $('tutSub').textContent = isTouch ? T('tutPhone') : T('tutPc'); $('tut1').textContent = T('tut1'); $('tut2').textContent = T('tut2'); $('tut3').textContent = T('tut3'); $('tutEnd').textContent = T('tutEnd'); $('bTutOk').textContent = T('tutOk')
    $('howT').textContent = T('howT'); $('howList').innerHTML = T('howBody').map(s => `<li>${s}</li>`).join(''); $('howReq').textContent = T('howReq'); $('howLadder').textContent = T('ladder'); $('howFinger').textContent = T('howFinger'); $('howCred').textContent = T('credits'); $('bHowClose').textContent = T('howClose')
    $('bDenFinger').textContent = T('finger'); $('bDenRetry').textContent = T('retry'); $('bDenBack').textContent = T('back')
    $('btnAgain').textContent = T('again'); $('bSave').textContent = T('save'); $('bPost').textContent = T('post')
    if (lastR) fillResult(lastR)
  }
  function goTitle() {
    stopReplay(); show('vTitle'); V.mode = 'title'; resetWorld(); V.hype = 0
    if (Snd.ctx) bedOn(true)
    singer_ = idleSinger
  }
  // タイトル中は口ずさむ（ときどき声の輪）
  function idleSinger() { const k = Math.max(0, Math.sin(V.t * 1.3)) ; V.level = 0.08 + k * 0.12 + Math.max(0, Math.sin(V.t * 9)) * 0.05 }
  let singer_ = idleSinger

  function unlockAudio() { const first = !Snd.ctx; Snd.init(); if (first && Snd.ctx) bedOn(V.mode === 'title') }

  // ---------------- 歌う ----------------
  let request = 'high', mode = 'mic', recBuf = null, lastR = null
  let stream = null, recNodes = null, recording = false, pcm = [], pcmN = 0, mr = null, mrChunks = [], recSR = 48000
  async function onMic() {
    unlockAudio()
    if (!LS.get('ar_tut')) { modal('pTut', true); pendingStart = 'mic'; return }
    await startMic()
  }
  let pendingStart = null
  async function startMic() {
    mode = 'mic'
    const md = navigator.mediaDevices
    if (!md || !md.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) { denied(T('unsupported')); return }
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record' } catch (e) {}
    try {
      stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
    } catch (e) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'auto' } catch (e2) {}
      denied(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? T('deniedB') : T('unsupported') + (e && e.name ? ' (' + e.name + ')' : ''))
      return
    }
    window.__micOk = true
    if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume()
    setupCapture()
    beginRound()
  }
  function denied(body, title) {
    window.__micDenied = (window.__micDenied || 0) + 1
    $('denT').textContent = title || T('deniedT'); $('denB').textContent = body; modal('pDenied', true)
  }
  function setupCapture() {
    pcm = []; pcmN = 0; mrChunks = []; recBuf = null
    const c = Snd.ctx
    if (c) {
      try {
        recSR = c.sampleRate
        const src = c.createMediaStreamSource(stream)
        const proc = (c.createScriptProcessor || c.createJavaScriptNode).call(c, 2048, 1, 1)
        const zero = c.createGain(); zero.gain.value = 0
        proc.onaudioprocess = e => {
          const d = e.inputBuffer.getChannelData(0)
          let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * d[i]
          const db = 10 * Math.log10(s / (d.length / 4) + 1e-12)
          V.lvRaw = clamp((db + 52) / 40, 0, 1)
          if (recording) { pcm.push(new Float32Array(d)); pcmN += d.length }
        }
        src.connect(proc); proc.connect(zero); zero.connect(c.destination)
        recNodes = { src, proc, zero }
      } catch (e) { recNodes = null }
    }
    // 予備: MediaRecorder（AudioContext が止まっている時はこちらで分析する）
    try { if (window.MediaRecorder) { mr = new MediaRecorder(stream); mr.ondataavailable = e => { if (e.data && e.data.size) mrChunks.push(e.data) } } } catch (e) { mr = null }
  }
  function stopCapture() {
    try { if (recNodes) { recNodes.proc.onaudioprocess = null; recNodes.src.disconnect(); recNodes.proc.disconnect(); recNodes.zero.disconnect() } } catch (e) {}
    recNodes = null
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch (e) {}
  }
  function onFinger() { unlockAudio(); modal('pDenied', false); if (!LS.get('ar_tut')) { modal('pTut', true); pendingStart = 'finger'; return } mode = 'finger'; beginRound() }

  // 3-2-1 → 5秒
  let roundTimer = null
  function beginRound() {
    stopReplay(); resetWorld(); V.mode = 'count'; singer_ = null; V.level = 0
    request = pick(AN.REQUESTS)
    $('reqTxt').textContent = D.requests[request][lang]
    show('vSing'); $('recBar').classList.remove('on'); $('recBar').hidden = true
    $('count').hidden = false; $('singCue').hidden = true
    const fingerMode = mode === 'finger'
    $('bHeart').hidden = !fingerMode; $('fingerTip').hidden = !fingerMode
    bedOff()
    if (window.TM) TM.start()
    let n = 3
    const tick = () => {
      if (n > 0) { $('count').textContent = n; Snd.play('tick', { vol: 0.7, jitter: 0 }); n--; roundTimer = setTimeout(tick, 800); return }
      $('count').hidden = true; startRecording()
    }
    tick()
  }
  let recT0 = 0, fingerSamples = [], finger = { down: false, x: 0, y: 0, p: 0, lx: 0, ly: 0, speed: 0 }
  function startRecording() {
    V.mode = 'sing'; $('singCue').textContent = T('sing'); $('singCue').hidden = false
    $('recBar').hidden = false; $('recBar').classList.add('on')
    recT0 = performance.now(); fingerSamples = []
    if (mode === 'mic') { pcm = []; pcmN = 0; mrChunks = []; recording = true; try { if (mr && mr.state === 'inactive') mr.start() } catch (e) {} }
    let el = 0
    singer_ = dt => {
      el += dt
      if (mode === 'finger') {
        const sp = finger.down ? finger.speed : 0
        fingerSamples.push({ t: el, x: finger.x, y: finger.y, down: finger.down, p: finger.p })
        V.lvRaw = finger.down ? clamp(0.3 + sp / 1600, 0, 1) : 0
        finger.speed *= 0.85
      }
      const target = V.lvRaw
      V.level += (target - V.level) * (target > V.level ? 0.5 : 0.15)
      if (el > 0.7) $('singCue').hidden = true
      const left = Math.max(0, 5 - el)
      const pips = $('recBar').querySelectorAll('.pips i'); pips.forEach((p, i) => p.classList.toggle('off', i >= Math.ceil(left)))
      if (el >= 5) { singer_ = null; endRecording() }
    }
  }
  async function endRecording() {
    $('recBar').classList.remove('on'); $('bHeart').hidden = true; $('fingerTip').hidden = true
    V.mode = 'judge'; V.level = 0
    let R
    if (mode === 'finger') {
      const f = AN.fromFinger(fingerSamples, 5)
      R = makeResult(f, true)
    } else {
      recording = false
      const sr = recSR
      let x = null
      if (pcmN >= sr * 1.5) { x = new Float32Array(Math.min(pcmN, sr * 5)); let o = 0; for (const c of pcm) { if (o >= x.length) break; const n = Math.min(c.length, x.length - o); x.set(c.subarray(0, n), o); o += n } }
      const blob = await stopMr()
      let srx = sr
      // 取れた音がほぼ無音（端末によっては処理は動くのに中身がゼロで届く）なら、予備の録音を使う
      if (x) { let pk = 0; for (let i = 0; i < x.length; i += 8) { const v = Math.abs(x[i]); if (v > pk) pk = v } if (pk < 0.003 && blob) { window.__pcmSilent = pk; x = null } }
      if (!x && blob) { try { const buf = await decode(await blob.arrayBuffer()); srx = buf.sampleRate; x = buf.getChannelData(0).slice(0, Math.round(srx * 5)); recBuf = buf } catch (e) { x = null } }
      stopCapture()
      if (!x) { window.__recFail = (window.__recFail || 0) + 1; goTitle(); denied(T('recFailB'), T('recFailT')); return }
      if (!recBuf && Snd.ctx) { try { recBuf = Snd.ctx.createBuffer(1, x.length, srx); recBuf.getChannelData(0).set(x) } catch (e) { recBuf = null } }
      window.__lastPath = pcmN >= sr * 1.5 ? 'pcm' : 'recorder'
      const f = AN.analyze(x, srx)
      R = makeResult(f, false)
    }
    pcm = []
    runShow(R)
  }
  function stopMr() {
    return new Promise(res => {
      if (!mr || mr.state === 'inactive') return res(mrChunks.length ? new Blob(mrChunks, { type: mrChunks[0].type }) : null)
      const to = setTimeout(() => res(mrChunks.length ? new Blob(mrChunks, { type: mrChunks[0].type }) : null), 2500)
      mr.onstop = () => { clearTimeout(to); res(mrChunks.length ? new Blob(mrChunks, { type: mrChunks[0].type || mr.mimeType }) : null) }
      try { mr.stop() } catch (e) { clearTimeout(to); res(null) }
    })
  }
  function decode(ab) {
    const c = Snd.ctx || new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100)
    return new Promise((ok, ng) => { const p = c.decodeAudioData(ab, ok, ng); if (p && p.catch) p.catch(ng) })
  }
  function makeResult(f, isFinger) {
    const j = AN.judge(f, request)
    const R = { ...j, f, finger: isFinger, request }
    R.ufo = j.kind === 'tier' && j.tier >= 8 && (f.rangeSemis >= 14 || Math.random() < 0.15)
    R.encore = j.kind === 'tier' && j.tier >= 10 && Math.random() < 0.3
    const src = j.kind === 'good' ? D.good : j.kind === 'none' ? (j.whisper ? { subJa: D.whisper.subJa, subEn: D.whisper.subEn } : D.none) : D.tiers[j.tier]
    R.subI = Math.floor(Math.random() * src.subJa.length); R.subSrc = j.kind === 'tier' ? 't' + j.tier : j.kind
    window.__lastResult = { kind: R.kind, tier: R.tier, D: R.D, gauges: R.gauges, reqOk: R.reqOk, request, finger: isFinger, medianHz: Math.round(f.medianHz || 0) }
    return R
  }

  // ---------------- 破壊の台本 ----------------
  let show_ = null
  function telop(s) { const el = $('telop'); el.classList.remove('in'); void el.offsetWidth; $('telopTxt').textContent = s; el.classList.add('in') }
  function runShow(R) {
    show('vShow'); $('telop').classList.remove('in'); V.mode = 'show'; singer_ = null
    if (Snd.ctx) { Snd.loop('amb', AMB, 0.18) }
    const steps = []
    const at = (t, fn) => steps.push({ t, fn })
    let t = 0.8
    // 自分の歌を流しながら壊れていく
    at(0.05, () => { V.sing = 1; playRec(0.85) })
    const base = clamp((R.gauges.vol || 0) / 100, 0, 1)
    const lvSing = () => { V.level = clamp(base * (0.6 + Math.sin(V.t * 11) * 0.25 + Math.sin(V.t * 23) * 0.15), 0, 1) }
    singer_ = () => { if (V.sing) lvSing(); else V.level *= 0.9 }
    if (R.kind === 'none') {
      singer_ = () => { V.level = 0 }
      at(0.6, () => { V.leaves.push({ x: -260, y: -60, vx: 120, vy: -10, rot: 0, vr: 3, c: '#a3b04a' }); V.shrug = 1; telop(D.none[lang === 'ja' ? 'ja' : 'en']) })
      at(1.4, () => { V.yawn = 1 })
      t = 2.8
    } else if (R.kind === 'good') {
      at(1.0, () => { V.sing = 0; V.clap = 1; Snd.play('clap', { vol: 0.35 }); telop(D.good[lang]) })
      at(1.6, () => { V.yawn = 1; Snd.play('cat', { vol: 0.5 }) })
      at(2.4, () => { V.clap = 0; V.shrug = 1 })
      t = 3.6
    } else {
      const tier = R.tier
      const dur = k => k <= 4 ? 0.8 : k <= 7 ? 1.05 : 1.45
      if (tier === 0) { at(t, () => { telop(D.tiers[0][lang]); V.yawn = 1; Snd.play('cat', { vol: 0.6 }) }); at(t + 0.9, () => { V.catState = 'gone' }); t += 1.8 }
      for (let k = 1; k <= tier; k++) { const s = t; at(s, () => { telop(D.tiers[k][lang]); EFFECTS[k](R) }); t += dur(k) }
      if (R.ufo) { at(t, () => { telop(T('ufo')); V.ufo = { x: 1.2, y: 0.12, tx: 0.62, ty: V.space >= 1 ? 0.62 : 0.2, beam: 0, paper: true }; Snd.play('ufo', { vol: 0.7 }) }); at(t + 0.6, () => { if (V.ufo) V.ufo.beam = 1 }); t += 1.6 }
      if (R.encore) { at(t, () => { telop(T('encore')); Snd.play('clap', { vol: 0.6 }); encoreAnim() }); t += 2.0 }
      t += 0.6
    }
    const shotAt = Math.max(0.5, t - 0.55)
    steps.push({ t: shotAt, fn: () => { R.photo = snap() }, end: true })
    steps.push({ t, fn: () => finishShow(R), end: true })
    steps.sort((a, b) => a.t - b.t)
    let el = 0, i = 0
    const sh = show_ = { next: true, R, tick(dt) { el += dt; while (sh.next && i < steps.length && steps[i].t <= el) { const s = steps[i++]; try { s.fn() } catch (e) { console.warn(e) } } if (i >= steps.length) sh.next = false },
      // 飛ばす: 残りの場面を全部起こし、世界を2秒進めて最後の絵にしてから撮る
      skip() { sh.next = false; const rest = steps.slice(i).filter(s => !s.end); i = steps.length; for (const s of rest) { try { s.fn() } catch (e) {} } for (let k = 0; k < 120; k++) stepWorld(); render(); R.photo = snap(); finishShow(R) } }
  }
  function encoreAnim() { tween(1.2, k => { V.encore = ease(k) }) }
  function boost(t) { V.shake = Math.max(V.shake, t) }
  const EFFECTS = {
    1() { V.crows.forEach((c, i) => after(i * 0.09, () => { c.fall = true; c.vy = -120; for (let j = 0; j < 4; j++) V.parts.push({ k: 'feather', x: c.x, y: -300, vx: rnd(-40, 40), vy: rnd(-30, 20), g: 30, rot: rnd(0, 6), vr: rnd(-3, 3), life: 1.6, decay: 0.5 }) })); Snd.play('crow'); after(0.2, () => Snd.play('crow', { rate: 0.85 })); Snd.play('flap', { vol: 0.6 }) },
    2() {
      V.angry = 1; V.bubble = { x: 160, y: -228, text: lang === 'ja' ? 'うるさい！' : 'QUIET!', size: 18 }; Snd.play('slam', { vol: 0.6 })
      after(0.33, () => {
        V.bubble = null; V.broken = 1; boost(0.5); Snd.play('glass'); after(0.12, () => Snd.play('glass', { rate: 0.9 })); after(0.26, () => Snd.play('glass', { rate: 1.1 }))
        for (let i = 0; i < 40; i++) V.parts.push({ k: 'shard', x: rnd(-220, 230), y: rnd(-210, -60), vx: rnd(-60, 60), vy: rnd(-80, 10), g: 500, rot: rnd(0, 6), vr: rnd(-8, 8), life: 1.4 })
        // ときどき自販機が中身を全部出す
        if (Math.random() < 0.6) { for (let i = 0; i < 12; i++) V.parts.push({ k: 'can', x: 196, y: -40, vx: rnd(-200, -40), vy: rnd(-300, -120), g: 700, rot: 0, vr: rnd(-10, 10), life: 2, decay: 0.5, c: pick(['#c4302b', '#2b5fae', '#e7b43b', '#3a8a5a']) }); Snd.play('rubble', { vol: 0.5, rate: 1.4 }) }
      })
    },
    3() { V.speaker = 1; V.angry = 0; Snd.play('chime', { vol: 0.8 }) },
    4() { V.speaker = 0; for (const [x, y] of [[-215, 72], [228, 84], [-60, -42], [-420, -60], [430, -60]]) { V.parts.push({ k: 'dog', x, y, life: 2.4, decay: 0.45 }); V.parts.push({ k: 'howl', x: x + 24, y: y - 50, life: 2, decay: 0.5 }) } Snd.play('howl'); after(0.18, () => Snd.play('howl', { rate: 0.8 })); after(0.36, () => Snd.play('howl', { rate: 1.2, vol: 0.6 })); Snd.play('bark', { vol: 0.5 }) },
    5() { tween(0.4, k => { V.cutWires = ease(k) }); V.blackout = 1; boost(0.4); Snd.play('zap', { vol: 0.9 }); Snd.play('snap', { vol: 0.8 }); for (let i = 0; i < 30; i++) V.parts.push({ k: 'spark', x: (i % 2 ? -150 : 250) + rnd(-10, 10), y: -314 + rnd(-6, 6), vx: rnd(-160, 160), vy: rnd(-200, 50), g: 600, life: 1, decay: 1.2 }) },
    6() { zoomTo(0.6, 0.6); V.sway = 1; boost(0.8); V.redSky = 0.3; Snd.play('creak'); Snd.play('rubble', { vol: 0.7 }); Snd.play('siren', { vol: 0.35 }); for (let i = 0; i < 30; i++) V.parts.push({ k: 'dust', x: rnd(-600, 600), y: rnd(-60, -10), vx: rnd(-20, 20), vy: rnd(-30, -5), r: rnd(6, 16), life: 1.6, decay: 0.6 }) },
    7() { zoomTo(0.45, 0.6); const tr = V.train; tr.x = -620; tr.v = 1500; tr.stop = false; after(0.35, () => { tr.stop = true; tr.spark = 1; boost(0.4); Snd.play('whistle', { vol: 0.7 }) }); Snd.play('station', { vol: 0.6 }) },
    8() { V.redSky = 0.6; tween(0.75, k => { V.moonZoom = ease(k); V.dark = 0.8 * k; if (k >= 1 && !V.moonCrack) { V.moonCrack = 1; Snd.play('crack', { rate: 0.6 }); boost(0.6) } }) },
    9() { V.flash = 1; V.space = 1; V.moonZoom = 0; boost(1); after(0.25, () => { tween(0.5, k => { V.earthCrack = k }); Snd.play('crack', { rate: 0.5, vol: 1 }); Snd.play('boom', { rate: 0.6, vol: 0.7 }) }) },
    10() { V.space = 1; boost(1.4); V.flash = 0.8; Snd.play('boom', { rate: 0.45, vol: 1 }); after(0.3, () => Snd.play('boom', { rate: 0.7 })); tween(1.2, k => { V.earthBoom = ease(k) }) },
  }
  function zoomTo(z, sec) { const z0 = V.zoom; tween(sec, k => { V.zoom = z0 + (z - z0) * ease(k) }) }
  function snap() { try { const c = document.createElement('canvas'), w = 720, h = Math.round(w * 8.4 / 16); c.width = w; c.height = h; const x = c.getContext('2d'); const sw = cv.width, sh = Math.round(cv.width * h / w), cyc = (V.space >= 1 ? H * 0.44 : GY() - 100 * U * V.zoom) * DPR, sy = clamp(Math.round(cyc - sh / 2), 0, Math.max(0, cv.height - sh)); x.drawImage(cv, 0, sy, sw, Math.min(sh, cv.height - sy), 0, 0, w, h); return c.toDataURL('image/jpeg', 0.84) } catch (e) { return '' } }
  function finishShow(R) {
    stopReplay(); V.sing = 0; show_ = null; singer_ = () => { V.level *= 0.9 }
    const jin = R.kind === 'tier' ? (R.tier >= 7 ? 'jinBig' : 'jinMid') : 'jinMeh'
    Snd.play(jin, { vol: 0.7, jitter: 0 })
    if (R.kind === 'good') Snd.play('giggle', { vol: 0.3 })
    if (window.TM) TM.end(R.D, R.kind === 'tier' && R.tier >= 10)
    lastR = R; fillResult(R); show('vResult'); V.mode = 'result'
  }

  // ---------------- 結果（号外） ----------------
  function readOf(key, v) { const a = D.read[key][lang]; return a[v < 25 ? 0 : v < 50 ? 1 : v < 80 ? 2 : 3] }
  function headOf(R) { return R.kind === 'good' ? D.good[lang] : R.kind === 'none' ? D.none[lang] : D.tiers[R.tier][lang] }
  function subOf(R) {
    const key = lang === 'ja' ? 'subJa' : 'subEn'
    const src = R.kind === 'good' ? D.good : R.kind === 'none' ? (R.whisper ? D.whisper : D.none) : D.tiers[R.tier]
    return src[key][R.subI % src[key].length]
  }
  function hintOf(R) {
    if (R.kind === 'good') return T('hint_good')
    if (R.kind === 'none') return T('hint_vol')
    if (R.tier >= 10) return T('hint_top')
    const gg = R.gauges, order = ['vol', 'lost', 'wild', 'persist'].sort((a, b) => gg[a] - gg[b])
    return T('hint_' + order[0])
  }
  function dateStr() { const d = new Date(); return lang === 'ja' ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日\n夕刊` : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + '\nEvening' }
  function stampOf(R) { return R.kind === 'tier' ? `${T('level')}<em>${R.tier}/10</em>` : R.kind === 'good' ? (lang === 'ja' ? '被害<em>なし</em>' : 'No<em>damage</em>') : (lang === 'ja' ? '本日<em>無音</em>' : 'Total<em>silence</em>') }
  function fillResult(R) {
    $('rName').textContent = T('paper'); $('rEx').textContent = T('extra'); $('rDate').textContent = dateStr()
    $('rHead').textContent = headOf(R); $('rSub').textContent = subOf(R)
    if (R.photo) $('rPhoto').src = R.photo
    $('rStamp').innerHTML = stampOf(R)
    const badges = []; if (R.reqOk) badges.push(T('reqOk')); if (R.ufo) badges.push(T('ufo')); if (R.encore) badges.push(lang === 'ja' ? 'アンコール' : 'Encore')
    $('rBadges').innerHTML = badges.map(b => `<span>${b}</span>`).join('')
    $('rGauges').innerHTML = ['vol', 'lost', 'wild', 'persist'].map(k => `<span>${T('g_' + k)}</span><span class="bar"><i style="width:${R.gauges[k]}%"></i></span><span class="rd">${readOf(k, R.gauges[k])}</span>`).join('')
    $('rHint').textContent = hintOf(R)
    const rb = $('bReplay')
    if (R.finger || !recBuf) { rb.disabled = true; rb.textContent = R.finger ? T('noRec') : T('replay') }
    else { rb.disabled = false; rb.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z" fill="#231f2b"/></svg><span>${T('replay')}</span>` }
  }
  // 自分の歌を聞く（端末の中のメモリだけ）
  let repNode = null
  function playRec(vol = 1) {
    stopReplay()
    Snd.played.replay = (Snd.played.replay || 0) + 1
    if (!recBuf || !Snd.ctx) return null
    try { const c = Snd.ctx, s = c.createBufferSource(), gn = c.createGain(); s.buffer = recBuf; gn.gain.value = vol; s.connect(gn); gn.connect(Snd.sfxBus); s.start(); repNode = s; s.onended = () => { if (repNode === s) { repNode = null; if (V.mode === 'result') fillResult(lastR) } }; return s } catch (e) { return null }
  }
  function stopReplay() { if (repNode) { try { repNode.stop() } catch (e) {} repNode = null } }
  function onReplay() {
    if (repNode) { stopReplay(); fillResult(lastR); return }
    if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume()
    if (playRec(1)) { $('bReplay').innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="10" height="12" fill="#231f2b"/></svg><span>${T('stop')}</span>` }
  }
  // 保存用の1枚（1080x1350 の号外）
  async function makeCard(R) {
    const c = document.createElement('canvas'), w = 1080, h = 1350; c.width = w; c.height = h
    const x = c.getContext('2d')
    try { await document.fonts.ready } catch (e) {}
    x.fillStyle = '#2b2f55'; x.fillRect(0, 0, w, h)
    x.save(); x.translate(w / 2, h / 2); x.rotate(-0.015); x.translate(-w / 2, -h / 2)
    x.fillStyle = '#f2ecdf'; x.fillRect(50, 50, w - 100, h - 100)
    const min = '"Shippori Mincho B1","Hiragino Mincho ProN",serif', ui = '"Zen Kaku Gothic New","Hiragino Sans",sans-serif'
    x.fillStyle = '#231f2b'; x.font = `800 58px ${min}`; x.textBaseline = 'alphabetic'; x.fillText(T('paper'), 90, 140)
    const nw = x.measureText(T('paper')).width
    x.fillStyle = '#c4302b'; x.fillRect(110 + nw, 92, 100, 62); x.fillStyle = '#fff'; x.font = `800 40px ${min}`; x.fillText(T('extra'), 120 + nw, 138)
    x.fillStyle = '#5a5550'; x.font = `500 26px ${ui}`; x.textAlign = 'right'; dateStr().split('\n').forEach((s, i) => x.fillText(s, w - 90, 112 + i * 32)); x.textAlign = 'left'
    x.fillStyle = '#231f2b'; x.fillRect(90, 168, w - 180, 4); x.fillRect(90, 178, w - 180, 2)
    // 見出し
    const head = headOf(R); let fs = 112; x.font = `800 ${fs}px ${min}`; while (x.measureText(head).width > w - 180 && fs > 60) { fs -= 4; x.font = `800 ${fs}px ${min}` }
    x.fillText(head, 90, 190 + fs)
    x.font = `700 34px ${ui}`; x.fillStyle = '#3b3640'; x.fillText(subOf(R), 90, 250 + fs, w - 180)
    // 写真
    const py = 290 + fs, ph = Math.round((w - 180) * 8.4 / 16)
    if (R.photo) { const img = new Image(); img.src = R.photo; try { await img.decode() } catch (e) {} x.drawImage(img, 90, py, w - 180, ph) }
    x.strokeStyle = '#231f2b'; x.lineWidth = 3; x.strokeRect(90, py, w - 180, ph)
    // ハンコ
    x.save(); x.translate(w - 200, py + ph - 100); x.rotate(-0.2); x.beginPath(); x.arc(0, 0, 86, 0, 7); x.fillStyle = 'rgba(242,236,223,.85)'; x.fill(); x.lineWidth = 7; x.strokeStyle = '#c4302b'; x.stroke(); x.fillStyle = '#c4302b'; x.textAlign = 'center'
    const st = stampOf(R).replace(/<em>/, '\n').replace(/<\/em>/, '').split('\n'); x.font = `900 26px ${ui}`; x.fillText(st[0], 0, -14); x.font = `800 50px ${min}`; x.fillText(st[1] || '', 0, 40); x.restore()
    // ゲージ
    let gy = py + ph + 60
    for (const k of ['vol', 'lost', 'wild', 'persist']) {
      x.fillStyle = '#231f2b'; x.font = `700 32px ${ui}`; x.fillText(T('g_' + k), 90, gy)
      x.fillStyle = '#e4dccb'; x.fillRect(370, gy - 26, 440, 26); x.fillStyle = '#231f2b'; x.fillRect(370, gy - 26, 440 * R.gauges[k] / 100, 26); x.strokeStyle = '#6b6258'; x.lineWidth = 2; x.strokeRect(370, gy - 26, 440, 26)
      x.fillStyle = '#c4302b'; x.font = `900 30px ${ui}`; x.textAlign = 'right'; x.fillText(readOf(k, R.gauges[k]), w - 90, gy); x.textAlign = 'left'
      gy += 54
    }
    x.fillStyle = '#5a5550'; x.font = `500 26px ${ui}`; x.fillText('tom3games.github.io/akichi-recital', 90, h - 84)
    x.restore()
    return c
  }
  async function onSave() {
    if (!lastR) return
    const c = await makeCard(lastR)
    const blob = await new Promise(ok => c.toBlob(ok, 'image/png'))
    window.__cardSize = blob ? blob.size : 0
    if (window.TM) TM.share('save')
    if (!blob) return
    const file = new File([blob], 'akichi-recital.png', { type: 'image/png' })
    try { if (navigator.canShare && navigator.canShare({ files: [file] }) && isTouch) { await navigator.share({ files: [file] }); return } } catch (e) { if (e && e.name === 'AbortError') return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'akichi-recital.png'; document.body.appendChild(a); a.click(); a.remove(); toast(T('saved'))
  }
  function postUrl(R) {
    const lv = R.kind === 'tier' ? ` ${T('level')}${R.tier}/10` : ''
    const text = T('shareTxt')(headOf(R), lv)
    return 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent('https://tom3games.github.io/akichi-recital/') + '&hashtags=' + encodeURIComponent(T('tag'))
  }
  function onPost() { if (!lastR) return; if (window.TM) TM.share('x'); window.__lastPost = postUrl(lastR); window.open(window.__lastPost, '_blank', 'noopener') }

  // ---------------- 指で歌う（心のマイク） ----------------
  const hb = $('bHeart')
  hb.addEventListener('pointerdown', e => { e.preventDefault(); try { hb.setPointerCapture(e.pointerId) } catch (er) {} finger.down = true; finger.x = finger.lx = e.clientX; finger.y = finger.ly = e.clientY; finger.p = e.pressure && e.pressure !== 0.5 ? e.pressure : 0.5; hb.classList.add('down') })
  hb.addEventListener('pointermove', e => { if (!finger.down) return; const d = Math.hypot(e.clientX - finger.lx, e.clientY - finger.ly); finger.speed = finger.speed * 0.6 + d * 60 * 0.4; finger.x = finger.lx = e.clientX; finger.y = finger.ly = e.clientY; if (e.pressure && e.pressure !== 0.5) finger.p = e.pressure })
  const up = () => { finger.down = false; hb.classList.remove('down') }
  hb.addEventListener('pointerup', up); hb.addEventListener('pointercancel', up); hb.addEventListener('lostpointercapture', up)

  // ---------------- ボタン ----------------
  $('bMic').addEventListener('click', onMic)
  $('bFinger').addEventListener('click', onFinger)
  $('bHow').addEventListener('click', () => { unlockAudio(); modal('pHow', true) })
  $('bHow2').addEventListener('click', () => modal('pHow', true))
  $('bHowClose').addEventListener('click', () => modal('pHow', false))
  $('bTutOk').addEventListener('click', () => { LS.set('ar_tut', '1'); modal('pTut', false); const p = pendingStart; pendingStart = null; if (p === 'mic') startMic(); else if (p === 'finger') { mode = 'finger'; beginRound() } })
  $('bLang').addEventListener('click', () => { lang = lang === 'ja' ? 'en' : 'ja'; LS.set('ar_lang', lang); applyLang() })
  $('bDenFinger').addEventListener('click', onFinger)
  $('bDenRetry').addEventListener('click', () => { modal('pDenied', false); unlockAudio(); startMic() })
  $('bDenBack').addEventListener('click', () => { modal('pDenied', false); goTitle() })
  $('btnAgain').addEventListener('click', () => { unlockAudio(); stopReplay(); if (mode === 'finger') beginRound(); else startMic() })
  $('bReplay').addEventListener('click', onReplay)
  $('bSave').addEventListener('click', onSave)
  $('bPost').addEventListener('click', onPost)
  $('vShow').addEventListener('pointerdown', () => { if (show_ && show_.next) show_.skip() })
  $('bMute').addEventListener('click', () => { muted = !muted; LS.set('ar_mute', muted ? '1' : '0'); Snd.setMute(muted); unlockAudio(); $('muteWave').style.display = muted ? 'none' : ''; $('muteX').hidden = !muted })
  $('muteWave').style.display = muted ? 'none' : ''; $('muteX').hidden = !muted
  document.addEventListener('visibilitychange', () => { if (document.hidden && Snd.ctx && Snd.ctx.state === 'running' && V.mode !== 'sing') { try { Snd.ctx.suspend() } catch (e) {} } else if (!document.hidden && Snd.ctx && Snd.ctx.state === 'suspended' && !window.__muteOk) { try { Snd.ctx.resume() } catch (e) {} } })
  applyLang()

  // ---------------- 検証用の窓口 ----------------
  window.ar = {
    V, D, get lastR() { return lastR }, get mode() { return mode }, get request() { return request }, set request(v) { request = v },
    dbg: { pause(p) { paused = p }, step(n = 1) { for (let i = 0; i < n; i++) stepWorld() } },
    // 台本どおりに結果を出す（撮影・OGP 用）。f は analyzer の数字
    showWith(over) { stopReplay(); resetWorld(); const f = { dur: 5, actFrac: 1, voicedRatio: 0.8, unsteady: 0.8, devMean: 30, rangeSemis: 20, jumpsPerSec: 2, jitter: 50, harsh: 0.6, loudDb: -8, medianHz: 300, longestSec: 5, riseDb: 0, ...over }; const R = makeResult(f, false); if (over.ufo != null) R.ufo = over.ufo; if (over.encore != null) R.encore = over.encore; runShow(R); return R },
    skip() { if (show_ && show_.next) show_.skip() },
    xy(id) { const r = $(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } },
    postUrl() { return lastR ? postUrl(lastR) : '' }, makeCard: () => lastR && makeCard(lastR), recBufLen: () => recBuf ? recBuf.length : 0,
  }
  window.__arReady = true
})()
