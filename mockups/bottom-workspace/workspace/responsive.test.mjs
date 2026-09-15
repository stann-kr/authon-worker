import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

// Build the standalone artifact first. These verify state/semantics, not geometry.
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
async function workspace(route = 'planning/bookings') {
  const errors = [], observers = new Set();
  let frameWidth = 1280;
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: `http://localhost:4176/#${route}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.add(this); }
        observe() {}
        disconnect() { observers.delete(this); }
      };
      w.HTMLElement.prototype.getBoundingClientRect = function () {
        const top = this.matches('.workspace-scroll') ? 160 : this.matches('.dock-region') ? 700 : 50;
        return { x: 0, y: top, left: 0, right: frameWidth, width: frameWidth, top, bottom: 850, height: 850 - top };
      };
      w.HTMLDialogElement.prototype.show = w.HTMLDialogElement.prototype.showModal = function () {
        this.open = true; this.querySelector('h2')?.focus();
      };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const w = dom.window, d = w.document;
  const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
  const button = (name, root = d) => [...root.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === name || el.textContent.trim() === name);
  const dialog = () => d.querySelector('dialog[open]');
  const click = async el => { assert.ok(el, 'action exists'); el.focus(); el.click(); await tick(); };
  const input = async (el, value) => {
    assert.ok(el, 'input exists');
    const proto = el.tagName === 'SELECT' ? w.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await tick();
  };
  const label = name => [...d.querySelectorAll('label')].find(el => el.querySelector('span')?.textContent.replace(' *','') === name)?.querySelector('input,select,textarea');
  const resize = async width => { frameWidth = width; [...observers].forEach(o => o.callback()); await tick(); };
  const navigate = async route => { w.location.hash = `#${route}`; await tick(70); };
  const submit = async () => { dialog().querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(230); };
  const finish = () => { assert.deepEqual(errors, []); dom.window.close(); };
  await tick(80);
  return { w, d, tick, button, dialog, click, input, label, resize, navigate, submit, finish };
}

test('selected detail changes target and resizes without remounting or losing focus', async () => {
  const q = await workspace();
  const cards = q.d.querySelectorAll('.planning-booking');
  await q.click(cards[0]);
  assert.equal(q.dialog().getAttribute('aria-modal'), 'false');
  await q.click(cards[1]);
  assert.equal(q.dialog().querySelector('h2').textContent, 'MILO');
  assert.equal(cards[1].getAttribute('aria-pressed'), 'true');
  const node = q.dialog(), close = q.button('닫기', node);
  close.focus();
  for (const width of [834, 390, 979, 980, 1280]) {
    await q.resize(width);
    assert.equal(q.dialog(), node);
    assert.equal(q.d.activeElement, close);
    assert.equal(node.getAttribute('aria-modal'), String(width < 980));
  }
  close.dispatchEvent(new q.w.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
  await q.tick();
  assert.equal(q.dialog(), null);
  assert.equal(q.d.activeElement, cards[1]);
  q.finish();
});

test('roster search stays accessible and preserves input and focus through responsive changes', async () => {
  const q = await workspace('workspace/door');
  const search = q.d.querySelector('.roster-search'), input = search.querySelector('input');
  const toggle = q.d.querySelector('[aria-controls="'+search.id+'"]');
  const escape = async () => {
    input.dispatchEvent(new q.w.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
    await q.tick();
  };
  assert.equal(search.hidden, false);
  assert.equal(toggle.hidden, true);
  await q.input(input, '김서윤'); input.focus();
  for (const width of [390, 700, 834, 1280]) {
    await q.resize(width);
    assert.equal(q.d.querySelector('.roster-search input'), input);
    assert.equal(input.value, '김서윤');
    assert.equal(search.hidden, false);
    assert.equal(q.d.activeElement, input);
    assert.equal(q.d.querySelectorAll('.guest-list li').length, 1);
  }
  await escape(); await escape();
  assert.equal(input.value, '');
  assert.equal(search.hidden, false);
  assert.equal(q.d.activeElement, input);
  await q.resize(390);
  assert.equal(search.hidden, false, 'active empty search remains open when narrowing');
  await escape();
  assert.equal(search.hidden, true);
  assert.equal(q.d.activeElement, toggle);
  await q.resize(1280);
  assert.equal(search.hidden, false);
  assert.equal(toggle.hidden, true);
  assert.equal(q.d.activeElement, input, 'focus moves off the hidden toggle');
  q.finish();
});

test('guest detail starts with its action, discloses QR and does not repeat another guest success', async () => {
  const q = await workspace('workspace/door');
  await q.click(q.button('박지우 입장 처리')); await q.tick(220);
  await q.click(q.button('김서윤 상세'));
  const body = q.dialog().querySelector('.sheet-body');
  assert.equal(body.querySelector('button').textContent, '입장 처리');
  assert.equal(body.querySelector('details').open, false);
  assert.equal(body.textContent.includes('박지우'), false);
  await q.click(q.button('입장 처리', body)); await q.tick(220);
  assert.equal(q.dialog(), null);
  assert.ok(q.button('김서윤 입장 취소'));
  q.finish();
});

test('editor keeps draft, discard state and focused field through resize', async () => {
  const q = await workspace();
  await q.click(q.d.querySelector('.planning-booking'));
  await q.click(q.button('부킹 수정'));
  const field = q.d.querySelector('[name=owner]'), node = q.dialog();
  await q.input(field, 'RESIZE OWNER'); field.focus();
  for (const width of [390, 834, 1280]) {
    await q.resize(width);
    assert.equal(q.dialog(), node);
    assert.equal(q.d.querySelector('[name=owner]'), field);
    assert.equal(field.value, 'RESIZE OWNER');
    assert.equal(q.d.activeElement, field);
    assert.equal(node.getAttribute('aria-modal'), 'true');
  }
  await q.click(q.button('닫기', node));
  assert.ok(q.button('계속 작성', node));
  await q.resize(390);
  await q.click(q.button('계속 작성', node));
  assert.equal(field.value, 'RESIZE OWNER');
  await q.click(q.button('닫기', node));
  await q.click(q.button('내용 버리고 닫기', node));
  assert.equal(q.dialog().querySelector('h2').textContent, 'SORA');
  q.finish();
});

test('request review resets the target form and only locks after an actual change', async () => {
  const q = await workspace('workspace/requests');
  const rows = q.d.querySelectorAll('main .flow-row-button');
  await q.click(rows[0]);
  const input = q.dialog().querySelector('input[name=count]'), initial = input.value;
  assert.equal(q.dialog().getAttribute('aria-modal'), 'false');
  await q.input(input, '1');
  assert.equal(q.dialog().getAttribute('aria-modal'), 'true');
  await q.resize(390); await q.resize(1280);
  assert.equal(q.dialog().querySelector('input[name=count]'), input);
  await q.input(input, initial);
  assert.equal(q.dialog().getAttribute('aria-modal'), 'false');
  await q.click(rows[1]);
  assert.notEqual(q.dialog().querySelector('input[name=count]'), input);
  const targetName = rows[1].querySelector('strong').textContent;
  assert.ok(q.dialog().textContent.includes(targetName));
  await q.submit();
  assert.equal(q.dialog(), null);
  assert.equal(q.d.querySelectorAll('main .flow-row-button').length, rows.length - 1);
  q.finish();
});

test('CSV partial registration retains unfinished input across resize and ten guests check in directly', async () => {
  const q = await workspace('workspace/roster');
  await q.click(q.button('게스트 등록'));
  await q.click(q.dialog().querySelector('.form-toggle input'));
  const csv = q.dialog().querySelector('input[type=file]');
  const names = Array.from({length:10}, (_, i) => `Responsive Guest ${String(i+1).padStart(2,'0')}`);
  Object.defineProperty(csv, 'files', { value: [{text: async () => 'name\n'+[...names, 'x'.repeat(101)].join('\n')}] });
  csv.dispatchEvent(new q.w.Event('change', { bubbles:true })); await q.tick();
  await q.click(q.button('이름 불러오기'));
  await q.submit();
  const remaining = q.label('붙여넣을 이름');
  assert.equal(remaining.value, 'x'.repeat(101));
  remaining.focus(); await q.resize(390); await q.resize(1280);
  assert.equal(q.label('붙여넣을 이름'), remaining);
  assert.equal(q.d.activeElement, remaining);
  assert.equal(remaining.value, 'x'.repeat(101));
  await q.click(q.button('닫기')); await q.click(q.button('내용 버리고 닫기'));
  await q.navigate('workspace/door');
  for (const name of names) {
    await q.click(q.button(name.toUpperCase()+' 입장 처리'));
    await q.tick(220);
    assert.ok(q.button(name.toUpperCase()+' 입장 취소'));
    assert.equal(q.dialog(), null, 'check-in does not open a detail panel');
  }
  q.finish();
});
