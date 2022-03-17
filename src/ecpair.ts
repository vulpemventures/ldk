import ECPairFactory from 'ecpair';
import { ecc } from './ecclib';

export const ECPair = ECPairFactory(ecc);
