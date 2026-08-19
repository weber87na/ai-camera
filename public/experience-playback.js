/**
 * Decode one muted video frame so a Three.js VideoTexture has a visible
 * initial image before the user starts the experience.
 */
export async function primeVideoFrame(video) {
    if (!video) return false;

    const originalMuted = video.muted;
    const originalDefaultMuted = video.defaultMuted;
    const originalVolume = video.volume;

    video.pause();
    video.currentTime = 0;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;

    try {
        await video.play();
        await new Promise((resolve) => {
            if (typeof video.requestVideoFrameCallback === "function") {
                video.requestVideoFrameCallback(() => resolve());
                return;
            }
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        video.pause();
        video.currentTime = 0;
        return true;
    } catch {
        video.pause();
        video.currentTime = 0;
        return false;
    } finally {
        video.muted = originalMuted;
        video.defaultMuted = originalDefaultMuted;
        video.volume = originalVolume;
    }
}

export function createExperiencePlayback(video, {
    volume = 0.95,
    companions = [],
    container = document.body
} = {}) {
    const media = [video, ...companions].filter(Boolean);
    let fallbackButton = null;

    const applySound = (force = false) => {
        if (!force) return;
        media.forEach(element => {
            element.defaultMuted = false;
            element.muted = false;
            element.volume = volume;
        });
    };

    const hideFallback = () => {
        fallbackButton?.remove();
        fallbackButton = null;
    };

    const showFallback = () => {
        if (fallbackButton) return;
        fallbackButton = document.createElement("button");
        fallbackButton.type = "button";
        fallbackButton.className = "experience-playback-fallback";
        fallbackButton.textContent = "播放影片並開啟聲音";
        fallbackButton.addEventListener("click", async event => {
            event.stopPropagation();
            try {
                await play({ sound: true });
            } catch {
                // Keep the button visible so another trusted gesture can retry.
            }
        });
        container.appendChild(fallbackButton);
    };

    const play = async ({ sound = false } = {}) => {
        applySound(sound);
        try {
            await Promise.all(media.map(element => element.play()));
            applySound(sound);
            hideFallback();
        } catch (error) {
            if (sound) showFallback();
            throw error;
        }
    };

    video.addEventListener("playing", hideFallback);
    return { applySound, play, showFallback };
}
