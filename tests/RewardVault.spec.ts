import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell } from '@ton/core';
import { RewardVault, JettonMinter, JettonWallet, jettonContentToCell } from '../wrappers';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed, sign } from '@ton/crypto';

describe('RewardVault', () => {
    let code: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    const initBalance = toNano('100');
    let signerKeyPair: KeyPair;

    beforeAll(async () => {
        code = await compile('RewardVault');
        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let rewardVault: SandboxContract<RewardVault>;

    // jetton walet and minter
    let deployerJettonWallet: SandboxContract<JettonWallet>;
    let vaultJettonWallet: SandboxContract<JettonWallet>;
    let jettonMinter: SandboxContract<JettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        signerKeyPair = keyPairFromSeed(await getSecureRandomBytes(32));

        rewardVault = blockchain.openContract(
            RewardVault.createFromConfig(
                {
                    admin: deployer.address,
                    signer: signerKeyPair.publicKey,
                    jettonCode: jettonWalletCode,
                },
                code,
            ),
        );

        const contentUrl = 'https://www.example.com';
        const content = jettonContentToCell({ type: 1, uri: contentUrl });
        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                { admin: deployer.address, content, wallet_code: jettonWalletCode },
                jettonMinterCode,
            ),
        );
        // deploy jetton token and mint
        await jettonMinter.sendDeploy(deployer.getSender(), toNano('0.05'));

        await jettonMinter.sendMint(deployer.getSender(), deployer.address, initBalance, 0n, toNano('0.05'));
        await jettonMinter.sendMint(deployer.getSender(), rewardVault.address, initBalance, 0n, toNano('0.05'));

        deployerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(deployer.address)),
        );
        vaultJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(rewardVault.address)),
        );
        // check balance
        expect(await deployerJettonWallet.getJettonBalance()).toStrictEqual(initBalance);
        expect(await vaultJettonWallet.getJettonBalance()).toStrictEqual(initBalance);

        const deployResult = await rewardVault.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: rewardVault.address,
            deploy: true,
            success: true,
        });

        /// print contract addresses
        // console.log('deployer: ', deployer.address)
        // console.log('rewardVault: ', rewardVault.address)
        // console.log('jettonMinter: ', jettonMinter.address)
        // console.log('deployerJettonWallet: ', deployerJettonWallet.address)
        // console.log('vaultJettonWallet: ', vaultJettonWallet.address)
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and rewardVault are ready to use
    });

    it('revert when using invalid signature', async () => {});

    it('should deposit jettons to reward vault', async () => {
        const depositAmount = toNano('0.05');
        const validUntil = Math.floor(Date.now() / 1000) + 60;

        const toSign = beginCell()
            .storeCoins(depositAmount)
            .storeAddress(deployer.address)
            .storeAddress(jettonMinter.address)
            .storeUint(validUntil, 32)
            .endCell();

        const signature = sign(toSign.hash(), signerKeyPair.secretKey);
        const forwardPayload = RewardVault.depositPayload({
            signature,
            validUntil,
            jettonAddress: jettonMinter.address,
        });
        const tonAmount = toNano('0.1');
        const depositResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            tonAmount,
            depositAmount,
            rewardVault.address,
            deployer.address,
            Cell.EMPTY,
            toNano('0.05'),
            forwardPayload,
        );

        // check balance
        expect(await vaultJettonWallet.getJettonBalance()).toStrictEqual(initBalance + depositAmount);
        expect(await deployerJettonWallet.getJettonBalance()).toStrictEqual(initBalance - depositAmount);

        // check transfer notification is handled correctly
        expect(depositResult.transactions).toHaveTransaction({
            from: vaultJettonWallet.address,
            to: rewardVault.address,
            success: true,
        });
    });
});
