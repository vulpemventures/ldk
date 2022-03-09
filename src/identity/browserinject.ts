import { BlindingDataLike } from 'liquidjs-lib/src/psbt';
import { MarinaProvider } from 'marina-provider';

import { AddressInterface, IdentityType } from '../types';
import { checkIdentityType } from '../utils';

import { Identity, IdentityInterface, IdentityOpts } from './identity';

/**
 * This interface describes the shape of the value arguments used in contructor.
 * @member windowProvider a valid property of the browser's window object where to lookup the injected provider
 */
export interface InjectOpts {
  windowProvider: string;
}

export class BrowserInject extends Identity implements IdentityInterface {
  // here we force MarinaProvider since there aren't other Liquid injected API specification available as TypeScript interface yet.
  protected provider: MarinaProvider;

  constructor(args: IdentityOpts<InjectOpts>) {
    super(args);

    // checks the args type.
    checkIdentityType(args.type, IdentityType.Inject);

    //checks if we are in the brower and if the provider is injected in the dom
    if (
      window === undefined ||
      (window as any)[args.opts.windowProvider] === undefined
    ) {
      throw new Error(
        'The value.windowProvider of IdentityOpts is not valid or the script is to injected in the window'
      );
    }

    this.provider = (window as any)[args.opts.windowProvider];
  }

  getNextAddress(): Promise<AddressInterface> {
    return this.provider.getNextAddress();
  }
  getNextChangeAddress(): Promise<AddressInterface> {
    return this.provider.getNextChangeAddress();
  }
  signPset(psetBase64: string): Promise<string> {
    return this.provider.signTransaction(psetBase64);
  }
  getAddresses(): Promise<AddressInterface[]> {
    return this.provider.getAddresses();
  }
  getBlindingPrivateKey(_: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
  isAbleToSign(): boolean {
    return true;
  }
  blindPset(
    _: string,
    __: number[],
    ___?: Map<number, string>,
    ____?: Map<number, BlindingDataLike>
  ): Promise<string> {
    throw new Error('Method not implemented.');
  }
}
