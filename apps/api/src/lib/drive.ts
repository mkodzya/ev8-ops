import { createSign } from 'node:crypto';

// Google Drive, read only (Mika, 19.10.2026, variant A; ADR-0031).
//
// The company's rentals are kept in Drive the way the people work: a folder
// for each renter, named by the pickup day and the name, with the contract
// and the hand-over act; when the moped comes back, the folder moves to the
// finished rentals with the return act. EV8 Ops reads that — never writes,
// never moves, never deletes (the owner's rule: nothing is deleted in Drive) —
// and lays it beside the rentals here.
//
// Access is a Google service account the company made and shared the rentals
// folder with as a viewer. Its key is a server secret (`DRIVE_SA_KEY`, the
// JSON Google gives, as it is or in base64), put there by
// `deploy/set-drive-key.sh`; the folder is `DRIVE_ROOT`. Neither is in the
// repository. The scope asked for is read only.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface DriveConfig {
  clientEmail: string;
  privateKey: string;
  /** The rentals folder shared with the service account. */
  root: string;
}

/** Null without a usable key and folder: the link is then off. */
export function driveConfig(e: NodeJS.ProcessEnv = process.env): DriveConfig | null {
  const raw = (e.DRIVE_SA_KEY ?? '').trim();
  const root = (e.DRIVE_ROOT ?? '').trim();
  if (!raw || !root) return null;
  let json: { type?: string; client_email?: string; private_key?: string };
  try {
    json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (json.type !== 'service_account' || !json.client_email || !json.private_key) return null;
  return { clientEmail: json.client_email, privateKey: json.private_key, root };
}

/** Why Drive gave nothing: our word for it, never its answer. */
export type DriveFailure = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'http' | 'network' | 'bad_answer';

export class DriveError extends Error {
  constructor(
    readonly failure: DriveFailure,
    readonly httpStatus: number | null = null,
    readonly stage: 'token' | 'api' = 'api',
  ) {
    super(`drive: ${failure}${httpStatus ? ` (${httpStatus})` : ''} at the ${stage}`);
  }
}

const failureOf = (status: number): DriveFailure =>
  status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'http';

/** The signed request for a token: a JWT the service account's key signs (RS256). */
export function assertion(cfg: Pick<DriveConfig, 'clientEmail' | 'privateKey'>, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const sign = createSign('RSA-SHA256');
  sign.update(body);
  return `${body}.${sign.sign(cfg.privateKey).toString('base64url')}`;
}

let cached: { token: string; until: number; email: string } | null = null;

async function token(cfg: DriveConfig, fetchFn: typeof fetch): Promise<string> {
  if (cached && cached.email === cfg.clientEmail && cached.until > Date.now() + 60_000) return cached.token;
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(cfg) }).toString(),
    });
  } catch {
    throw new DriveError('network', null, 'token');
  }
  if (!res.ok) throw new DriveError(res.status === 400 ? 'unauthorized' : failureOf(res.status), res.status, 'token');
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) throw new DriveError('bad_answer', null, 'token');
  cached = { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000, email: cfg.clientEmail };
  return body.access_token;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string | null;
}

export const FOLDER = 'application/vnd.google-apps.folder';

async function get(cfg: DriveConfig, path: string, fetchFn: typeof fetch): Promise<Response> {
  const t = await token(cfg, fetchFn);
  let res: Response;
  try {
    res = await fetchFn(`${API}${path}`, { headers: { authorization: `Bearer ${t}` } });
  } catch {
    throw new DriveError('network');
  }
  if (!res.ok) throw new DriveError(failureOf(res.status), res.status);
  return res;
}

/** What a folder holds, every page of it; things in the bin are not there. */
export async function listFolder(cfg: DriveConfig, folderId: string, fetchFn: typeof fetch = fetch): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(page ? { pageToken: page } : {}),
    });
    const body = (await (await get(cfg, `/files?${q}`, fetchFn)).json().catch(() => null)) as { files?: DriveItem[]; nextPageToken?: string } | null;
    if (!body || !Array.isArray(body.files)) throw new DriveError('bad_answer');
    out.push(...body.files.map((f) => ({ ...f, webViewLink: f.webViewLink ?? null })));
    page = body.nextPageToken;
  } while (page);
  return out;
}

/** A file's bytes. Only the documents the scan reads ask for this — never a photo. */
export async function download(cfg: DriveConfig, fileId: string, fetchFn: typeof fetch = fetch): Promise<Buffer> {
  const res = await get(cfg, `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, fetchFn);
  return Buffer.from(await res.arrayBuffer());
}

/** For a test: forget the token, so the next call asks for one. */
export function forgetToken(): void {
  cached = null;
}
