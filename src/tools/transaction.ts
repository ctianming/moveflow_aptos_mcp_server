import { z } from "zod";
import { getSigningService } from "../aptos.js";
import { canExecuteTransaction } from "../utils.js";

// 添加提交已签名交易的工具定义
// Define interfaces for better type safety
interface SignedTransaction {
    signature: string;
    public_key: string;
    sender: string;  // 添加缺失的sender属性
    transaction_hash?: string;
}

interface SubmitSignedTransactionInput {
    transactionId: string;
    signedTransaction: SignedTransaction;
}

interface HandlerResponse {
    content: Array<{
        type: string;
        text: string;
    }>;
    isError?: boolean;
}

export const submitSignedTransactionTool = {
    name: "submit-signed-transaction",
    description: "提交由客户端签名的交易",
    inputSchema: z.object({
        transactionId: z.string().describe("交易ID"),
        signedTransaction: z.object({
            signature: z.string().describe("十六进制格式的交易签名"),
            public_key: z.string().describe("签名者的公钥"),
            sender: z.string().describe("发送者地址"),  // 添加缺失的sender字段
            transaction_hash: z.string().optional().describe("交易哈希"),
        }).describe("签名数据")
    }),
    handler: async (args: SubmitSignedTransactionInput): Promise<HandlerResponse> => {
        try {
            // 调用签名服务的submitSignedTransaction方法
            const signingService = getSigningService();

            // 此处提交客户端签名后的交易
            const result = await signingService.submitSignedTransaction(
                args.transactionId,
                args.signedTransaction
            );

            return {
                content: [{
                    type: "text",
                    text: `交易已提交，哈希: ${result.hash || "未知"}`
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `提交签名交易失败: ${error.message || "未知错误"}`
                }],
                isError: true
            };
        }
    }
};

// 导出工具
export const transactionTools = [
    submitSignedTransactionTool
];
