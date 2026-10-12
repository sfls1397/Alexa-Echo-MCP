import { it, expect } from 'vitest';
import { keychainSessionStore } from '../src/alexa/session.js';

function fixture() {
  const items = new Map<string, string>();
  let failAfter = Infinity;
  let writes = 0;
  const exec = ((file: string, args: string[], options?: { input?: string }) => {
    expect(file).toBe('/usr/bin/security');
    if (options?.input !== undefined) {
      expect(args).toEqual(['-i']);
      expect(Buffer.byteLength(options.input)).toBeLessThan(4095);
      if (++writes === failAfter) throw new Error('fixture failure');
      const parts = /^add-generic-password -U -s "([^"\\]+)" -a "([^"\\]+)" -w "([^"\\]+)"\n$/.exec(options.input)!;
      if (!parts) throw new Error('invalid fixture command');
      items.set(parts[2]!, parts[3]!);
      return Buffer.from('');
    }
    const account = args[args.indexOf('-a') + 1]!;
    if (args[0] === 'find-generic-password') {
      if (!items.has(account)) throw new Error('absent');
      return Buffer.from(items.get(account)! + '\n');
    }
    if (!items.delete(account)) throw new Error('absent');
    return Buffer.from('');
  }) as typeof import('node:child_process').execFileSync;
  return { items, store: keychainSessionStore(exec), failNextChunk: () => { failAfter = writes + 2; } };
}
it('reads legacy sessions and round-trips large sessions with cleanup', () => {
  const f = fixture();
  const legacy = { localCookie: 'TEST_ONLY', refreshToken: 'TEST_REFRESH' };
  f.items.set('amazon-session', Buffer.from(JSON.stringify(legacy)).toString('base64'));
  expect(f.store.load()).toEqual(legacy);
  const large = { ...legacy, localCookie: 'TEST_ONLY_' + 'Z'.repeat(16000) };
  f.store.save(large);
  expect(f.items.size).toBeGreaterThan(4);
  expect(f.store.load()).toEqual(large);
  expect(f.store.clear()).toBe(true);
  expect(f.items.size).toBe(0);
});
it('keeps the prior session intact and removes partial chunks on write failure', () => {
  const f = fixture();
  const previous = { localCookie: 'TEST_ONLY', refreshToken: 'TEST_REFRESH' };
  f.store.save(previous);
  const snapshot = new Map(f.items);
  f.failNextChunk();
  expect(() => f.store.save({ ...previous, localCookie: 'Z'.repeat(16000) })).toThrow('credential values omitted');
  expect(f.items).toEqual(snapshot);
  expect(f.store.load()).toEqual(previous);
});
it('rejects missing or corrupted chunks', () => {
  const f = fixture();
  f.store.save({ localCookie: 'TEST_ONLY', refreshToken: 'TEST_REFRESH' });
  const chunk = [...f.items.keys()].find(key => key !== 'amazon-session')!;
  f.items.set(chunk, 'corrupt');
  expect(f.store.load()).toBeNull();
  f.items.delete(chunk);
  expect(f.store.load()).toBeNull();
});
