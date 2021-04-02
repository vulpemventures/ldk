import {
  EsploraIdentityRestorer,
  IdentityRestorerInterface,
} from './identityRestorer';
import {
  Network,
  Transaction,
  networks,
  confidential,
  TxOutput,
} from 'liquidjs-lib';
import { isConfidentialOutput, psetToUnsignedHex } from '../utils';
import { AddressInterface } from '../types';
import { decodePset } from '../transaction';
import { BlindingDataLike } from 'liquidjs-lib/types/psbt';

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
  getNextAddress(): AddressInterface | Promise<AddressInterface>;
  getNextChangeAddress(): AddressInterface | Promise<AddressInterface>;
  signPset(psetBase64: string): string | Promise<string>;
  getAddresses(): AddressInterface[] | Promise<AddressInterface[]>;
  getBlindingPrivateKey(script: string): string;
  isAbleToSign(): boolean;
  blindPset(
    // the pset to blind
    psetBase64: string,
    // the output to blind, specifided by output index
    outputsIndexToBlind: number[],
    // optional: an outputs index to hex encoded blinding pub key
    // only useful for non-wallet outputs
    outputsPubKeysByIndex?: Map<number, string>,
    // BlindingDataLike to use to blind the outputs by input index
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string>;
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

  async blindPsetWithBlindKeysGetter(
    getBlindingKeyPair: (
      script: Buffer
    ) => { publicKey: Buffer; privateKey: Buffer },
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    const inputsData = new Map<number, BlindingDataLike>();
    const outputsKeys = new Map<number, Buffer>();

    const pset = decodePset(psetBase64);
    const transaction = Transaction.fromHex(psetToUnsignedHex(psetBase64));

    // set the outputs map
    for (const index of outputsToBlind) {
      if (outputsPubKeys && outputsPubKeys.has(index)) {
        const pubKey = Buffer.from(outputsPubKeys.get(index)!, 'hex');
        outputsKeys.set(index, pubKey);
        continue;
      }

      const { script } = transaction.outs[index];
      const pubKey = getBlindingKeyPair(script).publicKey;
      outputsKeys.set(index, pubKey);
    }

    // set the inputs map
    for (let index = 0; index < pset.data.inputs.length; index++) {
      const input = pset.data.inputs[index];
      let script: Buffer | undefined = undefined;

      // continue if the input witness is unconfidential
      if (input.witnessUtxo) {
        if (!isConfidentialOutput(input.witnessUtxo)) {
          continue;
        }

        script = input.witnessUtxo.script;
      }

      if (input.nonWitnessUtxo) {
        const vout = transaction.ins[index].index;
        const witness = Transaction.fromBuffer(input.nonWitnessUtxo).outs[vout];
        if (!isConfidentialOutput(witness)) {
          continue;
        }

        script = witness.script;
      }

      // check if blindingDataLike is specified
      if (inputsBlindingDataLike && inputsBlindingDataLike.has(index)) {
        inputsData.set(index, inputsBlindingDataLike.get(index));
        continue;
      }

      if (!script) {
        throw new Error('no witness script for input #' + index);
      }

      // else, get the private blinding key and use it as blindingDataLike
      const privKey = getBlindingKeyPair(script).privateKey;
      const blinders = await confidential.unblindOutputWithKey(
        input.witnessUtxo as TxOutput,
        privKey
      );

      inputsData.set(index, blinders);
    }

    const blinded = await pset.blindOutputsByIndex(inputsData, outputsKeys);
    return blinded.toBase64();
  }
}
