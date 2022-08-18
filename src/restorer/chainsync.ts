import { ChainAPI } from '../explorer/api';
import { IdentityInterface } from '../identity/identity';
import { Mnemonic } from '../identity/mnemonic';
import { restorerFromState } from './mnemonic-restorer';
import { Restorer } from './restorer';

function makeRestorerFromChainAPI<T extends IdentityInterface>(
  id: T,
  getAddress: (isChange: boolean, index: number) => string
): Restorer<{ api: ChainAPI; gapLimit: number }, IdentityInterface> {
  return async ({ gapLimit, api }) => {
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

        const hasBeenUsedArray = await api.addressesHasBeenUsed(addrs);

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

    return restorerFromState(id)({
      lastUsedExternalIndex,
      lastUsedInternalIndex,
    });
  };
}

export function mnemonicRestorerFromChain(mnemonicToRestore: Mnemonic) {
  return makeRestorerFromChainAPI<Mnemonic>(
    mnemonicToRestore,
    (isChange, index) =>
      mnemonicToRestore.getAddress(isChange, index).address.confidentialAddress
  );
}
