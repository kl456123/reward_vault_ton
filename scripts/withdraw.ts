import { Address, toNano, Cell } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto';
import { RewardVault, JettonMinter, JettonWallet, jettonContentToCell, ExitCodes, Opcodes } from '../wrappers';

export async function run(provider: NetworkProvider, args: string[]) {
    const mnemonics = process.env.WALLET_MNEMONIC!.split(' ');
    const signerKeyPair = await mnemonicToPrivateKey(mnemonics);
    const deployerAddress = provider.sender().address!;

    const jettonMinter = provider.open(
        JettonMinter.createFromAddress(Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')),
    );

    const rewardVaultAddress = Address.parse('EQDNEThZMo4eFuim5GWyoskbatbynx-5ZQMsET7KZsJY44RI');

    const deployerJettonWallet = provider.open(
        JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(deployerAddress)),
    );
    const vaultJettonWallet = provider.open(
        JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(rewardVaultAddress)),
    );
    const rewardVault = provider.open(RewardVault.createFromAddress(rewardVaultAddress));

    const jettonAmount = toNano('0.0005');
    const createdAt = Math.floor(Date.now() / 1000) - 60;
    const projectId = 0n;
    const queryID = 1;
    const value = toNano('0.05');
    const recipient = deployerAddress;

    const withdrawResult = await rewardVault.sendWithdraw(provider.sender(), {
        value,
        queryID,
        signerKeyPair,
        projectId,
        createdAt,
        jettonAmount,
        recipient,
        tokenWalletAddress: vaultJettonWallet.address,
    });
}
