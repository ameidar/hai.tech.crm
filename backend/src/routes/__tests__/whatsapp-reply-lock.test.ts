import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * WhatsApp Reply Lock — Unit tests
 * Tests the per-conversation queuing mechanism that prevents duplicate AI replies
 */

// Simulate the reply lock mechanism (mirrors production code)
function createReplyLockSystem() {
  const replyLocks = new Map<string, Promise<void>>();
  const callLog: Array<{ convId: string; startedAt: number; finishedAt: number }> = [];

  async function queueReply(convId: string, replyFn: () => Promise<void>) {
    const prevLock = replyLocks.get(convId) || Promise.resolve();
    const currentLock = prevLock.then(async () => {
      const started = Date.now();
      try {
        await replyFn();
      } catch (e) {
        // Error is caught so the chain continues for next messages
      }
      callLog.push({ convId, startedAt: started, finishedAt: Date.now() });
    });
    replyLocks.set(convId, currentLock);
    currentLock.finally(() => {
      if (replyLocks.get(convId) === currentLock) {
        replyLocks.delete(convId);
      }
    });
    return currentLock;
  }

  return { replyLocks, callLog, queueReply };
}

describe('WhatsApp Reply Lock', () => {

  describe('Sequential execution per conversation', () => {
    it('should execute replies sequentially for the same conversation', async () => {
      const { callLog, queueReply } = createReplyLockSystem();
      const order: number[] = [];

      const p1 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 50));
        order.push(1);
      });
      const p2 = queueReply('conv1', async () => {
        order.push(2);
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2]); // Must be sequential, not [2, 1]
    });

    it('should process 3 messages in order', async () => {
      const { queueReply } = createReplyLockSystem();
      const order: number[] = [];

      const p1 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 30));
        order.push(1);
      });
      const p2 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 20));
        order.push(2);
      });
      const p3 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 10));
        order.push(3);
      });

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('Parallel execution for different conversations', () => {
    it('should allow parallel replies for different conversations', async () => {
      const { queueReply } = createReplyLockSystem();
      const startTime = Date.now();
      const completionTimes: Record<string, number> = {};

      const p1 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 50));
        completionTimes['conv1'] = Date.now() - startTime;
      });
      const p2 = queueReply('conv2', async () => {
        await new Promise(r => setTimeout(r, 50));
        completionTimes['conv2'] = Date.now() - startTime;
      });

      await Promise.all([p1, p2]);
      // Both should complete around the same time (parallel), not 100ms+ (sequential)
      expect(Math.abs(completionTimes['conv1'] - completionTimes['conv2'])).toBeLessThan(30);
    });
  });

  describe('Memory cleanup', () => {
    it('should clean up lock after completion', async () => {
      const { replyLocks, queueReply } = createReplyLockSystem();

      await queueReply('conv1', async () => {});
      // Allow microtask (.finally) to run
      await new Promise(r => setTimeout(r, 10));
      expect(replyLocks.has('conv1')).toBe(false);
    });

    it('should not clean up lock if a newer lock exists', async () => {
      const { replyLocks, queueReply } = createReplyLockSystem();

      const p1 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 50));
      });
      // Queue second before first finishes
      const p2 = queueReply('conv1', async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      // After p1 finishes, lock should still exist (p2 is the current lock)
      await p1;
      expect(replyLocks.has('conv1')).toBe(true);

      await p2;
      await new Promise(r => setTimeout(r, 10));
      expect(replyLocks.has('conv1')).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should continue processing next message even if previous fails', async () => {
      const { queueReply } = createReplyLockSystem();
      const order: string[] = [];

      const p1 = queueReply('conv1', async () => {
        order.push('start-1');
        throw new Error('GPT timeout');
      });

      const p2 = queueReply('conv1', async () => {
        order.push('start-2');
      });

      await Promise.all([p1, p2]);
      expect(order).toContain('start-1');
      expect(order).toContain('start-2');
    });

    it('should not block conversation permanently on error', async () => {
      const { replyLocks, queueReply } = createReplyLockSystem();

      await queueReply('conv1', async () => {
        throw new Error('fail');
      });

      // Should still be able to queue new replies
      const result = { completed: false };
      await queueReply('conv1', async () => {
        result.completed = true;
      });
      expect(result.completed).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle rapid double-tap from user', async () => {
      const { queueReply } = createReplyLockSystem();
      const replies: string[] = [];

      // Simulate: user sends "היי" twice quickly
      // First reply takes time (GPT call), second waits
      const messageHistory: string[] = [];

      const p1 = queueReply('conv1', async () => {
        // GPT sees: ["היי"]
        await new Promise(r => setTimeout(r, 30));
        const reply = 'היי! 👋 אשמח לעזור';
        messageHistory.push(reply);
        replies.push(reply);
      });

      const p2 = queueReply('conv1', async () => {
        // GPT sees: ["היי", "היי! 👋 אשמח לעזור", "היי"] — now has context
        await new Promise(r => setTimeout(r, 10));
        const reply = messageHistory.length > 0
          ? 'מחפשים קורס לילד/ה?'  // contextual follow-up
          : 'היי! 👋 אשמח לעזור';   // would be duplicate without lock
        replies.push(reply);
      });

      await Promise.all([p1, p2]);
      // With lock: two different replies
      expect(replies[0]).not.toBe(replies[1]);
    });
  });
});
