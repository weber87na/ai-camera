import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrderedOperaRoles, getOperaPortraitUrl, renderOperaMode } from './public/opera-mode.js';

const rolePairs = [
  ['sheng', '小生'], ['dan', '苦旦'], ['jing', '花臉'], ['chou', '文丑'],
  ['beauty-fan', '小旦'], ['beauty-necklace', '小旦'],
  ['beauty-umbrella', '小旦'], ['beauty-dessert', '花旦'],
  ['handsome-sheng', '小生'],
];
const roles = rolePairs.map(([id, name]) => ({ id, name, title: name, description: `${name}的造型` }));

test('preview roles keep the original four first and accept additional configured roles', () => {
  const reordered = [...roles.slice(4), ...roles.slice(0, 4).reverse()];
  assert.deepEqual(getOrderedOperaRoles(reordered).map(role => role.id), rolePairs.map(([id]) => id));
  assert.deepEqual(getOrderedOperaRoles(roles.slice(0, 4)), roles.slice(0, 4));
  for (const [index, role] of roles.entries()) {
    assert.equal(getOperaPortraitUrl(role), `images/opera-${role.id}-portrait.png?v=${index < 4 ? '2' : index === 8 ? '1' : '4'}`);
  }
  assert.deepEqual(reordered.slice(0, 5), roles.slice(4), 'sorting must not mutate API data');
});

test('preview config rejects missing legacy roles, duplicates, malformed IDs and incomplete text', () => {
  for (const invalid of [
    null, [], roles.slice(1), [...roles, roles[0]], [...roles, null],
    [...roles, { ...roles[4], id: '../unsafe' }],
    roles.map(role => role.id === 'beauty-fan' ? { ...role, name: ' ' } : role),
  ]) assert.throws(() => getOrderedOperaRoles(invalid), /角色設定不完整/);
});

// Small DOM double exercises event handling and gallery reconciliation without a browser dependency.
class Element extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.clientWidth = 288;
    this.scrollLeft = 0;
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (force ?? !names.has(name)) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      },
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    node.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, node);
    node.parent = this;
    return node;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceChildren(...nodes) { [...this.children].forEach(node => node.remove()); this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelector(selector) {
    const matches = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName === selector;
    for (const child of this.children) {
      if (matches(child)) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }
  set innerHTML(html) {
    this.replaceChildren();
    const stack = [this];
    for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
      if (match[1]) { stack.pop(); continue; }
      const node = new Element(match[2]);
      node.className = match[3].match(/class="([^"]*)"/)?.[1] || '';
      stack.at(-1).appendChild(node);
      if (!['img', 'input', 'br', 'meta'].includes(match[2])) stack.push(node);
    }
  }
  scrollTo({ left }) { this.scrollLeft = left; }
  focus() {}
}

function browser(t) {
  const originals = new Map();
  const install = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const body = new Element('body');
  body.dataset.operaDecorated = 'true';
  const document = Object.assign(new EventTarget(), {
    body, createElement: tag => new Element(tag), getElementById: element,
    querySelector: element, querySelectorAll: () => [],
  });
  const media = () => Object.assign(new EventTarget(), { matches: true });
  const observers = [];
  const intervals = [];
  install('document', document);
  install('window', Object.assign(new EventTarget(), { matchMedia: media }));
  install('matchMedia', media);
  install('ResizeObserver', class {
    constructor(callback) { observers.push(callback); }
    observe() { observers.at(-1)(); }
  });
  install('requestAnimationFrame', callback => { queueMicrotask(callback); return 1; });
  install('setInterval', callback => { intervals.push(callback); return intervals.length; });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { element, body, observers, intervals, install };
}

function press(element, key) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  element.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
}

test('nine-role carousel shows subtype names once and preserves the chosen role after resizing', t => {
  const page = browser(t);
  const container = new Element();
  const selections = [];
  renderOperaMode(container, roles, selection => selections.push(selection));
  const carousel = container.querySelector('.opera-carousel');
  const next = container.querySelector('.opera-next');
  const previous = container.querySelector('.opera-previous');
  assert.equal(carousel.children.length, 9);
  assert.equal(container.dataset.selectedRole, 'sheng');
  assert.equal(previous.disabled, true);
  for (const [index, role] of roles.entries()) {
    if (index) next.dispatchEvent(new Event('click'));
    assert.equal(container.dataset.selectedRole, role.id);
    assert.equal(carousel.children[index].attributes['aria-label'], `${index + 1} / 9：${role.name}`);
    assert.equal(carousel.children[index].querySelector('img').alt, `歌仔戲 ${role.name}。${role.description}`);
    assert.equal(carousel.children[index].attributes['aria-hidden'], 'false');
    assert.equal(container.querySelector('.opera-selected-character').textContent, role.name);
    assert.equal(container.querySelector('.opera-selected-character').classList.contains('is-long-name'), false);
    assert.equal(selections.at(-1).name, `歌仔戲・${role.name}`);
  }
  assert.equal(next.disabled, true);
  assert.deepEqual(selections.map(selection => selection.role), rolePairs.map(([id]) => id));
  press(carousel, 'ArrowLeft');
  assert.equal(container.dataset.selectedRole, 'beauty-dessert');
  carousel.clientWidth = 390;
  page.observers.forEach(callback => callback());
  assert.equal(carousel.scrollLeft, 7 * 390);
  assert.equal(container.dataset.selectedRole, 'beauty-dessert');
  press(carousel, 'Home');
  assert.equal(container.dataset.selectedRole, 'sheng');
  press(carousel, 'End');
  assert.equal(container.dataset.selectedRole, 'handsome-sheng');
});

test('empty gallery fills nine cells with subtype-labelled previews; real photos replace all previews', async t => {
  const page = browser(t);
  const requests = [];
  let photoData = { images: [], photos: [] };
  page.install('fetch', async url => {
    requests.push(url);
    return { ok: true, json: async () => url === '/api/config'
      ? { mode: 'opera', roles, video: { enabled: false } } : photoData };
  });
  await import('./public/gallery.js?frontend-test');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const grid = page.element('galleryGrid');
  assert.equal(grid.children.length, 1);
  const group = grid.children[0];
  assert.equal(group.children.length, 9);
  assert.deepEqual(group.children.map(card => card.querySelector('img').src),
    roles.map(role => `/${getOperaPortraitUrl(role)}`));
  assert.deepEqual(group.children.map(card => card.querySelector('img').alt),
    roles.map(role => `${role.name}・角色造型示意`));
  assert.equal(group.children.filter(cell => cell.className === 'gallery-placeholder').length, 0);
  assert.equal(page.element('galleryRetry').hidden, true);
  assert.equal(page.intervals.length, 1);
  photoData = { images: ['/storage/new-photo.jpg'], photos: [{ url: '/storage/new-photo.jpg', name: '測試參加者' }] };
  await page.intervals[0]();
  assert.equal(group.children.length, 9);
  assert.equal(group.children[0].querySelector('img').src, '/storage/new-photo.jpg');
  assert.equal(group.children[0].attributes['aria-label'], '欣賞測試參加者');
  assert.equal(group.children.filter(cell => cell.className === 'gallery-placeholder').length, 8);
  assert.ok(requests.every(url => url === '/api/config' || url.startsWith('/api/photos/')), 'previews never go to any write or lottery API');
});
