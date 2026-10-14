import test from 'node:test';
import assert from 'node:assert/strict';
import { operaDateString, operaCandidates, pickOperaWinner, fetchOperaPool } from './public/opera-lottery.js';

function mockRandom(t, values) {
    let index = 0;
    return t.mock.method(globalThis.crypto, 'getRandomValues', buffer => {
        assert.ok(index < values.length, 'unexpected extra random draw');
        buffer[0] = values[index++];
        return buffer;
    });
}

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
    assert.deepEqual(operaCandidates(data, true), [{
        url: '/storage/a.jpg', name: '王 小明', video: '/storage/a.mp4', participantKey: 'name:王 小明'
    }]);
    const photos = operaCandidates(data, false);
    assert.equal(photos.length, 3);
    assert.ok(photos.every(photo => photo.video === ''), 'disabled mode never includes a playable video');
});

test('candidate normalization deduplicates photos and handles unnamed and empty pools', t => {
    mockRandom(t, [0]);
    assert.deepEqual(operaCandidates({}, true), []);
    assert.equal(pickOperaWinner([]), null);
    const pool = operaCandidates({ photos: [{ url: '/a.jpg' }, { url: '/a.jpg' }] }, false);
    assert.deepEqual(pool, [{ url: '/a.jpg', name: '未具名參加者', video: '', participantKey: 'url:/a.jpg' }]);
    assert.equal(pickOperaWinner(pool), pool[0]);
});

test('redrawing excludes every photo with the previous winner name from the latest pool', t => {
    mockRandom(t, [0, 1]);
    const previous = operaCandidates({ photos: [{ url: '/old.jpg', name: ' 王  小明 ' }] }, false)[0];
    const pool = operaCandidates({ photos: [
        { url: '/new-a.jpg', name: '王 小明' },
        { url: '/new-b.jpg', name: ' 王 小明 ' },
        { url: '/other-a.jpg', name: '另一位' },
        { url: '/other-b.jpg', name: '第三位' }
    ] }, false);
    assert.equal(pickOperaWinner(pool, previous), pool[2]);
    assert.equal(pickOperaWinner(pool, previous), pool[3]);
    assert.equal(pool.length, 4, 'exclusion must not remove entries from the shared pool');
});

test('unnamed participants use their photo URL rather than the shared display label', t => {
    mockRandom(t, [0, 0]);
    const pool = operaCandidates({ photos: [
        { url: '/unnamed-a.jpg' },
        { url: '/unnamed-b.jpg', name: '  ' },
        { url: '/named.jpg', name: '未具名參加者' }
    ] }, false);
    assert.equal(pickOperaWinner(pool, pool[0]), pool[1]);
    assert.equal(pickOperaWinner(pool, pool[2]), pool[0], 'a real name matching the fallback label is still distinct');
});

test('one remaining participant is drawable even with several photos and empty pools return null', t => {
    const random = mockRandom(t, [1, 0]);
    const pool = operaCandidates({ photos: [
        { url: '/one-a.jpg', name: '唯一參與者' },
        { url: '/one-b.jpg', name: '唯一參與者' }
    ] }, false);
    assert.equal(pickOperaWinner(pool, pool[0]), pool[1]);
    assert.equal(pickOperaWinner([pool[0]], pool[0]), pool[0]);
    assert.equal(pickOperaWinner([], pool[0]), null);
    assert.equal(random.mock.callCount(), 2);
});

test('eligible draws retain unbiased rejection sampling and accept a zero random value', t => {
    const random = mockRandom(t, [0xffffffff, 2, 0]);
    const pool = operaCandidates({ photos: ['甲', '乙', '丙', '丁'].map((name, i) => ({ url: `/${i}.jpg`, name })) }, false);
    assert.equal(pickOperaWinner(pool, pool[0]), pool[3]);
    assert.equal(random.mock.callCount(), 2, '2^32 - 1 must be rejected for a pool of three');
    assert.equal(pickOperaWinner(pool, pool[0]), pool[1]);
});

test('each fresh pool includes the actual Taipei query date for resetting draw history', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T15:59:59Z') });
    const photoRequests = [];
    t.mock.method(globalThis, 'fetch', async url => {
        if (url === '/api/config') return Response.json({ mode: 'opera', video: { enabled: false } });
        photoRequests.push(url);
        return Response.json({ photos: [{ url: '/a.jpg', name: '甲' }] });
    });
    const before = await fetchOperaPool();
    t.mock.timers.setTime(new Date('2026-10-14T16:00:00Z').getTime());
    const after = await fetchOperaPool();
    assert.equal(before.date, '2026-10-14');
    assert.equal(after.date, '2026-10-15');
    assert.deepEqual(photoRequests, ['/api/photos/2026-10-14', '/api/photos/2026-10-15']);
});

test('display photo URLs include unfinished videos independently from the filtered winner pool', async t => {
    let videoEnabled = true;
    const data = { photos: [
        { url: '/storage/finished.jpg', name: '完成', video: '/storage/finished.mp4' },
        { url: '/storage/pending.jpg', name: '製作中' },
        { url: '/storage/pending.jpg', name: '重複網址' },
        { url: '/storage/failed.jpg', name: '影片失敗', video: 'javascript:alert(1)' },
        { url: 'javascript:alert(1)', name: '無效照片', video: '/storage/invalid.mp4' },
        { url: 'data:image/png;base64,abc' },
        { url: '' },
        null
    ] };
    t.mock.method(globalThis, 'fetch', async url => Response.json(url === '/api/config'
        ? { mode: 'opera', video: { enabled: videoEnabled } }
        : data));
    const videoPool = await fetchOperaPool();
    assert.deepEqual(videoPool.entries.map(entry => entry.url), ['/storage/finished.jpg']);
    assert.deepEqual(videoPool.photoUrls, ['/storage/finished.jpg', '/storage/pending.jpg', '/storage/failed.jpg']);

    videoEnabled = false;
    const photoPool = await fetchOperaPool();
    assert.deepEqual(photoPool.photoUrls, videoPool.photoUrls);
    assert.deepEqual(photoPool.entries.map(entry => entry.url), videoPool.photoUrls);
});

test('display photo URLs accept legacy images without changing lottery candidates', async t => {
    t.mock.method(globalThis, 'fetch', async url => Response.json(url === '/api/config'
        ? { mode: 'opera', video: { enabled: true } }
        : { images: ['/storage/a.jpg', '/storage/a.jpg', 'https://example.com/b.jpg', 'javascript:alert(1)', 'file:///c.jpg', null, ' '] }));
    const pool = await fetchOperaPool();
    assert.deepEqual(pool.photoUrls, ['/storage/a.jpg', 'https://example.com/b.jpg']);
    assert.deepEqual(pool.entries, [], 'display fallback must not create new lottery candidates');
});

test('empty or missing stored photos never add example portraits to the display pool', async t => {
    let data = { photos: [], images: [] };
    t.mock.method(globalThis, 'fetch', async url => Response.json(url === '/api/config'
        ? { mode: 'opera', video: { enabled: true } }
        : data));
    for (const response of [{ photos: [], images: [] }, { images: [] }, {}]) {
        data = response;
        const pool = await fetchOperaPool();
        assert.deepEqual(pool.photoUrls, []);
        assert.deepEqual(pool.entries, []);
    }
});
