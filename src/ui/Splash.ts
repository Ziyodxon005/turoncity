/**
 * showSplash — splash_image.png ekranning yuqori qismini egallaydi.
 * 5 soniyadan keyin avtomatik yopiladi (yoki bosish/teginish bilan tezroq).
 * Footer: "TURON O'quv markazi tomonidan ishlab chiqilgan"
 */
export function showSplash(container: HTMLElement, onContinue?: () => void): void {
  if (!document.getElementById('splash-style')) {
    const s = document.createElement('style');
    s.id = 'splash-style';
    s.textContent = `
      @keyframes splashPulse { 0%,100%{opacity:.3} 50%{opacity:.9} }
      @keyframes splashIn    { from{opacity:0;transform:scale(1.03)} to{opacity:1;transform:scale(1)} }
      @keyframes splashFooterIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      @keyframes progressBar { from{width:0%} to{width:100%} }
    `;
    document.head.appendChild(s);
  }

  const overlay = document.createElement('div');
  overlay.id = 'splash';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100;background:#000;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:flex-start;transition:opacity .6s ease;' +
    'touch-action:none;cursor:pointer;';

  // ── Rasm — ekranning yuqori qismini egallaydi ──────────────────────────────
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}splash_image.png`;
  img.alt = 'TURON CITY';
  img.style.cssText =
    'width:100%;height:75vh;object-fit:cover;object-position:center top;display:block;' +
    'animation:splashIn .6s ease both;transition:opacity .4s ease;';
  overlay.appendChild(img);

  // ── Quyi qism (qora) ───────────────────────────────────────────────────────
  const bottom = document.createElement('div');
  bottom.style.cssText =
    'flex:1;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:10px;padding:12px 0 8px;';

  // Progress bar (5 soniya)
  const barTrack = document.createElement('div');
  barTrack.style.cssText =
    'width:clamp(180px,40vw,320px);height:3px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden;';
  const barFill = document.createElement('div');
  barFill.style.cssText =
    'height:100%;background:linear-gradient(90deg,#54a0ff,#a8d8ff);border-radius:2px;' +
    'animation:progressBar 10s linear both;';
  barTrack.appendChild(barFill);

  // Hint
  const hint = document.createElement('div');
  hint.textContent = 'Bosish yoki teginish uchun...';
  hint.style.cssText =
    'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(10px,1.8vmin,14px);' +
    'color:rgba(255,255,255,.6);letter-spacing:1px;animation:splashPulse 1.4s ease-in-out infinite;';

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText =
    'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(8px,1.4vmin,11px);' +
    'color:rgba(84,160,255,.65);letter-spacing:1.5px;text-shadow:0 0 10px rgba(84,160,255,.4);' +
    'animation:splashFooterIn .8s ease .3s both;';
  footer.textContent = '⚡ TURON O\'QUV MARKAZI TOMONIDAN ISHLAB CHIQILGAN ⚡';

  bottom.append(barTrack, hint, footer);
  overlay.appendChild(bottom);
  container.appendChild(overlay);

  // ── Dismiss ──────────────────────────────────────────────────────────────────
  let dismissed = false;
  let padRaf = 0;

  const cleanup = (): void => {
    removeEventListener('pointerdown', dismiss);
    removeEventListener('keydown', dismiss);
    cancelAnimationFrame(padRaf);
  };

  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    onContinue?.();
    cleanup();
    img.style.opacity = '0';
    hint.style.opacity = '0';
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => overlay.remove(), 650);
    }, 420);
  };

  // 5 soniyadan keyin avtomatik yopiladi
  const autoTimer = setTimeout(dismiss, 10000);
  const origDismiss = dismiss;
  const earlyDismiss = (): void => { clearTimeout(autoTimer); origDismiss(); };

  addEventListener('pointerdown', earlyDismiss);
  addEventListener('keydown', earlyDismiss);

  const pollPad = (): void => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.buttons.some((b) => b.pressed)) { earlyDismiss(); return; }
    }
    padRaf = requestAnimationFrame(pollPad);
  };
  padRaf = requestAnimationFrame(pollPad);

  (window as Window & { __skipSplash?: () => void }).__skipSplash = (): void => {
    clearTimeout(autoTimer);
    cleanup();
    overlay.remove();
  };
}
