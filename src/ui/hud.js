// =====================================================================
// HUD — notifications, generating overlay, info bar
// =====================================================================

export function notify(text) {
    const c = document.getElementById('notifications');
    const div = document.createElement('div');
    div.className = 'notification';
    div.textContent = text;
    c.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

export function showGenerating(text) {
    document.getElementById('generating-text').textContent = text;
    document.getElementById('generating-overlay').style.display = 'block';
}

export function updateGenerating(text) {
    document.getElementById('generating-text').textContent = text;
}

export function hideGenerating() {
    document.getElementById('generating-overlay').style.display = 'none';
}

export function updateInfoBar(playerPos, aiStatus) {
    document.getElementById('info-bar').textContent =
        `Pos: ${playerPos.x.toFixed(0)}, ${playerPos.z.toFixed(0)} | AI: ${aiStatus} | Powered by Claude Code + Blender MCP`;
}
