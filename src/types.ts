/**
 * Defines the shape of the object returned by the getAdresses's method.
 * @member confidentialAddress the confidential address.
 * @member blindingPrivateKey the blinding private key associated to the confidential address.
 */
export interface AddressInterface {
  confidentialAddress: string;
  blindingPrivateKey: string;
}
