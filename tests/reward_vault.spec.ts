import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell } from '@ton/core';
import { RewardVault, JettonMinter, JettonWallet, jettonContentToCell, ExitCodes, Opcodes } from '../wrappers';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed, sign } from '@ton/crypto';
import { generateMockData } from './test_utils';

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

    it('check state of reward vault', async () => {
        const vaultData = await rewardVault.getVaultData();
        expect(vaultData.admin).toEqualAddress(deployer.address);
        expect(vaultData.timeout).toEqual(timeout);
        expect(vaultData.signer).toEqual(signerKeyPair.publicKey);
    });

    it('success to deposit jettons to reward vault', async () => {
        const depositAmount = toNano('0.05');
        const createdAt = Math.floor(Date.now() / 1000) - 60;
        const queryId = 0n;
        const projectId = 0n;

        const forwardPayload = RewardVault.depositPayload({
            signerKeyPair,
            createdAt,
            queryId,
            projectId,
            tokenWalletAddress: vaultJettonWallet.address,
            depositAmount,
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
    });

    it('revert when using invalid signature', async () => {
        const mockData = generateMockData();
        const newSignerKeyPair = keyPairFromSeed(await getSecureRandomBytes(32));
        const forwardPayload = RewardVault.depositPayload({
            ...mockData,
            signerKeyPair: newSignerKeyPair,
            tokenWalletAddress: vaultJettonWallet.address,
        });
        // revert when deposit again with the same signature
        const depositResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            mockData.tonAmount,
            mockData.depositAmount,
            rewardVault.address,
            deployer.address,
            Cell.EMPTY,
            mockData.forward_ton_amount,
            forwardPayload,
        );
        expect(depositResult.transactions).toHaveTransaction({
            from: vaultJettonWallet.address,
            to: rewardVault.address,
            success: false,
            exitCode: ExitCodes.InvaidSignature,
        });
    });

    it('revert when tx expiry', async () => {
        const mockData = generateMockData();
        const forwardPayload = RewardVault.depositPayload({
            ...mockData,
            signerKeyPair,
            tokenWalletAddress: vaultJettonWallet.address,
            // overwrite to make it expiry
            createdAt: Math.floor(Date.now() / 1000) - 60 * 60,
        });
        // revert when deposit again with the same signature
        const depositResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            mockData.tonAmount,
            mockData.depositAmount,
            rewardVault.address,
            deployer.address,
            Cell.EMPTY,
            mockData.forward_ton_amount,
            forwardPayload,
        );
        expect(depositResult.transactions).toHaveTransaction({
            from: vaultJettonWallet.address,
            to: rewardVault.address,
            success: false,
            exitCode: ExitCodes.InvalidCreatedAt,
        });
    });

    it('revert when using the same queryId again', async () => {
        const mockData = generateMockData();
        const forwardPayload = RewardVault.depositPayload({
            ...mockData,
            signerKeyPair,
            tokenWalletAddress: vaultJettonWallet.address,
        });
        // revert when deposit again with the same signature
        const depositResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            mockData.tonAmount,
            mockData.depositAmount,
            rewardVault.address,
            deployer.address,
            Cell.EMPTY,
            mockData.forward_ton_amount,
            forwardPayload,
        );
        expect(depositResult.transactions).toHaveTransaction({
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

        const vaultBalanceBefore = await vaultJettonWallet.getJettonBalance();
        const recipientBalanceBefore = 0n;
        const withdrawResult = await rewardVault.sendWithdraw(recipient.getSender(), {
            value,
            queryID,
            signerKeyPair,
            projectId,
            createdAt,
            jettonAmount,
            recipient: recipient.address,
            tokenWalletAddress: vaultJettonWallet.address,
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

    describe('administration test', () => {
        it('success to upgrade reward vault code', async () => {});

        it('success to change admin', async () => {
            const newAdmin = await blockchain.treasury('newAdmin');
            const opts = { value: toNano('0.05'), admin: newAdmin.address };
            const result = await rewardVault.sendTransferOwnership(deployer.getSender(), opts);
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: rewardVault.address,
                op: Opcodes.transfer_ownership,
                success: true,
            });
            {
                const vaultData = await rewardVault.getVaultData();
                expect(vaultData.admin).toEqualAddress(newAdmin.address);
            }

            const revertResult = await rewardVault.sendTransferOwnership(deployer.getSender(), opts);
            expect(revertResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: rewardVault.address,
                op: Opcodes.transfer_ownership,
                success: false,
            });
            // transfer ownership back to deployer
            const transferBackResult = await rewardVault.sendTransferOwnership(newAdmin.getSender(), {
                value: toNano('0.05'),
                admin: deployer.address,
            });
            expect(transferBackResult.transactions).toHaveTransaction({
                from: newAdmin.address,
                to: rewardVault.address,
                op: Opcodes.transfer_ownership,
                success: true,
            });
            {
                const vaultData = await rewardVault.getVaultData();
                expect(vaultData.admin).toEqualAddress(deployer.address);
            }
        });

        it('success to config signer', async () => {
            const newSignerKeyPair = keyPairFromSeed(await getSecureRandomBytes(32));
            const result = await rewardVault.sendConfigSigner(deployer.getSender(), {
                signer: newSignerKeyPair.publicKey,
                value: toNano('0.05'),
            });
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: rewardVault.address,
                op: Opcodes.config_signer,
                success: true,
            });
            const vaultData = await rewardVault.getVaultData();
            expect(vaultData.signer).toEqual(newSignerKeyPair.publicKey);

            await rewardVault.sendConfigSigner(deployer.getSender(), {
                signer: signerKeyPair.publicKey,
                value: toNano('0.05'),
            });
        });

        it('revert when non-admin to config signer', async () => {
            const newSignerKeyPair = keyPairFromSeed(await getSecureRandomBytes(32));
            const other = await blockchain.treasury('other');
            const result = await rewardVault.sendConfigSigner(other.getSender(), {
                signer: newSignerKeyPair.publicKey,
                value: toNano('0.05'),
            });
            expect(result.transactions).toHaveTransaction({
                from: other.address,
                to: rewardVault.address,
                op: Opcodes.config_signer,
                success: false,
            });
        });

        it.only('success to lock and unlock', async () => {
            expect((await rewardVault.getVaultData()).isLocked).toBeFalsy();
            await rewardVault.sendLock(deployer.getSender(), { value: toNano('0.05'), lock: true });
            expect((await rewardVault.getVaultData()).isLocked).toBeTruthy();
            await rewardVault.sendLock(deployer.getSender(), { value: toNano('0.05'), lock: false });
            expect((await rewardVault.getVaultData()).isLocked).toBeFalsy();
        });

        it('revert when non-admin to lock/unlock', async () => {
            const other = await blockchain.treasury('other');
            const lockRevertResult = await rewardVault.sendLock(other.getSender(), {
                value: toNano('0.05'),
                lock: true,
            });
            expect(lockRevertResult.transactions).toHaveTransaction({
                op: Opcodes.lock,
                success: false,
            });
            const unlockRevertResult = await rewardVault.sendLock(other.getSender(), {
                value: toNano('0.05'),
                lock: false,
            });
            expect(unlockRevertResult.transactions).toHaveTransaction({
                op: Opcodes.unlock,
                success: false,
            });
        });
    });
});
