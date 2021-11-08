import axios from 'axios';
import { Transaction, TxOutput } from 'liquidjs-lib';
import {
  TxInterface,
  InputInterface,
  Output,
  Outpoint,
  isUnblindedOutput,
  sats,
  asset,
} from '../types';
import { EsploraTx, EsploraUtxo } from './types';
import { fetchAndUnblindUtxos } from './utxos';

/**
 * Fetch the raw transaction by txid
 * @param txId txID to fetch
 * @param url esplora URL
 */
export async function fetchTxHex(txId: string, url: string): Promise<string> {
  return (await axios.get(`${url}/tx/${txId}/hex`)).data;
}

/**
 * Fetch the transaction as TxInterface (with prevouts)
 * @param txId transaction's hash to fetch
 * @param url the esplora URL
 */
export async function fetchTx(txId: string, url: string): Promise<TxInterface> {
  return esploraTxToTxInterface(
    (await axios.get(`${url}/tx/${txId}`)).data,
    url
  );
}

/**
 * Fetch unspents for a given address.
 * @param address
 * @param url the esplora URL
 */
export async function fetchUtxos(
  address: string,
  url: string
): Promise<Output[]> {
  const esploraUtxos: EsploraUtxo[] = (
    await axios.get(`${url}/address/${address}/utxo`)
  ).data;
  return Promise.all(esploraUtxos.map(outpointToUtxo(url)));
}

const outpointToUtxo = (esploraURL: string) => async (
  outpoint: Outpoint
): Promise<Output> => {
  const prevoutHex: string = await fetchTxHex(outpoint.txid, esploraURL);
  const prevout = Transaction.fromHex(prevoutHex).outs[outpoint.vout];
  return { ...outpoint, prevout };
};

/**
 * Convert an esplora transaction to a TxInterface
 * @param esploraTx
 * @param explorerUrl
 */
export async function esploraTxToTxInterface(
  esploraTx: EsploraTx,
  explorerUrl: string
): Promise<TxInterface> {
  const inputTxIds: string[] = [];
  const inputVouts: number[] = [];

  for (const input of esploraTx.vin) {
    inputTxIds.push(input.txid);
    inputVouts.push(input.vout);
  }

  const prevoutTxHexs = await Promise.all(
    inputTxIds.map((txid, index) => {
      if (!esploraTx.vin[index].is_pegin) return fetchTxHex(txid, explorerUrl);
      return Promise.resolve(undefined); // return undefined in case of pegin
    })
  );

  const prevoutAsOutput = prevoutTxHexs.map(
    (hex: string | undefined, index: number) => {
      if (!hex) return undefined;
      return makeOutput(
        { txid: inputTxIds[index], vout: inputVouts[index] },
        Transaction.fromHex(hex).outs[inputVouts[index]]
      );
    }
  );

  const txInputs: InputInterface[] = inputTxIds.map(
    (txid: string, index: number) => {
      return {
        prevout: prevoutAsOutput[index],
        txid: txid,
        vout: inputVouts[index],
        isPegin: esploraTx.vin[index].is_pegin,
      };
    }
  );

  const txHex = await fetchTxHex(esploraTx.txid, explorerUrl);
  const transaction = Transaction.fromHex(txHex);

  const makeOutpoint = (index: number): Outpoint => ({
    txid: esploraTx.txid,
    vout: index,
  });
  const makeOutputFromTxout = (txout: TxOutput, index: number): Output =>
    makeOutput(makeOutpoint(index), txout);
  const txOutputs = transaction.outs.map(makeOutputFromTxout);

  const tx: TxInterface = {
    txid: esploraTx.txid,
    vin: txInputs,
    vout: txOutputs,
    fee: esploraTx.fee,
    status: {
      confirmed: esploraTx.status.confirmed,
      blockHash: esploraTx.status.block_hash,
      blockHeight: esploraTx.status.block_height,
      blockTime: esploraTx.status.block_time,
    },
  };

  return tx;
}

// util function for output mapping
function makeOutput(outpoint: Outpoint, txOutput: TxOutput): Output {
  return {
    ...outpoint,
    prevout: txOutput,
  };
}

/**
 * Create unblinded explorer URL from blinding data
 * @param baseURL
 * @param txID
 * @param outputsBlinder
 */
export function makeUnblindURL(
  baseURL: string,
  txID: string,
  outputsBlinder: {
    value: number;
    asset: string;
    assetBlinder: string;
    valueBlinder: string;
  }[]
): string {
  const outputsString = outputsBlinder
    .map(
      ({ value, asset, assetBlinder, valueBlinder }) =>
        `${value},${asset},${valueBlinder},${assetBlinder}`
    )
    .join(',');
  return `${baseURL}/tx/${txID}#blinded=${outputsString}`;
}

/**
 * Create explorer URL with unblinding data
 * @param tx transaction to create the link for
 * @param baseURL base web Explorer URL
 */
export function getUnblindURLFromTx(tx: TxInterface, baseURL: string) {
  const outputsData: {
    value: number;
    asset: string;
    assetBlinder: string;
    valueBlinder: string;
  }[] = [];

  const reverseHex = (blinder: string) =>
    Buffer.from(blinder, 'hex')
      .reverse()
      .toString('hex');

  for (const output of tx.vout) {
    if (output.prevout.script.length > 0 && isUnblindedOutput(output)) {
      outputsData.push({
        value: sats(output),
        asset: asset(output),
        assetBlinder: reverseHex(
          output.unblindData.assetBlindingFactor.toString('hex')
        ),
        valueBlinder: reverseHex(
          output.unblindData.valueBlindingFactor.toString('hex')
        ),
      });
    }
  }

  return makeUnblindURL(baseURL, tx.txid, outputsData);
}

/**
 * Fetch balances for a given address
 * @param address the address to fetch utxos
 * @param blindPrivKey the blinding private key (if the address is confidential one)
 * @param url esplora URL
 */
export async function fetchBalances(
  address: string,
  blindPrivKey: string,
  url: string
) {
  const utxoInterfaces = await fetchAndUnblindUtxos(
    [{ confidentialAddress: address, blindingPrivateKey: blindPrivKey }],
    url
  );
  return (utxoInterfaces as any).reduce(
    (storage: { [x: string]: any }, item: { [x: string]: any; value: any }) => {
      // get the first instance of the key by which we're grouping
      const group = item['asset'];

      // set `storage` for this instance of group to the outer scope (if not empty) or initialize it
      storage[group] = storage[group] || 0;

      // add this item to its group within `storage`
      storage[group] += item.value;

      // return the updated storage to the reduce function, which will then loop through the next
      return storage;
    },
    {}
  ); // {} is the initial value of the storage
}
