import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell } from '@ton/core';
import { RewardVault, JettonMinter, JettonWallet, jettonContentToCell, ExitCodes, Opcodes } from '../wrappers';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed, sign } from '@ton/crypto';

describe('RewardVault', () => {
    let code: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    const initBalance = toNano('100');
    let signerKeyPair: KeyPair;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let rewardVault: SandboxContract<RewardVault>;

    // jetton walet and minter
    let deployerJettonWallet: SandboxContract<JettonWallet>;
    let vaultJettonWallet: SandboxContract<JettonWallet>;
    let jettonMinter: SandboxContract<JettonMinter>;
    const timeout = 60n * 60n; // 1 hour

    beforeAll(async () => {
        code = await compile('RewardVault');
        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');

        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        signerKeyPair = keyPairFromSeed(await getSecureRandomBytes(32));

        rewardVault = blockchain.openContract(
            RewardVault.createFromConfig(
                {
                    timeout, // 1 hour
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
    });

    it('should deploy', async () => {
        const vaultData = await rewardVault.getVaultData();
        expect(vaultData.admin).toEqualAddress(deployer.address);
        expect(vaultData.timeout).toEqual(timeout);
        // the check is done inside beforeEach
        // blockchain and rewardVault are ready to use
    });

    it('revert when using invalid signature', async () => {});
    it('revert when using the same queryId again', async () => {});

    it('success to deposit jettons to reward vault', async () => {
        const depositAmount = toNano('0.05');
        const createdAt = Math.floor(Date.now() / 1000) - 60;
        const queryId = 0n;
        const projectId = 0n;

        const toSign = beginCell()
            .storeUint(queryId, 23)
            .storeUint(projectId, 64)
            .storeUint(createdAt, 64)
            .storeAddress(jettonMinter.address)
            .storeCoins(depositAmount)
            .endCell();

        const signature = sign(toSign.hash(), signerKeyPair.secretKey);
        const forwardPayload = RewardVault.depositPayload({
            signature,
            createdAt,
            queryId,
            projectId,
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

        // check transfer notification is handled correctly
        expect(depositResult.transactions).toHaveTransaction({
            from: vaultJettonWallet.address,
            to: rewardVault.address,
            success: true,
        });

        // check balance
        expect(await vaultJettonWallet.getJettonBalance()).toStrictEqual(initBalance + depositAmount);
        expect(await deployerJettonWallet.getJettonBalance()).toStrictEqual(initBalance - depositAmount);

        // revert when deposit again with the same signature
        const secondDepositResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            tonAmount,
            depositAmount,
            rewardVault.address,
            deployer.address,
            Cell.EMPTY,
            toNano('0.05'),
            forwardPayload,
        );
        expect(secondDepositResult.transactions).toHaveTransaction({
            from: vaultJettonWallet.address,
            to: rewardVault.address,
            success: false,
            exitCode: ExitCodes.AlreadyExecuted,
        });
    });

    it('success to withdraw jetton from reward vault', async () => {
        const jettonAmount = toNano('0.05');
        const createdAt = Math.floor(Date.now() / 1000) - 60;
        const projectId = 0n;
        const queryID = 1;
        const value = toNano('0.05');
        const recipient = await blockchain.treasury('recipient');
        const toSign = beginCell()
            .storeUint(queryID, 23)
            .storeUint(projectId, 64)
            .storeUint(createdAt, 64)
            .storeCoins(jettonAmount)
            .storeAddress(jettonMinter.address)
            .storeAddress(recipient.address)
            .endCell();

        const signature = sign(toSign.hash(), signerKeyPair.secretKey);

        const vaultBalanceBefore = await vaultJettonWallet.getJettonBalance();
        const recipientBalanceBefore = 0n;
        const withdrawResult = await rewardVault.sendWithdraw(recipient.getSender(), {
            value,
            queryID,
            signature,
            projectId,
            createdAt,
            jettonAmount,
            recipient: recipient.address,
            jettonAddress: jettonMinter.address,
        });

        expect(withdrawResult.transactions).toHaveTransaction({
            from: recipient.address,
            to: rewardVault.address,
            op: Opcodes.withdraw,
            success: true,
        });

        const recipientJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(recipient.address)),
        );

        // check balance
        expect(await vaultJettonWallet.getJettonBalance()).toStrictEqual(vaultBalanceBefore - jettonAmount);
        expect(await recipientJettonWallet.getJettonBalance()).toStrictEqual(recipientBalanceBefore + jettonAmount);
    });
});
