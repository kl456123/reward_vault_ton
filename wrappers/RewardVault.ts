import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { JettonMinter, JettonWallet } from '../wrappers';

export type RewardVaultConfig = {
    admin: Address;
    signer: Buffer;
    jettonCode: Cell;
};

export function rewardVaultConfigToCell(config: RewardVaultConfig): Cell {
    return beginCell().storeAddress(config.admin).storeBuffer(config.signer).storeRef(config.jettonCode).endCell();
}

export const Opcodes = {
    deposit: 0x95db9d39,
    claim: 0xa769de27,
    withdraw: 0xb5de5f9e,

    config_signer: 0x9c0e0150,
    transfer_ownership: 0xb516d5ff,
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
        opts: { value: bigint; admin: Address; queryID?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.withdraw, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeAddress(opts.admin)
                .endCell(),
        });
    }

    static depositPayload(opts: { signature: Buffer; validUntil: number; jettonAddress: Address }) {
        return beginCell()
            .storeUint(Opcodes.deposit, 32)
            .storeBuffer(opts.signature)
            .storeAddress(opts.jettonAddress)
            .storeUint(opts.validUntil, 32)
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
        return [result.stack.readAddress(), result.stack.readBigNumber(), result.stack.readCell()];
    }
}
