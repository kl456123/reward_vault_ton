import { Address, toNano, Cell } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto';
import { RewardVault, JettonMinter, JettonWallet, jettonContentToCell, ExitCodes, Opcodes } from '../wrappers';

export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();
    const newAdmin = Address.parse(args.length > 0 ? args[0] : await ui.input('new admin address'));
    const rewardVaultAddress = Address.parse('EQDNEThZMo4eFuim5GWyoskbatbynx-5ZQMsET7KZsJY44RI');
    const rewardVault = provider.open(RewardVault.createFromAddress(rewardVaultAddress));

    const opts = { value: toNano('0.05'), admin: newAdmin };
    await rewardVault.sendTransferOwnership(provider.sender(), opts);

    ui.clearActionPrompt();
    ui.write('Ownership transfered successfully!');
}
