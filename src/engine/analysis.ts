import type { Frame } from './connection';
import { correlate, type CorrelationResult } from './correlation';
import type { OperationIntent } from './intent';
import { matchFrame, type MessageShape } from './routing';
import { identifyBySchema, validateFrame, type ValidationResult } from './validation';

export interface FrameAnalysis {
  /** Message each identified frame belongs to, by frame id. */
  messageIds: Map<number, string>;
  /** Schema verdicts by frame id; frames with nothing to check are absent. */
  validations: Map<number, ValidationResult>;
  /** Request/reply links, for operations the client sends. */
  correlation?: CorrelationResult;
  /** Correlation ids this operation has already sent. */
  sentKeys: ReadonlySet<string>;
}

export type AnalysisIntent = Pick<
  OperationIntent,
  'id' | 'direction' | 'messages' | 'replyMessages' | 'routingMessages' | 'discriminator'
>;

/**
 * Without a discriminator, frames the operation expects can still be checked when only one
 * message could be the expected one.
 */
function soleExpectedMessage(intent: AnalysisIntent, frame: Frame): MessageShape | undefined {
  if (intent.discriminator) return undefined;
  const expected =
    frame.direction === 'out'
      ? frame.source === intent.id
        ? intent.messages
        : []
      : intent.direction === 'clientSends'
        ? intent.replyMessages
        : intent.messages;
  return expected.length === 1 ? expected[0] : undefined;
}

/** Identifies, validates and correlates a connection log from one operation's point of view. */
export function analyzeFrames(intent: AnalysisIntent, frames: readonly Frame[]): FrameAnalysis {
  const messagesById = new Map(intent.routingMessages.map((message) => [message.id, message]));
  const onlyMessage = intent.routingMessages.length === 1 ? intent.routingMessages[0] : undefined;
  const messageIds = new Map<number, string>();
  const validations = new Map<number, ValidationResult>();

  for (const frame of frames) {
    let messageId = frame.isJson ? matchFrame(frame.json, intent.discriminator) : undefined;
    if (messageId === undefined && !frame.binary) {
      // A channel with a single message can only carry that message. Otherwise fall back to the
      // one schema that accepts the frame (PROJECT.MD §6, step 3).
      messageId = onlyMessage ? onlyMessage.id : identifyBySchema(frame, intent.routingMessages);
    }
    if (messageId !== undefined) {
      messageIds.set(frame.id, messageId);
    }

    const expected =
      messageId !== undefined ? messagesById.get(messageId) : soleExpectedMessage(intent, frame);
    const validation = expected ? validateFrame(frame, expected) : undefined;
    if (validation && validation.status !== 'unsupported') {
      validations.set(frame.id, validation);
    }
  }

  const correlation =
    intent.direction === 'clientSends'
      ? correlate(frames, {
          operationId: intent.id,
          requestMessages: intent.messages,
          replyMessages: intent.replyMessages,
          messageIdOf: (frame) => messageIds.get(frame.id),
        })
      : undefined;

  const sentKeys = new Set<string>();
  correlation?.requests.forEach((request) => {
    if (request.key !== undefined) sentKeys.add(request.key);
  });

  return { messageIds, validations, correlation, sentKeys };
}
