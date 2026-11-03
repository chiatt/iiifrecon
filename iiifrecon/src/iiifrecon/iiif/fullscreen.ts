// Fullscreen the whole viewer (controls included) rather than just the canvas.
export function toggleFullscreen(element: HTMLElement) {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        element.requestFullscreen();
    }
}
