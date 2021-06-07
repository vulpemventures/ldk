import { MasterPublicKey } from './../identity/masterpubkey';
import { Mnemonic } from './../identity/mnemonic';
import { IdentityInterface } from '../identity/identity';
import { Restorer } from './restorer';
import axios from 'axios';
import { getIndexFromAddress } from '../utils';

// from Esplora

export const BLOCKSTREAM_ESPLORA_ENDPOINT: string =
  'https://blockstream.info/liquid/api';

export interface EsploraRestorerOpts {
  esploraURL: string;
  gapLimit: number;
}

function restorerFromEsplora<R extends MasterPublicKey>(
  identity: R
): Restorer<EsploraRestorerOpts, R> {
  return async ({
    esploraURL = BLOCKSTREAM_ESPLORA_ENDPOINT,
    gapLimit = 20,
  }) => {
    const restoreFunc = async function(
      nextAddrFunc: (index: number) => string
    ): Promise<number> {
      let counter = 0;
      let index = 0;
      let maxIndex = 0;

      while (counter < gapLimit) {
        const addr = nextAddrFunc(index);
        const addrHasTxs = await addressHasBeenUsed(addr, esploraURL);
        index++;

        if (addrHasTxs) {
          maxIndex = index;
          counter = 0;
        } else counter++;
      }

      return maxIndex;
    };

    const maxExternalIndex = await restoreFunc(
      (index: number) =>
        identity.getAddress(false, index).address.confidentialAddress
    );

    const maxInternalIndex = await restoreFunc(
      (index: number) =>
        identity.getAddress(true, index).address.confidentialAddress
    );

    return restorerFromState(identity)({ maxExternalIndex, maxInternalIndex });
  };
}

async function addressHasBeenUsed(
  address: string,
  esploraURL: string
): Promise<boolean> {
  const data = (await axios.get(`${esploraURL}/address/${address}/txs`)).data;
  return data.length > 0 ? true : false;
}

/**
 * build an async esplora restorer for a specific mnemonic
 * @param mnemonicToRestore
 */
export function mnemonicRestorerFromEsplora(mnemonicToRestore: Mnemonic) {
  return restorerFromEsplora<Mnemonic>(mnemonicToRestore);
}

/**
 * build an async esplora restorer for a specific masterPubKey
 * @param toRestore
 */
export function masterPubKeyRestorerFromEsplora(toRestore: MasterPublicKey) {
  return restorerFromEsplora<MasterPublicKey>(toRestore);
}

// From state

export interface StateRestorerOpts {
  maxExternalIndex: number;
  maxInternalIndex: number;
}

function restorerFromState<R extends IdentityInterface>(
  identity: R
): Restorer<StateRestorerOpts, R> {
  return async ({ maxExternalIndex, maxInternalIndex }) => {
    for (let i = 0; i < maxExternalIndex; i++) {
      const address = await identity.getNextAddress();
      const index = getIndexFromAddress(address);
      if (index === maxExternalIndex) {
        break;
      }
    }

    for (let i = 0; i < maxInternalIndex; i++) {
      const address = await identity.getNextChangeAddress();
      const index = getIndexFromAddress(address);
      if (index === maxInternalIndex) {
        break;
      }
    }

    return identity;
  };
}

/**
 * create a restorer from state for a given mnemonic
 * @param toRestore
 */
export function mnemonicRestorerFromState(toRestore: Mnemonic) {
  return restorerFromState<Mnemonic>(toRestore);
}

/**
 * create a restorer from state for a given mnemonic
 * @param toRestore
 */
export function masterPubKeyRestorerFromState(toRestore: MasterPublicKey) {
  return restorerFromState<MasterPublicKey>(toRestore);
}
