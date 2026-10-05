// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app';
import { DiskBlobStore, FileKeyValueStore } from '../../backend/src/infra';
import { DemoInbox } from '../../shared/auth-service';
import { HttpGateway } from '../src/api/http-gateway';

let server: Server;
let base = '';
let dir = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nightshade-web-'));
  const app = createApp(
    { tokenSecret: 'x'.repeat(40), corsOrigins: ['*'], publicUrl: '', maxUploadMb: 5, exposeDevCodes: true, passwordIterations: 1000 },
    { kv: new FileKeyValueStore(join(dir, 'db.json')), blobs: new DiskBlobStore(join(dir, 'up')), mailer: new DemoInbox() },
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

it('drives the real API end to end through the frontend client', async () => {
  const gateway = new HttpGateway(base);
  const mail = await gateway.register('Lily', 'lily@example.com', 'pumpkin42');
  await expect(gateway.login('lily@example.com', 'pumpkin42')).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });
  const session = await gateway.verifyEmail('lily@example.com', mail!.code);
  const library = await gateway.openLibrary(session);
  expect(library.music.name).toBe('Music');

  const result = await library.addFiles([new File([new Uint8Array(64)], 'Lily - Halloween.mp3', { type: 'audio/mpeg' })]);
  expect(result.added[0].title).toBe('Halloween');
  await library.addRemote('https://archive.org/download/a/Two.mp3', {});
  await library.addRemote('https://archive.org/download/a/Three.mp3', {});
  const mix = await library.createPlaylist('Mix');
  for (const id of library.music.tracks) await library.addToPlaylist(mix.id, id);
  await library.moveInPlaylist(mix.id, 0, 2);
  await expect(Promise.resolve().then(() => library.renamePlaylist(library.music.id, 'X'))).rejects.toThrow();

  const fresh = await gateway.openLibrary(session);
  expect(fresh.playlistTracks(mix.id).map((t) => t.title)).toEqual(['Two', 'Three', 'Halloween']);

  const url = await fresh.resolveSource(result.added[0]);
  const audio = await fetch(`${base}${url}`);
  expect(audio.status).toBe(200);
  expect(audio.headers.get('content-type')).toContain('audio/mpeg');
});
