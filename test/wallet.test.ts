import {
  fetchAndUnblindTxs,
  isBlindedOutputInterface,
  UnblindedOutputInterface,
  fetchAndUnblindUtxos,
  fetchAndUnblindUtxosGenerator,
  UtxoInterface,
} from '../src/wallet';
import { networks, TxOutput, Transaction, Psbt } from 'liquidjs-lib';
import {
  faucet,
  fetchUtxos,
  fetchTxHex,
  mint,
  APIURL,
  sleep,
  broadcastTx,
} from './_regtest';
import * as assert from 'assert';
import {
  senderAddress,
  senderWallet,
  recipientAddress,
  sender,
} from './fixtures/wallet.keys';
import axios from 'axios';

const network = networks.regtest;

jest.setTimeout(500000);

describe('Wallet - Transaction builder', () => {
  describe('buildTx', () => {
    let senderUtxos: any[] = [];
    let USDT: string = '';

    beforeAll(async () => {
      // fund the proposer account with LBTC
      await faucet(senderAddress);
      // mint and fund with USDT
      const minted = await mint(senderAddress, 100);
      USDT = minted.asset;
      senderUtxos = await fetchUtxos(senderAddress);

      const txHexs: string[] = await Promise.all(
        senderUtxos.map((utxo: any) => fetchTxHex(utxo.txid))
      );

      const outputs: TxOutput[] = txHexs.map(
        (hex, index) => Transaction.fromHex(hex).outs[senderUtxos[index].vout]
      );

      senderUtxos.forEach((utxo: any, index: number) => {
        utxo.prevout = outputs[index];
      });
    });

    it('Can build a confidential transaction spending LBTC', async () => {
      // create a tx using wallet
      const tx = senderWallet.createTx();

      const unsignedTx = senderWallet.buildTx(
        tx,
        senderUtxos,
        recipientAddress!,
        50000,
        network.assetHash,
        sender.getNextChangeAddress().confidentialAddress
      );

      assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
    });

    it('Can build a confidential transaction spending USDT', async () => {
      // create a tx using wallet
      const tx = senderWallet.createTx();

      const unsignedTx = senderWallet.buildTx(
        tx,
        senderUtxos,
        recipientAddress!,
        150000,
        USDT,
        sender.getNextChangeAddress().confidentialAddress
      );

      assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
    });
  });

  describe('FetchAndUnblindTx function', () => {
    it('should fetch all the transactions of an address & unblind the outputs', async () => {
      const { txId } = (
        await axios.post(`${APIURL}/faucet`, { address: senderAddress })
      ).data;

      // sleep 5s for nigiri
      await sleep(5000);

      const txs = await fetchAndUnblindTxs(
        senderAddress,
        [sender.getNextAddress().blindingPrivateKey],
        APIURL
      );

      const faucetTx = txs.find(tx => tx.txid === txId);
      expect(faucetTx).not.toBeUndefined();

      const LBTC = networks.regtest.assetHash;
      const hasOutputWithValue1LBTC = faucetTx!.vout.some(out => {
        if (!isBlindedOutputInterface(out)) {
          const unblindOutput = out as UnblindedOutputInterface;
          return (
            unblindOutput.value === 1_0000_0000 && unblindOutput.asset === LBTC
          );
        }
        return false;
      });

      expect(hasOutputWithValue1LBTC).toEqual(true);
    });

    it('should fetch all the transactions of an address & unblind the prevouts', async () => {
      const { txId } = (
        await axios.post(`${APIURL}/faucet`, { address: senderAddress })
      ).data;
      await sleep(5000);

      const utxosPromises = await fetchAndUnblindUtxos(
        [
          {
            address: senderAddress,
            blindingKey: sender.getNextAddress().blindingPrivateKey,
          },
        ],
        APIURL
      );

      const utxos = await Promise.all(utxosPromises);

      const tx = senderWallet.createTx();
      const unsignedTx = senderWallet.buildTx(
        tx,
        utxos.filter(utxo => utxo.txid === txId),
        recipientAddress!,
        100,
        networks.regtest.assetHash,
        sender.getNextChangeAddress().confidentialAddress
      );

      const signedPset = await sender.signPset(unsignedTx);
      const hex = Psbt.fromBase64(signedPset)
        .finalizeAllInputs()
        .extractTransaction()
        .toHex();
      const txIdBroadcasted = await broadcastTx(hex);

      const txs = await fetchAndUnblindTxs(
        senderAddress,
        [sender.getNextAddress().blindingPrivateKey],
        APIURL
      );
      const faucetTx = txs.find(
        tx => tx.txid.valueOf() === txIdBroadcasted.valueOf()
      );
      expect(faucetTx).not.toBeUndefined();

      const hasUnblindedPrevout = faucetTx!.vin
        .map(input => input.prevout)
        .some(prevout => {
          if (!isBlindedOutputInterface(prevout)) {
            const unblindOutput = prevout as UnblindedOutputInterface;
            return (
              unblindOutput.value === 1_0000_0000 &&
              unblindOutput.asset === networks.regtest.assetHash
            );
          }
          return false;
        });
      expect(hasUnblindedPrevout).toEqual(true);
    });
  });

  describe('fetchAndUnblindGenerator function', () => {
    it('should return utxos at each next iteration', async () => {
      await axios.post(`${APIURL}/faucet`, { address: senderAddress });
      await sleep(5000);

      const utxosGenerator = fetchAndUnblindUtxosGenerator(
        [
          {
            address: senderAddress,
            blindingKey: sender.getNextAddress().blindingPrivateKey,
          },
          {
            address: recipientAddress,
            blindingKey: '',
          },
        ],
        APIURL
      );

      const utxosArray: UtxoInterface[] = [];
      let utxoV = await utxosGenerator.next();
      while (!utxoV.done) {
        utxosArray.push(utxoV.value as UtxoInterface);
        utxoV = await utxosGenerator.next();
      }

      assert.strictEqual(utxosArray.length, utxoV.value);
    });
  });
});
