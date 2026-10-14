// A fixed, reusable set of CSS petals: no frame loop or growing particle list.
let petalLayer;

export function startOperaPetals() {
  if (petalLayer || !document.body.classList.contains('opera-mode')) return;

  petalLayer = document.createElement('div');
  petalLayer.className = 'opera-petals';
  petalLayer.setAttribute('aria-hidden', 'true');
  document.body.append(petalLayer);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallScreen = window.matchMedia('(max-width: 600px)');
  const refresh = () => {
    petalLayer.replaceChildren();
    petalLayer.hidden = reducedMotion.matches;
    if (reducedMotion.matches) return;

    const count = smallScreen.matches ? 9 : 18;
    const petals = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const petal = document.createElement('span');
      petal.className = 'opera-petal';
      const duration = 14 + Math.random() * 10;
      petal.style.setProperty('--petal-left', `${3 + (index + Math.random()) / count * 94}%`);
      petal.style.setProperty('--petal-size', `${10 + Math.random() * 8}px`);
      petal.style.setProperty('--petal-duration', `${duration}s`);
      petal.style.setProperty('--petal-delay', `${-Math.random() * duration}s`);
      petal.style.setProperty('--petal-drift', `${Math.random() * 70 - 35}px`);
      petal.style.setProperty('--petal-turn', `${Math.random() * 160 - 80}deg`);
      petal.style.setProperty('--petal-sway', `${3 + Math.random() * 3}s`);
      petals.append(petal);
    }
    petalLayer.append(petals);
  };
  const syncVisibility = () => {
    petalLayer.classList.toggle('is-paused', document.hidden);
  };

  reducedMotion.addEventListener('change', refresh);
  smallScreen.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', syncVisibility);
  refresh();
  syncVisibility();
}
