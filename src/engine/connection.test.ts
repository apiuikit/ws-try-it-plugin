import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ConnectionOptions, type WebSocketLike } from './connection';

class FakeSocket implements WebSocketLike {
  binaryType = 'blob';
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;
  sent: string[] = [];
  closeCalls: Array<number | undefined> = [];

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {}

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closeCalls.push(code);
  }

  serverOpen() {
    this.onopen?.({});
  }
  serverMessage(data: unknown) {
    this.onmessage?.({ data });
  }
  serverClose(code: number, reason = '', wasClean = code !== 1006) {
    this.onclose?.({ code, reason, wasClean });
  }
}

const URL = 'ws://localhost:8787/echo';

function setup(options: ConnectionOptions = {}) {
  const sockets: FakeSocket[] = [];
  const manager = new ConnectionManager(URL, {
    createSocket: (url, protocols) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
    schedule: (flush) => flush(),
    pageProtocol: 'http:',
    ...options,
  });
  return { manager, sockets, status: () => manager.getSnapshot().status };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionManager', () => {
  it('opens a connection with arraybuffer binary type', () => {
    const { manager, sockets, status } = setup();
    manager.connect();
    expect(status()).toBe('connecting');
    expect(sockets[0].binaryType).toBe('arraybuffer');

    sockets[0].serverOpen();
    expect(status()).toBe('open');
  });

  it('opens the socket with credentials but publishes only the plain URL', () => {
    const { manager, sockets } = setup();
    const socketUrl = `${URL}?token=letmein`;
    manager.connect(socketUrl);

    expect(sockets[0].url).toBe(socketUrl);
    expect(manager.getSnapshot().url).toBe(URL);
    expect(JSON.stringify(manager.getSnapshot())).not.toContain('letmein');
    expect(manager.isUsing(socketUrl)).toBe(true);
    expect(manager.isUsing(`${URL}?token=other`)).toBe(false);

    sockets[0].serverClose(1006);
    expect(manager.isUsing(socketUrl)).toBe(false);
  });

  it('offers subprotocols and counts them as part of the connection identity', () => {
    const { manager, sockets } = setup();
    manager.connect(URL, { protocols: ['bearer', 'letmein'] });

    expect(sockets[0].protocols).toEqual(['bearer', 'letmein']);
    expect(manager.isUsing(URL, ['bearer', 'letmein'])).toBe(true);
    expect(manager.isUsing(URL, ['bearer', 'other'])).toBe(false);
    expect(manager.isUsing(URL)).toBe(false);
  });

  it('adds a failure hint to a failed handshake only', () => {
    const failed = setup();
    failed.manager.connect(URL, { failureHint: 'The server may also have rejected the credentials.' });
    failed.sockets[0].serverClose(1006);
    expect(failed.manager.getSnapshot().detail).toContain('rejected the credentials');

    const dropped = setup();
    dropped.manager.connect(URL, { failureHint: 'The server may also have rejected the credentials.' });
    dropped.sockets[0].serverOpen();
    dropped.sockets[0].serverClose(1011);
    expect(dropped.manager.getSnapshot().detail).not.toContain('rejected the credentials');
  });

  it('keeps credentials out of failure messages', () => {
    const { manager, sockets } = setup();
    manager.connect(`${URL}?token=letmein`);
    sockets[0].serverClose(1006);
    expect(manager.getSnapshot().detail).not.toContain('letmein');
  });

  it('does not open a second socket while connecting or open', () => {
    const { manager, sockets } = setup();
    manager.connect();
    manager.connect();
    sockets[0].serverOpen();
    manager.connect();
    expect(sockets).toHaveLength(1);
  });

  it('logs inbound text, JSON and binary frames', () => {
    const { manager, sockets } = setup();
    manager.connect();
    sockets[0].serverOpen();
    sockets[0].serverMessage('{"type":"tick"}');
    sockets[0].serverMessage('plain');
    sockets[0].serverMessage(new ArrayBuffer(4));

    expect(manager.getSnapshot().frames).toMatchObject([
      { direction: 'in', isJson: true, json: { type: 'tick' } },
      { direction: 'in', isJson: false, text: 'plain' },
      { direction: 'in', binary: true, text: '<binary, 4 bytes>' },
    ]);
  });

  it('sends frames tagged with their source operation', () => {
    const { manager, sockets } = setup();
    expect(() => manager.send('x')).toThrow('Not connected');

    manager.connect();
    sockets[0].serverOpen();
    manager.send('{"type":"ping"}', 'sendPing');

    expect(sockets[0].sent).toEqual(['{"type":"ping"}']);
    expect(manager.getSnapshot().frames).toMatchObject([
      { direction: 'out', source: 'sendPing', json: { type: 'ping' } },
    ]);
  });

  it('records send failures on the frame', () => {
    const { manager, sockets } = setup();
    manager.connect();
    sockets[0].serverOpen();
    sockets[0].send = () => {
      throw new Error('lone surrogate');
    };
    manager.send('bad');
    expect(manager.getSnapshot().frames[0].error).toBe('lone surrogate');
  });

  it('treats a user disconnect as a clean close', () => {
    const { manager, sockets, status } = setup();
    manager.connect();
    sockets[0].serverOpen();
    manager.disconnect();
    expect(status()).toBe('closing');
    expect(sockets[0].closeCalls).toEqual([1000]);

    sockets[0].serverClose(1000);
    expect(status()).toBe('closed-clean');
  });

  it('distinguishes a failed handshake from a dropped connection', () => {
    const failed = setup();
    failed.manager.connect();
    failed.sockets[0].serverClose(1006);
    expect(failed.manager.getSnapshot()).toMatchObject({
      status: 'closed-unexpected',
      detail: expect.stringContaining('Could not connect'),
    });

    const dropped = setup();
    dropped.manager.connect();
    dropped.sockets[0].serverOpen();
    dropped.sockets[0].serverClose(1011, 'boom');
    expect(dropped.manager.getSnapshot()).toMatchObject({
      status: 'closed-unexpected',
      detail: 'Connection lost (code 1011: boom).',
    });
  });

  it('gives up on a connection that never opens', () => {
    vi.useFakeTimers();
    const { manager, sockets, status } = setup({ connectTimeoutMs: 2000 });
    manager.connect();
    vi.advanceTimersByTime(2000);

    expect(status()).toBe('closed-unexpected');
    expect(sockets[0].closeCalls).toHaveLength(1);

    // Late events from the abandoned socket are ignored.
    sockets[0].serverClose(1006);
    sockets[0].serverOpen();
    expect(status()).toBe('closed-unexpected');
  });

  it('reconnects with a fresh socket and ignores the old one', () => {
    const { manager, sockets, status } = setup();
    manager.connect();
    sockets[0].serverOpen();
    sockets[0].serverClose(1011);
    manager.connect();
    sockets[1].serverOpen();

    sockets[0].serverMessage('stale');
    expect(status()).toBe('open');
    expect(manager.getSnapshot().frames).toHaveLength(0);
  });

  it('blocks mixed content without creating a socket', () => {
    const sockets: unknown[] = [];
    const manager = new ConnectionManager('ws://example.com', {
      createSocket: () => {
        sockets.push(null);
        return new FakeSocket('');
      },
      pageProtocol: 'https:',
    });
    manager.connect();
    expect(manager.getSnapshot().status).toBe('blocked-precheck');
    expect(sockets).toHaveLength(0);
  });

  it('caps the retained log', () => {
    const { manager, sockets } = setup({ maxFrames: 2 });
    manager.connect();
    sockets[0].serverOpen();
    ['1', '2', '3'].forEach((data) => sockets[0].serverMessage(data));
    expect(manager.getSnapshot().frames.map((frame) => frame.text)).toEqual(['2', '3']);
  });

  it('truncates oversized frames in the log without parsing them', () => {
    const { manager, sockets } = setup({ maxFrameLength: 10 });
    manager.connect();
    sockets[0].serverOpen();
    sockets[0].serverMessage('{"type":"a-long-message"}');
    manager.send('{"x":1}');

    expect(manager.getSnapshot().frames).toMatchObject([
      { direction: 'in', text: '{"type":"a', size: 25, truncated: true, isJson: false },
      { direction: 'out', text: '{"x":1}', size: 7, isJson: true },
    ]);
    expect(manager.getSnapshot().frames[1].truncated).toBeUndefined();
  });

  it('still sends oversized frames in full', () => {
    const { manager, sockets } = setup({ maxFrameLength: 3 });
    manager.connect();
    sockets[0].serverOpen();
    manager.send('abcdef');
    expect(sockets[0].sent).toEqual(['abcdef']);
    expect(manager.getSnapshot().frames[0]).toMatchObject({ text: 'abc', size: 6, truncated: true });
  });

  it('drops the oldest frames beyond the total log budget', () => {
    const { manager, sockets } = setup({ maxLogLength: 10 });
    manager.connect();
    sockets[0].serverOpen();
    ['aaaa', 'bbbb', 'cccc'].forEach((data) => sockets[0].serverMessage(data));
    expect(manager.getSnapshot().frames.map((frame) => frame.text)).toEqual(['bbbb', 'cccc']);
  });

  it('keeps the newest frame even when it alone exceeds the budget', () => {
    const { manager, sockets } = setup({ maxLogLength: 3 });
    manager.connect();
    sockets[0].serverOpen();
    sockets[0].serverMessage('aaaa');
    sockets[0].serverMessage('bbbbbb');
    expect(manager.getSnapshot().frames.map((frame) => frame.text)).toEqual(['bbbbbb']);
  });

  it('resets the budget when the log is cleared', () => {
    const { manager, sockets } = setup({ maxLogLength: 8 });
    manager.connect();
    sockets[0].serverOpen();
    sockets[0].serverMessage('aaaaaaaa');
    manager.clearLog();
    sockets[0].serverMessage('bbbb');
    sockets[0].serverMessage('cccc');
    expect(manager.getSnapshot().frames.map((frame) => frame.text)).toEqual(['bbbb', 'cccc']);
  });

  it('refuses hosts outside allowedHosts without creating a socket', () => {
    const { manager, sockets, status } = setup({ allowedHosts: ['api.example.com'] });
    manager.connect();
    expect(status()).toBe('blocked-precheck');
    expect(manager.getSnapshot().detail).toContain('localhost:8787');
    expect(sockets).toHaveLength(0);
  });

  it('batches frame notifications until the scheduled flush', () => {
    let flush: (() => void) | undefined;
    const { manager, sockets } = setup({ schedule: (fn) => (flush = fn) });
    const listener = vi.fn();
    manager.connect();
    sockets[0].serverOpen();
    manager.subscribe(listener);

    sockets[0].serverMessage('a');
    sockets[0].serverMessage('b');
    expect(listener).not.toHaveBeenCalled();
    expect(manager.getSnapshot().frames).toHaveLength(0);

    flush?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().frames).toHaveLength(2);
  });
});
