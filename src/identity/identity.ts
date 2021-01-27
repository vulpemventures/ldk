import {
  EsploraIdentityRestorer,
  IdentityRestorerInterface,
} from './identityRestorer';
import { Network, networks } from 'liquidjs-lib';
import { AddressInterface } from '../types';

/**
 * Enumeration of all the Identity types.
 */
export enum IdentityType {
  PrivateKey = 1,
  Mnemonic,
  MasterPublicKey,
  Inject,
  Ledger,
  Trezor,
}

/**
 * The identity interface.
 * @member network the network type (regtest, liquid...)
 * @member type the Identity type @see IdentityType
 * @method signPset take a base64 pset, sign it, and returns the result base64 encoded.
 * @method getAddresses returns all the generated addresses (and their blindkey if confidential).
 */
export interface IdentityInterface {
  network: Network;
  type: IdentityType;
  restorer: IdentityRestorerInterface;
  isRestored: Promise<boolean>;
  getNextAddress(): AddressInterface;
  getNextChangeAddress(): AddressInterface;
  signPset(psetBase64: string): string | Promise<string>;
  getAddresses(): AddressInterface[];
  getBlindingPrivateKey(script: string): string;
  isAbleToSign(): boolean;
}

/**
 * Identity constructors options.
 * @member chain the blockchain type of the identity.
 * @member type the identity type @see IdentityType .
 * @member value the data used to create the Identity. depends of the type.
 */
export interface IdentityOpts {
  chain: string;
  type: number;
  value: any;
  initializeFromRestorer?: boolean;
  restorer?: IdentityRestorerInterface;
}

/**
 * Abstract class for Identity.
 */
export default class Identity {
  static DEFAULT_RESTORER: IdentityRestorerInterface = new EsploraIdentityRestorer();

  network: Network;
  type: IdentityType;
  restorer: IdentityRestorerInterface;

  constructor(args: IdentityOpts) {
    if (!args.chain || !networks.hasOwnProperty(args.chain)) {
      throw new Error('Network is missing or not valid');
    }

    if (!args.type || !(args.type in IdentityType)) {
      throw new Error('Type is missing or not valid');
    }

    this.network = (networks as Record<string, Network>)[args.chain];
    this.type = args.type;

    // set the restorer if the user specified it.
    if (args.restorer) {
      this.restorer = args.restorer;
    } else {
      this.restorer = Identity.DEFAULT_RESTORER;
    }
  }
}
