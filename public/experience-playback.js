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

export function createExperiencePlayback(video, { volume = 0.95, companions = [] } = {}) {
    const requested = consumePlaybackRequest();
    const media = [video, ...companions].filter(Boolean);
    let fallbackButton = null;

    const applySound = () => {
        if (!requested) return;
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
                await play();
            } catch {
                // Keep the button visible so another trusted gesture can retry.
            }
        });
        document.body.appendChild(fallbackButton);
    };

    const play = async () => {
        applySound();
        try {
            await Promise.all(media.map(element => element.play()));
            applySound();
            hideFallback();
        } catch (error) {
            showFallback();
            throw error;
        }
    };

    video.addEventListener("playing", hideFallback);
    return { requested, applySound, play, showFallback };
}
