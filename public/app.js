import { renderOperaMode } from './opera-mode.js?v=6';
import { getCaptureFrame } from './camera-capture.js?v=1';

const styles=[
  {id:'simpsons',name:'辛普森',desc:'美式動畫',art:'☻'},
  {id:'doraemon',name:'哆啦A夢',desc:'復古未來',art:'◉'},
  {id:'opera',name:'歌仔戲',desc:'台灣戲韻',art:'✦'},
  {id:'taoist-ink',name:'道家水墨',desc:'山水留白',art:'山'},
  {id:'hunter',name:'獵人',desc:'冒險能量',art:'↗'},
  {id:'magical-girl',name:'美少女戰士',desc:'星月魔法',art:'☾'},
  {id:'miyazaki',name:'宮崎駿',desc:'手繪奇幻',art:'✦',label:'images/style-label-07.webp?v=7'},
  {id:'european-portrait-oil',name:'油畫',desc:'古典油彩',art:'◌',label:'images/style-label-08.webp?v=7'},
  {id:'picasso',name:'畢卡索抽象',desc:'幾何多視角',art:'◇'},
  {id:'disney-3d',name:'迪士尼',desc:'夢幻立體',art:'✎',label:'images/style-label-10.webp?v=7'}
];
let selectedStyle=null, stream=null, cameraTrack=null, facingMode='user', cameraZoom=1, nativeZoomRange=null, nativeZoomActive=false, nativeZoomApplying=false, nativeZoomRequest=0, capturedData='', participantName='', isGenerating=false;
let appConfig = null;
let configLoading = false;
let cameraRequest = 0;
let cameraStarting = false;
let resultVideoUrl = '';
const $=s=>document.querySelector(s);
const MAX_CAMERA_ZOOM=4;
const show=(id)=>{if(id!=='resultScreen')stopResultVideo();document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('is-active',x.id===id))};
const toast=(msg)=>{const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function loadAppConfig() {
  if (configLoading) return;
  configLoading = true;
  appConfig = null;
  selectedStyle = null;
  $('#startButton').disabled = true;
  $('#configStatus').hidden = false;
  $('#configStatus').setAttribute('aria-busy', 'true');
  $('#configMessage').textContent = '正在準備拍照模式…';
  $('#configRetryButton').hidden = true;
  $('#standardHome').hidden = true;
  $('#operaHome').hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const config = await readJson(await fetch('/api/config', { cache: 'no-store', signal: controller.signal }));
    if (!['standard', 'opera'].includes(config.mode)) throw new Error('拍照模式設定無效，請重新載入');
    document.body.classList.toggle('opera-mode', config.mode === 'opera');
    if (config.mode === 'opera') {
      renderOperaMode($('#operaHome'), config.roles, selection => {
        selectedStyle = selection;
        $('#startButton').disabled = !appConfig;
        $('#startButton').textContent = '開始拍照';
      });
      $('#operaHome').hidden = false;
      $('#startButton').textContent = '開始拍照';
      document.title = '映像間｜歌仔戲照相館';
      document.querySelector('meta[name="theme-color"]').content = '#211719';
    } else {
      $('#standardHome').hidden = false;
      renderStyles();
      $('#startButton').textContent = '開始拍照';
    }
    appConfig = config;
    $('.dont-close').textContent = config.video?.enabled
      ? '請保持畫面開啟，照片完成後將製作影片，可能需要數分鐘'
      : '請保持畫面開啟，通常需要 20–60 秒';
    $('#startButton').disabled = !selectedStyle;
    $('#configStatus').hidden = true;
  } catch (error) {
    appConfig = null;
    selectedStyle = null;
    $('#standardHome').hidden = true;
    $('#operaHome').hidden = true;
    $('#configMessage').textContent = error.name === 'AbortError'
      ? '載入拍照模式逾時，請確認網路後重試。'
      : '無法載入拍照模式，請確認網路後重試。';
    $('#configRetryButton').hidden = false;
    $('#startButton').disabled = true;
  } finally {
    clearTimeout(timeout);
    configLoading = false;
    $('#configStatus').setAttribute('aria-busy', 'false');
  }
}
function getDeviceId(){let id=localStorage.getItem('aiCameraDeviceId');if(!id){id=crypto.randomUUID();localStorage.setItem('aiCameraDeviceId',id)}return id}
function selectStyle(card){document.querySelectorAll('.style-card').forEach(c=>c.classList.toggle('selected',c===card));selectedStyle=styles.find(s=>s.id===card.dataset.style);const index=styles.indexOf(selectedStyle)+1,label=$('#selectedStyleLabel');label.src=selectedStyle.label||`images/style-label-${String(index).padStart(2,'0')}.webp?v=1`;label.alt=selectedStyle.name}
function hideSwipeHint(){const hint=$('#swipeHint');if(hint)hint.classList.add('is-hidden')}
function enableCarouselDrag(grid,cards){let dragging=false,startX=0,startScrollLeft=0,startIndex=0,touchStartX=0,touchStartIndex=0,moved=false,raf=0,snapTimer=0;const currentIndex=()=>Math.max(0,Math.min(cards.length-1,Math.round(grid.scrollLeft/Math.max(grid.clientWidth,1))));const bumpEdge=(index,message)=>{const card=cards[index];card?.classList.remove('edge-bump');void card?.offsetWidth;card?.classList.add('edge-bump');setTimeout(()=>card?.classList.remove('edge-bump'),430);toast(message)};const updatePhysics=()=>{raf=0;const center=grid.scrollLeft+grid.clientWidth/2;cards.forEach(card=>{const cardCenter=card.offsetLeft+card.offsetWidth/2;const delta=(cardCenter-center)/Math.max(grid.clientWidth,1);const distance=Math.min(Math.abs(delta),1);const image=card.querySelector('.style-photo');card.style.opacity=String(1-distance*.14);card.style.filter=`brightness(${1-distance*.08}) saturate(${1-distance*.08})`;if(image){const parallax=Math.max(-9,Math.min(9,-delta*9));const scale=1.012-distance*.012;image.style.transform=`translate3d(${parallax}px,0,0) scale(${scale})`}})};const settleJelly=()=>{clearTimeout(snapTimer);snapTimer=setTimeout(()=>{const index=currentIndex();cards.forEach(card=>card.classList.remove('is-jelly'));void cards[index]?.offsetWidth;cards[index]?.classList.add('is-jelly');setTimeout(()=>cards[index]?.classList.remove('is-jelly'),480)},130)};grid.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse')return;dragging=true;moved=false;startX=event.clientX;startScrollLeft=grid.scrollLeft;startIndex=currentIndex();grid.classList.add('is-dragging');grid.setPointerCapture(event.pointerId)});grid.addEventListener('pointermove',event=>{if(!dragging)return;const delta=event.clientX-startX;if(Math.abs(delta)>4){moved=true;hideSwipeHint()}grid.scrollLeft=startScrollLeft-delta});const finish=event=>{if(!dragging)return;const gestureDelta=event.clientX-startX;dragging=false;grid.classList.remove('is-dragging');if(grid.hasPointerCapture?.(event.pointerId))grid.releasePointerCapture(event.pointerId);const index=currentIndex();cards[index]?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});if(startIndex===cards.length-1&&gestureDelta<-32)bumpEdge(cards.length-1,'已經是最後一種風格');else if(startIndex===0&&gestureDelta>32)bumpEdge(0,'已經是第一種風格');if(moved){grid.dataset.justDragged='true';setTimeout(()=>delete grid.dataset.justDragged,80)}};grid.addEventListener('pointerup',finish);grid.addEventListener('pointercancel',finish);grid.addEventListener('touchstart',event=>{touchStartX=event.touches[0]?.clientX||0;touchStartIndex=currentIndex()},{passive:true});grid.addEventListener('touchend',event=>{const gestureDelta=(event.changedTouches[0]?.clientX||touchStartX)-touchStartX;if(touchStartIndex===cards.length-1&&gestureDelta<-32)bumpEdge(cards.length-1,'已經是最後一種風格');else if(touchStartIndex===0&&gestureDelta>32)bumpEdge(0,'已經是第一種風格')},{passive:true});grid.addEventListener('scroll',()=>{if(grid.scrollLeft>4)hideSwipeHint();if(!raf)raf=requestAnimationFrame(updatePhysics);settleJelly()},{passive:true});updatePhysics()}
function renderStyles(){const grid=$('#styleGrid');grid.innerHTML=styles.map((s,i)=>`<button class="style-card" data-style="${s.id}" aria-label="${s.name}"><img class="style-photo" src="images/style-${String(i+1).padStart(2,'0')}.webp?v=10" alt="" draggable="false" loading="${i===0?'eager':'lazy'}" ${i===0?'fetchpriority="high"':''}></button>`).join('');const cards=[...document.querySelectorAll('.style-card')];cards.forEach(card=>card.addEventListener('click',()=>{if(grid.dataset.justDragged)return;selectStyle(card);card.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});hideSwipeHint()}));const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(visible?.intersectionRatio>.72)selectStyle(visible.target)},{root:grid,threshold:[.72,.9]});cards.forEach(card=>observer.observe(card));grid.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const current=cards.indexOf(document.activeElement);const index=current<0?0:current;const next=cards[Math.max(0,Math.min(cards.length-1,index+(event.key==='ArrowRight'?1:-1)))];next?.focus();next?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});hideSwipeHint()});enableCarouselDrag(grid,cards);selectStyle(cards[0])}
function updateVideoZoom(){const video=$('#video');if(!video)return;const mirror=facingMode==='user'?'scaleX(-1) ':'';const previewZoom=nativeZoomActive?1:cameraZoom;video.style.transform=`${mirror}scale(${previewZoom})`}
function getNativeZoomRange(track){const range=track?.getCapabilities?.()?.zoom;const min=Number(range?.min),max=Number(range?.max),step=Number(range?.step)||0;if(!Number.isFinite(min)||!Number.isFinite(max)||max<=Math.max(1,min))return null;return {min:Math.max(1,min),max,step}}
function clampCameraZoom(value){const max=nativeZoomRange?.max||MAX_CAMERA_ZOOM;return Math.min(max,Math.max(1,Number(value)||1))}
function getNativeZoomValue(value){const range=nativeZoomRange;let zoom=Math.min(range.max,Math.max(range.min,value));if(range.step>0)zoom=range.min+Math.round((zoom-range.min)/range.step)*range.step;return Number(zoom.toFixed(4))}
function applyNativeZoom(){const track=cameraTrack,range=nativeZoomRange;if(!track||!range||nativeZoomApplying)return;nativeZoomApplying=true;const request=nativeZoomRequest,zoom=getNativeZoomValue(cameraZoom);Promise.resolve().then(()=>track.applyConstraints({advanced:[{zoom}]})).then(()=>{if(track!==cameraTrack)return;if(request===nativeZoomRequest){nativeZoomActive=true;updateVideoZoom()}}).catch(()=>{if(track!==cameraTrack)return;if(request===nativeZoomRequest){nativeZoomRange=null;nativeZoomActive=false;updateVideoZoom()}}).finally(()=>{if(track!==cameraTrack)return;nativeZoomApplying=false;if(request!==nativeZoomRequest&&nativeZoomRange)applyNativeZoom()})}
function setCameraZoom(value){cameraZoom=clampCameraZoom(value);updateVideoZoom();if(nativeZoomRange&&cameraTrack){nativeZoomRequest+=1;applyNativeZoom()}}
function getTouchDistance(touches){const first=touches[0],second=touches[1];return first&&second?Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY):0}
function enableCameraZoomGesture(){const stage=$('#cameraStage');if(!stage)return;let pinchStartDistance=0,pinchStartZoom=1;stage.addEventListener('touchstart',event=>{if(event.touches.length!==2)return;pinchStartDistance=getTouchDistance(event.touches);pinchStartZoom=cameraZoom;event.preventDefault()},{passive:false});stage.addEventListener('touchmove',event=>{if(event.touches.length<2||!pinchStartDistance)return;const distance=getTouchDistance(event.touches);if(!distance)return;event.preventDefault();setCameraZoom(pinchStartZoom*distance/pinchStartDistance)},{passive:false});const finishPinch=event=>{if(event.touches.length<2)pinchStartDistance=0};stage.addEventListener('touchend',finishPinch,{passive:false});stage.addEventListener('touchcancel',finishPinch,{passive:false})}
function setCameraState(state) {
  const loading = state === 'loading';
  const ready = state === 'ready';
  $('#cameraPlaceholder').style.display = ready ? 'none' : '';
  $('#cameraPlaceholder p').textContent = loading ? '正在開啟相機…' : '點擊下方按鈕開啟相機';
  $('#permissionButton').style.display = ready ? 'none' : '';
  $('#permissionButton').disabled = loading;
  $('#permissionButton').textContent = loading ? '正在開啟相機…' : '開啟相機';
  $('#shutterButton').disabled = !ready;
  $('#switchCamera').disabled = loading;
}
async function setupCamera() {
  if (cameraStarting || stream?.active) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraState('idle');
    toast('此瀏覽器不支援相機，請改用 Safari 或 Chrome');
    return;
  }
  const request = ++cameraRequest;
  cameraStarting = true;
  setCameraState('loading');
  try {
    let nextStream;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        nextStream = await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:1920},height:{ideal:1920}},audio:false});
        break;
      } catch (error) {
        // Some cameras need a moment to release the previous capture session.
        if (request !== cameraRequest) return;
        if (error.name !== 'NotReadableError' || attempt > 0) throw error;
        await wait(250);
        if (request !== cameraRequest) return;
      }
    }
    // Leaving the camera screen also cancels permission requests still pending.
    if (request !== cameraRequest) {
      nextStream.getTracks().forEach(track => track.stop());
      return;
    }
    stream = nextStream;
    cameraTrack = stream.getVideoTracks()[0] || null;
    cameraZoom = 1;
    nativeZoomRange = getNativeZoomRange(cameraTrack);
    nativeZoomActive = false;
    nativeZoomApplying = false;
    nativeZoomRequest += 1;
    const video = $('#video');
    video.srcObject = stream;
    updateVideoZoom();
    await video.play();
    if (request !== cameraRequest) return;
    setCameraState('ready');
  } catch (error) {
    if (request !== cameraRequest) return;
    stopCamera();
    toast(error.name === 'NotReadableError' ? '相機暫時忙碌，請稍後點擊「開啟相機」重試' : '無法開啟相機，請確認瀏覽器權限');
  } finally {
    if (request === cameraRequest) cameraStarting = false;
  }
}
function stopCamera() {
  cameraRequest += 1;
  cameraStarting = false;
  stream?.getTracks().forEach(track => track.stop());
  const video = $('#video');
  video.pause();
  video.srcObject = null;
  video.load();
  stream = null;
  cameraTrack = null;
  cameraZoom = 1;
  nativeZoomRange = null;
  nativeZoomActive = false;
  nativeZoomApplying = false;
  nativeZoomRequest += 1;
  updateVideoZoom();
  setCameraState('idle');
}
function normalizeParticipantName(value){return typeof value==='string'?value.replace(/\s+/g,' ').trim():''}
function openCamera(){if(!appConfig||!selectedStyle)return;const input=$('#participantName');const name=normalizeParticipantName(input?.value);if(!name){input?.setCustomValidity('請輸入姓名後再拍照');input?.reportValidity();input?.focus();return}input.setCustomValidity('');input.value=name;participantName=name;show('cameraScreen');$('#cameraStylePill').textContent=selectedStyle.name;setupCamera()}
function takePhoto() {
  const video = $('#video'), canvas = $('#captureCanvas');
  if (cameraStarting || !stream?.active || video.readyState < 2 ||
      !video.videoWidth || !video.videoHeight || !video.clientWidth || !video.clientHeight) {
    toast('請等待相機畫面準備完成');
    return;
  }
  // The camera may deliver landscape frames even when the viewfinder is portrait.
  // Use the untransformed video box so CSS zoom and mirroring are applied only once.
  const frame = getCaptureFrame(video.videoWidth, video.videoHeight,
    video.clientWidth, video.clientHeight, nativeZoomActive ? 1 : cameraZoom);
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  if (facingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, frame.x, frame.y, frame.cropWidth, frame.cropHeight,
    0, 0, canvas.width, canvas.height);
  ctx.restore();
  capturedData = canvas.toDataURL('image/jpeg', .82);
  $('#capturedImage').src = capturedData;
  $('#reviewStyleName').textContent = selectedStyle.name;
  stopCamera();
  show('reviewScreen');
}
async function readJson(response){const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'服務暫時無法使用');return data}
function updateQueue(status) {
  const queue = $('#queueStep');
  const generateStep = $('#generateStep');
  const videoStage = appConfig?.video?.enabled && status.stage === 'video';
  generateStep.hidden = appConfig?.mode === 'opera' || videoStage;
  if (status.status === 'queued') {
    queue.className = 'active';
    queue.querySelector('span').textContent = '●';
    generateStep.className = '';
    $('#queueMessage').textContent = status.position > 0
      ? `目前使用人數較多，前方還有 ${status.position} 組照片`
      : '即將開始生成';
  } else if (videoStage) {
    queue.className = 'active';
    queue.querySelector('span').textContent = '●';
    const progress = Number(status.videoProgress);
    const suffix = status.videoProgress != null && Number.isFinite(progress)
      ? `（${Math.max(0, Math.min(99, Math.round(progress)))}%）` : '';
    $('#queueMessage').textContent = `照片已完成，正在製作影片…${suffix}`;
  } else {
    queue.className = 'done';
    queue.querySelector('span').textContent = '✓';
    $('#queueMessage').textContent = '已進入生成程序';
    generateStep.className = 'active';
    generateStep.querySelector('span').textContent = '●';
  }
}
async function pollJob(jobId) {
  for (;;) {
    const status = await readJson(await fetch(`/api/jobs/${encodeURIComponent(jobId)}`));
    updateQueue(status);
    if (status.status === 'completed') return status;
    if (status.status === 'failed') throw new Error(status.error || '作品生成失敗，請重新嘗試');
    await wait(2000);
  }
}
function stopResultVideo() {
  const video = $('#resultVideo');
  if (!video) return;
  video.onerror = null;
  video.onloadedmetadata = null;
  video.pause();
  video.removeAttribute('src');
  video.removeAttribute('poster');
  video.load();
  video.hidden = true;
  resultVideoUrl = '';
}
function setResultMessage(message) {
  const status = $('#resultMediaStatus');
  status.textContent = message || '';
  status.hidden = !message;
}
function showResult(result) {
  stopResultVideo();
  const image = $('#resultImage');
  const video = $('#resultVideo');
  const wrap = $('.result-image-wrap');
  image.src = result.image;
  image.hidden = false;
  wrap.classList.remove('has-video');
  $('#shareButton').textContent = '分享圖片';
  setResultMessage(result.videoWarning);
  if (appConfig?.video?.enabled && typeof result.video === 'string' && result.video) {
    resultVideoUrl = result.video;
    wrap.style.removeProperty('--result-video-ratio');
    video.onloadedmetadata = () => {
      if (video.videoWidth && video.videoHeight) wrap.style.setProperty('--result-video-ratio', video.videoWidth / video.videoHeight);
    };
    video.poster = result.image;
    video.muted = true;
    video.defaultMuted = true;
    video.onerror = () => {
      if (!resultVideoUrl) return;
      stopResultVideo();
      image.hidden = false;
      wrap.classList.remove('has-video');
      $('#shareButton').textContent = '分享圖片';
      setResultMessage('影片暫時無法播放，先顯示已完成的照片。');
    };
    video.src = resultVideoUrl;
    video.hidden = false;
    image.hidden = true;
    wrap.classList.add('has-video');
    $('#shareButton').textContent = '分享影片';
  }
  $('#resultStyleLabel').textContent = selectedStyle.name;
  $('#totalTokens').textContent = result.usage?.totalTokens?.toLocaleString() || '依帳單為準';
  $('#tokenLabel').textContent = appConfig?.video?.enabled ? '圖片 Token' : '總 Token';
  $('#totalCost').textContent = result.cost?.twd != null ? `NT$${Number(result.cost.twd).toFixed(2)}` : '依帳單為準';
  $('#totalCostUsd').textContent = result.cost?.usd != null ? `約 US$${Number(result.cost.usd).toFixed(3)}` : '';
  show('resultScreen');
  if (resultVideoUrl) video.play().catch(() => {
    if (resultVideoUrl) setResultMessage('點擊影片播放鍵即可播放。');
  });
}
async function generate() {
  if (isGenerating || !appConfig || !selectedStyle) return;
  isGenerating = true;
  $('#usePhotoButton').disabled = true;
  show('processingScreen');
  $('#processingStyleName').textContent = selectedStyle.name;
  updateQueue({ status: 'queued', position: 0 });
  try {
    const blob = await (await fetch(capturedData)).blob();
    const form = new FormData();
    form.append('photo', blob, 'photo.jpg');
    form.append('name', participantName);
    form.append('style', selectedStyle.id);
    if (selectedStyle.role) form.append('role', selectedStyle.role);
    form.append('deviceId', getDeviceId());
    form.append('requestId', crypto.randomUUID());
    const queued = await readJson(await fetch('/api/generate', { method: 'POST', body: form }));
    showResult(await pollJob(queued.jobId));
  } catch (error) {
    toast(error.message);
    show('reviewScreen');
  } finally {
    isGenerating = false;
    $('#usePhotoButton').disabled = false;
  }
}
function resultMedia() {
  return resultVideoUrl
    ? { src: resultVideoUrl, extension: 'mp4', mime: 'video/mp4', label: '影片' }
    : { src: $('#resultImage').getAttribute('src'), extension: 'jpg', mime: 'image/jpeg', label: '圖片' };
}
function download() {
  const media = resultMedia();
  if (!media.src) { toast('尚無作品可下載'); return; }
  const a = document.createElement('a');
  a.href = media.src;
  a.download = `ai-${media.extension === 'mp4' ? 'video' : 'photo'}-${Date.now()}.${media.extension}`;
  a.click();
  toast(`${media.label}已開始下載`);
}
async function share() {
  const media = resultMedia();
  if (!media.src) { toast('尚無作品可分享'); return; }
  try {
    const response = await fetch(media.src);
    if (!response.ok) throw new Error('fetch failed');
    const blob = await response.blob();
    const file = new File([blob], `ai-${media.extension === 'mp4' ? 'video' : 'photo'}-${Date.now()}.${media.extension}`, { type: media.mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `我的 AI 風格${media.label}` });
      return;
    }
    download();
    toast(`已開始下載${media.label}，儲存後即可分享`);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      download();
      toast(`已開始下載${media.label}，儲存後即可分享`);
    }
  }
}
window.addEventListener('pagehide', event => {
  // A back/forward cache entry must keep its media source and share target.
  if (event.persisted) $('#resultVideo').pause();
  else stopResultVideo();
});
window.addEventListener('pageshow', event => {
  if (event.persisted && resultVideoUrl && $('#resultScreen').classList.contains('is-active')) {
    $('#resultVideo').play().catch(() => setResultMessage('點擊影片播放鍵即可播放。'));
  }
});
enableCameraZoomGesture();
setCameraState('idle');
loadAppConfig();
$('#configRetryButton').addEventListener('click', loadAppConfig);
$('#participantName').addEventListener('input',event=>event.currentTarget.setCustomValidity(''));
$('#photoStartForm').addEventListener('submit',event=>{event.preventDefault();openCamera()});
$('#permissionButton').addEventListener('click',setupCamera);
$('#shutterButton').addEventListener('click',takePhoto);
$('#switchCamera').addEventListener('click',()=>{facingMode=facingMode==='user'?'environment':'user';stopCamera();setupCamera()});
$('#retakeButton').addEventListener('click',openCamera);
$('#usePhotoButton').addEventListener('click',generate);
$('#shareButton').addEventListener('click',share);
$('#againButton').addEventListener('click',()=>show('homeScreen'));
document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.back==='home'){stopCamera();show('homeScreen')}else{openCamera()}}));
