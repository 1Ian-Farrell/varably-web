const { test } = require('node:test');
const assert = require('node:assert/strict');
const editor = require('../admin-content-editor.js');

function values(extra = {}) {
  return {
    title: 'Title', location: 'Location', description: 'Description',
    latitude: '42', longitude: '-71', environment: 'both', parking: '3',
    free: false, costTier: '$$$$', costNotes: 'Admission',
    activities: [{ activityName: 'Hiking', gear: ['boots'] }],
    links: [{ label: 'Website', url: 'https://example.test' }],
    hasHours: true, allDay: false,
    schedule: '{"Mon":{"isOpen":true,"openTime":"9:00 AM","closeTime":"5:00 PM"}}',
    date: '2026-10-11', start: '09:00', end: '17:00', repeat: 'Every week',
    customRepeat: '', locationSpot: 'linked-spot', liveFeed: false, ...extra,
  };
}
test('web editor writes every owner-editable spot field without rewriting ownership or billing', () => {
  const updates = editor.buildUpdates(values(), 'spots');
  assert.deepEqual(Object.keys(updates).sort(), ['title', 'location', 'description', 'latitude', 'longitude',
    'environment', 'isOutdoors', 'parkingType', 'cost', 'activities', 'links', 'hoursOfOperation'].sort());
  assert.equal(updates.cost.tier, '$$$$');
  assert.deepEqual(updates.activities, [{ activityName: 'hiking', gear: ['boots'] }]);
  assert.equal(updates.hoursOfOperation.schedule.Mon.openTime, '9:00 AM');
});
test('web editor includes event date, times, recurrence, linked spot and live feed', () => {
  const updates = editor.buildUpdates(values(), 'events');
  assert.equal(updates.date.getDate(), 11);
  assert.equal(updates.startTime, '9:00 AM');
  assert.equal(updates.endTime, '5:00 PM');
  assert.deepEqual(updates.recurrence, { repeatOption: 'Every week', customValue: null });
  assert.equal(updates.locationSpotId, 'linked-spot');
  assert.equal(updates.enableLiveFeed, false);
  assert.equal(updates.hoursOfOperation, undefined);
});
test('invalid fields fail explicitly before any save or upload', () => {
  for (const extra of [
    { title: '' }, { latitude: '91' }, { longitude: '' }, { activities: 'broken' },
    { activities: [{ activityName: 'hiking', gear: 7 }] },
    { links: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] },
    { schedule: '{"Mon":{"isOpen":true,"openTime":"bad","closeTime":"5:00 PM"}}' },
  ]) assert.throws(() => editor.buildUpdates(values(extra), 'spots'));
  for (const extra of [{ date: '2026-02-30' }, { end: '25:00' },
    { repeat: 'Custom...', customRepeat: '' }, { locationSpot: 'spots/id' }]) {
    assert.throws(() => editor.buildUpdates(values(extra), 'events'));
  }
});
test('approval deduplicates and accepts exactly 10 photos but never 11', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `photo-${i}`);
  assert.equal(editor.mergePhotos(nine, ['photo-0', 'new']).length, 10);
  assert.throws(() => editor.mergePhotos(nine, ['new', 'extra']), /at most 10/);
  assert.deepEqual(editor.photoList({ coverImage: 'cover', imageUrls: ['a', 'a'] }), ['cover', 'a']);
});
test('legacy time values convert correctly to time inputs', () => {
  assert.equal(editor.timeInput('12:00 AM'), '00:00');
  assert.equal(editor.timeInput('12:00 PM'), '12:00');
  assert.equal(editor.timeInput('7:30 PM'), '19:30');
  assert.equal(editor.timeInput('19:30'), '19:30');
});
