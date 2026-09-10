import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ProcessSignature, SignatureStatus } from '../shared/types';

const execFileAsync = promisify(execFile);

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const LOOKUP_TIMEOUT_MS = 45000;
const BATCH_SIZE = 60;

/** Authenticode verdicts are stable for a given binary; re-checking is pure cost. */
const cache = new Map<string, ProcessSignature>();

interface PsSignatureRow {
  Path?: string | null;
  Status?: string | null;
  Subject?: string | null;
}

/** Map SignatureStatus enum names onto the app's coarser vocabulary. */
function toStatus(raw: string | null | undefined): SignatureStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'valid':
      return 'valid';
    case 'notsigned':
      return 'unsigned';
    case 'hashmismatch':
      return 'tampered';
    case 'nottrusted':
    case 'unknownerror':
      return 'untrusted';
    default:
      return 'unavailable';
  }
}

/**
 * Pull the common name out of a certificate subject such as
 * `CN="Contoso, Inc.", O=Contoso, C=US`. Falls back to the raw subject so a
 * publisher is still shown when the subject uses an unexpected shape.
 */
export function extractPublisher(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const match = /(?:^|,)\s*CN=(?:"((?:[^"]|"")*)"|([^,]*))/i.exec(subject);
  const name = (match?.[1]?.replace(/""/g, '"') ?? match?.[2] ?? subject).trim();
  return name.length > 0 ? name : null;
}

/** Parse the JSON emitted by the Authenticode batch script. Pure — unit tested. */
export function parseSignatureOutput(json: string): Map<string, ProcessSignature> {
  const results = new Map<string, ProcessSignature>();
  if (!json.trim()) return results;

  const parsed = JSON.parse(json) as PsSignatureRow | PsSignatureRow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const checkedAt = Date.now();

  for (const row of rows) {
    if (typeof row?.Path !== 'string' || !row.Path) continue;
    const status = toStatus(row.Status);
    results.set(row.Path, {
      publisher: status === 'unsigned' ? null : extractPublisher(row.Subject),
      status,
      checkedAt,
    });
  }
  return results;
}

function buildScript(paths: string[]): string {
  // Paths reach PowerShell as single-quoted literals in a data array, never as
  // command text; doubling embedded quotes is the full escaping requirement.
  const literals = paths.map((path) => `'${path.replace(/'/g, "''")}'`).join(',');
  return `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(${literals})
Get-AuthenticodeSignature -FilePath $paths |
  Select-Object @{n='Path';e={$_.Path}},@{n='Status';e={$_.Status.ToString()}},@{n='Subject';e={$_.SignerCertificate.Subject}} |
  ConvertTo-Json -Compress -Depth 2
`.trim();
}

export function getCachedSignature(path: string): ProcessSignature | null {
  return cache.get(path) ?? null;
}

/**
 * Verify any paths not already cached. Resolves to the newly resolved entries
 * only, so callers can push a small delta to the renderer.
 */
export async function resolveSignatures(paths: string[]): Promise<Map<string, ProcessSignature>> {
  const pending = [...new Set(paths)].filter((path) => path && !cache.has(path));
  const resolved = new Map<string, ProcessSignature>();
  if (pending.length === 0) return resolved;

  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    const batch = pending.slice(index, index + BATCH_SIZE);
    try {
      const { stdout } = await execFileAsync('powershell.exe', [...PS_ARGS, buildScript(batch)], {
        encoding: 'utf8',
        timeout: LOOKUP_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      });
      for (const [path, signature] of parseSignatureOutput(stdout)) {
        cache.set(path, signature);
        resolved.set(path, signature);
      }
    } catch (error) {
      console.error('[Signature] Authenticode batch failed:', error);
    }

    // A path the batch skipped still needs an answer, or the UI would show
    // "Checking…" forever and retry the same failing binary on every scan.
    for (const path of batch) {
      if (cache.has(path)) continue;
      const fallback: ProcessSignature = {
        publisher: null,
        status: 'unavailable',
        checkedAt: Date.now(),
      };
      cache.set(path, fallback);
      resolved.set(path, fallback);
    }
  }

  return resolved;
}
