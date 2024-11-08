import { Address, toNano, Cell } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto';
import { RewardVault, JettonMinter, JettonWallet, jettonContentToCell, ExitCodes, Opcodes } from '../wrappers';

export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();
    const rewardVaultAddress = Address.parse(args.length > 0 ? args[0] : await ui.input('reward vault address'));

    const depositAmount = toNano('0.001');
    const createdAt = Math.floor(Date.now() / 1000) - 60;
    const queryId = 0n;
    const projectId = 0n;
    const mnemonics = process.env.WALLET_MNEMONIC!.split(' ');
    const signerKeyPair = await mnemonicToPrivateKey(mnemonics);
    const deployerAddress = provider.sender().address!;

    const jettonMinter = provider.open(
        JettonMinter.createFromAddress(Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')),
    );

    const deployerJettonWallet = provider.open(
        JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(deployerAddress)),
    );
    const vaultJettonWallet = provider.open(
        JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(rewardVaultAddress)),
    );

    const forwardPayload = RewardVault.depositPayload({
        signerKeyPair,
        createdAt,
        queryId,
        projectId,
        tokenWalletAddress: vaultJettonWallet.address,
        depositAmount,
    });
    const totalTonAmount = toNano('0.1');
    const forwardTonAmount = toNano('0.05');
    const depositResult = await deployerJettonWallet.sendTransfer(
        provider.sender(),
        totalTonAmount,
        depositAmount,
        rewardVaultAddress,
        deployerAddress,
        Cell.EMPTY,
        forwardTonAmount,
        forwardPayload,
    );
    ui.clearActionPrompt();
    ui.write('Ownership transfered successfully!');
}
