import test from 'node:test';
import assert from 'node:assert/strict';
import { operaDateString, operaCandidates, pickOperaWinner } from './public/opera-lottery.js';

test('opera draw date follows Taipei across the UTC midnight boundary', () => {
    assert.equal(operaDateString(new Date('2026-10-14T15:59:59Z')), '2026-10-14');
    assert.equal(operaDateString(new Date('2026-10-14T16:00:00Z')), '2026-10-15');
});

test('video lottery excludes unfinished pairs and preserves each winner name and video', () => {
    const data = { photos: [
        { url: '/storage/a.jpg', name: '  王 小明  ', video: '/storage/a.mp4' },
        { url: '/storage/b.jpg', name: '照片參加者' },
        { url: '/storage/c.jpg', name: '壞影片', video: 'javascript:alert(1)' },
        { url: 'javascript:alert(1)', name: '壞照片', video: '/storage/d.mp4' },
        null
    ] };
    assert.deepEqual(operaCandidates(data, true), [{ url: '/storage/a.jpg', name: '王 小明', video: '/storage/a.mp4' }]);
    const photos = operaCandidates(data, false);
    assert.equal(photos.length, 3);
    assert.ok(photos.every(photo => photo.video === ''), 'disabled mode never includes a playable video');
});

test('candidate normalization deduplicates photos and handles unnamed and empty pools', () => {
    assert.deepEqual(operaCandidates({}, true), []);
    assert.equal(pickOperaWinner([]), null);
    const pool = operaCandidates({ photos: [{ url: '/a.jpg' }, { url: '/a.jpg' }] }, false);
    assert.deepEqual(pool, [{ url: '/a.jpg', name: '未具名參加者', video: '' }]);
    assert.equal(pickOperaWinner(pool), pool[0]);
    const several = [...pool, { url: '/b.jpg', name: '第二位', video: '' }];
    for (let i = 0; i < 20; i++) assert.ok(several.includes(pickOperaWinner(several)));
});
