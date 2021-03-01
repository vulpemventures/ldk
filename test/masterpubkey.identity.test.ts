import {
  EsploraIdentityRestorer,
  IdentityOpts,
  IdentityType,
  MasterPublicKey,
  Mnemonic,
  fromXpub,
} from '../src';
import * as assert from 'assert';
import { networks, payments } from 'liquidjs-lib';
import { faucet } from './_regtest';

jest.setTimeout(60000);

const validOpts: IdentityOpts = {
  chain: 'regtest',
  type: IdentityType.MasterPublicKey,
  value: {
    masterPublicKey: fromXpub(
      'tpubD6NzVbkrYhZ4XzWjD4v6Q3aNJzvGYFrCNvL5FvWkpE5yBwXwzPeUAF7KrdUKQ4feKGquMXJNn5dkm3xL8eFyDjSrD1C5s5Byh3ZTiBU1wHd',
      'regtest'
    ),
    masterBlindingKey:
      'c90591b4766a23ca881767626f4c2222641c944b21ad23bcadb699c031868c85',
  },
};

const invalidKeysOpts: IdentityOpts = {
  ...validOpts,
  value: {
    masterPublicKey: "I'm not a good pub key",
    masterBlindingKey: "i'm not a hex encoded blindingkey éç",
  },
};

const wrongTypeOpts: IdentityOpts = {
  ...validOpts,
  type: IdentityType.Mnemonic,
};

const invalidValueFormat: IdentityOpts = {
  ...validOpts,
  value: {
    notMasterPubKey:
      'xpub6CpihtY9HVc1jNJWCiXnRbpXm5BgVNKqZMsM4XqpDcQigJr6AHNwaForLZ3kkisDcRoaXSUms6DJNhxFtQGeZfWAQWCZQe1esNetx5Wqe4M',
    notMasterBlindKey: '0000000001211200000000000000000000000000000',
  },
};

describe('Identity: Master Pub Key', () => {
  describe('Contructor', () => {
    it('should build a valid MasterPubkey class instance if the contructor arguments are valid', () => {
      const pubKey = new MasterPublicKey(validOpts);
      assert.deepStrictEqual(pubKey instanceof MasterPublicKey, true);
    });

    it('should throw an error if the identity type is not IdentityType.MasterPubKey', () => {
      assert.throws(() => new MasterPublicKey(wrongTypeOpts));
    });

    it('should throw an error if the args value has not the good format', () => {
      assert.throws(() => new MasterPublicKey(invalidValueFormat));
    });

    it('should throw an error if the masterPublicKey and masterBlindingKey are not valid key', () => {
      assert.throws(() => new MasterPublicKey(invalidKeysOpts));
    });
  });

  describe('isAbleToSign', () => {
    it('should return false', () => {
      const pubKey = new MasterPublicKey(validOpts);
      assert.deepStrictEqual(pubKey.isAbleToSign(), false);
    });
  });

  describe('MasterPubKey.signPset', () => {
    it('should throw an error', () => {
      const pubKey = new MasterPublicKey(validOpts);
      assert.throws(() => pubKey.signPset(''));
    });
  });

  describe('MasterPubKey.getAddresses', () => {
    it('should have private method getAddress return an AddressInterfaceExtended', () => {
      const pubKey = new MasterPublicKey(validOpts);
      const addressExtended = pubKey['getAddress'](true, 5);
      assert.deepStrictEqual(addressExtended, {
        address: {
          blindingPrivateKey:
            '14ead34445d4e1e7d74f37af73243b577d329b13186e73d0c0712221d5d2ccf7',
          confidentialAddress:
            'el1qqtdlqfxu94x0hkktqwwkeucn3wxvfwtq2lm35kwh7k2vnrtszzcelhhk3vvrccwqc2kkpvvctat37ffvcncsj04dwjx4m2ze6',
          derivationPath: "m/84'/0'/0'/1/5",
        },
        derivationPath: "m/84'/0'/0'/1/5",
        publicKey:
          '0212df6a58be8fc11396b413678a863c7b8a76abdcf2e1cae2fe4fe5818b93dd37',
      });
    });

    it('should return all the generated addresses', () => {
      const pubKey = new MasterPublicKey(validOpts);
      const addr0 = pubKey.getNextAddress();
      const addr1 = pubKey.getNextAddress();

      const addresses = pubKey.getAddresses();

      assert.deepStrictEqual(addresses.sort(), [addr0, addr1].sort());
    });
  });

  describe('MasterPubKey.getBlindingPrivateKey', () => {
    it('should return privateKey according to slip77 spec', () => {
      const pubKey = new MasterPublicKey(validOpts);

      const {
        confidentialAddress,
        blindingPrivateKey,
      } = pubKey.getNextAddress();

      const script: string = payments
        .p2wpkh({
          confidentialAddress,
          network: networks.regtest,
        })
        .output!.toString('hex');

      assert.deepStrictEqual(
        pubKey.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });
  });

  describe('MasterPubKey.restore', () => {
    let pubkey: MasterPublicKey;
    let toRestorePubKey: MasterPublicKey;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      pubkey = new MasterPublicKey(validOpts);
      // faucet all the addresses
      for (let i = 0; i < numberOfAddresses; i++) {
        const addr = pubkey.getNextAddress();
        const changeAddr = pubkey.getNextChangeAddress();
        await faucet(addr.confidentialAddress);
        await faucet(changeAddr.confidentialAddress);
      }

      toRestorePubKey = new MasterPublicKey({
        ...validOpts,
        initializeFromRestorer: true,
        restorer: new EsploraIdentityRestorer('http://localhost:3001'),
      });

      await toRestorePubKey.isRestored;
    });

    it('should restore already used addresses', () => {
      assert.deepStrictEqual(
        pubkey
          .getAddresses()
          .map(a => a.confidentialAddress)
          .sort(),
        toRestorePubKey
          .getAddresses()
          .map(a => a.confidentialAddress)
          .sort()
      );
    });

    it('should update the index when restored', () => {
      const addressesKnown = toRestorePubKey
        .getAddresses()
        .map(a => a.confidentialAddress);

      const next = toRestorePubKey.getNextAddress();
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });

    it('should update the change index when restored', () => {
      const addressesKnown = toRestorePubKey
        .getAddresses()
        .map(a => a.confidentialAddress);

      const next = toRestorePubKey.getNextChangeAddress();
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });
  });

  describe('MasterPubKey X Mnemonic', () => {
    it('should generate same addresses than Mnemonic', () => {
      const mnemonicValidOpts: IdentityOpts = {
        chain: 'regtest',
        type: IdentityType.Mnemonic,
        value: {
          mnemonic:
            'pause quantum three welcome become episode tackle achieve predict mimic share task onion vapor announce exist inner fortune stamp crucial angle neither manage denial',
        },
      };

      const mnemonic = new Mnemonic(mnemonicValidOpts);
      const pubkey = new MasterPublicKey({
        ...validOpts,
        value: {
          masterBlindingKey: mnemonic.masterBlindingKey,
          masterPublicKey: mnemonic.masterPublicKey,
        },
      });

      assert.deepStrictEqual(
        pubkey.getNextAddress(),
        mnemonic.getNextAddress()
      );
    });
  });
});
