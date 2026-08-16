const PLAYBACK_REQUEST_KEY = "lottery:experience-playback";
const PLAYBACK_REQUEST_TTL = 30_000;

function normalizePath(path) {
    return String(path || "/").replace(/\/+$/, "") || "/";
}

export function requestExperiencePlayback(route) {
    try {
        window.sessionStorage.setItem(PLAYBACK_REQUEST_KEY, JSON.stringify({
            route: normalizePath(route),
            expiresAt: Date.now() + PLAYBACK_REQUEST_TTL
        }));
    } catch {
        // Navigation still works when storage is unavailable; the destination
        // page will fall back to its regular media policy.
    }
}

function consumePlaybackRequest() {
    try {
        const serialized = window.sessionStorage.getItem(PLAYBACK_REQUEST_KEY);
        window.sessionStorage.removeItem(PLAYBACK_REQUEST_KEY);
        if (!serialized) return false;
        const request = JSON.parse(serialized);
        return request.expiresAt >= Date.now()
            && normalizePath(request.route) === normalizePath(window.location.pathname);
    } catch {
        return false;
    }
}

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

export function createExperiencePlayback(video, { volume = 0.95, companions = [] } = {}) {
    const requested = consumePlaybackRequest();
    const media = [video, ...companions].filter(Boolean);
    let fallbackButton = null;

    const applySound = (force = false) => {
        if (!requested && !force) return;
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
        if (!requested || fallbackButton) return;
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
        document.body.appendChild(fallbackButton);
    };

    const play = async ({ sound = false } = {}) => {
        applySound(sound);
        try {
            await Promise.all(media.map(element => element.play()));
            applySound(sound);
            hideFallback();
        } catch (error) {
            showFallback();
            throw error;
        }
    };

    video.addEventListener("playing", hideFallback);
    return { requested, applySound, play, showFallback };
}
