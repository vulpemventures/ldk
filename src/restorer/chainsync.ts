import { ChainAPI } from '../explorer/api';
import { CointypeIdentity } from '../identity/cointype';
import { IdentityInterface } from '../identity/identity';
import { MasterPublicKey } from '../identity/masterpubkey';
import { restorerFromState } from './mnemonic-restorer';
import { Restorer } from './restorer';

function makeRestorerFromChainAPI<T extends IdentityInterface>(
  id: T,
  getAddress: (isChange: boolean, index: number) => string
): Restorer<{ api: ChainAPI; gapLimit: number }, T> {
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

export function mnemonicRestorerFromChain<T extends MasterPublicKey>(
  mnemonicToRestore: T
) {
  return makeRestorerFromChainAPI<T>(
    mnemonicToRestore,
    (isChange, index) =>
      mnemonicToRestore.getAddress(isChange, index).address.confidentialAddress
  );
}

export function cointypeRestorerFromChain<T extends CointypeIdentity>(
  identityToRestore: T
): Restorer<{ api: ChainAPI; gapLimit: number }, T> {
  const restorers: Restorer<
    { api: ChainAPI; gapLimit: number },
    MasterPublicKey
  >[] = [];
  for (const account of identityToRestore.accounts) {
    restorers.push(mnemonicRestorerFromChain(account));
  }

  return async ({ gapLimit, api }) => {
    const restoredAccounts = await Promise.all(
      restorers.map(r => r({ gapLimit, api }))
    );
    identityToRestore.accounts = restoredAccounts;
    return identityToRestore;
  };
}
