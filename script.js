// ============ 音频与播放器管理 ============

// 获取音频元素
const audio = document.getElementById('audio');
// iOS/移动端内联播放更稳
audio.playsInline = true;
audio.preload = 'auto';

// 获取专辑元素
const albumElements = [...document.querySelectorAll('.album')];

// 去重函数：根据ID去重专辑元素
function uniqueById(nodeList) {
  const map = new Map();
  nodeList.forEach(el => {
    const id = Number(el.dataset.id);
    if (!map.has(id)) map.set(id, el);
  });
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([_, el]) => el);
}

let albumAll = [...document.querySelectorAll('.album')];
let albumUnique = uniqueById(albumAll);
const playlist = albumUnique.map(el => el.dataset.audio);
let currentId = 0;

if (playlist[0]) audio.src = playlist[0];

// 统一的"想要播放"的标志
let pendingPlay = false;

// 安全播放封装：用户手势场景优先同步触发 play()
async function safePlay(isUserGesture = false) {
  try {
    if (isUserGesture) {
      // 先发起播放，保持在手势调用栈中
      const p = audio.play();
      // 同时尽快恢复 AC，但不阻塞手势
      try {
        if (window.AC && window.AC.state !== 'running') window.AC.resume();
      } catch (e) {}
      await p;
      pendingPlay = false;
    } else {
      // 非手势：先尝试恢复 AC，再播放
      try {
        if (window.AC && window.AC.state !== 'running') await window.AC.resume();
      } catch (e) {}
      await audio.play();
      pendingPlay = false;
    }
  } catch (err) {
    pendingPlay = true; // 需要用户手势时，挂起等待
  }
}

// 捕获任何用户手势：若有挂起播放，则立即播放
['pointerdown', 'keydown', 'touchstart', 'click'].forEach(evt => {
  document.addEventListener(evt, async () => {
    if (pendingPlay) await safePlay(true);
  }, { passive: true });
});

// 设置当前播放专辑的高亮状态
function setActiveAlbum(id) {
  albumAll = [...document.querySelectorAll('.album')];
  albumAll.forEach(el => el.classList.toggle('is-playing', Number(el.dataset.id) === id));
}

// 获取轨道标题元素
const trackTitleEl = document.getElementById('trackTitle');

// 从音频源获取文件名（不含扩展名）
function getBaseNameFromSrc(src) {
  try {
    const url = src.startsWith('http') ? new URL(src) : new URL(src, location.href);
    const file = decodeURIComponent((url.pathname.split('/').pop() || '').trim());
    return file.replace(/\.[^/.]+$/, '');
  } catch (e) {
    const file = decodeURIComponent((src.split('/').pop() || '').trim());
    return file.replace(/\.[^/.]+$/, '');
  }
}

// 更新轨道标题显示
function updateTrackTitle() {
  if (!trackTitleEl) return;
  const name = getBaseNameFromSrc(audio.currentSrc || audio.src || '');
  trackTitleEl.textContent = name || '';
}

// 根据ID播放指定曲目
function playById(id) {
  currentId = id;
  const src = playlist[id];
  if (!src) return;
  audio.src = src;
  audio.load();
  pendingPlay = true;
  safePlay(true);
  setActiveAlbum(id);
  updateTrackTitle();
}

// ============ 播放器控制 ============

// 获取播放器控制元素
const btnToggle = document.getElementById('btnToggle');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const seek = document.getElementById('seek');
const cur = document.getElementById('cur');
const dur = document.getElementById('dur');

// ==== 圆圈播放器 DOM ====
const circle = document.getElementById('circlePlayer');
const cpPlay = document.getElementById('cpPlay');
const cpPause= document.getElementById('cpPause');

// 设置播放/暂停图标状态
function setPlaying(on) {
  iconPlay.style.display = on ? 'none' : '';
  iconPause.style.display = on ? '' : 'none';
}

// HOME播放器切换按钮事件
btnToggle.onclick = async () => {
  if (audio.paused) {
    // 若首次进入还未就绪，确保先加载到可播放再在手势中触发播放
    if (!audio.currentSrc) {
      const src = playlist[currentId] || playlist[0];
      if (src) {
        audio.src = src;
        audio.load();
      }
    }
    if (audio.readyState < 2) {
      await new Promise(res => audio.addEventListener('loadeddata', res, { once: true }));
    }
    pendingPlay = true;
    safePlay(true);
  } else {
    audio.pause();
  }
};



// 音频播放状态事件监听
audio.addEventListener('play', () => {
  setPlaying(true);
  setActiveAlbum(currentId);
});

audio.addEventListener('pause', () => setPlaying(false));

// 一首歌播放完自动播放下一首
audio.addEventListener('ended', () => {
  currentId = (currentId + 1) % playlist.length;
  playById(currentId);
});

// ============ 进度条控制 ============

// 格式化时间显示
function fmt(t) {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// 更新播放器UI
function updateUI() {
  const p = (audio.currentTime / (audio.duration || 1));
  seek.value = Math.round(p * 1000);
  seek.style.setProperty('--p', (p * 100) + '%');
  cur.textContent = fmt(audio.currentTime);
  dur.textContent = fmt(audio.duration);
}

// 音频事件监听
['timeupdate', 'loadedmetadata', 'durationchange'].forEach(evt => audio.addEventListener(evt, updateUI));
['loadedmetadata', 'emptied', 'play', 'durationchange'].forEach(evt => audio.addEventListener(evt, updateTrackTitle));

// 进度条拖动事件
seek.addEventListener('input', () => seek.style.setProperty('--p', (seek.value / 10) + '%'));
seek.addEventListener('change', () => audio.currentTime = (audio.duration || 0) * (seek.value / 1000));

// ============ 频谱可视化 ============

// 初始化频谱显示
const viz = document.getElementById('viz');
const BAR_COUNT = 48;

// 创建频谱条
for (let i = 0; i < BAR_COUNT; i++) {
  const d = document.createElement('div');
  d.className = 'bar';
  viz.appendChild(d);
}

const bars = [...document.querySelectorAll('.bar')];

// 创建音频上下文
window.AC = window.AC || new (window.AudioContext || window.webkitAudioContext)();
const track = window.AC.createMediaElementSource(audio);
const analyser = window.AC.createAnalyser();
analyser.fftSize = 1024;
track.connect(analyser);
analyser.connect(window.AC.destination);

const data = new Uint8Array(analyser.frequencyBinCount);

// 频谱动画循环
function loop() {
  analyser.getByteFrequencyData(data);
  for (let i = 0; i < BAR_COUNT; i++) {
    const ix = Math.floor((i + 1) * data.length / BAR_COUNT) - 1;
    const v = data[ix] || 0;
    const h = 6 + (v / 255) * 48;
    bars[i].style.height = h + 'px';
    bars[i].style.opacity = 0.55 + (v / 255) * 0.45;
  }
  requestAnimationFrame(loop);
}

loop();

// ============ 导航和滚动控制 ============

// 获取导航元素
const homeBottom = document.querySelector('.home-bottom');
const navSticky = document.getElementById('navSticky');
const navInline = document.getElementById('navInline');
let activeLockHash = null; // 点击导航时锁定高亮，避免滚动中闪烁

// 统一管理浮动导航和浮动进度条的显示/隐藏
function updateFloatingElements() {
  // 获取当前可见的区块
  const homeSection = document.getElementById('home');
  const jinbutsuSection = document.getElementById('jinbutsu');
  const albumsSection = document.getElementById('albums');
  const samuraiSection = document.getElementById('samurai');
  const liveSection = document.getElementById('live');
  
  // 检查各个区块的可见性
  const homeVisible = homeSection && homeSection.getBoundingClientRect().top < window.innerHeight && homeSection.getBoundingClientRect().bottom > 0;
  const jinbutsuVisible = jinbutsuSection && jinbutsuSection.getBoundingClientRect().top < window.innerHeight && jinbutsuSection.getBoundingClientRect().bottom > 0;
  const albumsVisible = albumsSection && albumsSection.getBoundingClientRect().top < window.innerHeight && albumsSection.getBoundingClientRect().bottom > 0;
  const samuraiVisible = samuraiSection && samuraiSection.getBoundingClientRect().top < window.innerHeight && samuraiSection.getBoundingClientRect().bottom > 0;
  const liveVisible = liveSection && liveSection.getBoundingClientRect().top < window.innerHeight && liveSection.getBoundingClientRect().bottom > 0;
  
  // 检查页尾是否可见
  const siteFooter = document.getElementById('siteFooter');
  const footerVisible = siteFooter && siteFooter.getBoundingClientRect().top < window.innerHeight;
  
  // 根据区块可见性和页尾可见性决定显示状态
  let showNav = false;
  let showFab = false;
  
  if (homeVisible) {
    // home页面：浮动导航和浮动进度条都隐藏
    showNav = false;
    showFab = false;
  } else if (footerVisible) {
    // 页尾可见时：只显示导航，隐藏进度条
    showNav = true;
    showFab = false;
  } else if (jinbutsuVisible || albumsVisible) {
    // 人物和アルバム页面：两者都显示
    showNav = true;
    showFab = true;
  } else if (samuraiVisible || liveVisible) {
    // サムライ チャンプルー和ライブ页面：显示导航，隐藏进度条
    showNav = true;
    showFab = false;
  } else {
    // 其他情况：默认显示导航，隐藏进度条
    showNav = true;
    showFab = false;
  }
  
  // 应用显示状态
  navSticky.classList.toggle('show', showNav);
  circle.classList.toggle('show', showFab);
}

// 粘性导航 & 底部播放器：当 home 内的导航看不见时显示
const io = new IntersectionObserver(([e]) => {
  const out = !e.isIntersecting;
  // 当home导航不可见时，调用统一更新函数
  if (out) {
    updateFloatingElements();
  } else {
    // home导航可见时，隐藏所有浮动元素
    navSticky.classList.remove('show');
    circle.classList.remove('show');
  }
}, { rootMargin: '0px 0px 0px 0px' }); // 当导航完全离开视口时触发

io.observe(homeBottom);

// ============ 当前区块高亮 ============

// 定义所有区块
const sections = [
  document.getElementById('home'),
  document.getElementById('jinbutsu'),
  document.getElementById('albums'),
  document.getElementById('samurai'),
  document.getElementById('live')
];

// 设置导航高亮状态
function setActiveNav(hash) {
  const links = [
    ...(navInline ? navInline.querySelectorAll('a') : []),
    ...(navSticky ? navSticky.querySelectorAll('a') : [])
  ];
  links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === hash));
}

// 区块可见性观察器
const secObserver = new IntersectionObserver(() => {
  if (activeLockHash) return; // 滚动期间锁定，忽略自动高亮
  
  // 更新浮动元素的显示状态
  updateFloatingElements();
  
  // 在所有区块中，选择"可见比例足够"的、中心点最接近视口中线者
  const mid = window.innerHeight / 2;
  let best = null;
  let bestDist = Infinity;
  for (const s of sections) {
    if (!s) continue;
    const rect = s.getBoundingClientRect();
    const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    const denom = Math.max(1, Math.min(rect.height, window.innerHeight));
    const visibleRatio = Math.max(0, visibleH) / denom; // 0~1
    if (visibleRatio < 0.25) continue; // 可见不足 25% 时不参与高亮竞争，避免"过早高亮"
    const center = rect.top + rect.height / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  if (best && best.id) {
    setActiveNav('#' + best.id);
  }
}, { threshold: [0, 0.25, 0.5, 0.75, 1] });

sections.forEach(s => s && secObserver.observe(s));

// ============ 滚动控制 ============

// 读取 CSS 变量（px）
function readCssVarPx(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// 获取区块偏移量
function offsetForHash(hash) {
  if (hash === '#home') return 0;
  return readCssVarPx('--section-offset');
}

// 平滑滚动到指定位置
function smoothScrollToY(targetY, timeoutMs = 2000) {
  return new Promise(resolve => {
    const start = performance.now();
    function tick() {
      const now = performance.now();
      const t = now - start;
      const cur = window.scrollY || window.pageYOffset;
      const done = Math.abs(cur - targetY) < 2 || t > timeoutMs;
      if (done) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    requestAnimationFrame(tick);
  });
}

// 点击导航时立即高亮目标，提升反馈
function bindImmediateActive(nav) {
  if (!nav) return;
  nav.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const hash = a.getAttribute('href');
    const target = document.querySelector(hash);
    if (!target) return; // 让默认行为处理
    e.preventDefault();
    // 锁定高亮，避免途中路过其它区块闪动
    activeLockHash = hash;
    setActiveNav(hash);
    const rect = target.getBoundingClientRect();
    const curY = window.scrollY || window.pageYOffset;
    const y = curY + rect.top - offsetForHash(hash);
    await smoothScrollToY(y);
    // 到达后解除锁定，确保仍然显示目标区块高亮
    activeLockHash = null;
    setActiveNav(hash);
    // 同步 URL（不额外跳动）
    if (history.pushState) {
      history.pushState(null, '', hash);
    } else {
      location.hash = hash;
    }
  });
}

bindImmediateActive(navInline);
bindImmediateActive(navSticky);

// ============ 专辑轨道滚动 ============

// 专辑轨道：匀速左移 + 无缝循环 + 拖拽惯性 + 悬停暂停
function initAlbumMarquee() {
  const viewport = document.getElementById('homeAlbums');
  let track = viewport.querySelector('.albums-track');
  if (!track) {
    track = document.createElement('div');
    track.className = 'albums-track';
    while (viewport.firstChild) track.appendChild(viewport.firstChild);
    viewport.appendChild(track);
  }

  const originals = Array.from(track.children);
  
  function cloneOnce() {
    originals.forEach(n => track.appendChild(n.cloneNode(true)));
  }
  cloneOnce();

  let offset = 0;              // translateX 偏移（px）
  let baseSpeed = 40;          // 匀速（px/s）可调
  let vx = 0;                  // 惯性速度（px/s）
  let raf = 0;
  let lastT = 0;
  let pausedHover = false;
  let isDragging = false;
  let dragStartX = 0;
  let startOffset = 0;
  let lastX = 0;
  let lastTime = 0;
  let dragDist = 0;
  let preventClickUntil = 0;

  // 悬停暂停
  track.addEventListener('mouseover', e => {
    if (e.target.closest('.album')) pausedHover = true;
  });
  track.addEventListener('mouseout', e => {
    if (!track.contains(e.relatedTarget)) pausedHover = false;
  });

  // 拖拽开始
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; // 仅左键
    isDragging = true;
    pausedHover = true;
    dragStartX = lastX = e.clientX;
    startOffset = offset;
    lastTime = performance.now();
    dragDist = 0;
    viewport.setPointerCapture(e.pointerId);
  });

  // 拖拽移动
  viewport.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const now = performance.now();
    const dx = e.clientX - dragStartX;
    offset = startOffset + dx;
    wrap();
    const instDX = e.clientX - lastX;
    const dt = Math.max(1, now - lastTime);
    vx = (instDX / dt) * 1000;
    lastX = e.clientX;
    lastTime = now;
    dragDist += Math.abs(instDX);
  });

  // 拖拽结束
  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    pausedHover = false;
    const CLAMP = 1500;
    vx = Math.max(-CLAMP, Math.min(CLAMP, vx));
    if (dragDist > 5) {
      preventClickUntil = performance.now() + 250;
      window.__albumsPreventClickUntil = preventClickUntil;
    }
  }

  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('pointerleave', endDrag);

  // 防止拖拽时触发点击
  track.addEventListener('click', e => {
    if (window.__albumsPreventClickUntil && performance.now() < window.__albumsPreventClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // 动画帧
  function frame(t) {
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    const autoRun = !pausedHover && !isDragging;
    if (autoRun) {
      offset -= baseSpeed * dt;
    }
    if (Math.abs(vx) > 1) {
      offset += vx * dt;
      const decay = Math.pow(0.94, dt * 60);
      vx *= decay;
    } else {
      vx = 0;
    }
    wrap();
    track.style.transform = `translateX(${offset}px)`;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // 无缝循环包装
  function wrap() {
    const w = originals.reduce((s, n) => s + (n.offsetWidth + gapPx()), 0);
    while (offset <= -w) offset += w;
    while (offset > 0) offset -= w;
  }

  function gapPx() {
    const cs = getComputedStyle(track);
    const g = parseFloat(cs.columnGap || cs.gap || '0');
    return isNaN(g) ? 0 : g;
  }

  // 点击切歌（保持原逻辑）
  track.addEventListener('click', e => {
    if (dragDist > 5) return;
    const item = e.target.closest('.album');
    if (!item) return;
    const src = item.dataset.audio;
    if (src && typeof setSrcAndPlay === 'function') {
      setSrcAndPlay(src);
    }
  });
}

// 设置音频源并播放
function setSrcAndPlay(src) {
  if (!src) return;
  audio.src = src;
  audio.load();
  pendingPlay = true;
  safePlay(true);
}

// 初始化专辑滚动
initAlbumMarquee();

// 屏蔽原生拖影，不破坏 click 触发链
document.querySelectorAll('.album img').forEach(img => {
  img.setAttribute('draggable', 'false');
});

document.getElementById('homeAlbums').addEventListener('dragstart', e => {
  if (e.target.closest('.album img')) e.preventDefault();
});

// ============ 悬浮播放/暂停按钮 ============

(function attachHoverControls() {
  const trackEl = document.querySelector('.albums-track') || document.getElementById('homeAlbums');
  let albums = [...trackEl.querySelectorAll('.album')];
  
  for (const el of albums) {
    if (el.querySelector('.hover-ctrl')) continue;
    const btn = document.createElement('button');
    btn.className = 'hover-ctrl';
    btn.innerHTML = `<img alt="" />`;
    el.appendChild(btn);

    el.addEventListener('mouseenter', () => syncCtrlIcon(el));
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      if (!Number.isFinite(id)) return;
      if (id === currentId) {
        if (audio.paused) {
          pendingPlay = true;
          safePlay(true);
        } else {
          audio.pause();
        }
      } else {
        playById(id);
      }
      syncCtrlIcon(el);
    });
  }

  // 获取图标路径
  function iconFor(el) {
    const id = Number(el.dataset.id);
    const isCurrent = (id === currentId);
    if (isCurrent) return audio.paused ? 'img/bofang.svg' : 'img/zanting.svg';
    return 'img/bofang.svg';
  }

  // 同步控制图标
  function syncCtrlIcon(el) {
    const img = el.querySelector('.hover-ctrl img');
    if (!img) return;
    img.src = iconFor(el);
  }

  // 刷新当前悬停图标
  function refreshCurrentHoverIcon() {
    const list = trackEl.querySelectorAll(`.album[data-id="${currentId}"] .hover-ctrl img`);
    const src = (audio.paused ? 'img/bofang.svg' : 'img/zanting.svg');
    list.forEach(img => img.src = src);
  }

  audio.addEventListener('play', refreshCurrentHoverIcon);
  audio.addEventListener('pause', refreshCurrentHoverIcon);

  const _origPlayById = playById;
  window.playById = function(id) {
    _origPlayById(id);
    refreshCurrentHoverIcon();
  };
})();

// ============ 初始化 ============

// 默认首曲仅加载与选中，不自动播放
function initFirstTrackPaused() {
  if (!playlist || !playlist[0]) return;
  audio.src = playlist[0];
  audio.load();
  // 保持暂停：不设置 pendingPlay、不调用 safePlay
  setActiveAlbum(0);
  updateTrackTitle();
}

// 提前到脚本就绪阶段
initFirstTrackPaused();

// ============ サムライ チャンプルー 部分功能 ===============

// ---------- 工具：读当前旋转角（deg） ----------
function getRotationDeg(el){
  const t = getComputedStyle(el).transform;
  if (t === 'none') return 0;
  const m = new DOMMatrix(t);
  return Math.atan2(m.b, m.a) * 180 / Math.PI; // -180..180
}

// ---------- SFX：按下即响（独立于主播放器） ----------
const SFX = ['music/dj01.mp3','music/dj02.mp3','music/dj03.mp3'];
function playRandomSfx(){
  try{
    sfxAudio.src = SFX[Math.floor(Math.random()*SFX.length)];
    sfxAudio.currentTime = 0;
    sfxAudio.volume = 0.7;
    sfxAudio.play().catch(()=>{});
  }catch{}
}

// ---------- 点击合并 + 单段缓动补间 ----------
(function initRecordClickSpin(){
  const img = document.getElementById('record');
  if(!img) return;

  // 防止浏览器原生拖拽
  img.setAttribute('draggable', 'false');
  img.addEventListener('dragstart', e => e.preventDefault());

  const BASE_PER_TURN = 1100;                   // 一圈时长（ms），可调
  const EASE = 'cubic-bezier(.22,1,.36,1)';     // ease-out（也可换 ease-in-out）
  let batch = 0;                                // 本次合并内的点击次数
  let timer = null;
  let anim  = null;

  // 只用 pointerdown，避免一次点击触发两次（pointerdown + mousedown）
  img.addEventListener('pointerdown', ()=>{
    playRandomSfx();         // ★ 按下即响
    batch++;                 // 记录一次点击
    clearTimeout(timer);
    // 140ms 内的快速连续点击合并为一次动画
    timer = setTimeout(flushBatch, 140);
  });

  function flushBatch(){
    if (!batch) return;
    const turns = batch;     // 合并得到的圈数
    batch = 0;

    // 从"当前角度"开始，做整段 turns 圈的动画（只在开头/结尾缓动）
    const start = getRotationDeg(img);          // 动画中也能读取当前值
    const end   = start + 360 * turns;          // 目标角度

    // 如有正在运行的动画，先取消，避免叠加
    if (anim) try { anim.cancel(); } catch {}

    anim = img.animate(
      [
        { transform: `rotate(${start}deg)` },
        { transform: `rotate(${end}deg)` }
      ],
      { duration: BASE_PER_TURN * turns, easing: EASE, fill: 'forwards' }
    );
    anim.finished.catch(()=>{}); // 忽略中断错误
  }
})();

// 独立 SFX，不打断主音乐
const sfxAudio = document.getElementById('sfxAudio');
const sfxList  = ['music/dj01.mp3','music/dj02.mp3','music/dj03.mp3'];

function playRandomSfx(){
  if(!sfxAudio) return;
  const randomIndex = Math.floor(Math.random() * sfxList.length);
  const src = sfxList[randomIndex];
  console.log('播放随机音效:', src); // 调试用
  sfxAudio.src = src;
  sfxAudio.volume = 0.6;   // 自行调节
  sfxAudio.currentTime = 0;
  sfxAudio.play().catch((err)=>{
    console.log('音效播放失败:', err);
  });
}

// =============== 2) 小播放器（与主播放器/视频互斥） ===============
function initLocalPlayers(){
  console.log('开始初始化小播放器...');
  const cards = document.querySelectorAll('.local-player');
  const videos = document.querySelectorAll('.samurai-video');
  console.log('找到小播放器数量:', cards.length);
  console.log('找到视频数量:', videos.length);

  // 工具函数
  const fmt = t => !isFinite(t)? '0:00' : `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  
  // 暂停所有其他播放器
  function pauseOthers(currentAudio) {
    // 暂停主播放器
    if (audio && !audio.paused) audio.pause();
    // 暂停所有视频
    videos.forEach(v => v.pause());
    // 暂停其他小播放器
    cards.forEach(card => {
      const otherAudio = card._audio;
      if (otherAudio && otherAudio !== currentAudio && !otherAudio.paused) {
        otherAudio.pause();
        const btn = card.querySelector('.lp-toggle');
        if (btn) btn.textContent = '▶︎';
      }
    });
  }

  // 初始化每个小播放器
  cards.forEach(card => {
    const src = card.dataset.src;
    const btn = card.querySelector('.lp-toggle');
    const bar = card.querySelector('.lp-seek');
    const cur = card.querySelector('.lp-cur');
    const dur = card.querySelector('.lp-dur');

    console.log('初始化小播放器:', src);

    // 创建音频对象
    const a = new Audio();
    a.src = src;
    a.preload = 'metadata';
    card._audio = a; // 保存引用

    // 播放/暂停按钮
    btn.addEventListener('click', () => {
      console.log('点击播放按钮:', src);
      if (a.paused) {
        pauseOthers(a);
        a.play().then(() => {
          btn.textContent = '❚❚';
          console.log('播放成功:', src);
        }).catch(err => {
          console.log('播放失败:', err);
        });
      } else {
        a.pause();
        btn.textContent = '▶︎';
      }
    });

    // 进度条
    bar.addEventListener('input', () => {
      const percent = bar.value / 1000;
      bar.style.setProperty('--p', (percent * 100) + '%');
    });

    bar.addEventListener('change', () => {
      a.currentTime = a.duration * (bar.value / 1000);
    });

    // 更新UI
    function updateUI() {
      if (a.duration) {
        const percent = a.currentTime / a.duration;
        bar.value = Math.round(percent * 1000);
        bar.style.setProperty('--p', (percent * 100) + '%');
        cur.textContent = fmt(a.currentTime);
        dur.textContent = fmt(a.duration);
      }
    }

    // 监听音频事件
    a.addEventListener('timeupdate', updateUI);
    a.addEventListener('loadedmetadata', updateUI);
    a.addEventListener('play', () => {
      btn.textContent = '❚❚';
      pauseOthers(a);
    });
    a.addEventListener('pause', () => {
      btn.textContent = '▶︎';
    });
  });

  // 主播放器播放时暂停其他所有
  if (audio) {
    audio.addEventListener('play', () => {
      cards.forEach(card => {
        const a = card._audio;
        if (a && !a.paused) {
          a.pause();
          const btn = card.querySelector('.lp-toggle');
          if (btn) btn.textContent = '▶︎';
        }
      });
      videos.forEach(v => v.pause());
    });
  }

  // 视频播放时暂停其他所有
  videos.forEach(v => {
    v.addEventListener('play', () => {
      if (audio && !audio.paused) audio.pause();
      cards.forEach(card => {
        const a = card._audio;
        if (a && !a.paused) {
          a.pause();
          const btn = card.querySelector('.lp-toggle');
          if (btn) btn.textContent = '▶︎';
        }
      });
    });
  });
}

// ------- 返回顶部 -------
document.getElementById('siteFooter')?.addEventListener('click', ()=>{
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ------- YouTube Iframe API （直播区播放器）-------
(function initLiveYoutube(){
  const BOX_ID = 'ytLive';
  if(!document.getElementById(BOX_ID)) return;

  // 动态加载 API
  function loadYT(cb){
    if (window.YT && window.YT.Player) return cb();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = cb;
  }

  loadYT(()=>{
    // 创建播放器（videoId 从原链接提取）
    window.livePlayer = new YT.Player(BOX_ID, {
      videoId: 'FGOEMvymSIE',
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        // 允许 JS 控制
        enablejsapi: 1,
        origin: location.origin
      },
      events: {
        onStateChange: (e)=>{
          // 播放视频 => 停主播放器 & 停所有小播放器 & 停页面内 <video>
          if (e.data === YT.PlayerState.PLAYING) {
            try{ audio.pause(); }catch{}
            // 暂停所有小播放器（通过local-player容器找到音频）
            document.querySelectorAll('.local-player').forEach(card => {
              if (card._audio && !card._audio.paused) {
                card._audio.pause();
                const btn = card.querySelector('.lp-toggle');
                if (btn) btn.textContent = '▶︎';
              }
            });
            document.querySelectorAll('.samurai-video').forEach(v=>v.pause());
          }
        }
      }
    });
  });

  // 主播放器播放 => 暂停 YouTube
  audio?.addEventListener('play', ()=>{
    try{ window.livePlayer?.pauseVideo(); }catch{}
  });

  // 任意小播放器播放 => 暂停 YouTube（用捕获阶段监听）
  document.addEventListener('play', (ev)=>{
    if (ev.target?.closest('.local-player')) {
      try{ window.livePlayer?.pauseVideo(); }catch{}
    }
  }, true);
})();



// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM加载完成，初始化小播放器...');
  initLocalPlayers();
  
  // 添加导航点击事件监听，确保直接跳转时也能正确显示浮动元素
  const allNavLinks = document.querySelectorAll('nav a[href^="#"]');
  allNavLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href').substring(1);
      const targetSection = document.getElementById(targetId);
      
      if (targetSection) {
        // 平滑滚动到目标区块
        targetSection.scrollIntoView({ behavior: 'smooth' });
        
        // 延迟更新浮动元素状态，等待滚动完成
        setTimeout(() => {
          updateFloatingElements();
        }, 100);
      }
    });
  });
});

// ------- 圆圈播放器逻辑 -------
// 点击：切换播放/暂停
circle?.addEventListener('click', ()=>{
  if (audio.paused) { 
    (window.safePlay ? safePlay() : audio.play()).catch?.(()=>{}); 
  } else { 
    audio.pause(); 
  }
});

// 切图标
function setCircleIcon(){
  if (!circle) return;
  const on = !audio.paused;
  cpPlay.style.display  = on ? 'none' : '';
  cpPause.style.display = on ? ''    : 'none';
}
audio.addEventListener('play',  setCircleIcon);
audio.addEventListener('pause', setCircleIcon);

// 初始同步一次
setCircleIcon();


