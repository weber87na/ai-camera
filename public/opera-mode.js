import { startOperaPetals } from './opera-petals.js?v=1';

// Text and role IDs come from /api/config; these portraits are local style references.
const roleIds = ['sheng', 'dan', 'jing', 'chou'];
const portraitVersion = '2';
const imageUrl = role => `images/opera-${role.id}-portrait.png?v=${portraitVersion}`;

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function setDirectText(selector, text) {
  const element = document.querySelector(selector);
  const node = element && [...element.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
  if (node) node.textContent = text;
}

function decorativeProp(name, className) {
  return `<img class="opera-prop ${className}" src="images/opera-${name}.png?v=1" width="1254" height="1254" alt="" aria-hidden="true" decoding="async" loading="lazy">`;
}

function decoratePhotoFlow() {
  if (document.body.dataset.operaDecorated) return;
  document.body.dataset.operaDecorated = 'true';
  startOperaPetals();
  setText('#cameraScreen .camera-topbar > span:not(.camera-step)', '映像間・歌仔戲');
  setText('#cameraPlaceholder p', '準備好，換你登臺');
  setText('#cameraPlaceholder small', '開啟相機，讓臉部清楚入鏡');
  setText('#permissionButton', '開啟相機・準備登臺');
  setText('#cameraScreen .camera-hint', '臉部清楚入鏡，留下你的神韻');
  setText('#reviewScreen .simple-topbar > span:not(.camera-step)', '登臺前・確認照片');
  setText('#reviewScreen .review-badge', '你的神韻，即將入戲');
  setText('#reviewScreen h2', '這張，準備登場？');
  setDirectText('#reviewScreen .review-content > p', '確認照片後，為你上妝換戲服');
  document.querySelector('#reviewStyleName').hidden = true;
  document.querySelector('#reviewScreen .review-content > p > br').hidden = true;
  setText('#retakeButton', '重新拍攝');
  setText('#usePhotoButton', '確認・上妝登場');
  setText('#processingScreen .orbit-core', '戲');
  setDirectText('#processingScreen .processing-steps > div:first-child', '照片已準備好');
  // Shared queue updates still use this node; opera mode omits the detail row.
  document.querySelector('#generateStep').hidden = true;
  setDirectText('#processingScreen .processing-steps > div:last-child', '正在完成你的戲曲寫真');
  setText('#resultScreen .brand-small', '映像間・好戲登場');
  setText('#shareButton', '分享我的戲曲寫真');
  setText('#againButton', '再演一角・重新拍照　↗');
  setText('#homeScreen .gallery-button', '看大家的好戲　↗');
  document.querySelector('#cameraScreen .back-button')?.setAttribute('aria-label', '返回選擇角色');
  document.querySelector('#reviewScreen .back-button')?.setAttribute('aria-label', '返回相機');
  document.querySelector('#processingScreen .processing-inner')?.insertAdjacentHTML('afterbegin',
    '<p class="opera-scene-label">幕後・妝扮中</p><h2 class="opera-processing-title">好戲，即將登場。</h2>');
  document.querySelector('#resultScreen .result-content')?.insertAdjacentHTML('afterbegin',
    `<div class="opera-result-heading"><div><p class="opera-scene-label">一人一角・一張好戲</p><h1>你的戲曲寫真</h1></div>${decorativeProp('ornament-fan', 'opera-result-prop')}</div>`);
}

export function renderOperaMode(container, roles, onSelect) {
  if (!Array.isArray(roles) || roles.length !== roleIds.length ||
      !roleIds.every(id => roles.filter(role => role?.id === id).length === 1) ||
      roles.some(role => !['name', 'title', 'description'].every(key => typeof role[key] === 'string' && role[key].trim()))) {
    throw new Error('歌仔戲角色設定不完整，請重新載入');
  }

  decoratePhotoFlow();
  container.innerHTML = `
    <div class="opera-photo">
      <div class="opera-carousel" tabindex="0" role="region" aria-roledescription="輪播" aria-label="歌仔戲角色，左右滑動或按方向鍵切換"></div>
      <span class="opera-preview-note">AI 角色造型示意</span>
      <div class="opera-swipe-controls">
        <button class="opera-previous" type="button" aria-label="上一個角色">‹</button>
        <span aria-hidden="true">左右滑動切換角色</span>
        <button class="opera-next" type="button" aria-label="下一個角色">›</button>
      </div>
    </div>
    <div class="opera-caption" aria-live="polite" aria-atomic="true">
      <strong class="opera-selected-character"></strong>
    </div>`;

  const carousel = container.querySelector('.opera-carousel');
  const previous = container.querySelector('.opera-previous');
  const next = container.querySelector('.opera-next');
  const orderedRoles = roleIds.map(id => roles.find(role => role.id === id));
  let selectedIndex = -1;
  let dragging = null;
  let scrollFrame = 0;
  let layoutWidth = 0;
  let navigationTarget = null;
  const slides = orderedRoles.map((role, index) => {
    const slide = document.createElement('div');
    slide.className = 'opera-slide';
    slide.dataset.role = role.id;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', '投影片');
    slide.setAttribute('aria-label', `${index + 1} / ${roles.length}：${role.name}・${role.title}`);
    const portrait = document.createElement('img');
    portrait.className = 'opera-portrait';
    portrait.width = 1024;
    portrait.height = 1536;
    portrait.draggable = false;
    portrait.decoding = 'async';
    portrait.alt = `歌仔戲 ${role.name}・${role.title}。${role.description}`;
    if (index === 0) portrait.fetchPriority = 'high';
    const status = document.createElement('div');
    status.className = 'opera-image-status';
    status.innerHTML = '<span>角色示意圖載入中…</span><button type="button" hidden>重新載入圖片</button>';
    const retry = status.querySelector('button');
    function loadPortrait(reload = false) {
      slide.setAttribute('aria-busy', 'true');
      portrait.hidden = true;
      status.hidden = false;
      status.querySelector('span').textContent = '角色示意圖載入中…';
      retry.hidden = true;
      portrait.src = imageUrl(role) + (reload ? `&retry=${Date.now()}` : '');
    }
    portrait.addEventListener('load', () => {
      portrait.hidden = false;
      status.hidden = true;
      slide.setAttribute('aria-busy', 'false');
    });
    portrait.addEventListener('error', () => {
      status.querySelector('span').textContent = '角色示意圖暫時無法載入';
      retry.hidden = false;
      slide.setAttribute('aria-busy', 'false');
    });
    retry.addEventListener('click', () => loadPortrait(true));
    slide.append(portrait, status);
    carousel.append(slide);
    loadPortrait();
    return slide;
  });

  function select(index) {
    if (index === selectedIndex) return;
    selectedIndex = index;
    const role = orderedRoles[index];
    const propName = typeof role.propName === 'string' ? role.propName.trim() : '';
    container.dataset.selectedRole = role.id;
    container.querySelector('.opera-selected-character').textContent = role.name;
    previous.disabled = index === 0;
    next.disabled = index === roles.length - 1;
    slides.forEach((slide, i) => {
      slide.setAttribute('aria-hidden', String(i !== index));
      slide.querySelector('button').tabIndex = i === index ? 0 : -1;
    });
    document.body.style.setProperty('--opera-role-background', `url("${imageUrl(role)}")`);
    onSelect({ id: 'opera', role: role.id, name: `歌仔戲・${role.name}｜${role.title}${propName ? `・${propName}` : ''}` });
  }
  const clampIndex = index => Math.max(0, Math.min(slides.length - 1, index));
  const visibleIndex = () => clampIndex(Math.round(carousel.scrollLeft / Math.max(carousel.clientWidth, 1)));
  function goTo(index) {
    const target = clampIndex(index);
    navigationTarget = target;
    // Commit explicit navigation before an immediate press of the camera button.
    select(target);
    carousel.scrollTo({ left: target * carousel.clientWidth,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  function syncLayout() {
    const width = carousel.clientWidth;
    if (!width) { layoutWidth = 0; return true; }
    if (width === layoutWidth) return false;
    layoutWidth = width;
    navigationTarget = null;
    carousel.scrollTo({ left: Math.max(0, selectedIndex) * width, behavior: 'instant' });
    return true;
  }
  previous.addEventListener('click', () => goTo(selectedIndex - 1));
  next.addEventListener('click', () => goTo(selectedIndex + 1));
  carousel.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      // A resized viewport can emit scroll before ResizeObserver runs.
      if (syncLayout()) return;
      if (navigationTarget !== null) {
        if (Math.abs(carousel.scrollLeft - navigationTarget * layoutWidth) < 2) navigationTarget = null;
        return;
      }
      select(visibleIndex());
    });
  }, { passive: true });
  carousel.addEventListener('keydown', event => {
    let index;
    if (event.key === 'ArrowLeft') index = selectedIndex - 1;
    else if (event.key === 'ArrowRight') index = selectedIndex + 1;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = slides.length - 1;
    else return;
    event.preventDefault();
    goTo(index);
  });
  // Touch uses native scrolling; mouse and pen dragging share the same snap points.
  carousel.addEventListener('pointerdown', event => {
    navigationTarget = null;
    if (event.pointerType === 'touch' || event.button !== 0 || event.target.closest('button')) return;
    dragging = { id: event.pointerId, x: event.clientX, scroll: carousel.scrollLeft, index: visibleIndex() };
    carousel.classList.add('is-dragging');
    carousel.setPointerCapture(event.pointerId);
  });
  carousel.addEventListener('pointermove', event => {
    if (!dragging || dragging.id !== event.pointerId) return;
    carousel.scrollLeft = dragging.scroll - (event.clientX - dragging.x);
  });
  function finishDrag(event) {
    if (!dragging || dragging.id !== event.pointerId) return;
    const delta = event.clientX - dragging.x;
    const target = event.type === 'pointercancel' ? visibleIndex()
      : Math.abs(delta) > Math.min(60, carousel.clientWidth * .18)
        ? dragging.index + (delta < 0 ? 1 : -1) : dragging.index;
    dragging = null;
    carousel.classList.remove('is-dragging');
    if (carousel.hasPointerCapture(event.pointerId)) carousel.releasePointerCapture(event.pointerId);
    goTo(target);
  }
  carousel.addEventListener('pointerup', finishDrag);
  carousel.addEventListener('pointercancel', finishDrag);
  carousel.addEventListener('wheel', () => { navigationTarget = null; }, { passive: true });
  // Preserve the chosen role when rotation or the software keyboard resizes the photo.
  new ResizeObserver(syncLayout).observe(carousel);
  select(0);
}
