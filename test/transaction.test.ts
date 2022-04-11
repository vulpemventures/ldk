import * as ecc from 'tiny-secp256k1';
import * as assert from 'assert';
import { address, networks, Psbt, Transaction } from 'liquidjs-lib';
import { BlindingDataLike } from 'liquidjs-lib/src/psbt';
import { walletFromAddresses, WalletInterface } from '../src';
import { greedyCoinSelector } from '../src/coinselection/greedy';
import { fetchTxHex } from '../src/explorer/esplora';
import { decodePset, psetToUnsignedHex, psetToUnsignedTx } from '../src/utils';
import { fetchAndUnblindUtxos } from '../src/explorer/utxos';
import { BuildTxArgs, craftMultipleRecipientsPset } from '../src/transaction';
import { RecipientInterface } from '../src/types';
import { APIURL, broadcastTx, faucet, mint } from './_regtest';
import { recipientAddress, newRandomMnemonic } from './fixtures/wallet.keys';

jest.setTimeout(50000);

let senderWallet: WalletInterface;

describe('buildTx', () => {
  let USDT = '';
  let args: BuildTxArgs;
  let senderAddress = '';
  let senderBlindingKey = '';
  const sender = newRandomMnemonic();

  beforeAll(async () => {
    const addrI = await sender.getNextAddress();
    senderAddress = addrI.confidentialAddress;
    senderBlindingKey = addrI.blindingPrivateKey;

    senderWallet = await walletFromAddresses(
      ecc,
      await sender.getAddresses(),
      APIURL,
      'regtest'
    );

    await faucet(senderAddress);
    // mint and fund with USDT
    const minted = await mint(senderAddress, 100);
    USDT = minted.asset;
    const senderUtxos = await fetchAndUnblindUtxos(
      ecc,
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
    const tx = senderWallet.createTx();

    const recipients: RecipientInterface[] = [
      {
        asset: USDT,
        value: 50000,
        address: recipientAddress,
      },
    ];
    const unsignedTx = craftMultipleRecipientsPset({
      ...args,
      recipients,
      psetBase64: tx,
      addFee: true,
    });
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

    const unsignedTx = craftMultipleRecipientsPset({
      ...args,
      recipients,
      psetBase64: tx,
    });
    assert.doesNotThrow(() => Psbt.fromBase64(unsignedTx));
  });

  it('should be able to create a complex transaction and broadcast it', async () => {
    const tx = senderWallet.createTx();

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

    const unsignedTx = craftMultipleRecipientsPset({
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
      const utxo = args.unspents.find(
        u =>
          input.hash.equals(Buffer.from(u.txid, 'hex').reverse()) &&
          u.vout === input.index
      );

      if (!utxo) throw new Error('cannot find utxo');

      const blindingData = utxo.unblindData;

      if (blindingData) {
        blindingDataMap.set(i, blindingData);
      }
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

describe('sendTx', () => {
  const makeRecipient = (asset: string) => (
    value: number
  ): RecipientInterface => ({
    asset,
    value,
    address:
      'Azpw1q7r7sd6FYEphGVX4UDXy9ZtbwbTMkA3YPPjfpmLwmKzLRjpN5gJ19PTYedjTJhERvqf7QSs2N6J',
  });

  const makeTest = async (
    recipient: RecipientInterface,
    substractScenario: boolean
  ) => {
    const sender = newRandomMnemonic();
    const addrI = await sender.getNextAddress();
    const changeAddress = (await sender.getNextChangeAddress())
      .confidentialAddress;
    const senderAddress = addrI.confidentialAddress;

    await faucet(senderAddress); // send 1_0000_0000
    const wallet = await walletFromAddresses(ecc, [addrI], APIURL, 'regtest');
    const pset = wallet.sendTx(
      recipient,
      greedyCoinSelector(),
      changeAddress,
      substractScenario
    );
    const recipientIndex = psetToUnsignedTx(pset).outs.findIndex(out =>
      out.script.equals(
        address.toOutputScript(recipient.address, networks.regtest)
      )
    );
    const blinded = await sender.blindPset(
      pset,
      [recipientIndex],
      new Map().set(
        recipientIndex,
        address.fromConfidential(recipient.address).blindingKey
      )
    );
    const signed = await sender.signPset(blinded);
    const txHex = decodePset(signed)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();
    await broadcastTx(txHex);
  };

  it('should build a valid send tx with L-BTC', async () => {
    await makeTest(makeRecipient(networks.regtest.assetHash)(850), false);
  });

  it('should throw an error if not enough fund', async () => {
    assert.rejects(
      makeTest(makeRecipient(networks.regtest.assetHash)(1_0000_0000), false)
    );
  });

  it('should throw an error if not enough fund to pay fees (no substract fee from recipient)', async () => {
    assert.rejects(
      makeTest(makeRecipient(networks.regtest.assetHash)(1_0000_0000), false)
    );
  });

  it('should substract fees if needed (substract fee from recipient)', async () => {
    await makeTest(
      makeRecipient(networks.regtest.assetHash)(1_0000_0000),
      true
    );
  });
});
