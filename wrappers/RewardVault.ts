import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed, sign } from '@ton/crypto';
import { JettonMinter, JettonWallet } from '../wrappers';

export type RewardVaultConfig = {
    admin: Address;
    signer: Buffer;
    jettonCode: Cell;
    timeout: bigint;
};

export function rewardVaultConfigToCell(config: RewardVaultConfig): Cell {
    return beginCell()
        .storeUint(0, 1)
        .storeAddress(config.admin)
        .storeBuffer(config.signer)
        .storeUint(0, 1 + 1 + 64)
        .storeUint(config.timeout, 22)
        .endCell();
}

export const Opcodes = {
    deposit: 0x95db9d39,
    claim: 0xa769de27,
    withdraw: 0xb5de5f9e,

    config_signer: 0x9c0e0150,
    transfer_ownership: 0xb516d5ff,
    lock: 0x683a7dab,
    unlock: 0xb516d5ff,
    upgrade: 0xdbfaf817,
};

export const ExitCodes = {
    AlreadyExecuted: 36,
    InvaidSignature: 33,
    InvalidCreatedAt: 35,
    InvalidMessageToSend: 37,
    InvalidOp: 38,
    InvalidSender: 39,
    InvalidWC: 40,
};

export class RewardVault implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new RewardVault(address);
    }

    static createFromConfig(config: RewardVaultConfig, code: Cell, workchain = 0) {
        const data = rewardVaultConfigToCell(config);
        const init = { code, data };
        return new RewardVault(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendConfigSigner(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; signer: Buffer; queryID?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.config_signer, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeBuffer(opts.signer)
                .endCell(),
        });
    }

    async sendLock(provider: ContractProvider, via: Sender, opts: { value: bigint; lock: boolean; queryID?: number }) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(opts.lock ? Opcodes.lock : Opcodes.unlock, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .endCell(),
        });
    }

    async sendUpgrade(provider: ContractProvider, via: Sender, opts: { value: bigint; queryID?: number }) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.upgrade, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .endCell(),
        });
    }

    async sendTransferOwnership(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; admin: Address; queryID?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.transfer_ownership, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeAddress(opts.admin)
                .endCell(),
        });
    }

    async sendClaim(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryID: number;
            signature: Buffer;
            projectId: bigint;
            createdAt: number;
            jettonAmount: bigint;
            recipient: Address;
            tokenWalletAddress: Address;
        },
    ) {}

    async sendWithdraw(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryID: number;
            signerKeyPair: KeyPair;
            projectId: bigint;
            createdAt: number;
            jettonAmount: bigint;
            recipient: Address;
            tokenWalletAddress: Address;
        },
    ) {
        const toSign = beginCell()
            .storeUint(opts.queryID, 23)
            .storeUint(opts.projectId, 64)
            .storeUint(opts.createdAt, 64)
            .storeCoins(opts.jettonAmount)
            .storeAddress(opts.tokenWalletAddress)
            .storeAddress(opts.recipient)
            .endCell();

        const signature = sign(toSign.hash(), opts.signerKeyPair.secretKey);
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.withdraw, 32)
                .storeUint(opts.queryID, 64)
                .storeBuffer(signature)
                .storeRef(
                    beginCell()
                        .storeUint(opts.queryID, 23)
                        .storeUint(opts.projectId, 64)
                        .storeUint(opts.createdAt, 64)
                        .storeCoins(opts.jettonAmount)
                        .storeAddress(opts.tokenWalletAddress)
                        .storeAddress(opts.recipient)
                        .endCell(),
                )
                .endCell(),
        });
    }

    static depositPayload(opts: {
        signerKeyPair: KeyPair;
        createdAt: number;
        tokenWalletAddress: Address;
        queryId: bigint;
        projectId: bigint;
        depositAmount: bigint;
    }) {
        const toSign = beginCell()
            .storeUint(opts.queryId, 23)
            .storeUint(opts.projectId, 64)
            .storeUint(opts.createdAt, 64)
            .storeAddress(opts.tokenWalletAddress)
            .storeCoins(opts.depositAmount)
            .endCell();
        const signature = sign(toSign.hash(), opts.signerKeyPair.secretKey);
        return beginCell()
            .storeUint(Opcodes.deposit, 32)
            .storeBuffer(signature)
            .storeRef(
                beginCell()
                    .storeUint(opts.queryId, 23)
                    .storeUint(opts.projectId, 64)
                    .storeUint(opts.createdAt, 64)
                    .storeAddress(opts.tokenWalletAddress)
                    .endCell(),
            )
            .endCell();
    }

    async getVaultData(provider: ContractProvider) {
        const result = await provider.get('get_vault_data', []);
        return {
            isLocked: result.stack.readBoolean(), // is_locked
            admin: result.stack.readAddress(), // admin
            signer: Buffer.from(
                result.stack
                    .readBigNumber()
                    .toString(16)
                    .padStart(32 * 2, '0'),
                'hex',
            ), // signer
            lastCleanTime: result.stack.readBigNumber(), // last_clean_time
            timeout: result.stack.readBigNumber(), // timeout
        };
    }
}
