/**
 * PlatformSelect — shows a PC / Mobile choice after the splash screen.
 * The selection is persisted in localStorage so the player doesn't see it
 * on every reload.
 */

export type Platform = 'pc' | 'mobile';


export function showPlatformSelect(
  container: HTMLElement,
  onSelect: (p: Platform) => void,
): void {

  const overlay = document.createElement('div');
  overlay.id = 'platform-select';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:90;background:rgba(2,4,12,0.97);' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'font-family:ui-monospace,Menlo,Consolas,monospace;gap:40px;' +
    'animation:psFadeIn .4s ease;';

  // Inject keyframe once
  if (!document.getElementById('ps-style')) {
    const s = document.createElement('style');
    s.id = 'ps-style';
    s.textContent = `
      @keyframes psFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes psGlow{0%,100%{box-shadow:0 0 22px rgba(84,160,255,.35)}
        50%{box-shadow:0 0 44px rgba(84,160,255,.7)}}
      .ps-btn{
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:14px;width:220px;height:190px;border:2px solid rgba(255,255,255,.12);
        border-radius:20px;background:rgba(255,255,255,.04);cursor:pointer;
        color:#e8ecf5;transition:transform .15s,background .15s,border-color .15s;
        font-family:ui-monospace,Menlo,Consolas,monospace;
      }
      .ps-btn:hover{
        transform:translateY(-5px) scale(1.04);
        background:rgba(84,160,255,.12);
        border-color:rgba(84,160,255,.55);
        animation:psGlow 1.4s ease infinite;
      }
      .ps-btn .ps-icon{font-size:58px;line-height:1;}
      .ps-btn .ps-label{font-size:17px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}
      .ps-btn .ps-sub{font-size:11px;opacity:.55;text-align:center;line-height:1.5;max-width:160px;}
    `;
    document.head.appendChild(s);
  }

  const title = document.createElement('div');
  title.textContent = 'TURON CITY';
  title.style.cssText =
    'font-size:28px;font-weight:900;letter-spacing:6px;color:#54a0ff;' +
    'text-shadow:0 0 30px rgba(84,160,255,.6);';

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Platforma tanlang';
  subtitle.style.cssText = 'font-size:13px;opacity:.55;letter-spacing:2px;margin-top:-24px;';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:28px;';

  const makeBtn = (icon: string, label: string, sub: string, platform: Platform): HTMLElement => {
    const btn = document.createElement('button');
    btn.className = 'ps-btn';
    btn.innerHTML = `
      <span class="ps-icon">${icon}</span>
      <span class="ps-label">${label}</span>
      <span class="ps-sub">${sub}</span>
    `;
    btn.addEventListener('click', () => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity .3s ease';
      setTimeout(() => {
        overlay.remove();
        onSelect(platform);
      }, 300);
    });
    return btn;
  };

  btnRow.appendChild(makeBtn('🖥️', 'PC', 'Sichqoncha + klaviatura\n360° kamera', 'pc'));
  btnRow.appendChild(makeBtn('📱', 'Mobil', 'Sensorli joystick\nbarmoq bilan', 'mobile'));

  const hint = document.createElement('div');
  hint.textContent = 'Keyingi safar ham shu ekran chiqadi';
  hint.style.cssText = 'font-size:10px;opacity:.3;text-align:center;margin-top:8px;';

  overlay.append(title, subtitle, btnRow, hint);
  container.appendChild(overlay);
}
