import { Cell, toNano, beginCell } from '@ton/core';

export const generateMockData = () => {
    return {
        depositAmount: toNano('0.05'),
        queryId: 0n,
        projectId: 0n,
        createdAt: Math.floor(Date.now() / 1000) - 60,
        tonAmount: toNano('0.1'),
        forward_ton_amount: toNano('0.05'),
    };
};
