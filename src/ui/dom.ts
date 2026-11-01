export function $<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Falta el elemento ${sel}`);
  return el;
}

export type MsgLevel = '' | 'ok' | 'warn' | 'err';

/** Console status line. */
export function setMsg(text: string, level: MsgLevel = ''): void {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'msg ' + level;
}

/** Scanner state indicator in the top bar. */
export function setScanner(running: boolean, text: string): void {
  $('#state').classList.toggle('run', running);
  $('#stateTxt').textContent = text;
}

export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
