/**
 * @file window-state.ts
 * @brief Window geometry persistence across launches.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
// type-only import — erased at compile time, so this module stays pure Node
import type { BrowserWindow } from 'electron';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export function loadState(file: string, defaults: WindowState): WindowState {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WindowState>;
    return { ...defaults, ...s };
  } catch {
    return { ...defaults };
  }
}

/** Persist window bounds (debounced) so the app reopens where it was left. */
export function trackState(win: BrowserWindow, file: string): void {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    try {
      if (win.isDestroyed()) return;
      const bounds = win.getNormalBounds();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
    } catch {
      /* best effort */
    }
  };
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', onChange);
  win.on('move', onChange);
  win.on('close', save);
}
