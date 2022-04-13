import * as assert from 'assert';
import { fromXpub, toXpub } from '../src/utils';
import * as ecc from 'tiny-secp256k1';
import BIP32Factory from 'bip32';
import { blindingKeyFromXPubs } from '../src/p2ms';

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
    assert.doesNotThrow(() => BIP32Factory(ecc).fromBase58(x));
    assert.doesNotThrow(() => BIP32Factory(ecc).fromBase58(xFromV));
  });
});

describe('blinding key from xpub', () => {
  it('should compute blinding keys from xpub chaincodes', () => {
    const xpubs = [
      'xpub6CpihtY9HVc1jNJWCiXnRbpXm5BgVNKqZMsM4XqpDcQigJr6AHNwaForLZ3kkisDcRoaXSUms6DJNhxFtQGeZfWAQWCZQe1esNetx5Wqe4M',
      'xpub6CSpvUeAESaACHEVGCsUJCt4axQCXT6psFQFLCSaV36hmcSyoBhSwPGMfQ4yrbbhrCCJbEifjftEYAADXa331GVGj6WQqGB9uwdUQXUVgpy',
      'xpub6C1Ac8Fy647StqZ8QpCMqMkgyEL3rBuNUkCdQm8qETb1k5ydkP8MLP1GRMEHBvV8YUY7EXzQPwVbX8aR4YPJ27fiLqocNT5xPqdt9BCVAQ9',
    ].map(x => BIP32Factory(ecc).fromBase58(x));

    const blindKey = blindingKeyFromXPubs(xpubs, ecc).masterKey.toString('hex');

    assert.strictEqual(
      blindKey,
      '899bbe856c84cba5a420ee0735f08f1d4ee38026590534e848ab2e7c52658c81'
    );
  });
});
