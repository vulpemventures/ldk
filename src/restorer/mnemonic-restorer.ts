import { MasterPublicKey } from './../identity/masterpubkey';
import { Mnemonic } from './../identity/mnemonic';
import { Restorer } from './restorer';
import axios from 'axios';
import { IdentityInterface, Multisig, MultisigWatchOnly } from '..';

// from Esplora

export const BLOCKSTREAM_ESPLORA_ENDPOINT: string =
  'https://blockstream.info/liquid/api';

export interface EsploraRestorerOpts {
  esploraURL: string;
  gapLimit: number;
}

function restorerFromEsplora<R extends IdentityInterface>(
  identity: R,
  getAddress: (isChange: boolean, index: number) => string
): Restorer<EsploraRestorerOpts, R> {
  return async ({
    esploraURL = BLOCKSTREAM_ESPLORA_ENDPOINT,
    gapLimit = 20,
  }) => {
    const restoreFunc = async function(
      getAddrFunc: (index: number) => Promise<string>
    ): Promise<number | undefined> {
      let counter = 0;
      let next = 0;
      let maxIndex: number | undefined = undefined;

      while (counter < gapLimit) {
        const cpyNext = next;
        // generate a set of addresses from next to (next + gapLimit - 1)
        const addrs = await Promise.all(
          Array.from(Array(gapLimit).keys())
            .map(i => i + cpyNext)
            .map(getAddrFunc)
        );

        const hasBeenUsedArray = await Promise.all(
          addrs.map(a => addressHasBeenUsed(a, esploraURL))
        );

        let indexInArray = 0;
        for (const hasBeenUsed of hasBeenUsedArray) {
          if (hasBeenUsed) {
            maxIndex = indexInArray + next;
            counter = 0;
          } else {
            counter++;
            if (counter === gapLimit) return maxIndex; // duplicate the stop condition
          }
          indexInArray++;
        }

        next += gapLimit; // increase next
      }

      return maxIndex;
    };

    const restorerExternal = restoreFunc((index: number) => {
      return Promise.resolve(getAddress(false, index));
    });

    const restorerInternal = restoreFunc((index: number) => {
      return Promise.resolve(getAddress(true, index));
    });

    const [lastUsedExternalIndex, lastUsedInternalIndex] = await Promise.all([
      restorerExternal,
      restorerInternal,
    ]);

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
  return restorerFromEsplora<Mnemonic>(
    mnemonicToRestore,
    (isChange, index) =>
      mnemonicToRestore.getAddress(isChange, index).address.confidentialAddress
  );
}

/**
 * build an async esplora restorer for a specific masterPubKey
 * @param toRestore
 */
export function masterPubKeyRestorerFromEsplora(toRestore: MasterPublicKey) {
  return restorerFromEsplora<MasterPublicKey>(
    toRestore,
    (isChange, index) =>
      toRestore.getAddress(isChange, index).address.confidentialAddress
  );
}

/**
 * build an async esplora restorer for a MultisigWatchOnly
 * @param toRestore
 */
export function multisigWatchOnlyFromEsplora(toRestore: MultisigWatchOnly) {
  return restorerFromEsplora<MultisigWatchOnly>(
    toRestore,
    (isChange, index) =>
      toRestore.getMultisigAddress(
        isChange
          ? MultisigWatchOnly.INTERNAL_INDEX
          : MultisigWatchOnly.EXTERNAL_INDEX,
        index
      ).confidentialAddress
  );
}

/**
 * build an async esplora restorer for a Multisig
 * @param toRestore
 */
export function multisigFromEsplora(toRestore: Multisig) {
  return restorerFromEsplora<Multisig>(
    toRestore,
    (isChange, index) =>
      toRestore.getMultisigAddress(
        isChange
          ? MultisigWatchOnly.INTERNAL_INDEX
          : MultisigWatchOnly.EXTERNAL_INDEX,
        index
      ).confidentialAddress
  );
}

// From state

export interface StateRestorerOpts {
  lastUsedExternalIndex?: number;
  lastUsedInternalIndex?: number;
}

function restorerFromState<R extends IdentityInterface>(
  identity: R
): Restorer<StateRestorerOpts, R> {
  return async ({ lastUsedExternalIndex, lastUsedInternalIndex }) => {
    const promises = [];

    if (lastUsedExternalIndex !== undefined) {
      for (let i = 0; i <= lastUsedExternalIndex; i++) {
        const promise = identity.getNextAddress();
        promises.push(promise);
      }
    }

    if (lastUsedInternalIndex !== undefined) {
      for (let i = 0; i <= lastUsedInternalIndex; i++) {
        const promise = identity.getNextChangeAddress();
        promises.push(promise);
      }
    }

    await Promise.all(promises);

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
