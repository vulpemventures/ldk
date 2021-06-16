import { MasterPublicKey } from './../identity/masterpubkey';
import { Mnemonic } from './../identity/mnemonic';
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
    ): Promise<number | undefined> {
      let counter = 0;
      let index = 0;
      let maxIndex = undefined;

      while (counter < gapLimit) {
        const addr = nextAddrFunc(index);
        const addrHasTxs = await addressHasBeenUsed(addr, esploraURL);
        if (addrHasTxs) {
          maxIndex = index;
          counter = 0;
        } else {
          counter++;
        }
        index++;
      }
      return maxIndex;
    };

    const lastUsedExternalIndex = await restoreFunc((index: number) => {
      return identity.getAddress(false, index).address.confidentialAddress;
    });

    const lastUsedInternalIndex = await restoreFunc((index: number) => {
      return identity.getAddress(true, index).address.confidentialAddress;
    });

    return restorerFromState(identity)({
      lastUsedExternalIndex,
      lastUsedInternalIndex,
    });
  };
}

async function addressHasBeenUsed(
  address: string,
  esploraURL: string
): Promise<boolean> {
  const data = (await axios.get(`${esploraURL}/address/${address}/txs`)).data;
  return data.length > 0;
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
  lastUsedExternalIndex?: number;
  lastUsedInternalIndex?: number;
}

function restorerFromState<R extends MasterPublicKey>(
  identity: R
): Restorer<StateRestorerOpts, R> {
  return async ({ lastUsedExternalIndex, lastUsedInternalIndex }) => {
    if (lastUsedExternalIndex !== undefined) {
      for (let i = 0; i < lastUsedExternalIndex + 1; i++) {
        const address = await identity.getNextAddress();
        const index = getIndexFromAddress(address);
        if (index >= lastUsedExternalIndex) {
          break;
        }
      }
    }

    if (lastUsedInternalIndex !== undefined) {
      for (let i = 0; i < lastUsedInternalIndex + 1; i++) {
        const address = await identity.getNextChangeAddress();
        const index = getIndexFromAddress(address);
        if (index >= lastUsedInternalIndex) {
          break;
        }
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
