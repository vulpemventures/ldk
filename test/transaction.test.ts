import { networks, address, Psbt } from 'liquidjs-lib';
import {
  recipientAddress,
  senderAddress,
  senderWallet,
  sender,
  senderBlindingKey,
} from './fixtures/wallet.keys';
import { APIURL, broadcastTx, faucet, mint, sleep } from './_regtest';
import { buildTx, decodePset, RecipientInterface } from '../src/transaction';
import { fetchAndUnblindUtxos, UtxoInterface } from '../src/wallet';
import * as assert from 'assert';

jest.setTimeout(50000);

describe('buildTx', () => {
  let senderUtxos: UtxoInterface[];
  let USDT: string = '';

  beforeAll(async () => {
    await faucet(senderAddress);
    // mint and fund with USDT
    const minted = await mint(senderAddress, 100);
    USDT = minted.asset;

    await sleep(3000);

    senderUtxos = await fetchAndUnblindUtxos(
      [
        {
          address: senderAddress,
          blindingKey: senderBlindingKey,
        },
      ],
      APIURL
    );
  });

  it('should build a confidential transaction spending USDT', () => {
    // create a tx using wallet
    const tx = senderWallet.createTx();

    const recipients: RecipientInterface[] = [
      {
        asset: USDT,
        value: 50000,
        address: recipientAddress,
      },
    ];

    const unsignedTx = buildTx(
      tx,
      senderUtxos,
      recipients,
      // for change script, we just return the sender address for all assets
      (_: string) => senderAddress
    );

    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
  });

  it('should build a confidential transaction spending LBTC', async () => {
    // create a tx using wallet
    const tx = senderWallet.createTx();

    const recipients: RecipientInterface[] = [
      {
        asset: networks.regtest.assetHash,
        value: 50000,
        address: recipientAddress,
      },
    ];

    const unsignedTx = buildTx(
      tx,
      senderUtxos,
      recipients,
      // for change script, we just return the sender script for all assets
      (_: string) => senderAddress
    );

    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
  });

  it('should be able to create a complex transaction and broadcast it', async () => {
    const outputs = [
      {
        asset: networks.regtest.assetHash,
        value: 50000,
        address: recipientAddress,
      },
      {
        asset: USDT,
        value: 50000,
        address: recipientAddress,
      },
    ];

    const tx = senderWallet.createTx();
    const unsignedTx = buildTx(
      tx,
      senderUtxos,
      outputs,
      // for change script, we just return the sender script for all assets
      (_: string) => senderAddress,
      true
    );

    const pset = decodePset(unsignedTx);

    const privKeyBuffer = Buffer.from(senderBlindingKey, 'hex');
    pset.blindOutputsByIndex(
      new Map().set(0, privKeyBuffer).set(1, privKeyBuffer),
      new Map().set(2, address.fromConfidential(senderAddress).blindingKey)
    );

    const signedBase64 = await sender.signPset(pset.toBase64());
    const signedPset = decodePset(signedBase64);

    const hex = signedPset
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();

    await broadcastTx(hex);
  });
});
