import { IdentityInterface } from '../identity/identity';

export type Restorer<ArgsT, IdentityType extends IdentityInterface> = (
  args: ArgsT
) => Promise<IdentityType>;
