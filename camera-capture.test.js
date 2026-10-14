import test from 'node:test';
import assert from 'node:assert/strict';
import { getCaptureFrame } from './public/camera-capture.js';

test('desktop landscape camera captures only the portrait viewfinder', () => {
  assert.deepEqual(getCaptureFrame(1920, 1080, 300, 400), {
    x: 555, y: 0, cropWidth: 810, cropHeight: 1080, width: 810, height: 1080,
  });
});

test('software zoom crops inside the same viewfinder without enlarging pixels', () => {
  assert.deepEqual(getCaptureFrame(1920, 1080, 300, 400, 2), {
    x: 757.5, y: 270, cropWidth: 405, cropHeight: 540, width: 405, height: 540,
  });
});

test('portrait phone camera crops excess height instead of stretching', () => {
  assert.deepEqual(getCaptureFrame(1080, 1920, 300, 400), {
    x: 0, y: 240, cropWidth: 1080, cropHeight: 1440, width: 1080, height: 1440,
  });
});

test('high resolution capture is capped at 1536 pixels without changing framing', () => {
  assert.deepEqual(getCaptureFrame(3840, 2160, 400, 600), {
    x: 1200, y: 0, cropWidth: 1440, cropHeight: 2160, width: 1024, height: 1536,
  });
});

test('responsive frames keep the visible ratio within one output pixel', () => {
  for (const [viewportWidth, viewportHeight] of [[286, 410], [356, 638], [446, 714], [446, 596]]) {
    for (const [sourceWidth, sourceHeight] of [[640, 480], [1920, 1080], [1080, 1920]]) {
      const frame = getCaptureFrame(sourceWidth, sourceHeight, viewportWidth, viewportHeight);
      assert.ok(frame.width < frame.height);
      assert.ok(frame.x >= 0 && frame.y >= 0);
      assert.ok(frame.x + frame.cropWidth <= sourceWidth);
      assert.ok(frame.y + frame.cropHeight <= sourceHeight);
      assert.ok(Math.abs(frame.width - frame.height * viewportWidth / viewportHeight) <= 1);
    }
  }
});
