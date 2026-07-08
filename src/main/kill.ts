import { execFile } from 'child_process';
import { promisify } from 'util';
import type { KillResult } from '../shared/types';

const execFileAsync = promisify(execFile);

/** PIDs that must never be killed: System Idle (0) and System (4). */
export function isKillablePid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 4 && pid <= 0xffffffff;
}

function looksLikeAccessDenied(message: string): boolean {
  return /access is denied|denied|\(5\)/i.test(message);
}

/**
 * Kill a process via taskkill using an argument array — no shell parsing,
 * so a malicious renderer cannot inject shell syntax through the pid.
 */
export async function killProcess(pid: unknown, tree: boolean): Promise<KillResult> {
  if (!isKillablePid(pid)) {
    return { success: false, error: 'Invalid or protected PID' };
  }

  const args = ['/PID', String(pid), '/F'];
  if (tree) args.push('/T');

  try {
    await execFileAsync('taskkill', args, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Kill] taskkill failed for PID ${pid}:`, message);
    return {
      success: false,
      error: message,
      needsElevation: looksLikeAccessDenied(message),
    };
  }
}

/**
 * Retry a kill with elevation via a UAC prompt. Runs taskkill through
 * Start-Process -Verb RunAs; arguments are numeric-validated before use.
 */
export async function killProcessElevated(pid: unknown, tree: boolean): Promise<KillResult> {
  if (!isKillablePid(pid)) {
    return { success: false, error: 'Invalid or protected PID' };
  }

  const taskkillArgs = `'/PID','${pid}','/F'${tree ? ",'/T'" : ''}`;
  const script = `Start-Process -FilePath taskkill -ArgumentList ${taskkillArgs} -Verb RunAs -Wait -WindowStyle Hidden`;

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 60000, windowsHide: true },
    );
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Kill] Elevated taskkill failed for PID ${pid}:`, message);
    // "The operation was canceled by the user" => UAC prompt declined.
    const cancelled = /canceled|cancelled/i.test(message);
    return { success: false, error: cancelled ? 'Elevation was declined' : message };
  }
}
