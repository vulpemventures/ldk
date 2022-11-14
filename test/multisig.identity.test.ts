import * as assert from 'assert';
import { generateMnemonic } from 'bip39';
import {
  networks,
  address,
  Transaction,
  TxOutput,
  AssetHash,
  confidential,
} from 'liquidjs-lib';
import {
  Confidential,
  satoshiToConfidentialValue,
} from 'liquidjs-lib/src/confidential';
import { BlindingDataLike, Psbt } from 'liquidjs-lib/src/psbt';
import secp256k1 from '@vulpemventures/secp256k1-zkp';

import {
  IdentityOpts,
  IdentityType,
  Mnemonic,
  MultisigOpts,
  Multisig,
  multisigFromEsplora,
  DEFAULT_BASE_DERIVATION_PATH,
} from '../src';
import * as ecc from 'tiny-secp256k1';

// @ts-ignore
import { faucet, fetchTxHex, fetchUtxos, sleep } from './_regtest';

const network = networks.regtest;
const lbtc = AssetHash.fromHex(network.assetHash);

jest.setTimeout(60000);

const cosigners: Mnemonic[] = [
  Mnemonic.Random('regtest', ecc, DEFAULT_BASE_DERIVATION_PATH),
  Mnemonic.Random('regtest', ecc, DEFAULT_BASE_DERIVATION_PATH),
];

const validOpts: IdentityOpts<MultisigOpts> = {
  chain: 'regtest',
  type: IdentityType.Multisig,
  ecclib: ecc,
  opts: {
    signer: {
      mnemonic: generateMnemonic(),
      baseDerivationPath: DEFAULT_BASE_DERIVATION_PATH,
    }, // 1 signer
    cosigners: cosigners.map(m => m.getXPub()), // 2 co signers
    requiredSignatures: 2, // need 2 signatures among 3 pubkeys
  },
};

const invalidOpts: IdentityOpts<MultisigOpts> = {
  ...validOpts,
  opts: {
    signer: {
      mnemonic: generateMnemonic(),
      baseDerivationPath: DEFAULT_BASE_DERIVATION_PATH,
    }, // 1 signer
    cosigners: cosigners.map(m => m.getXPub()),
    requiredSignatures: 10000000,
  },
};

describe('Identity:  Multisig', () => {
  describe('Constructor', () => {
    it('should build a valid Multisig class instance if the constructor arguments are valid', () => {
      const multisig = new Multisig(validOpts);
      assert.deepStrictEqual(multisig instanceof Multisig, true);
    });

    it('should throw an error if the required number of keys is > at the number of cosigners', () => {
      assert.throws(() => new Multisig(invalidOpts));
    });
  });

  describe('isAbleToSign', () => {
    it('should return true', () => {
      const multisig = new Multisig(validOpts);
      assert.deepStrictEqual(multisig.isAbleToSign(), true);
    });
  });

  describe('Multisig.signPset', () => {
    it('should sign the inputs of the previously generated addresses (2-of-3 signatures)', async () => {
      const signer1 = new Multisig(validOpts);
      const generated = await signer1.getNextAddress();

      const { unconfidentialAddress } = address.fromConfidential(
        generated.confidentialAddress
      );
      const txid = await faucet(unconfidentialAddress);
      const utxo = (await fetchUtxos(unconfidentialAddress)).find(
        u => u.txid === txid
      );

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

      const script: Buffer = address.toOutputScript(unconfidentialAddress);

      const pset: Psbt = new Psbt({ network: networks.regtest })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: prevout,
          witnessScript: Buffer.from(generated.witnessScript, 'hex'),
        })
        .addOutputs([
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(49999500),
            script,
            asset: lbtc.bytes,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: lbtc.bytes,
          },
        ]);

      let signedBase64 = await signer1.signPset(pset.toBase64());

      // create the second signer
      const signer2 = new Multisig({
        ...validOpts,
        opts: {
          cosigners: [signer1.getXPub(), cosigners[1].getXPub()],
          requiredSignatures: 2,
          signer: { mnemonic: cosigners[0].mnemonic },
        },
      });
      await signer2.getNextAddress(); // used to "restore" the address

      signedBase64 = await signer2.signPset(signedBase64);

      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid = false;
      assert.doesNotThrow(
        () =>
          (isValid = signedPsbt.validateSignaturesOfAllInputs(
            Psbt.ECDSASigValidator(ecc)
          ))
      );
      assert.deepStrictEqual(isValid, true);
    });
  });

  describe('Multisig.blindPset', () => {
    it('should blind the transaction', async () => {
      const multisig = new Multisig(validOpts);
      const generated = await multisig.getNextAddress();

      const txid = await faucet(generated.confidentialAddress);
      const utxo = (await fetchUtxos(generated.confidentialAddress)).find(
        u => u.txid === txid
      );

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];
      const zkpLib = await secp256k1();
      const confidential = new Confidential(zkpLib);
      const unblindedPrevout = await confidential.unblindOutputWithKey(
        prevout as TxOutput,
        Buffer.from(
          await multisig.getBlindingPrivateKey(prevout.script.toString('hex')),
          'hex'
        )
      );

      const script: Buffer = address.toOutputScript(
        generated.confidentialAddress,
        multisig.network
      );

      const pset: Psbt = new Psbt({ network: multisig.network })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: prevout,
          witnessScript: Buffer.from(generated.witnessScript, 'hex'),
        })
        .addOutputs([
          {
            nonce: Buffer.from('00', 'hex'),
            value: satoshiToConfidentialValue(49999500),
            script,
            asset: lbtc.bytes,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: lbtc.bytes,
          },
        ]);

      const blindBase64 = await multisig.blindPset(
        pset.toBase64(),
        [0],
        undefined,
        new Map<number, BlindingDataLike>().set(0, unblindedPrevout)
      );
      const signedBase64 = await multisig.signPset(blindBase64);
      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid = false;
      assert.doesNotThrow(
        () =>
          (isValid = signedPsbt.validateSignaturesOfAllInputs(
            Psbt.ECDSASigValidator(ecc)
          ))
      );
      assert.deepStrictEqual(isValid, true);
    });
  });

  describe('Multisig.getAddresses', () => {
    it('should return all the generated addresses', async () => {
      const multisig = new Multisig(validOpts);
      const addr0 = await multisig.getNextAddress();
      const addr1 = await multisig.getNextAddress();

      const addresses = await multisig.getAddresses();

      assert.deepStrictEqual(addresses.sort(), [addr0, addr1].sort());
    });
  });

  describe('Multisig.getBlindingPrivateKey', () => {
    it('should return privateKey according to slip77-xor spec', async () => {
      const multisig = new Multisig(validOpts);

      const {
        confidentialAddress,
        blindingPrivateKey,
      } = await multisig.getNextAddress();

      const script: string = address
        .toOutputScript(confidentialAddress, networks.regtest)
        .toString('hex');

      assert.deepStrictEqual(
        await multisig.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });
  });

  describe('Multisig restoration', () => {
    let pubkey: Multisig;
    let restored: Multisig;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      pubkey = new Multisig(validOpts);
      // faucet all the addresses
      for (let i = 0; i < numberOfAddresses; i++) {
        const addr = await pubkey.getNextAddress();
        const changeAddr = await pubkey.getNextChangeAddress();
        await faucet(addr.confidentialAddress);
        await faucet(changeAddr.confidentialAddress);
      }

      await sleep(3000);

      const toRestore = new Multisig({ ...validOpts });
      restored = await multisigFromEsplora(toRestore)({
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
