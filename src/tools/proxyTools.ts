import { z } from "zod";
import { transactionProxyService } from "../services/TransactionProxyService.js";

// 用于获取待签名交易状态的工具
export const getTransactionStatusTool = {
    name: "get-transaction-status",
    description: "获取待签名交易的状态",
    inputSchema: z.object({
        transactionId: z.string().describe("交易ID")
    }),
    handler: async (args: { transactionId: string }) => {
        const status = transactionProxyService.getTransactionStatus(args.transactionId);
        return {
            content: [{
                type: "text",
                text: JSON.stringify(status, null, 2)
            }]
        };
    }
};

// 用于提交签名后交易的工具
export const submitSignedTransactionTool = {
    name: "submit-signed-transaction",
    description: "提交已签名的交易",
    inputSchema: z.object({
        transactionId: z.string().describe("待签名交易的ID"),
        signedTransaction: z.record(z.any()).describe("签名后的交易数据")
    }),
    handler: async (args: { transactionId: string, signedTransaction: any }) => {
        const result = await transactionProxyService.submitSignedTransaction(
            args.transactionId,
            args.signedTransaction
        );

        return {
            content: [{
                type: "text",
                text: result.success
                    ? `交易提交成功! 交易哈希: ${result.hash}`
                    : `交易提交失败: ${result.error}`
            }]
        };
    }
};

// 导出代理工具
export const proxyTools = [
    getTransactionStatusTool,
    submitSignedTransactionTool
];
