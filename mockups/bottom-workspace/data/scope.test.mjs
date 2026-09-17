import test from 'node:test';
import assert from 'node:assert/strict';
import { initialData } from './fixtures.ts';
import { availableVenues, resolveScope } from './scope.ts';

test('ordinary accounts resolve only their assigned venue, including forged selection IDs', () => {
  const data = initialData();
  for (const id of ['admin', 'door', 'sora', 'studio-admin']) {
    const user = data.users.find(u => u.id === id);
    const result = resolveScope(data, user, 'unowned-venue', 'tonight');
    assert.deepEqual(availableVenues(data, user).map(v => v.id), [user.venueId]);
    assert.equal(result.venue.id, user.venueId);
    assert.equal(result.event.venueId, user.venueId);
  }
});

test('super admin can select either venue without importing another venue event', () => {
  const data = initialData(), user = data.users.find(u => u.id === 'super');
  assert.equal(availableVenues(data, user).length, 2);
  assert.equal(resolveScope(data, user, 'studio', 'tonight').event.id, 'studio-night');
  assert.equal(resolveScope(data, user, 'faust', 'studio-night').event.id, 'tonight');
});

test('zero venues and unassigned accounts expose no real venue or event', () => {
  const data = initialData();
  const unassigned = resolveScope(data, data.users.find(u => u.id === 'unassigned'), 'faust', 'tonight');
  assert.equal(unassigned.status, 'no-venue');
  assert.equal(unassigned.venue.id, '');
  assert.equal(unassigned.venue.brandName, '');
  assert.equal(unassigned.event.id, '');
  data.venues = [];
  for (const id of ['super', 'admin']) {
    const result = resolveScope(data, data.users.find(u => u.id === id), 'faust', 'tonight');
    assert.equal(result.status, 'no-venue');
    assert.equal(result.venue.name, '');
    assert.equal(result.event.name, '');
  }
});

test('inactive assignment never falls back to another active venue', () => {
  const data = initialData();
  data.venues.find(v => v.id === 'faust').active = false;
  const admin = resolveScope(data, data.users.find(u => u.id === 'admin'), 'faust', 'tonight');
  assert.equal(admin.status, 'inactive-venue');
  assert.equal(admin.venue.id, '');
  const superScope = resolveScope(data, data.users.find(u => u.id === 'super'), 'faust', 'tonight');
  assert.equal(superScope.venue.id, 'studio');
  assert.equal(superScope.event.id, 'studio-night');
});

test('missing or archived events do not fall back across dates or venues', () => {
  const data = initialData(), user = data.users.find(u => u.id === 'super');
  const missing = resolveScope(data, user, 'studio', 'tonight', '2026-09-18');
  assert.equal(missing.status, 'no-event');
  assert.equal(missing.event.id, '');
  assert.equal(missing.event.venueId, 'studio');
  assert.equal(missing.event.date, '2026-09-18');
  data.events.filter(e => e.venueId === 'studio').forEach(e => { e.state = 'archived'; });
  assert.equal(resolveScope(data, user, 'studio', 'studio-night').status, 'no-event');
});

test('explicit general-list selection is retained, and unavailable accounts have no venue', () => {
  const data = initialData(), user = data.users.find(u => u.id === 'admin');
  assert.equal(resolveScope(data, user, 'faust', 'general-faust').event.id, 'general-faust');
  user.active = false;
  assert.deepEqual(availableVenues(data, user), []);
  user.active = true; user.deleted = true;
  assert.deepEqual(availableVenues(data, user), []);
});
