import {describe, expect, it, vi} from 'vitest';
vi.mock('@config/blah', () => ({default: {discovery: true}}));
import {isDomainUsername, isUsernameValid, isWebAppNameValid} from '@lib/richTextProcessor/validators';
import parseEntities from '@lib/richTextProcessor/parseEntities';

describe('Blah domain usernames', () => {
  it('accepts DNS labels and rejects malformed or oversized names', () => {
    for(const name of ['alice.example.org', '123.example', 'a-b.c', 'a'.repeat(63) + '.example']) {
      expect(isDomainUsername(name)).toBe(true);
      expect(isUsernameValid(name)).toBe(true);
    }
    for(const name of ['alice..example', '-alice.example', 'alice-.example', 'a_b.example', 'alice.example.', 'a'.repeat(64) + '.example', 'a.'.repeat(128) + 'a']) {
      expect(isDomainUsername(name)).toBe(false);
      expect(isUsernameValid(name)).toBe(false);
    }
    expect(isWebAppNameValid('alice.example')).toBe(false);
  });

  it('keeps dotted mentions, command targets and tags whole', () => {
    for(const [text, type] of [
      ['@alice-long.example.org', 'messageEntityMention'],
      ['/check_profile@dc.example.org', 'messageEntityBotCommand'],
      ['#topic@alice.example.org', 'messageEntityHashtag']
    ]) {
      expect(parseEntities(text)).toEqual([expect.objectContaining({_: type, offset: 0, length: text.length})]);
    }
    const mention = '@' + 'a'.repeat(63) + '.example.org';
    expect(parseEntities(mention + '.')).toEqual([{_: 'messageEntityMention', offset: 0, length: mention.length}]);
  });
});
