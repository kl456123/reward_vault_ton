import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
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
        .storeRef(config.jettonCode)
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

    async sendWithdraw(
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
            jettonAddress: Address;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.withdraw, 32)
                .storeUint(opts.queryID, 64)
                .storeBuffer(opts.signature)
                .storeRef(
                    beginCell()
                        .storeUint(opts.queryID, 23)
                        .storeUint(opts.projectId, 64)
                        .storeUint(opts.createdAt, 64)
                        .storeCoins(opts.jettonAmount)
                        .storeAddress(opts.jettonAddress)
                        .storeAddress(opts.recipient)
                        .endCell(),
                )
                .endCell(),
        });
    }

    static depositPayload(opts: {
        signature: Buffer;
        createdAt: number;
        jettonAddress: Address;
        queryId: bigint;
        projectId: bigint;
    }) {
        return beginCell()
            .storeUint(Opcodes.deposit, 32)
            .storeBuffer(opts.signature)
            .storeRef(
                beginCell()
                    .storeUint(opts.queryId, 23)
                    .storeUint(opts.projectId, 64)
                    .storeUint(opts.createdAt, 64)
                    .storeAddress(opts.jettonAddress)
                    .endCell(),
            )
            .endCell();
    }

    // async sendDeposit(
    // provider: ContractProvider,
    // via: Sender,
    // opts: {
    // jettonAmount: number;
    // to: Address;
    // value: bigint;
    // queryID?: number;
    // }
    // ) {

    // beginCell().storeUint(Opcodes.jetton_transfer, 32)
    // JettonWallet.transferMessage(opts.jettonAmount, opts.to);
    // await provider.internal(via, {
    // value: opts.value,
    // sendMode: SendMode.PAY_GAS_SEPARATELY,
    // body: beginCell()
    // .storeUint(Opcodes.jetton_transfer, 32)
    // .storeUint(opts.queryID ?? 0, 64)
    // .storeUint(opts.increaseBy, 32)
    // .endCell(),
    // });
    // }

    async getVaultData(provider: ContractProvider) {
        const result = await provider.get('get_vault_data', []);
        return {
            isLocked: result.stack.readBoolean(), // is_locked
            admin: result.stack.readAddress(), // admin
            signer: result.stack.readBigNumber(), // signer
            lastCleanTime: result.stack.readBigNumber(), // last_clean_time
            timeout: result.stack.readBigNumber(), // timeout
        };
    }
}
