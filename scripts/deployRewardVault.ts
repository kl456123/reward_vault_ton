import { toNano } from '@ton/core';
import { RewardVault } from '../wrappers/RewardVault';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const rewardVault = provider.open(
        RewardVault.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                counter: 0,
            },
            await compile('RewardVault'),
        ),
    );

    await rewardVault.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(rewardVault.address);

    console.log('ID', await rewardVault.getID());
}
