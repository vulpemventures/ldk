import axios from 'axios';
import { Transaction, TxOutput } from 'liquidjs-lib';

import {
  BlindedOutputInterface,
  TxInterface,
  UnblindedOutputInterface,
  isBlindedOutputInterface,
  InputInterface,
} from '../types';
import { isConfidentialOutput, toAssetHash, toNumber } from '../utils';

import { EsploraTx, EsploraUtxo } from './types';

const ZERO = Buffer.alloc(32).toString('hex');

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
): Promise<EsploraUtxo[]> {
  return (await axios.get(`${url}/address/${address}/utxo`)).data;
}

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
      return txOutputToOutputInterface(
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

  const txOutputs = transaction.outs.map(txOutputToOutputInterface);

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
function txOutputToOutputInterface(
  txOutput: TxOutput
): BlindedOutputInterface | UnblindedOutputInterface {
  if (isConfidentialOutput(txOutput)) {
    const blindedOutput: BlindedOutputInterface = {
      blindedAsset: txOutput.asset,
      blindedValue: txOutput.value,
      nonce: txOutput.nonce,
      rangeProof: txOutput.rangeProof!,
      surjectionProof: txOutput.surjectionProof!,
      script: txOutput.script.toString('hex'),
    };
    return blindedOutput;
  }

  const unblindedOutput: UnblindedOutputInterface = {
    asset: toAssetHash(txOutput.asset),
    value: toNumber(txOutput.value),
    script: txOutput.script.toString('hex'),
    assetBlinder: ZERO,
    valueBlinder: ZERO,
  };

  return unblindedOutput;
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
    if (output.script.length > 0 && !isBlindedOutputInterface(output)) {
      outputsData.push({
        ...output,
        assetBlinder: reverseHex(output.assetBlinder),
        valueBlinder: reverseHex(output.valueBlinder),
      });
    }
  }

  return makeUnblindURL(baseURL, tx.txid, outputsData);
}
