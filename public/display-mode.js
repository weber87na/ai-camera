export const CENTURY_WIDTH = 3008;
export const CENTURY_HEIGHT = 1376;
export const CENTURY_ASPECT = CENTURY_WIDTH / CENTURY_HEIGHT;
export const SIGNAL_ASPECT = 16 / 9;

export const isCenturyDisplay =
    new URLSearchParams(window.location.search).get("display") === "century";

if (isCenturyDisplay) {
    document.documentElement.classList.add("century-display");
}

export function getDisplaySize() {
    if (isCenturyDisplay) {
        return {
            width: CENTURY_WIDTH,
            height: CENTURY_HEIGHT,
            aspect: CENTURY_ASPECT,
            pixelRatio: 1
        };
    }

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    return {
        width,
        height,
        aspect: width / height,
        pixelRatio: window.devicePixelRatio || 1
    };
}

export function updateDisplayFrame() {
    const display = getDisplaySize();
    if (!isCenturyDisplay) return { ...display, directNativeOutput: false };

    const directNativeOutput =
        Math.abs(window.innerWidth - CENTURY_WIDTH) < 1 &&
        Math.abs(window.innerHeight - CENTURY_HEIGHT) < 1;
    const frameWidth = directNativeOutput
        ? CENTURY_WIDTH
        : Math.min(window.innerWidth, window.innerHeight * SIGNAL_ASPECT);
    const frameHeight = directNativeOutput
        ? CENTURY_HEIGHT
        : frameWidth / SIGNAL_ASPECT;

    const root = document.documentElement;
    root.style.setProperty("--display-frame-width", `${frameWidth}px`);
    root.style.setProperty("--display-frame-height", `${frameHeight}px`);
    root.style.setProperty("--display-scale-x", String(frameWidth / CENTURY_WIDTH));
    root.style.setProperty("--display-scale-y", String(frameHeight / CENTURY_HEIGHT));

    return {
        ...display,
        frameWidth,
        frameHeight,
        directNativeOutput
    };
}

export function isCompactDisplay() {
    return !isCenturyDisplay && window.innerWidth < 700;
}

export function getElementPointer(event, element) {
    const rect = element.getBoundingClientRect();
    const u = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
    const v = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
    return {
        u,
        v,
        ndcX: u * 2 - 1,
        ndcY: -(v * 2 - 1),
        rect
    };
}

export function withDisplayMode(path) {
    if (!isCenturyDisplay) return path;
    const url = new URL(path, window.location.origin);
    url.searchParams.set("display", "century");
    return `${url.pathname}${url.search}${url.hash}`;
}

export function preserveDisplayModeLinks(root = document) {
    if (!isCenturyDisplay) return;
    root.querySelectorAll("a[data-preserve-display]").forEach(link => {
        const href = link.getAttribute("href");
        if (href) link.setAttribute("href", withDisplayMode(href));
    });
}

export function initializeDisplayModeToggle(root = document) {
    const toggles = root.querySelectorAll("[data-display-mode-toggle]");
    if (!toggles.length) return;

    const toggleUrl = new URL(window.location.href);
    const nextMode = isCenturyDisplay ? "normal" : "century";
    if (isCenturyDisplay) {
        toggleUrl.searchParams.delete("display");
    } else {
        toggleUrl.searchParams.set("display", "century");
    }

    const href = `${toggleUrl.pathname}${toggleUrl.search}${toggleUrl.hash}`;
    const label = isCenturyDisplay ? "普通模式" : "世紀廳模式";
    const ariaLabel = isCenturyDisplay ? "切換至普通模式" : "切換至世紀廳模式";
    toggles.forEach(toggle => {
        toggle.href = href;
        toggle.textContent = label;
        toggle.setAttribute("aria-label", ariaLabel);
        toggle.dataset.displayMode = nextMode;
    });
}

initializeDisplayModeToggle();
