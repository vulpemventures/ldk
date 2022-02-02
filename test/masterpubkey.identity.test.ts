import * as assert from 'assert';
import { networks, payments } from 'liquidjs-lib';

import {
  IdentityOpts,
  IdentityType,
  MasterPublicKey,
  Mnemonic,
  fromXpub,
  masterPubKeyRestorerFromEsplora,
  MasterPublicKeyOpts,
  MnemonicOpts,
} from '../src';

import { faucet, sleep } from './_regtest';

jest.setTimeout(60000);

const validOpts: IdentityOpts<MasterPublicKeyOpts> = {
  chain: 'regtest',
  type: IdentityType.MasterPublicKey,
  opts: {
    masterPublicKey: fromXpub(
      'tpubD6NzVbkrYhZ4XzWjD4v6Q3aNJzvGYFrCNvL5FvWkpE5yBwXwzPeUAF7KrdUKQ4feKGquMXJNn5dkm3xL8eFyDjSrD1C5s5Byh3ZTiBU1wHd',
      'regtest'
    ),
    masterBlindingKey:
      'c90591b4766a23ca881767626f4c2222641c944b21ad23bcadb699c031868c85',
  },
};

const invalidKeysOpts: IdentityOpts<MasterPublicKeyOpts> = {
  ...validOpts,
  opts: {
    masterPublicKey: "I'm not a good pub key",
    masterBlindingKey: "i'm not a hex encoded blindingkey éç",
  },
};

const wrongTypeOpts: IdentityOpts<MasterPublicKeyOpts> = {
  ...validOpts,
  type: IdentityType.Mnemonic,
};

describe('Identity: Master Pub Key', () => {
  describe('Constructor', () => {
    it('should build a valid MasterPubkey class instance if the constructor arguments are valid', () => {
      const pubKey = new MasterPublicKey(validOpts);
      assert.deepStrictEqual(pubKey instanceof MasterPublicKey, true);
    });

    it('should throw an error if the identity type is not IdentityType.MasterPubKey', () => {
      assert.throws(() => new MasterPublicKey(wrongTypeOpts));
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
          publicKey:
            '0212df6a58be8fc11396b413678a863c7b8a76abdcf2e1cae2fe4fe5818b93dd37',
        },
        publicKey:
          '0212df6a58be8fc11396b413678a863c7b8a76abdcf2e1cae2fe4fe5818b93dd37',
      });
    });

    it('should return all the generated addresses', async () => {
      const pubKey = new MasterPublicKey(validOpts);
      const addr0 = await pubKey.getNextAddress();
      const addr1 = await pubKey.getNextAddress();

      const addresses = await pubKey.getAddresses();

      assert.deepStrictEqual(addresses.sort(), [addr0, addr1].sort());
    });
  });

  describe('MasterPubKey.getBlindingPrivateKey', () => {
    it('should return privateKey according to slip77 spec', async () => {
      const pubKey = new MasterPublicKey(validOpts);

      const {
        confidentialAddress,
        blindingPrivateKey,
      } = await pubKey.getNextAddress();

      const script: string = payments
        .p2wpkh({
          confidentialAddress,
          network: networks.regtest,
        })
        .output!.toString('hex');

      assert.deepStrictEqual(
        await pubKey.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });
  });

  describe('MasterPubKey.restore', () => {
    let pubkey: MasterPublicKey;
    let restoredPubKey: MasterPublicKey;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      pubkey = new MasterPublicKey(validOpts);
      // faucet all the addresses
      for (let i = 0; i < numberOfAddresses; i++) {
        const addr = await pubkey.getNextAddress();
        const changeAddr = await pubkey.getNextChangeAddress();
        await faucet(addr.confidentialAddress);
        await faucet(changeAddr.confidentialAddress);
      }
      await sleep(3000);

      const toRestorePubKey = new MasterPublicKey({ ...validOpts });
      restoredPubKey = await masterPubKeyRestorerFromEsplora(toRestorePubKey)({
        gapLimit: 20,
        esploraURL: 'http://localhost:3001',
      });
    });

    it('should restore already used addresses', async () => {
      const pubKeyAddrs = await pubkey.getAddresses();
      const toRestoreAddrs = await restoredPubKey.getAddresses();
      assert.deepStrictEqual(
        toRestoreAddrs.map(a => a.confidentialAddress).sort(),
        pubKeyAddrs.map(a => a.confidentialAddress).sort()
      );
    });

    it('should update the index when restored', async () => {
      const addrs = await restoredPubKey.getAddresses();
      const addressesKnown = addrs.map(a => a.confidentialAddress);

      const next = await restoredPubKey.getNextAddress();
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });

    it('should update the change index when restored', async () => {
      const addrs = await restoredPubKey.getAddresses();
      const addressesKnown = addrs.map(a => a.confidentialAddress);

      const next = await restoredPubKey.getNextChangeAddress();
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });
  });

  describe('MasterPubKey X Mnemonic', () => {
    it('should generate same addresses than Mnemonic', () => {
      const mnemonicValidOpts: IdentityOpts<MnemonicOpts> = {
        chain: 'regtest',
        type: IdentityType.Mnemonic,
        opts: {
          mnemonic:
            'pause quantum three welcome become episode tackle achieve predict mimic share task onion vapor announce exist inner fortune stamp crucial angle neither manage denial',
        },
      };

      const mnemonic = new Mnemonic(mnemonicValidOpts);
      const pubkey = new MasterPublicKey({
        ...validOpts,
        opts: {
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

  describe('testnet', () => {
    it('should generate testnet addresses with chain = "testnet"', async () => {
      const mnemonic = Mnemonic.Random('testnet');
      const address = await mnemonic.getNextAddress();
      assert.ok(address.confidentialAddress.startsWith('tlq'));
    });
  });
});
