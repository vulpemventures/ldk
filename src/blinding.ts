import { confidential, address } from 'liquidjs-lib';
import { UnblindedOutput } from './types';
import { isConfidentialOutput, psetToUnsignedTx } from './utils';

/**
 * iterates through pset's inputs and try to find the prevout blinders.
 * @param pset the unsigned pset to blind
 * @param utxos a set of coins (should contain all the pset prevouts to build the whole map)
 * @returns a map inputIndex => blinders data which can be used as input of blindOutputByIndex.
 */
export function inputBlindingDataMap(
  pset: string,
  utxos: UnblindedOutput[]
): Map<number, confidential.UnblindOutputResult> {
  const inputBlindingData = new Map<number, confidential.UnblindOutputResult>();
  const txidToBuffer = function(txid: string) {
    return Buffer.from(txid, 'hex').reverse();
  };

  let index = -1;
  for (const input of psetToUnsignedTx(pset).ins) {
    index++;
    const utxo = utxos.find(
      u => txidToBuffer(u.txid).equals(input.hash) && u.vout === input.index
    );

    // only add unblind data if the prevout of the input is confidential
    if (utxo && utxo.unblindData && isConfidentialOutput(utxo.prevout)) {
      inputBlindingData.set(index, utxo.unblindData);
    }
  }

  return inputBlindingData;
}

/**
 * find the blinding public key associated with output script using a set of addresses.
 * @param pset the unsigned pset to blind
 * @param outputAddresses a set of addresses used to craft the pset outputs.
 * @returns the blinding public mapped to output index. Can be used as input in blindOutputByIndex.
 */
export function outputBlindingPubkeysMap(
  pset: string,
  outputAddresses: string[]
): Map<number, Buffer> {
  const outPubkeys: Map<number, Buffer> = new Map();

  for (const outAddress of outputAddresses) {
    const index = outputIndexFromAddress(pset, outAddress);
    if (index === -1) continue;
    if (isConfidentialAddress(outAddress)) {
      outPubkeys.set(index, blindingKeyFromAddress(outAddress));
    }
  }

  return outPubkeys;
}

function outputIndexFromAddress(tx: string, addressToFind: string): number {
  const utx = psetToUnsignedTx(tx);
  const recipientScript = address.toOutputScript(addressToFind);
  return utx.outs.findIndex(out => out.script.equals(recipientScript));
}

function isConfidentialAddress(addr: string): boolean {
  try {
    address.fromConfidential(addr);
    return true;
  } catch (ignore) {
    return false;
  }
}

function blindingKeyFromAddress(addr: string): Buffer {
  return address.fromConfidential(addr).blindingKey;
}
