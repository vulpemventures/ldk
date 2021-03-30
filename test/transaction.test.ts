import { BlindingDataLike } from 'liquidjs-lib/types/psbt';
import { networks, Psbt, Transaction } from 'liquidjs-lib';
import {
  recipientAddress,
  senderAddress,
  senderWallet,
  sender,
  senderBlindingKey,
} from './fixtures/wallet.keys';
import { APIURL, broadcastTx, faucet, mint } from './_regtest';
import { buildTx, BuildTxArgs, decodePset } from '../src/transaction';
import * as assert from 'assert';
import { RecipientInterface } from '../src/types';
import { greedyCoinSelector } from '../src/coinselection/greedy';
import { fetchTxHex } from '../src/explorer/esplora';
import { psetToUnsignedHex } from '../src/utils';
import { fetchAndUnblindUtxos } from '../src/explorer/utxos';

jest.setTimeout(50000);

describe('buildTx', () => {
  let USDT: string = '';
  let args: BuildTxArgs;

  beforeAll(async () => {
    await faucet(senderAddress);
    // mint and fund with USDT
    const minted = await mint(senderAddress, 100);
    USDT = minted.asset;
    const senderUtxos = await fetchAndUnblindUtxos(
      [
        {
          confidentialAddress: senderAddress,
          blindingPrivateKey: senderBlindingKey,
        },
      ],
      APIURL
    );

    args = {
      psetBase64: '',
      recipients: [],
      unspents: senderUtxos,
      changeAddressByAsset: (_: string) => senderAddress,
      coinSelector: greedyCoinSelector(),
    };
  });

  it('should build a confidential transaction spending USDT', async () => {
    // create a tx using wallet
    const tx = (await senderWallet).createTx();

    const recipients: RecipientInterface[] = [
      {
        asset: USDT,
        value: 50000,
        address: recipientAddress,
      },
    ];
    const unsignedTx = buildTx({
      ...args,
      recipients,
      psetBase64: tx,
      addFee: true,
    });
    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
  });

  it('should build a confidential transaction spending LBTC', async () => {
    // create a tx using wallet
    const tx = (await senderWallet).createTx();

    const recipients: RecipientInterface[] = [
      {
        asset: networks.regtest.assetHash,
        value: 50000,
        address: recipientAddress,
      },
    ];

    const unsignedTx = buildTx({ ...args, recipients, psetBase64: tx });
    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
  });

  it('should be able to create a complex transaction and broadcast it', async () => {
    const tx = (await senderWallet).createTx();

    const recipients = [
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

    const unsignedTx = buildTx({
      ...args,
      recipients,
      psetBase64: tx,
      addFee: true,
    });
    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));

    const blindingDataMap = new Map<number, BlindingDataLike>();

    const transaction = Transaction.fromHex(psetToUnsignedHex(unsignedTx));
    for (let i = 0; i < transaction.ins.length; i++) {
      const input = transaction.ins[i];
      const blindingData = args.unspents.find(
        u =>
          input.hash.equals(Buffer.from(u.txid, 'hex').reverse()) &&
          u.vout === input.index
      )!.unblindData;
      blindingDataMap.set(i, blindingData);
    }

    // blind only the change output
    const blindedBase64 = await sender.blindPset(
      unsignedTx,
      [2],
      undefined,
      blindingDataMap
    );
    const signedBase64 = await sender.signPset(blindedBase64);
    const signedPset = decodePset(signedBase64);

    const hex = signedPset
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();

    const txid = await broadcastTx(hex);
    const txhex = await fetchTxHex(txid, APIURL);
    assert.doesNotThrow(() => Transaction.fromHex(txhex));
  });
});
