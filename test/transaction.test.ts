import { networks, address, Psbt } from 'liquidjs-lib';
import {
  recipientAddress,
  senderAddress,
  senderWallet,
  sender,
} from './fixtures/wallet.keys';
import { APIURL, faucet, sleep } from './_regtest';
import { buildTx, OutputInterface } from '../src/transaction';
import { fetchAndUnblindUtxos, UtxoInterface } from '../src/wallet';
import * as assert from 'assert';

describe('buildTx', () => {
  let senderUtxos: UtxoInterface[];
  // let USDT: string = '';

  beforeAll(async () => {
    await faucet(senderAddress);
    await sleep(2000);
    // mint and fund with USDT
    // const minted = await mint(senderAddress, 100);
    // USDT = minted.asset;
    senderUtxos = await fetchAndUnblindUtxos(
      [
        {
          address: senderAddress,
          blindingKey: sender.getNextAddress().blindingPrivateKey,
        },
      ],
      APIURL
    );
  }, 20000);

  it('Can build a confidential transaction spending LBTC', () => {
    // create a tx using wallet
    const tx = senderWallet.createTx();

    const outputs: OutputInterface[] = [
      {
        asset: networks.regtest.assetHash,
        value: 50000,
        script: address
          .toOutputScript(recipientAddress, networks.regtest)
          .toString('hex'),
      },
    ];

    console.time('buildTxBis');
    const unsignedTx = buildTx(
      tx,
      senderUtxos,
      outputs,
      // for change script, we just return the sender script for all assets
      (_: string) =>
        address.toOutputScript(senderAddress, networks.regtest).toString('hex')
    );
    console.timeEnd('buildTxBis');

    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
  });
});
