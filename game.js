// ─── Telegram Mini App ───────────────────────────────────────────────────────
if (window.Telegram && window.Telegram.WebApp) {
  Telegram.WebApp.ready()
  Telegram.WebApp.expand()
}

const canvas  = document.getElementById("game")
const ctx     = canvas.getContext("2d")

// Вертикальный формат
const MOBILE_CONTROLS_H = 220
const HUD_H             = 72

// Рендерим в половину ширины для производительности
const RENDER_SCALE = 0.5

function resizeCanvas() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight - MOBILE_CONTROLS_H - HUD_H
  // Растягиваем через CSS — canvas рендерится маленьким, браузер масштабирует
  canvas.style.width  = window.innerWidth + "px"
  canvas.style.height = (window.innerHeight - MOBILE_CONTROLS_H - HUD_H) + "px"
  canvas.width  = Math.floor(window.innerWidth  * RENDER_SCALE)
  canvas.height = Math.floor((window.innerHeight - MOBILE_CONTROLS_H - HUD_H) * RENDER_SCALE)
}
resizeCanvas()
window.addEventListener("resize", resizeCanvas)

const mini = document.getElementById("minimap")
const mctx = mini.getContext("2d")
mini.width  = 180
mini.height = 180

const elHP         = document.getElementById("hp")
const elAmmo       = document.getElementById("ammo")
const elEnemyCount = document.getElementById("enemyCount")
const elKills      = document.getElementById("kills")
const elFace       = document.getElementById("face")
const elFlash      = document.getElementById("damage-flash")

const MAP = 30
const FOV = Math.PI / 3

// ─── Текстуры ────────────────────────────────────────────────────────────────

function img(p) {
  const i = new Image()
  i.src = p
  return i
}

const tex = {
  wall1:    img("assets/textures/wall1.png"),
  wall2:    img("assets/textures/wall2.png"),
  floor:    img("assets/textures/floor.png"),
  ceiling:  img("assets/textures/ceiling.png"),
  gun:      img("assets/weapons/gun.png"),
  apple:    img("assets/items/apple.png"),
  monster1: img("assets/monsters/monster1.png"),
  monster2: img("assets/monsters/monster2.png"),
  monster3:   img("assets/monsters/monster3.png"),
  explosion:  img("assets/effects/explosion.png"),
  boss:       img("assets/monsters/boss.png"),
  // Текстуры уровня 2 — ангар
  wall1_l2:   img("assets/textures/wall1_lvl2.png"),
  wall2_l2:   img("assets/textures/wall2_lvl2.png"),
  floor_l2:   img("assets/textures/floor_lvl2.png"),
  ceiling_l2: img("assets/textures/ceiling_lvl2.png"),
}

// ─── Карта ───────────────────────────────────────────────────────────────────

let map = []

for (let y = 0; y < MAP; y++) {
  map[y] = []
  for (let x = 0; x < MAP; x++) {
    if (x === 0 || y === 0 || x === MAP - 1 || y === MAP - 1) {
      map[y][x] = 1
    } else {
      map[y][x] = Math.random() < 0.25 ? 1 : 0
    }
  }
}

// Стартовая зона пустая
for (let y = 1; y <= 3; y++)
  for (let x = 1; x <= 3; x++)
    map[y][x] = 0

function wall(x, y) {
  return map[Math.floor(y)]?.[Math.floor(x)] === 1
}

// ─── Предметы на полу (яблоки = патроны, аптечки = HP) ──────────────────────

let items = []

for (let i = 0; i < 40; i++) {
  let ix, iy, attempts = 0
  do {
    ix = 1 + Math.random() * (MAP - 2)
    iy = 1 + Math.random() * (MAP - 2)
    attempts++
  } while (wall(ix, iy) && attempts < 100)

  items.push({ x: ix, y: iy, picked: false, ammo: 5, type: "ammo" })
}

// 5 аптечек — восстанавливают 25 HP
for (let i = 0; i < 5; i++) {
  let ix, iy, attempts = 0
  do {
    ix = 1 + Math.random() * (MAP - 2)
    iy = 1 + Math.random() * (MAP - 2)
    attempts++
  } while (wall(ix, iy) && attempts < 100)

  items.push({ x: ix, y: iy, picked: false, heal: 25, type: "medkit" })
}

// ─── Игрок ───────────────────────────────────────────────────────────────────

let player = {
  x:     2,
  y:     2,
  angle: 0,
  hp:    100,
  ammo:  30,
  dead:  false,
  kills: 0,
}

// ─── Враги ───────────────────────────────────────────────────────────────────

let enemies = []

for (let i = 0; i < 50; i++) {
  let ex, ey, attempts = 0
  do {
    ex = 1 + Math.random() * (MAP - 2)
    ey = 1 + Math.random() * (MAP - 2)
    attempts++
  } while (wall(ex, ey) && attempts < 100)

  enemies.push({
    x:    ex,
    y:    ey,
    hp:   3,
    type: Math.floor(Math.random() * 3),
    dir:  Math.random() * Math.PI * 2,
  })
}

// ─── Летящие пули ────────────────────────────────────────────────────────────

let bullets = []

// ─── Взрывы ──────────────────────────────────────────────────────────────────

let explosions = []   // { x, y, frame, timer }

const EXPL_FRAMES     = 8     // кадров в спрайт-полоске
const EXPL_FRAME_W    = 128   // ширина одного кадра
const EXPL_FRAME_DUR  = 4     // кадров игры на один кадр анимации

// ─── Уровень / Портал / Босс ─────────────────────────────────────────────────

let currentLevel = 1   // 1 = первый уровень, 2 = уровень с боссом

// Портал появляется когда убиты все враги на уровне 1
let portal = null  // { x, y } или null

// Босс
let boss = null
/*  boss = {
      x, y, hp, maxHp, dir,
      shootTimer,        // счётчик до следующего выстрела
      projectiles: []    // снаряды босса { x, y, angle, dead }
    }
*/

function spawnPortal() {
  // Ставим портал в дальнем углу от игрока
  let px, py, attempts = 0
  do {
    px = 2 + Math.random() * (MAP - 4)
    py = 2 + Math.random() * (MAP - 4)
    attempts++
  } while ((wall(px, py) || Math.hypot(px - player.x, py - player.y) < 8) && attempts < 200)
  portal = { x: px, y: py, animTimer: 0 }
}

function spawnBoss() {
  // Босс — в центре уровня, гарантированно свободная зона
  const bx = MAP / 2
  const by = MAP / 2
  // Очищаем зону вокруг босса
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++)
      if (map[Math.floor(by+dy)]?.[Math.floor(bx+dx)] !== undefined)
        map[Math.floor(by+dy)][Math.floor(bx+dx)] = 0

  boss = {
    x: bx, y: by,
    hp: 30, maxHp: 30,
    dir: 0,
    shootTimer: 0,
    projectiles: [],
  }
}

function loadLevel2() {
  currentLevel = 2
  portal = null

  // Новая карта — темнее, больше коридоров
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++)
      if (x === 0 || y === 0 || x === MAP-1 || y === MAP-1)
        map[y][x] = 1
      else
        map[y][x] = Math.random() < 0.18 ? 1 : 0

  // Зона игрока
  for (let y = 1; y <= 3; y++)
    for (let x = 1; x <= 3; x++)
      map[y][x] = 0

  // Сбрасываем игрока
  player.x = 2; player.y = 2
  player.hp = Math.min(100, player.hp + 30)  // небольшое лечение при переходе
  bullets = []
  explosions = []
  enemies = []  // на уровне 2 нет обычных врагов

  // Новые яблоки
  items = []
  for (let i = 0; i < 15; i++) {
    let ix, iy, a = 0
    do { ix = 1+Math.random()*(MAP-2); iy = 1+Math.random()*(MAP-2); a++ }
    while (wall(ix,iy) && a < 100)
    items.push({ x: ix, y: iy, picked: false, ammo: 8, type: "ammo" })
  }
  // 3 аптечки на уровне 2
  for (let i = 0; i < 3; i++) {
    let ix, iy, a = 0
    do { ix = 1+Math.random()*(MAP-2); iy = 1+Math.random()*(MAP-2); a++ }
    while (wall(ix,iy) && a < 100)
    items.push({ x: ix, y: iy, picked: false, heal: 25, type: "medkit" })
  }

  spawnBoss()
}

// ─── Урон ────────────────────────────────────────────────────────────────────

let hurtTimer = 0
let lastHP    = 100

// ─── Звуки ───────────────────────────────────────────────────────────────────

const snd = {
  music:      new Audio("assets/sounds/03__The_Imp_s_Song.mp3"),
  menuMusic:  new Audio("assets/sounds/19__Donna_To_The_Rescue.mp3"),
  hurt:       new Audio("assets/sounds/hurt_01.mp3"),
  shoot:      new Audio("assets/sounds/burst_fire.mp3"),
  enemyDeath: new Audio("assets/sounds/Goblin_Death.wav"),
  pickup:     new Audio("assets/sounds/key-176034.mp3"),
  ambient:    new Audio("assets/sounds/radio_death.mp3"),
  empty:      new Audio("assets/sounds/outofammo.wav"),
}

// Музыка игры на репите
snd.music.loop   = true
snd.music.volume = 0.45

// Музыка меню на репите
snd.menuMusic.loop   = true
snd.menuMusic.volume = 0.5

// Фоновые звуки монстров на репите
snd.ambient.loop   = true
snd.ambient.volume = 0.2

// Музыка меню — запускаем сразу как только страница загружена
let audioStarted = false

function startMenuAudio() {
  snd.menuMusic.play().catch(() => {
    // Браузер заблокировал автовоспроизведение — ждём первого клика
    const tryPlay = () => {
      snd.menuMusic.play().catch(() => {})
      document.removeEventListener("click",   tryPlay)
      document.removeEventListener("keydown", tryPlay)
    }
    document.addEventListener("click",   tryPlay, { once: true })
    document.addEventListener("keydown", tryPlay, { once: true })
  })
}

function startAudio() {
  if (audioStarted) return
  audioStarted = true
  snd.menuMusic.pause()
  snd.menuMusic.currentTime = 0
  snd.music.play().catch(() => {})
  snd.ambient.play().catch(() => {})
}

function returnToMenu() {
  snd.music.pause()
  snd.music.currentTime = 0
  snd.ambient.pause()
  snd.ambient.currentTime = 0
  audioStarted = false

  if (elMenu)        elMenu.classList.remove("hidden")
  if (elGameWrapper) elGameWrapper.classList.add("hidden")

  snd.menuMusic.currentTime = 0
  snd.menuMusic.play().catch(() => {})
}

// Запускаем музыку меню сразу
startMenuAudio()

// Хелпер для коротких звуков — клонирует аудио чтобы можно было играть несколько раз подряд
function playSound(audio, volume = 1.0) {
  const clone = audio.cloneNode()
  clone.volume = Math.min(1, volume)
  clone.play().catch(() => {})
}

// ─── Управление — используем e.code, не e.key ────────────────────────────────
// e.code не зависит от раскладки клавиатуры (русская/английская)

let keys = {}
document.addEventListener("keydown", e => {
  keys[e.code] = true
  // ESC — выход в меню (только если игра активна)
  if (e.code === "Escape" && elGameWrapper && !elGameWrapper.classList.contains("hidden")) {
    returnToMenu()
  }
})
document.addEventListener("keyup", e => { keys[e.code] = false })

// ─── Главное меню ────────────────────────────────────────────────────────────

const elMenu        = document.getElementById("main-menu")
const elGameWrapper = document.getElementById("game-wrapper")
const btnNewGame    = document.getElementById("btn-newgame")

function startGame() {
  if (elMenu)        elMenu.classList.add("hidden")
  if (elGameWrapper) elGameWrapper.classList.remove("hidden")
  startAudio()
  initMobileControls()
}

if (btnNewGame) btnNewGame.addEventListener("click", startGame)

// ─── Мобильное управление ────────────────────────────────────────────────────

let joystick = { active: false, id: null, startX: 0, startY: 0, dx: 0, dy: 0 }
let lookTouch = { active: false, id: null, lastX: 0 }

function initMobileControls() {
  const joystickZone = document.getElementById("joystick-zone")
  const lookZone     = document.getElementById("look-zone")
  const fireBtn      = document.getElementById("fire-btn")
  const knob         = document.getElementById("joystick-knob")
  const base         = document.getElementById("joystick-base")

  const MAX_DIST = 40

  // ── Джойстик движения ──────────────────────────────────────
  joystickZone.addEventListener("touchstart", e => {
    e.preventDefault()
    const t = e.changedTouches[0]
    joystick.active = true
    joystick.id     = t.identifier
    const rect      = base.getBoundingClientRect()
    joystick.startX = rect.left + rect.width / 2
    joystick.startY = rect.top  + rect.height / 2
  }, { passive: false })

  joystickZone.addEventListener("touchmove", e => {
    e.preventDefault()
    for (const t of e.changedTouches) {
      if (t.identifier !== joystick.id) continue
      let dx = t.clientX - joystick.startX
      let dy = t.clientY - joystick.startY
      const dist = Math.sqrt(dx*dx + dy*dy)
      if (dist > MAX_DIST) { dx = dx/dist*MAX_DIST; dy = dy/dist*MAX_DIST }
      joystick.dx = dx / MAX_DIST
      joystick.dy = dy / MAX_DIST
      knob.style.transform = `translate(${dx}px, ${dy}px)`
    }
  }, { passive: false })

  joystickZone.addEventListener("touchend", e => {
    e.preventDefault()
    for (const t of e.changedTouches) {
      if (t.identifier !== joystick.id) continue
      joystick.active = false
      joystick.dx = 0; joystick.dy = 0
      knob.style.transform = "translate(0,0)"
    }
  }, { passive: false })

  // ── Зона поворота камеры ────────────────────────────────────
  lookZone.addEventListener("touchstart", e => {
    e.preventDefault()
    const t = e.changedTouches[0]
    lookTouch.active = true
    lookTouch.id     = t.identifier
    lookTouch.lastX  = t.clientX
  }, { passive: false })

  lookZone.addEventListener("touchmove", e => {
    e.preventDefault()
    for (const t of e.changedTouches) {
      if (t.identifier !== lookTouch.id) continue
      const delta     = t.clientX - lookTouch.lastX
      player.angle   += delta * 0.005
      lookTouch.lastX = t.clientX
    }
  }, { passive: false })

  lookZone.addEventListener("touchend", e => {
    e.preventDefault()
    lookTouch.active = false
  }, { passive: false })

  // ── Кнопка огня ────────────────────────────────────────────
  fireBtn.addEventListener("touchstart", e => {
    e.preventDefault()
    shoot()
  }, { passive: false })
}

function shoot() {
  if (player.dead) return
  if (player.ammo <= 0) {
    playSound(snd.empty, 0.8)
    return
  }
  player.ammo--
  playSound(snd.shoot, 0.7)
  triggerRecoil()
  bullets.push({
    x:     player.x + Math.cos(player.angle) * 0.3,
    y:     player.y + Math.sin(player.angle) * 0.3,
    angle: player.angle,
    dead:  false,
    dist:  0,
  })
}

// ─── Угол ────────────────────────────────────────────────────────────────────

function normalizeAngle(a) {
  while (a >  Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

// ─── DDA Raycast ─────────────────────────────────────────────────────────────

function ray(angle) {
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)

  let mapX = Math.floor(player.x)
  let mapY = Math.floor(player.y)

  const deltaX = Math.abs(1 / cos)
  const deltaY = Math.abs(1 / sin)
  const stepX  = cos > 0 ? 1 : -1
  const stepY  = sin > 0 ? 1 : -1

  let sideX = cos > 0
    ? (mapX + 1 - player.x) * deltaX
    : (player.x - mapX)     * deltaX
  let sideY = sin > 0
    ? (mapY + 1 - player.y) * deltaY
    : (player.y - mapY)     * deltaY

  let side = 0, hit = false

  for (let i = 0; i < 64 && !hit; i++) {
    if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0 }
    else               { sideY += deltaY; mapY += stepY; side = 1 }
    if (map[mapY]?.[mapX] === 1) hit = true
  }

  let dist = side === 0
    ? (mapX - player.x + (1 - stepX) / 2) / cos
    : (mapY - player.y + (1 - stepY) / 2) / sin
  dist = Math.max(0.001, dist)

  let wallX = side === 0
    ? player.y + dist * sin
    : player.x + dist * cos
  wallX -= Math.floor(wallX)

  return { dist, wallX, side }
}

// ─── Мир ─────────────────────────────────────────────────────────────────────

let zBuffer = []

function drawWorld() {
  const texCeil  = currentLevel === 2 ? tex.ceiling_l2 : tex.ceiling
  const texFloor = currentLevel === 2 ? tex.floor_l2   : tex.floor
  const texW1    = currentLevel === 2 ? tex.wall1_l2   : tex.wall1
  const texW2    = currentLevel === 2 ? tex.wall2_l2   : tex.wall2

  if (texCeil.complete && texCeil.naturalWidth > 0)
    ctx.drawImage(texCeil, 0, 0, canvas.width, canvas.height / 2)
  else {
    ctx.fillStyle = currentLevel === 2 ? "#1a1a1a" : "#1a1a2e"
    ctx.fillRect(0, 0, canvas.width, canvas.height / 2)
  }

  if (texFloor.complete && texFloor.naturalWidth > 0)
    ctx.drawImage(texFloor, 0, canvas.height / 2, canvas.width, canvas.height / 2)
  else {
    ctx.fillStyle = currentLevel === 2 ? "#2a2a2a" : "#3a2a1a"
    ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2)
  }

  zBuffer = new Array(canvas.width)

  // Рисуем полосами по 2px — вдвое меньше лучей, заметный прирост скорости
  const STRIP = 2
  for (let x = 0; x < canvas.width; x += STRIP) {
    const angle = player.angle - FOV / 2 + FOV * x / canvas.width
    const r     = ray(angle)
    const dist  = r.dist * Math.cos(normalizeAngle(angle - player.angle))

    // Заполняем zBuffer для всех пикселей полосы
    for (let i = 0; i < STRIP; i++) zBuffer[x + i] = dist

    const h    = canvas.height / dist
    const tex_ = r.side === 0 ? texW1 : texW2

    if (tex_.complete && tex_.naturalWidth > 0) {
      const tx = Math.floor(r.wallX * tex_.naturalWidth)
      ctx.drawImage(tex_, tx, 0, 1, tex_.naturalHeight,
        x, Math.floor(canvas.height / 2 - h / 2), STRIP, Math.ceil(h))
    } else {
      const shade = Math.min(255, Math.floor(180 / dist))
      ctx.fillStyle = r.side === 0
        ? `rgb(${shade},${Math.floor(shade*0.7)},${Math.floor(shade*0.5)})`
        : `rgb(${Math.floor(shade*0.7)},${Math.floor(shade*0.5)},${Math.floor(shade*0.35)})`
      ctx.fillRect(x, Math.floor(canvas.height / 2 - h / 2), STRIP, Math.ceil(h))
    }
  }
}

// ─── Движение с инерцией ─────────────────────────────────────────────────────

let velX = 0
let velY = 0

function move() {
  if (player.dead) return

  const ACCEL     = 0.012
  const MAX_SPEED = 0.10
  const FRICTION  = 0.78

  let inputX = 0
  let inputY = 0

  // Клавиатура (для дескопа / отладки)
  if (keys["KeyW"] || keys["ArrowUp"]) {
    inputX += Math.cos(player.angle)
    inputY += Math.sin(player.angle)
  }
  if (keys["KeyS"] || keys["ArrowDown"]) {
    inputX -= Math.cos(player.angle)
    inputY -= Math.sin(player.angle)
  }
  if (keys["KeyA"] || keys["ArrowLeft"]) {
    inputX += Math.cos(player.angle - Math.PI / 2)
    inputY += Math.sin(player.angle - Math.PI / 2)
  }
  if (keys["KeyD"] || keys["ArrowRight"]) {
    inputX += Math.cos(player.angle + Math.PI / 2)
    inputY += Math.sin(player.angle + Math.PI / 2)
  }

  // Джойстик — вперёд/назад по оси Y, стрейф по оси X
  if (joystick.active) {
    const fwd  = -joystick.dy  // вверх = вперёд
    const side =  joystick.dx
    inputX += Math.cos(player.angle) * fwd + Math.cos(player.angle + Math.PI / 2) * side
    inputY += Math.sin(player.angle) * fwd + Math.sin(player.angle + Math.PI / 2) * side
  }

  const len = Math.sqrt(inputX * inputX + inputY * inputY)
  if (len > 0) { inputX /= len; inputY /= len }

  velX = (velX + inputX * ACCEL) * FRICTION
  velY = (velY + inputY * ACCEL) * FRICTION

  const speed = Math.sqrt(velX * velX + velY * velY)
  if (speed > MAX_SPEED) { velX = (velX / speed) * MAX_SPEED; velY = (velY / speed) * MAX_SPEED }

  const nx = player.x + velX
  const ny = player.y + velY

  if (!wall(nx, player.y)) player.x = nx; else velX = 0
  if (!wall(player.x, ny)) player.y = ny; else velY = 0

  // Подбор предметов
  items.forEach(item => {
    if (item.picked) return
    const dx = player.x - item.x
    const dy = player.y - item.y
    if (Math.sqrt(dx * dx + dy * dy) < 0.6) {
      item.picked = true
      if (item.type === "medkit") {
        player.hp = Math.min(100, player.hp + item.heal)
      } else {
        player.ammo = Math.min(99, player.ammo + item.ammo)
      }
      playSound(snd.pickup, 0.9)
    }
  })

  // Вход в портал
  if (portal) {
    const dx = player.x - portal.x
    const dy = player.y - portal.y
    if (Math.sqrt(dx*dx + dy*dy) < 1.2) {
      loadLevel2()
    }
  }
}

// ─── Враги ───────────────────────────────────────────────────────────────────

function updateEnemies() {
  enemies.forEach(e => {
    if (e.hp <= 0) return

    if (Math.random() < 0.015) e.dir = Math.random() * Math.PI * 2

    const speed = 0.008
    const nx = e.x + Math.cos(e.dir) * speed
    const ny = e.y + Math.sin(e.dir) * speed

    if (!wall(nx, ny)) { e.x = nx; e.y = ny }
    else e.dir += Math.PI + (Math.random() - 0.5) * 0.8

    const dx = player.x - e.x
    const dy = player.y - e.y
    if (Math.sqrt(dx * dx + dy * dy) < 0.8) player.hp -= 0.12
  })

  if (player.hp <= 0) { player.hp = 0; player.dead = true }
}

// ─── Пули ────────────────────────────────────────────────────────────────────

function updateBullets() {
  bullets.forEach(b => {
    if (b.dead) return
    b.x    += Math.cos(b.angle) * 0.18
    b.y    += Math.sin(b.angle) * 0.18
    b.dist += 0.18

    if (b.dist > 25 || wall(b.x, b.y)) { b.dead = true; return }

    enemies.forEach(e => {
      if (e.hp <= 0 || b.dead) return
      const dx = b.x - e.x
      const dy = b.y - e.y
      if (Math.sqrt(dx * dx + dy * dy) < 0.5) {
        e.hp--
        b.dead = true
        if (e.hp <= 0) {
          player.kills++
          playSound(snd.enemyDeath, 0.8)
          explosions.push({ x: e.x, y: e.y, frame: 0, timer: 0 })
          // Проверяем — все ли враги убиты на уровне 1
          if (currentLevel === 1 && !portal && enemies.every(e2 => e2.hp <= 0)) {
            spawnPortal()
          }
        }
      }
    })
  })
  bullets = bullets.filter(b => !b.dead)
}

// ─── Спрайт в мире (общий хелпер) ────────────────────────────────────────────

function drawBillboard(image, wx, wy, worldSize, colorFallback) {
  const dx   = wx - player.x
  const dy   = wy - player.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 0.2) return

  let ang = Math.atan2(dy, dx) - player.angle
  ang = normalizeAngle(ang)
  if (Math.abs(ang) >= FOV / 2) return

  const size    = (canvas.height * worldSize) / dist
  const screenX = Math.floor((0.5 + ang / FOV) * canvas.width)
  const top     = Math.floor(canvas.height / 2 - size / 2)
  const startX  = Math.floor(screenX - size / 2)
  const endX    = Math.floor(screenX + size / 2)

  if (!image || !image.complete || image.naturalWidth === 0) {
    // Фолбэк — цветной кружок
    ctx.fillStyle = colorFallback
    ctx.beginPath()
    ctx.arc(screenX, canvas.height / 2, Math.max(4, size / 2), 0, Math.PI * 2)
    ctx.fill()
    return
  }

  for (let sx = startX; sx < endX; sx++) {
    if (sx < 0 || sx >= canvas.width) continue
    if (zBuffer[sx] !== undefined && dist >= zBuffer[sx]) continue
    const tx = Math.floor(((sx - startX) / size) * image.naturalWidth)
    ctx.drawImage(image, tx, 0, 1, image.naturalHeight, sx, top, 1, size)
  }
}

// ─── Взрывы — обновление и отрисовка ─────────────────────────────────────────

function drawExplosions() {
  // Обновляем таймеры
  explosions.forEach(expl => {
    expl.timer++
    if (expl.timer >= 6) {
      expl.timer = 0
      expl.frame++
    }
  })

  // Удаляем завершённые
  explosions = explosions.filter(expl => expl.frame < EXPL_FRAMES)

  const explImg = tex.explosion

  explosions.forEach(expl => {
    const dx   = expl.x - player.x
    const dy   = expl.y - player.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Убрал ограничение dist > 20, снизил минимум
    if (dist < 0.05) return

    let ang = Math.atan2(dy, dx) - player.angle
    ang = normalizeAngle(ang)

    // Чуть расширил угол чтобы не обрезало по краям
    if (Math.abs(ang) >= FOV / 1.8) return

    const size    = (canvas.height * 1.6) / dist
    const screenX = (0.5 + ang / FOV) * canvas.width
    const top     = canvas.height / 2 - size / 2

    if (explImg.complete && explImg.naturalWidth > 0) {
      ctx.drawImage(
        explImg,
        expl.frame * EXPL_FRAME_W, 0,   // X кадра в полоске
        EXPL_FRAME_W, EXPL_FRAME_W,      // ширина и высота кадра (128×128)
        screenX - size / 2, top,
        size, size
      )
    } else {
      // Фолбэк — оранжевый круг
      ctx.globalAlpha = 1 - expl.frame / EXPL_FRAMES
      ctx.fillStyle = "#ff6600"
      ctx.beginPath()
      ctx.arc(screenX, canvas.height / 2, size / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  })
}

// ─── Босс ────────────────────────────────────────────────────────────────────

function updateBoss() {
  if (!boss || boss.hp <= 0) return

  // Движение к игроку
  const dx = player.x - boss.x
  const dy = player.y - boss.y
  const dist = Math.hypot(dx, dy)
  boss.dir = Math.atan2(dy, dx)

  if (dist > 2) {
    const speed = 0.015
    const nx = boss.x + Math.cos(boss.dir) * speed
    const ny = boss.y + Math.sin(boss.dir) * speed
    if (!wall(nx, boss.y)) boss.x = nx
    if (!wall(boss.x, ny)) boss.y = ny
  }

  // Контактный урон
  if (dist < 1.2) player.hp -= 0.3

  // Стрельба — каждые 90 кадров (~1.5 сек)
  boss.shootTimer++
  if (boss.shootTimer >= 90) {
    boss.shootTimer = 0
    // 3 снаряда веером
    for (let i = -1; i <= 1; i++) {
      boss.projectiles.push({
        x: boss.x, y: boss.y,
        angle: boss.dir + i * 0.25,
        dead: false,
      })
    }
  }

  // Обновляем снаряды
  boss.projectiles.forEach(p => {
    if (p.dead) return
    p.x += Math.cos(p.angle) * 0.12
    p.y += Math.sin(p.angle) * 0.12
    if (wall(p.x, p.y)) { p.dead = true; return }
    // Попадание в игрока
    if (Math.hypot(p.x - player.x, p.y - player.y) < 0.5) {
      player.hp -= 8
      p.dead = true
    }
  })
  boss.projectiles = boss.projectiles.filter(p => !p.dead)

  if (player.hp <= 0) { player.hp = 0; player.dead = true }
}

function drawBoss() {
  if (!boss || boss.hp <= 0) return
  drawBillboard(tex.boss, boss.x, boss.y, 1.8, "#800080")

  // Снаряды босса — красные шары
  boss.projectiles.forEach(p => {
    const dx = p.x - player.x
    const dy = p.y - player.y
    const dist = Math.hypot(dx, dy)
    if (dist < 0.2) return
    let ang = Math.atan2(dy, dx) - player.angle
    ang = normalizeAngle(ang)
    if (Math.abs(ang) >= FOV / 2) return
    const size = (canvas.height * 0.06) / dist
    const sx = (0.5 + ang / FOV) * canvas.width
    const sy = canvas.height / 2
    const col = Math.floor(sx)
    if (col >= 0 && col < canvas.width && zBuffer[col] && dist >= zBuffer[col]) return
    ctx.fillStyle = "#ff2200"
    ctx.shadowColor = "#ff6600"
    ctx.shadowBlur = 20
    ctx.beginPath()
    ctx.arc(sx, sy, Math.max(4, size/2), 0, Math.PI*2)
    ctx.fill()
    ctx.shadowBlur = 0
  })

  // HP-бар босса вверху экрана
  const barW = canvas.width * 0.5
  const barH = 28
  const barX = canvas.width / 2 - barW / 2
  const barY = 20

  ctx.fillStyle = "rgba(0,0,0,0.7)"
  ctx.fillRect(barX - 4, barY - 4, barW + 8, barH + 8)

  ctx.fillStyle = "#400"
  ctx.fillRect(barX, barY, barW, barH)

  const pct = boss.hp / boss.maxHp
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0)
  grad.addColorStop(0, "#ff2200")
  grad.addColorStop(1, "#ff6600")
  ctx.fillStyle = grad
  ctx.fillRect(barX, barY, barW * pct, barH)

  ctx.strokeStyle = "#c00"
  ctx.lineWidth = 2
  ctx.strokeRect(barX, barY, barW, barH)

  ctx.font = "bold 16px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#fff"
  ctx.textAlign = "center"
  ctx.fillText(`BOSS  ${boss.hp} / ${boss.maxHp}`, canvas.width / 2, barY + barH - 6)
  ctx.textAlign = "left"
}

function checkBossHit() {
  if (!boss || boss.hp <= 0) return
  bullets.forEach(b => {
    if (b.dead) return
    if (Math.hypot(b.x - boss.x, b.y - boss.y) < 1.2) {
      boss.hp--
      b.dead = true
      explosions.push({ x: b.x, y: b.y, frame: 0, timer: 0 })
      if (boss.hp <= 0) {
        // ПОБЕДА
        explosions.push({ x: boss.x, y: boss.y, frame: 0, timer: 0 })
        player.kills++
        setTimeout(() => showVictory(), 1500)
      }
    }
  })
}

function showVictory() {
  player.dead = true  // останавливаем управление
  snd.music.pause()
  // Рисуем экран победы — через флаг
  player._victory = true
}

// ─── Портал ──────────────────────────────────────────────────────────────────

function drawPortal() {
  if (!portal) return
  portal.animTimer++

  const dx = portal.x - player.x
  const dy = portal.y - player.y
  const dist = Math.hypot(dx, dy)
  if (dist < 0.2 || dist > 20) return

  let ang = Math.atan2(dy, dx) - player.angle
  ang = normalizeAngle(ang)
  if (Math.abs(ang) >= FOV / 2) return

  const size = (canvas.height * 0.9) / dist
  const sx   = (0.5 + ang / FOV) * canvas.width
  const sy   = canvas.height / 2

  // Анимированное свечение портала
  const pulse = 0.7 + 0.3 * Math.sin(portal.animTimer * 0.08)
  const r     = size / 2 * pulse

  // Внешнее свечение
  const glow = ctx.createRadialGradient(sx, sy, r*0.1, sx, sy, r*1.6)
  glow.addColorStop(0,   `rgba(0,100,255,${0.5 * pulse})`)
  glow.addColorStop(0.5, `rgba(0,50,200,${0.3 * pulse})`)
  glow.addColorStop(1,   "rgba(0,0,100,0)")
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(sx, sy, r * 1.6, 0, Math.PI * 2)
  ctx.fill()

  // Ядро портала
  const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
  core.addColorStop(0,   `rgba(150,220,255,${0.95 * pulse})`)
  core.addColorStop(0.4, `rgba(0,120,255,${0.8 * pulse})`)
  core.addColorStop(1,   `rgba(0,0,200,${0.4 * pulse})`)
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(sx, sy, r, 0, Math.PI * 2)
  ctx.fill()

  // Надпись
  if (dist < 5) {
    ctx.font = `bold ${Math.floor(18/dist*3)}px 'Share Tech Mono', monospace`
    ctx.fillStyle = `rgba(150,220,255,${Math.min(1, 3/dist)})`
    ctx.textAlign = "center"
    ctx.fillText("[ ВОЙТИ ]", sx, sy - r - 10)
    ctx.textAlign = "left"
  }
}

// ─── Отрисовка врагов ────────────────────────────────────────────────────────

function drawSprites() {
  enemies
    .filter(e => e.hp > 0)
    .map(e => {
      const dx = e.x - player.x
      const dy = e.y - player.y
      return { e, dist: dx * dx + dy * dy }
    })
    .sort((a, b) => b.dist - a.dist)
    .forEach(({ e }) => drawBillboard(tex["monster" + (e.type + 1)], e.x, e.y, 1, "#a00"))
}

// ─── Отрисовка летящих яблок ─────────────────────────────────────────────────

function drawBullets() {
  bullets.forEach(b => drawBillboard(tex.apple, b.x, b.y, 0.08, "#e03010"))
}

// ─── Отрисовка яблок на полу ─────────────────────────────────────────────────
// Яблоки лежат на полу — рисуем их чуть ниже центра экрана

function drawItems() {
  items.forEach(item => {
    if (item.picked) return

    const dx   = item.x - player.x
    const dy   = item.y - player.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 0.2 || dist > 15) return

    let ang = Math.atan2(dy, dx) - player.angle
    ang = normalizeAngle(ang)
    if (Math.abs(ang) >= FOV / 2) return

    const size    = (canvas.height * 0.35) / dist
    const screenX = Math.floor((0.5 + ang / FOV) * canvas.width)
    const floorY  = Math.floor(canvas.height / 2 + canvas.height / (2 * dist))
    const top     = Math.floor(floorY - size / 2)
    const startX  = Math.floor(screenX - size / 2)
    const endX    = Math.floor(screenX + size / 2)

    if (item.type === "medkit") {
      // Аптечка — красный крест
      const col = Math.floor(screenX)
      if (col >= 0 && col < canvas.width && zBuffer[col] && dist >= zBuffer[col]) return
      const s = Math.max(6, size * 0.5)
      ctx.fillStyle = "#cc0000"
      ctx.fillRect(screenX - s/2, floorY - s*1.5, s, s*3)
      ctx.fillRect(screenX - s*1.5, floorY - s/2, s*3, s)
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(screenX - s*0.3, floorY - s*1.3, s*0.6, s*2.6)
      ctx.fillRect(screenX - s*1.3, floorY - s*0.3, s*2.6, s*0.6)
      return
    }

    const appleImg = tex.apple
    if (!appleImg.complete || appleImg.naturalWidth === 0) {
      ctx.fillStyle = "#e03010"
      ctx.beginPath()
      ctx.arc(screenX, floorY, Math.max(4, size / 2), 0, Math.PI * 2)
      ctx.fill()
      return
    }

    for (let sx = startX; sx < endX; sx++) {
      if (sx < 0 || sx >= canvas.width) continue
      if (zBuffer[sx] !== undefined && dist >= zBuffer[sx]) continue
      const tx = Math.floor(((sx - startX) / size) * appleImg.naturalWidth)
      ctx.drawImage(appleImg, tx, 0, 1, appleImg.naturalHeight, sx, top, 1, size)
    }
  })
}

// ─── Оружие с покачиванием ───────────────────────────────────────────────────

let bobPhase  = 0   // текущая фаза качания (радианы)
let bobAmount = 0   // текущая амплитуда (плавно нарастает/убывает)

// Отдача при выстреле
let recoil     = 0   // текущая сила отдачи (0..1)
let recoilVel  = 0   // скорость отдачи

function drawGun() {
  if (!tex.gun.complete || tex.gun.naturalWidth === 0) return

  // ── Боббинг при ходьбе ──────────────────────────────────────────────────
  const moving = Math.sqrt(velX * velX + velY * velY)
  if (moving > 0.003) {
    bobAmount += (1 - bobAmount) * 0.12
    bobPhase  += moving * 18
  } else {
    bobAmount *= 0.88
  }
  const offsetY = Math.sin(bobPhase)       * bobAmount * 28
  const offsetX = Math.sin(bobPhase * 0.5) * bobAmount * 10

  // ── Отдача при выстреле ─────────────────────────────────────────────────
  // Плавное затухание отдачи: пружина возвращает в исходное положение
  recoilVel += (0 - recoil) * 0.3    // пружина тянет к нулю
  recoilVel *= 0.65                  // демпфирование
  recoil    += recoilVel

  // Отдача двигает пушку вниз и увеличивает масштаб
  const recoilY     = recoil * 90
  const recoilScale = 1 + recoil * 0.12

  // ── Вспышка дула ────────────────────────────────────────────────────────
  if (recoil > 0.3) {
    const flashSize = recoil * 120
    const flashX    = canvas.width / 2
    const flashY    = canvas.height - 380 + offsetY + recoilY - flashSize * 0.3

    const grad = ctx.createRadialGradient(flashX, flashY, 0, flashX, flashY, flashSize)
    grad.addColorStop(0,   "rgba(255,230,100,0.95)")
    grad.addColorStop(0.3, "rgba(255,120,20,0.7)")
    grad.addColorStop(1,   "rgba(255,60,0,0)")

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(flashX, flashY, flashSize, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Рисуем пушку ────────────────────────────────────────────────────────
  const w  = 600 * recoilScale
  const h  = 380 * recoilScale
  const x  = canvas.width  / 2 - w / 2 + offsetX
  const y  = canvas.height - 380 + offsetY + recoilY

  ctx.drawImage(tex.gun, x, y, w, h)
}

// Вызывается при каждом выстреле — запускает анимацию отдачи
function triggerRecoil() {
  recoilVel = 0.9   // резкий толчок вниз
}

// ─── HTML HUD ────────────────────────────────────────────────────────────────

// Три состояния лица в зависимости от HP
const FACE_HEALTHY = "assets/ui/chico_face.png"       // 100–60 HP
const FACE_HURT    = "assets/ui/chico_face_hurt.png"  // 60–25 HP
const FACE_DYING   = "assets/ui/chico_face_dying.png" // 25–0 HP

let currentFaceState = "healthy"  // следим чтобы не менять src каждый кадр
let blinkTimer = 0                // мигание красным при уроне (кадры)
let blinkOn    = false            // текущее состояние мигания

function updateHUD() {
  if (elHP)         elHP.textContent         = Math.ceil(player.hp)
  if (elAmmo)       elAmmo.textContent       = player.ammo
  if (elEnemyCount) elEnemyCount.textContent = enemies.filter(e => e.hp > 0).length
  if (elKills)      elKills.textContent      = player.kills

  // ── Смена картинки лица по HP ──────────────────────────────────────────────
  if (elFace) {
    let targetState
    if (player.hp > 60)      targetState = "healthy"
    else if (player.hp > 25) targetState = "hurt"
    else                     targetState = "dying"

    if (targetState !== currentFaceState) {
      currentFaceState = targetState
      if (targetState === "healthy") elFace.src = FACE_HEALTHY
      if (targetState === "hurt")    elFace.src = FACE_HURT
      if (targetState === "dying")   elFace.src = FACE_DYING
    }
  }

  // ── Мигание красным при получении урона ───────────────────────────────────
  if (player.hp < lastHP) {
    blinkTimer = 20           // мигаем 20 кадров (~333ms)
    hurtTimer  = 8
    playSound(snd.hurt, 0.9)
  }
  lastHP = player.hp

  // Красный флэш на экране
  // Подсказка портала
  if (portal && currentLevel === 1) {
    ctx.save()
    ctx.font = "bold 18px 'Share Tech Mono', monospace"
    ctx.fillStyle = `rgba(100,180,255,${0.6 + 0.4 * Math.sin(Date.now()/400)})`
    ctx.textAlign = "center"
    ctx.fillText("★ ПОРТАЛ ОТКРЫТ — НАЙДИ ЕГО НА КАРТЕ ★", canvas.width / 2, 60)
    ctx.textAlign = "left"
    ctx.restore()
  }

  // Подсказка уровня 2
  if (currentLevel === 2 && boss && boss.hp > 0) {
    ctx.save()
    ctx.font = "bold 18px 'Share Tech Mono', monospace"
    ctx.fillStyle = `rgba(255,80,80,${0.6 + 0.4 * Math.sin(Date.now()/300)})`
    ctx.textAlign = "center"
    ctx.fillText("⚠ УБЕЙ БОССА ⚠", canvas.width / 2, 60)
    ctx.textAlign = "left"
    ctx.restore()
  }

  if (hurtTimer > 0) {
    hurtTimer--
    if (elFlash) elFlash.classList.add("active")
  } else {
    if (elFlash) elFlash.classList.remove("active")
  }

  // Мигание рамки лица
  if (blinkTimer > 0) {
    blinkTimer--
    blinkOn = !blinkOn
    if (elFace) {
      elFace.style.filter = blinkOn
        ? "brightness(1) sepia(1) saturate(6) hue-rotate(-20deg)"  // красный
        : "none"
    }
  } else {
    blinkOn = false
    if (elFace) elFace.style.filter = "none"
  }
}

// ─── Миникарта ───────────────────────────────────────────────────────────────

function drawMinimap() {
  const s = 180 / MAP

  mctx.fillStyle = "rgba(0,0,0,0.8)"
  mctx.fillRect(0, 0, 180, 180)

  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++)
      if (map[y][x]) {
        mctx.fillStyle = "#7a5a30"
        mctx.fillRect(x * s, y * s, s, s)
      }

  // Предметы
  items.forEach(item => {
    if (item.picked) return
    if (item.type === "medkit") {
      mctx.fillStyle = "#ff4444"
    } else {
      mctx.fillStyle = "#0a0"
    }
    mctx.fillRect(item.x * s - 1.5, item.y * s - 1.5, 3, 3)
  })

  // Враги
  enemies.forEach(e => {
    if (e.hp <= 0) return
    mctx.fillStyle = "#f00"
    mctx.fillRect(e.x * s - 1.5, e.y * s - 1.5, 3, 3)
  })

  // Пули
  bullets.forEach(b => {
    mctx.fillStyle = "#fa0"
    mctx.fillRect(b.x * s - 1, b.y * s - 1, 2, 2)
  })

  // Портал — синий маркер
  if (portal) {
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300)
    mctx.fillStyle = `rgba(0,120,255,${pulse})`
    mctx.beginPath()
    mctx.arc(portal.x * s, portal.y * s, 5, 0, Math.PI * 2)
    mctx.fill()
    mctx.strokeStyle = "#88aaff"
    mctx.lineWidth = 1.5
    mctx.stroke()
  }

  // Босс — фиолетовый маркер
  if (boss && boss.hp > 0) {
    mctx.fillStyle = "#cc00ff"
    mctx.beginPath()
    mctx.arc(boss.x * s, boss.y * s, 5, 0, Math.PI * 2)
    mctx.fill()
  }

  // Игрок
  mctx.fillStyle = "#0f0"
  mctx.beginPath()
  mctx.arc(player.x * s, player.y * s, 3, 0, Math.PI * 2)
  mctx.fill()

  mctx.strokeStyle = "#0f0"
  mctx.lineWidth   = 1
  mctx.beginPath()
  mctx.moveTo(player.x * s, player.y * s)
  mctx.lineTo(
    (player.x + Math.cos(player.angle) * 2) * s,
    (player.y + Math.sin(player.angle) * 2) * s
  )
  mctx.stroke()
}

// ─── Смерть ──────────────────────────────────────────────────────────────────

function drawDead() {
  ctx.fillStyle = "rgba(180,0,0,0.65)"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.textAlign   = "center"
  ctx.shadowColor = "#900"
  ctx.shadowBlur  = 20
  ctx.font      = "bold 80px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#fff"
  ctx.fillText("ВЫ МЕРТВЫ", canvas.width / 2, canvas.height / 2 - 30)
  ctx.font      = "22px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#ffa040"
  ctx.fillText(`Убито врагов: ${player.kills}`, canvas.width / 2, canvas.height / 2 + 30)
  ctx.font      = "18px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#aaa"
  ctx.fillText("F5 — перезапуск | ESC — меню", canvas.width / 2, canvas.height / 2 + 70)
  ctx.restore()
}

// ─── Победа ──────────────────────────────────────────────────────────────────

function drawVictory() {
  // Золотой фон
  ctx.fillStyle = "rgba(20,10,0,0.85)"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.textAlign   = "center"

  // Вспышка
  const t = Date.now() / 1000
  const pulse = 0.8 + 0.2 * Math.sin(t * 3)

  ctx.shadowColor = "#ffa000"
  ctx.shadowBlur  = 60 * pulse

  ctx.font      = `bold ${Math.floor(90 * pulse)}px 'Share Tech Mono', monospace`
  ctx.fillStyle = "#ffd700"
  ctx.fillText("ПОБЕДА!", canvas.width / 2, canvas.height / 2 - 60)

  ctx.shadowBlur = 10
  ctx.font      = "28px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#ff8800"
  ctx.fillText("TOYSBERRY BOOM — ПРОЙДЕНО!", canvas.width / 2, canvas.height / 2 + 10)

  ctx.font      = "22px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#ffcc44"
  ctx.fillText(`Убито врагов: ${player.kills}`, canvas.width / 2, canvas.height / 2 + 55)

  ctx.font      = "18px 'Share Tech Mono', monospace"
  ctx.fillStyle = "#aaa"
  ctx.fillText("ESC — вернуться в меню", canvas.width / 2, canvas.height / 2 + 100)

  ctx.restore()
}

// ─── Цикл ────────────────────────────────────────────────────────────────────

const TARGET_FPS  = 30
const FRAME_TIME  = 1000 / TARGET_FPS
let   lastFrameAt = 0

function loop(now) {
  requestAnimationFrame(loop)

  if (now - lastFrameAt < FRAME_TIME) return
  lastFrameAt = now

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  move()
  updateEnemies()
  updateBullets()
  if (currentLevel === 2) { updateBoss(); checkBossHit() }

  drawWorld()
  drawItems()
  drawPortal()
  drawSprites()
  if (currentLevel === 2) drawBoss()
  drawExplosions()
  drawBullets()
  drawGun()
  updateHUD()
  drawMinimap()

  if (player.dead) {
    if (player._victory) drawVictory()
    else drawDead()
  }
}

requestAnimationFrame(loop)
