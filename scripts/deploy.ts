import { toNano } from '@ton/core';
import { RewardVault } from '../wrappers/RewardVault';
import { compile, NetworkProvider } from '@ton/blueprint';
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4, internal } from '@ton/ton';

export async function run(provider: NetworkProvider) {
    const timeout = 60n * 60n; // 1 hour
    const admin = provider.sender().address!;
    const mnemonics = process.env.WALLET_MNEMONIC!.split(' ');
    const signerKeyPair = await mnemonicToPrivateKey(mnemonics);
    const rewardVault = provider.open(
        RewardVault.createFromConfig(
            {
                timeout, // 1 hour
                admin,
                signer: signerKeyPair.publicKey,
            },
            await compile('RewardVault'),
        ),
    );

    await rewardVault.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(rewardVault.address);

    console.log('vault data: ', await rewardVault.getVaultData());
}
