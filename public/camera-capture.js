// Match the centered object-fit: cover preview before applying software zoom.
export function getCaptureFrame(sourceWidth, sourceHeight, viewportWidth, viewportHeight, zoom = 1) {
  const ratio = viewportWidth / viewportHeight;
  const cropWidth = Math.min(sourceWidth, sourceHeight * ratio) / zoom;
  const cropHeight = Math.min(sourceHeight, sourceWidth / ratio) / zoom;
  const scale = Math.min(1, 1536 / Math.max(cropWidth, cropHeight));
  return {
    x: (sourceWidth - cropWidth) / 2,
    y: (sourceHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}
