import * as assert from 'assert';

import {
  ECPair,
  Psbt,
  Transaction,
  confidential,
  networks,
  payments,
} from 'liquidjs-lib';
import {
  AddressInterface,
  IdentityOpts,
  IdentityType,
  PrivateKey,
} from '../src';
import { faucet, fetchTxHex, fetchUtxos } from './_regtest';

const network = networks.regtest;

// increase default timeout of jest
jest.setTimeout(15000);

const validOpts: IdentityOpts = {
  chain: 'regtest',
  type: IdentityType.PrivateKey,
  value: {
    signingKeyWIF: 'cPNMJD4VyFnQjGbGs3kcydRzAbDCXrLAbvH6wTCqs88qg1SkZT3J',
    blindingKeyWIF: 'cRdrvnPMLV7CsEak2pGrgG4MY7S3XN1vjtcgfemCrF7KJRPeGgW6',
  },
};

const unvalidTypeOpts: IdentityOpts = {
  ...validOpts,
  type: IdentityType.Mnemonic,
};

const unvalidValueOpts: IdentityOpts = {
  ...validOpts,
  value: { notSigningKey: 'xxx', vulpem: 'company' },
};

const unvalidWIF: IdentityOpts = {
  ...validOpts,
  value: {
    signingKeyWIF: 'cPNMJD4VyFnQjGbGs3kcydRzAbDCXrLAbvH6wTCqs88qg1SkZT3J',
    blindingKey: 'invalidWIF',
  },
};

const keypair = ECPair.fromWIF(validOpts.value.signingKeyWIF, network);
const keypair2 = ECPair.fromWIF(validOpts.value.blindingKeyWIF, network);
const p2wpkh = payments.p2wpkh({
  pubkey: keypair.publicKey!,
  blindkey: keypair2.publicKey!,
  network: network,
});

describe('Identity: Private key', () => {
  describe('Constructor', () => {
    it('should build a valid PrivateKey class if the constructor arguments are valid', () => {
      const privateKey = new PrivateKey(validOpts);
      assert.deepStrictEqual(privateKey instanceof PrivateKey, true);
    });

    it('should throw an error if type is not IdentityType.PrivateKey', () => {
      assert.throws(() => new PrivateKey(unvalidTypeOpts));
    });

    it('should throw an error if value of IdentityOpts is not of type {signingKeyWIF: string; blindingKeyWIF: string;}', () => {
      assert.throws(() => new PrivateKey(unvalidValueOpts));
    });

    it('should throw an error if signingKey AND/OR blindingKey are not WIF encoded string', () => {
      assert.throws(() => new PrivateKey(unvalidWIF));
    });
  });

  describe('PrivateKey.isAbleToSign', () => {
    it('should return true', () => {
      const privKey = new PrivateKey(validOpts);
      assert.deepStrictEqual(privKey.isAbleToSign(), true);
    });
  });

  describe('PrivateKey.signPset', () => {
    it("should sign all the inputs with scriptPubKey = PrivateKey instance p2wpkh's scriptPubKey", async () => {
      await faucet(p2wpkh.confidentialAddress!);
      const utxo = (await fetchUtxos(p2wpkh.confidentialAddress!))[0];
      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

      const unblindedUtxo = await confidential.unblindOutputWithKey(
        prevout,
        keypair2.privateKey!
      );

      const pset: Psbt = new Psbt({ network })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(
              parseInt(unblindedUtxo.value, 10)
            ),
            asset: unblindedUtxo.asset,
            script: p2wpkh.output!,
          },
        })
        .addOutputs([
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(49999500),
            script: p2wpkh.output!,
            asset: network.assetHash,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: network.assetHash,
          },
        ]);

      const privateKey = new PrivateKey(validOpts);
      const signedBase64 = await privateKey.signPset(pset.toBase64());
      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid: boolean = false;
      assert.doesNotThrow(
        () => (isValid = signedPsbt.validateSignaturesOfAllInputs())
      );
      assert.deepStrictEqual(isValid, true);
    });
  });

  describe('PrivateKey.getAddresses', () => {
    it("should return the PrivateKey instance p2wpkh's address and blindPrivKey", async () => {
      const privateKey = new PrivateKey(validOpts);
      const addr: AddressInterface = (await privateKey.getAddresses())[0];
      assert.deepStrictEqual(
        p2wpkh.confidentialAddress,
        addr.confidentialAddress
      );
      assert.deepStrictEqual(
        keypair2.privateKey!,
        Buffer.from(addr.blindingPrivateKey, 'hex')
      );
    });
  });

  describe('PrivateKey.getBlindingPrivateKey', () => {
    it('should return the private blinding key associated with the PrivateKey instance confidential address', async () => {
      const privateKey = new PrivateKey(validOpts);
      const { confidentialAddress, blindingPrivateKey } = (
        await privateKey.getAddresses()
      )[0];
      const script: string = payments
        .p2wpkh({
          confidentialAddress,
          network,
        })
        .output!.toString('hex');
      assert.deepStrictEqual(
        await privateKey.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });

    it('should throw an error if the script is not the PrivateKey scriptPubKey', () => {
      const privateKey = new PrivateKey(validOpts);
      const notTheGoodScript = 'bbb4659bedb5d3d3c7ab12d7f85323c3a1b6c060efbe';
      assert.rejects(() => privateKey.getBlindingPrivateKey(notTheGoodScript));
    });
  });
});
