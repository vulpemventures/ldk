import * as assert from 'assert';
import { bip32 } from '../src/bip32';

import { fromXpub, toXpub } from '../src/utils';

const xpub =
  'xpub661MyMwAqRbcGC851SCJ22vDfA3ModMuFd9NozAt1d3diLCW31jN13wF2tx6uYCKTkjMuKDUNjVuvyMuvieXfv64Fm44MhjMdFFJ2hXcTp4';

describe('changeVersionBytes', () => {
  it('should be reversable', () => {
    const vpubkey = fromXpub(xpub, 'regtest');
    const xpubAfterVpub = toXpub(vpubkey);
    assert.deepStrictEqual(xpubAfterVpub, xpub);
  });

  it('should be a valid point', () => {
    const x =
      'xpub6CpihtY9HVc1jNJWCiXnRbpXm5BgVNKqZMsM4XqpDcQigJr6AHNwaForLZ3kkisDcRoaXSUms6DJNhxFtQGeZfWAQWCZQe1esNetx5Wqe4M';
    const v = fromXpub(x, 'regtest');
    const xFromV = toXpub(v);
    assert.doesNotThrow(() => bip32.fromBase58(x));
    assert.doesNotThrow(() => bip32.fromBase58(xFromV));
  });
});
