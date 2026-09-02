import { describe, expect, it } from 'vitest';
import { isValidTimezone, validateProfilePatch } from '@/lib/account-profile-validation';

describe('validateProfilePatch', () => {
  it('accepts a full valid patch and normalises line endings', () => {
    const result = validateProfilePatch({
      status: 'ready',
      language: 'en',
      profile: 'line1\r\nline2',
      voice: 'v',
      strategy: 's',
      memory: 'm',
      postMode: 'auto',
      inboundReplyMode: 'approval',
      outboundReplyMode: 'draft',
      postsPerDay: 2,
      planHour: 9,
      planTimezone: 'America/New_York',
      unknown: 'ignored',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.profile).toBe('line1\nline2');
      expect(result.patch.postsPerDay).toBe(2);
      expect('unknown' in result.patch).toBe(false);
    }
  });

  it('rejects bad modes, cadence, hour and timezone with one error each', () => {
    const result = validateProfilePatch({
      postMode: 'yolo',
      postsPerDay: 9,
      planHour: 24,
      planTimezone: 'Mars/Olympus',
      status: 'archived',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(5);
    }
  });

  it('accepts a partial patch', () => {
    const result = validateProfilePatch({ postsPerDay: '1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch).toEqual({ postsPerDay: 1 });
  });

  it('rejects non-object bodies', () => {
    expect(validateProfilePatch(null).ok).toBe(false);
    expect(validateProfilePatch([]).ok).toBe(false);
  });
});

describe('isValidTimezone', () => {
  it('knows IANA names and rejects nonsense', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('Nowhere/City')).toBe(false);
  });
});

describe('reply lane fields', () => {
  it('accepts the playbook as a brief field and bounds the depth cap', () => {
    const ok = validateProfilePatch({ playbook: 'answer questions\r\nignore bait', maxRepliesPerConversation: '3' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.patch).toEqual({ playbook: 'answer questions\nignore bait', maxRepliesPerConversation: 3 });
    for (const bad of [0, 6, 1.5, 'many']) {
      const result = validateProfilePatch({ maxRepliesPerConversation: bad });
      expect(result.ok).toBe(false);
    }
  });
});
