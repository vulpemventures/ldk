import * as assert from 'assert';
import { networks, address } from 'liquidjs-lib';

import {
  IdentityOpts,
  IdentityType,
  Mnemonic,
  MultisigWatchOnlyOpts,
  MultisigWatchOnly,
  multisigWatchOnlyFromEsplora,
} from '../src';

import { faucet, sleep } from './_regtest';

jest.setTimeout(60000);

const cosigners: Mnemonic[] = [
  Mnemonic.Random('regtest'),
  Mnemonic.Random('regtest'),
  Mnemonic.Random('regtest'),
];

const validOpts: IdentityOpts<MultisigWatchOnlyOpts> = {
  chain: 'regtest',
  type: IdentityType.MultisigWatchOnly,
  opts: {
    cosigners: cosigners.map(m => m.getXPub()),
    requiredSignatures: 1,
  },
};

const invalidOpts: IdentityOpts<MultisigWatchOnlyOpts> = {
  ...validOpts,
  opts: {
    cosigners: cosigners.map(m => m.getXPub()),
    requiredSignatures: 10000000,
  },
};

describe('Identity:  Multisig watch only', () => {
  describe('Contructor', () => {
    it('should build a valid MultisigWatchOnly class instance if the contructor arguments are valid', () => {
      const multisig = new MultisigWatchOnly(validOpts);
      assert.deepStrictEqual(multisig instanceof MultisigWatchOnly, true);
    });

    it('should throw an error if the required number of keys is > at the number of cosigners', () => {
      assert.throws(() => new MultisigWatchOnly(invalidOpts));
    });
  });

  describe('isAbleToSign', () => {
    it('should return false', () => {
      const multisig = new MultisigWatchOnly(validOpts);
      assert.deepStrictEqual(multisig.isAbleToSign(), false);
    });
  });

  describe('MultisigWatchOnly.signPset', () => {
    it('should throw an error', () => {
      const multisig = new MultisigWatchOnly(validOpts);
      assert.throws(() => multisig.signPset(''));
    });
  });

  describe('MultisigWatchOnly.getAddresses', () => {
    it('should return all the generated addresses', async () => {
      const multisig = new MultisigWatchOnly(validOpts);
      const addr0 = await multisig.getNextAddress();
      const addr1 = await multisig.getNextAddress();

      const addresses = await multisig.getAddresses();

      assert.deepStrictEqual(addresses.sort(), [addr0, addr1].sort());
    });
  });

  describe('MultisigWatchOnly.getBlindingPrivateKey', () => {
    it('should return privateKey according to slip77-xor spec', async () => {
      const pubKey = new MultisigWatchOnly(validOpts);

      const {
        confidentialAddress,
        blindingPrivateKey,
      } = await pubKey.getNextAddress();

      const script: string = address
        .toOutputScript(confidentialAddress, networks.regtest)
        .toString('hex');

      assert.deepStrictEqual(
        await pubKey.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });
  });

  describe('MultisigWatchOnly restoration', () => {
    let pubkey: MultisigWatchOnly;
    let restored: MultisigWatchOnly;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      pubkey = new MultisigWatchOnly(validOpts);
      // faucet all the addresses
      for (let i = 0; i < numberOfAddresses; i++) {
        const addr = await pubkey.getNextAddress();
        const changeAddr = await pubkey.getNextChangeAddress();
        await faucet(addr.confidentialAddress);
        await faucet(changeAddr.confidentialAddress);
      }

      await sleep(3000);

      const toRestore = new MultisigWatchOnly({ ...validOpts });
      restored = await multisigWatchOnlyFromEsplora(toRestore)({
        gapLimit: 20,
        esploraURL: 'http://localhost:3001',
      });
    });

    it('should restore already used addresses', async () => {
      const pubKeyAddrs = await pubkey.getAddresses();
      const toRestoreAddrs = await restored.getAddresses();
      assert.deepStrictEqual(
        toRestoreAddrs.map(a => a.confidentialAddress).sort(),
        pubKeyAddrs.map(a => a.confidentialAddress).sort()
      );
    });

    it('should update the index when restored', async () => {
      const addrs = await restored.getAddresses();
      const addressesKnown = addrs.map(a => a.confidentialAddress);

      const next = await restored.getNextAddress();
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });

    it('should update the change index when restored', async () => {
      const addrs = await restored.getAddresses();
      const addressesKnown = addrs.map(a => a.confidentialAddress);

      const next = await restored.getNextChangeAddress();
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });
  });
});
