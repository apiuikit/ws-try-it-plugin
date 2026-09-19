import { describe, expect, it } from 'vitest';

import { analyzeFrames, type AnalysisIntent } from './analysis';
import type { Frame } from './connection';
import { inferDiscriminator, type MessageShape } from './routing';

let nextId = 1;
const frameOf = (direction: Frame['direction'], json: unknown, extra: Partial<Frame> = {}): Frame => {
  const text = JSON.stringify(json);
  return { id: nextId++, direction, at: nextId, text, size: text.length, binary: false, isJson: true, json, ...extra };
};

const message = (id: string, payloadSchema: unknown, correlationId?: string): MessageShape => ({
  id,
  name: id,
  payloadSchema,
  correlationId,
});

describe('analyzeFrames', () => {
  describe('with a discriminator (Kraken-like)', () => {
    const reqid = '$message.payload#/reqid';
    const subscribe = message(
      'subscribe',
      {
        type: 'object',
        required: ['event'],
        properties: {
          event: { const: 'subscribe' },
          reqid: { type: 'integer' },
          pair: { type: 'array', items: { type: 'string', pattern: '[A-Z]+\\/[A-Z]+' } },
        },
      },
      reqid,
    );
    const status = message(
      'subscriptionStatus',
      { type: 'object', required: ['event', 'status'], properties: { event: { const: 'subscriptionStatus' }, status: { type: 'string' } } },
      reqid,
    );
    const heartbeat = message('heartbeat', {
      type: 'object',
      required: ['event'],
      properties: { event: { const: 'heartbeat' } },
    });
    const routingMessages = [subscribe, status, heartbeat];
    const intent: AnalysisIntent = {
      id: 'receiveSubscribeRequest',
      direction: 'clientSends',
      messages: [subscribe],
      replyMessages: [status],
      routingMessages,
      discriminator: inferDiscriminator(routingMessages),
    };

    it('identifies, validates and correlates frames', () => {
      const request = frameOf('out', { event: 'subscribe', reqid: 7, pair: ['XBTUSD'] }, { source: intent.id });
      const reply = frameOf('in', { event: 'subscriptionStatus', reqid: 7, status: 'error' });
      const ticker = frameOf('in', [119930888, { a: [] }, 'ticker', 'XBT/USD']);
      const analysis = analyzeFrames(intent, [request, reply, ticker]);

      expect(analysis.messageIds.get(request.id)).toBe('subscribe');
      expect(analysis.messageIds.get(reply.id)).toBe('subscriptionStatus');
      expect(analysis.messageIds.has(ticker.id)).toBe(false);

      expect(analysis.validations.get(request.id)).toMatchObject({ status: 'invalid', issues: [{ path: '/pair/0' }] });
      expect(analysis.validations.get(reply.id)).toEqual({ status: 'valid' });
      // An unidentified frame has no schema to be checked against.
      expect(analysis.validations.has(ticker.id)).toBe(false);

      expect(analysis.correlation?.replies.get(reply.id)?.requestFrameId).toBe(request.id);
      expect([...analysis.sentKeys]).toEqual(['7']);
    });

    it('leaves a frame unidentified when several schemas accept it', () => {
      const loose = message('loose', { type: 'object' });
      const withLoose = { ...intent, routingMessages: [...routingMessages, loose, message('alsoLoose', { type: 'object' })] };
      const frame = frameOf('in', { channelID: 1 });
      expect(analyzeFrames(withLoose, [frame]).messageIds.has(frame.id)).toBe(false);
    });

    it('identifies a frame the discriminator missed when exactly one schema accepts it', () => {
      const noEvent = message('noEvent', { type: 'object', required: ['channelID'], properties: { channelID: { type: 'integer' } } });
      const withFallback = { ...intent, routingMessages: [...routingMessages, noEvent] };
      const frame = frameOf('in', { channelID: 1 });
      expect(analyzeFrames(withFallback, [frame]).messageIds.get(frame.id)).toBe('noEvent');
    });
  });

  describe('with a single message and no discriminator (Gemini-like)', () => {
    const market = message('marketData', {
      type: 'object',
      required: ['type'],
      properties: { type: { enum: ['update', 'heartbeat'] }, price: { type: 'number' } },
    });
    const intent: AnalysisIntent = {
      id: 'sendMarketData',
      direction: 'clientReceives',
      messages: [market],
      replyMessages: [],
      routingMessages: [market],
      discriminator: undefined,
    };

    it('labels every frame with the only message and validates it', () => {
      const update = frameOf('in', { type: 'update', price: '76290.58' });
      const heartbeat = frameOf('in', { type: 'heartbeat' });
      const binary = frameOf('in', null, { binary: true, isJson: false, text: '<binary>' });
      const analysis = analyzeFrames(intent, [update, heartbeat, binary]);

      expect(analysis.messageIds.get(update.id)).toBe('marketData');
      expect(analysis.messageIds.get(heartbeat.id)).toBe('marketData');
      expect(analysis.messageIds.has(binary.id)).toBe(false);
      expect(analysis.validations.get(update.id)).toMatchObject({ status: 'invalid', issues: [{ path: '/price' }] });
      expect(analysis.validations.get(heartbeat.id)).toEqual({ status: 'valid' });
      expect(analysis.correlation).toBeUndefined();
    });
  });
});
