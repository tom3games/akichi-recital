// 遊ばれ方の計測。素の script で読み、ゲーム側は window.TM があるときだけ呼ぶ（読めなくてもゲームは動く）
// 使い方: <script src="tm.js?v=1" data-game="slug"></script> / TM.start() / TM.end(点数, クリアしたか) / TM.share('x'|'save') / TM.support()
// 本番ドメインで ID があるときだけ送る。ローカルと自動テストは window.__tmLog に積むだけ
(function () {
  var ID = ''
  var HOSTS = ['tom3games.github.io', 'tom3games.com']
  var script = document.currentScript
  var game = (script && script.getAttribute('data-game')) || location.pathname.split('/').filter(Boolean)[0] || 'unknown'
  var id = window.__tmId || ID
  var live = !!id && (window.__tmForce === true || (HOSTS.indexOf(location.hostname) >= 0 && !navigator.webdriver))
  var log = window.__tmLog = []
  var plays = 0, startedAt = 0, playing = false

  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  if (live) {
    gtag('js', new Date())
    gtag('config', id)
    var s = document.createElement('script')
    s.async = true
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id)
    document.head.appendChild(s)
  }

  function send(name, params) {
    params.game = game
    log.push({ name: name, params: params })
    if (live) gtag('event', name, params)
  }
  function seconds() { return Math.round((Date.now() - startedAt) / 1000) }
  function quit() {
    if (!playing) return
    playing = false
    send('game_quit', { play_no: plays, sec: seconds(), transport_type: 'beacon' })
  }

  window.TM = {
    start: function () {
      quit()
      plays += 1
      startedAt = Date.now()
      playing = true
      send('game_start', { play_no: plays, retry: plays > 1 ? 1 : 0 })
    },
    end: function (score, cleared) {
      if (!playing) return
      playing = false
      send('game_end', { play_no: plays, sec: seconds(), score: Number(score) || 0, cleared: cleared ? 1 : 0 })
    },
    share: function (method) { send('share', { method: method }) },
    support: function () { send('support_click', {}) }
  }
  window.addEventListener('pagehide', quit)
})()
