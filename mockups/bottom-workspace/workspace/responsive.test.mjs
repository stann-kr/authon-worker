import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

// Build the standalone artifact first. These verify state/semantics, not geometry.
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
async function workspace(route = 'planning/bookings', search = '') {
  const errors = [], observers = new Set();
  let frameWidth = 1280, contentWidth = 1280;
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: `http://localhost:4176/${search}#${route}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.add(this); }
        observe() {}
        disconnect() { observers.delete(this); }
      };
      w.HTMLElement.prototype.getBoundingClientRect = function () {
        const top = this.matches('.workspace-scroll') ? 160 : this.matches('.dock-region') ? 700 : 50;
        const width = this.matches('.workspace-scroll') ? contentWidth : frameWidth;
        return { x: 0, y: top, left: 0, right: width, width, top, bottom: 850, height: 850 - top };
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
  const resize = async (width, mainWidth = width) => { frameWidth = width; contentWidth = mainWidth; [...observers].forEach(o => o.callback()); await tick(); };
  const navigate = async route => { w.location.hash = `#${route}`; await tick(70); };
  const submit = async () => { dialog().querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(230); };
  const finish = () => { assert.deepEqual(errors, []); dom.window.close(); };
  await tick(80);
  return { w, d, tick, button, dialog, click, input, label, resize, navigate, submit, finish };
}

test('Door comparison keeps the same roster, search, filter, check-in and selected detail between layouts', async () => {
  const q = await workspace('workspace/door', '?door-compare=1&door-layout=columns');
  assert.equal(q.d.querySelector('[aria-label="역할 미리보기"]').value, 'door');
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 20);
  const search = q.d.querySelector('.roster-search input');
  await q.click(q.button('B · 이름 중심'));
  await q.input(search, '김서윤');
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 2);
  const pendingFilter = q.d.querySelectorAll('.roster-status-filters button')[1];
  await q.click(pendingFilter);
  await q.click(q.d.querySelector('.guest-list .check-button'));
  await q.tick(220);
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 1);
  await q.click(q.button('A · 열 정렬'));
  assert.equal(q.d.querySelector('.roster-search input'), search);
  assert.equal(search.value, '김서윤');
  assert.equal(pendingFilter.getAttribute('aria-pressed'), 'true');
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 1);
  assert.ok(pendingFilter.textContent.includes('13'));
  const person = q.d.querySelector('.guest-list .guest-person');
  await q.click(person);
  const detail = q.dialog();
  await q.click(q.button('B · 이름 중심'));
  assert.equal(q.dialog(), detail);
  assert.equal(person.getAttribute('aria-pressed'), 'true');
  assert.equal(q.button('B · 이름 중심').getAttribute('aria-pressed'), 'true');
  assert.equal(new URLSearchParams(q.w.location.search).get('door-layout'), 'identity');
  q.finish();
});

test('name-first mobile search remains available and queued check-ins survive comparison changes', async () => {
  const q = await workspace('workspace/door', '?door-compare=1&door-layout=identity');
  await q.resize(390);
  const input = q.d.querySelector('.roster-search input');
  assert.equal(input.parentElement.hidden, false);
  await q.input(input, 'Lucas');
  input.dispatchEvent(new q.w.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
  await q.tick();
  assert.equal(input.value, '');
  assert.equal(input.parentElement.hidden, false);
  await q.input(q.d.querySelector('[aria-label="목업 상태"]'), 'offline');
  const action = q.d.querySelector('.guest-list .check-button');
  await q.click(action); await q.tick(220);
  assert.equal(action.textContent.trim(), '기기 저장');
  assert.equal(action.disabled, true);
  await q.click(q.button('A · 열 정렬'));
  await q.click(q.button('B · 이름 중심'));
  assert.equal(q.d.querySelector('.guest-list .check-button'), action);
  assert.equal(action.textContent.trim(), '기기 저장');
  assert.equal(action.disabled, true);
  assert.ok(q.d.querySelectorAll('.roster-status-filters button')[2].textContent.includes('6'));
  q.finish();
});

test('desktop navigation comparisons share the roster, filters, check-in and queued state', async () => {
  const q = await workspace('workspace/door', '?door-compare=1&workspace-layout=sidebar');
  assert.equal(q.d.querySelectorAll('nav[aria-label="주요 메뉴"]').length, 1);
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 20);
  assert.equal(q.button('아티스트', q.d.querySelector('nav')), undefined, 'Door role only gets its allowed navigation');
  assert.ok(q.d.querySelector('.workspace-header [aria-label="현재 화면 작업"]'));
  assert.equal(q.d.querySelector('.dock-region nav'), null);
  const search = q.d.querySelector('.roster-search input');
  await q.input(search, '김서윤');
  const pending = q.d.querySelectorAll('.roster-status-filters button')[1];
  await q.click(pending);
  await q.click(q.d.querySelector('.guest-list .check-button')); await q.tick(220);
  await q.click(q.button('B · 상단 메뉴'));
  assert.equal(q.button('B · 상단 메뉴').getAttribute('aria-pressed'), 'true');
  assert.equal(q.d.querySelector('.roster-search input'), search);
  assert.equal(search.value, '김서윤');
  assert.equal(pending.getAttribute('aria-pressed'), 'true');
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 1);
  assert.ok(pending.textContent.includes('13'));
  assert.equal(new URLSearchParams(q.w.location.search).get('workspace-layout'), 'top');
  const person = q.d.querySelector('.guest-person');
  await q.click(person);
  const detail = q.dialog();
  await q.click(q.button('A · 좌측 사이드바'));
  assert.equal(q.dialog(), detail);
  assert.equal(person.getAttribute('aria-pressed'), 'true');
  await q.click(q.button('닫기', detail));
  await q.input(q.d.querySelector('[aria-label="목업 상태"]'), 'offline');
  const action = q.d.querySelector('.guest-list .check-button');
  await q.click(action); await q.tick(220);
  await q.click(q.button('B · 상단 메뉴'));
  assert.equal(q.d.querySelector('.guest-list .check-button'), action);
  assert.equal(action.textContent.trim(), '기기 저장');
  assert.equal(action.disabled, true);
  q.finish();
});

test('desktop actions, menu focus and open forms survive return to the mobile dock', async () => {
  const q = await workspace('workspace/door', '?door-compare=1&workspace-layout=top');
  const activeNav = () => q.d.querySelector('nav [aria-current="page"]');
  activeNav().focus();
  await q.resize(390);
  assert.ok(q.d.querySelector('.dock-region nav'));
  assert.equal(q.d.querySelector('.desktop-chrome'), null);
  assert.equal(q.d.activeElement, activeNav());
  await q.resize(1280);
  assert.equal(q.d.activeElement, activeNav());
  assert.equal(q.d.querySelectorAll('nav[aria-label="주요 메뉴"]').length, 1);
  await q.click(q.button('전체 메뉴'));
  await q.click(q.button('내 명단', q.dialog()));
  await q.tick(60);
  assert.equal(q.dialog(), null);
  assert.equal(q.d.activeElement, activeNav());
  assert.equal(activeNav().textContent.trim(), '내 명단');
  await q.click(q.button('도어', q.d.querySelector('nav')));
  await q.click(q.button('코드 조회'));
  const form = q.dialog();
  const input = form.querySelector('input');
  await q.input(input, 'MOCK-REVIEW'); input.focus();
  await q.resize(390);
  assert.equal(q.dialog(), form);
  assert.equal(form.querySelector('input'), input);
  assert.equal(input.value, 'MOCK-REVIEW');
  assert.equal(q.d.activeElement, input);
  await q.resize(1280);
  assert.equal(q.dialog(), form);
  assert.equal(q.d.activeElement, input);
  await q.click(q.button('닫기', form));
  await q.input(q.d.querySelector('[aria-label="역할 미리보기"]'), 'admin');
  await q.click(q.button('A · 좌측 사이드바'));
  assert.ok(q.button('아티스트', q.d.querySelector('nav')), 'admin sees its additional destinations');
  await q.click(q.button('아티스트', q.d.querySelector('nav')));
  assert.equal(activeNav().textContent.trim(), '아티스트');
  await q.click(q.button('B · 상단 메뉴'));
  assert.equal(activeNav().textContent.trim(), '아티스트', 'top menu keeps the selected destination visible');
  q.finish();
});

test('original workspace uses the sidebar across operating screens, roles and empty scopes', async () => {
  const q = await workspace();
  assert.equal(q.d.querySelector('[aria-label="데스크톱 메뉴 비교"]'), null);
  assert.equal(q.d.querySelector('[aria-label="명단 비교"]'), null);
  const routes = [
    'planning/artists', 'planning/bookings', 'planning/schedule', 'planning/preparation',
    'workspace/events', 'workspace/roster', 'workspace/door', 'workspace/attendance',
    'workspace/links', 'workspace/users', 'workspace/analytics', 'workspace/requests',
    'workspace/report', 'workspace/profile', 'workspace/home',
  ];
  for (const route of routes) {
    await q.navigate(route);
    assert.equal(q.d.querySelector('.app-shell').dataset.view, route.split('/')[1]);
    assert.equal(q.d.querySelector('.app-shell').dataset.workspaceLayout, 'sidebar');
    assert.equal(q.d.querySelectorAll('nav[aria-label="주요 메뉴"]').length, 1);
    assert.ok(q.d.querySelector('.desktop-chrome nav'));
    assert.equal(q.d.querySelector('.dock-region nav'), null);
    if (route === 'workspace/users') {
      await q.click(q.d.querySelector('main .flow-row-button'));
      const role = q.dialog().querySelector('select[name="role"]');
      assert.equal(role.value, 'venue_admin', 'read-only account details display the actual current role');
      assert.equal(role.matches(':disabled'), true, 'displaying the role does not grant edit permission');
      await q.click(q.button('닫기', q.dialog()));
    }
  }
  await q.input(q.d.querySelector('[aria-label="역할 미리보기"]'), 'door');
  await q.navigate('workspace/door');
  assert.equal(q.button('계정', q.d.querySelector('nav')), undefined);
  await q.input(q.label('베뉴 구성'), 'none');
  assert.equal(q.button('도어', q.d.querySelector('nav')), undefined);
  assert.equal(q.d.querySelectorAll('.workspace-header .action-pill').length, 0);
  assert.ok(q.button('내 계정 열기'));
  await q.resize(834);
  assert.ok(q.d.querySelector('.dock-region nav'));
  await q.resize(1280);
  assert.ok(q.d.querySelector('.desktop-chrome nav'));
  for (const role of ['auth', 'external']) {
    await q.input(q.d.querySelector('[aria-label="역할 미리보기"]'), role);
    assert.equal(q.d.querySelector('.desktop-chrome'), null);
    assert.equal(q.d.querySelector('nav[aria-label="주요 메뉴"]'), null);
  }
  q.finish();
});

test('sidebar groups destinations, discloses pending work and follows navigation without losing mobile access', async () => {
  const q = await workspace('workspace/door');
  const nav = () => q.d.querySelector('nav[aria-label="주요 메뉴"]');
  const group = name => [...nav().querySelectorAll('.sidebar-group')].find(section => section.querySelector('h2 span').textContent === name);
  const toggle = name => group(name).querySelector('h2 button');
  const panel = name => group(name).querySelector('.sidebar-group-items');
  assert.deepEqual([...nav().querySelectorAll('h2 button > span:first-of-type')].map(el => el.textContent),
    ['공연 준비', '현장 운영', '운영 기록', '관리']);
  assert.equal(q.button('전체 메뉴', nav()), undefined);
  assert.ok(q.button('홈', nav()));
  assert.equal(toggle('현장 운영').getAttribute('aria-expanded'), 'true');
  assert.equal(panel('공연 준비').hidden, true);
  assert.deepEqual([...panel('현장 운영').querySelectorAll('button')].map(el => el.getAttribute('aria-label')),
    ['명단', '등록 링크', '인원 요청', '도어', '입장 집계']);
  assert.ok(toggle('관리').querySelector('[aria-label$="pending"], [aria-label^="대기 "]'));
  const search = q.d.querySelector('.roster-search input');
  await q.input(search, '김서윤');
  await q.click(toggle('공연 준비'));
  assert.equal(panel('현장 운영').hidden, true);
  assert.ok(toggle('현장 운영').querySelector('.nav-count'), 'pending work remains visible while collapsed');
  assert.equal(q.d.querySelector('.roster-search input'), search);
  assert.equal(search.value, '김서윤');
  const destination = q.button('부킹', panel('공연 준비'));
  await q.click(destination);
  assert.equal(q.w.location.hash, '#planning/bookings');
  assert.equal(panel('공연 준비').hidden, false);
  assert.equal(destination.getAttribute('aria-current'), 'page');
  assert.equal(q.d.activeElement, destination);
  await q.navigate('workspace/door');
  assert.equal(panel('현장 운영').hidden, false, 'returning to a previous screen does not restore an unrelated open group');
  assert.equal(q.d.activeElement, q.button('도어', nav()), 'focus leaves the newly hidden group');
  await q.navigate('workspace/requests');
  assert.equal(panel('현장 운영').hidden, false, 'direct navigation opens its destination group');
  assert.equal(panel('공연 준비').hidden, true);
  const requests = q.button('인원 요청', nav());
  assert.ok(q.d.getElementById(requests.getAttribute('aria-describedby')));
  requests.focus();
  await q.resize(390);
  assert.equal(q.d.activeElement.getAttribute('aria-label'), '인원 요청');
  await q.click(q.button('전체 메뉴'));
  assert.ok(q.dialog().textContent.includes('운영 기록'));
  await q.click(q.button('아티스트 관리', q.dialog()));
  await q.resize(1280);
  assert.equal(panel('공연 준비').hidden, false);
  assert.equal(q.d.activeElement.getAttribute('aria-label'), '아티스트');
  await q.input(q.d.querySelector('[aria-label="역할 미리보기"]'), 'door');
  await q.navigate('workspace/door');
  assert.equal(nav().querySelectorAll('.sidebar-group').length, 1);
  assert.equal(nav().querySelector('h2 button'), null, 'a single permitted group needs no disclosure');
  assert.equal(nav().querySelector('.sidebar-group-items').hidden, false);
  assert.equal(q.button('계정', nav()), undefined);
  await q.navigate('workspace/profile');
  assert.equal(q.button('내 계정 열기').getAttribute('aria-current'), 'page');
  assert.equal(q.button('프로필', nav()), undefined);
  q.finish();
});

test('roster column choice preserves ordering, check-ins and detail, and survives narrow views and navigation', async () => {
  const q = await workspace('workspace/door', '?door-compare=1');
  assert.equal(q.button('1열 보기').getAttribute('aria-pressed'), 'true');
  const rows = [...q.d.querySelectorAll('.guest-list > li')];
  await q.click(q.button('2열 보기'));
  assert.equal(q.button('2열 보기').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...q.d.querySelectorAll('.guest-list > li')], rows, 'same people and reading order');
  const search = q.d.querySelector('.roster-search input');
  await q.input(search, '김서윤');
  const pending = q.d.querySelectorAll('.roster-status-filters button')[1];
  await q.click(pending);
  await q.click(q.d.querySelector('.guest-list .check-button')); await q.tick(220);
  await q.click(q.button('1열 보기'));
  assert.equal(q.d.querySelector('.roster-search input'), search);
  assert.equal(search.value, '김서윤');
  assert.equal(pending.getAttribute('aria-pressed'), 'true');
  assert.equal(q.d.querySelectorAll('.guest-list > li').length, 1);
  assert.ok(pending.textContent.includes('13'));
  await q.click(q.d.querySelector('.guest-person'));
  const detail = q.dialog();
  await q.click(q.button('2열 보기'));
  assert.equal(q.dialog(), detail);
  await q.resize(1280, 700);
  assert.equal(q.button('1열 보기').getAttribute('aria-pressed'), 'true');
  assert.equal(q.button('2열 보기').disabled, true);
  await q.resize(1280);
  assert.equal(q.button('2열 보기').getAttribute('aria-pressed'), 'true');
  await q.click(q.button('닫기', detail));
  q.button('2열 보기').focus();
  await q.resize(390);
  assert.equal(q.button('2열 보기'), undefined);
  assert.equal(q.d.activeElement, q.d.querySelector('main'));
  assert.equal(q.d.querySelector('.roster-search input'), search);
  assert.equal(search.value, '김서윤');
  await q.resize(1280);
  assert.equal(q.button('2열 보기').getAttribute('aria-pressed'), 'true');
  await q.input(q.d.querySelector('[aria-label="목업 상태"]'), 'offline');
  const action = q.d.querySelector('.guest-list .check-button');
  await q.click(action); await q.tick(220);
  await q.click(q.button('1열 보기'));
  assert.equal(q.d.querySelector('.guest-list .check-button'), action);
  assert.equal(action.textContent.trim(), '기기 저장');
  assert.equal(action.disabled, true);
  await q.click(q.button('2열 보기'));
  await q.navigate('workspace/roster');
  assert.equal(q.button('2열 보기').getAttribute('aria-pressed'), 'true');
  assert.equal(q.d.querySelector('.check-button'), null, 'Door account cannot check in through its personal roster');
  const savedSearch = q.w.location.search;
  assert.equal(new URLSearchParams(savedSearch).get('roster-columns'), '2');
  q.finish();
  const restored = await workspace('workspace/door', savedSearch);
  assert.equal(restored.button('2열 보기').getAttribute('aria-pressed'), 'true');
  restored.finish();
});

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
