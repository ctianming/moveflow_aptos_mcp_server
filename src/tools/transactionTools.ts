import { z } from "zod";
import { getSigningService } from "../aptos.js";

// 定义已签名交易提交工具
// Define interfaces for the types
interface SignedTransactionData {
    signature: string;
    public_key: string;
    sender: string;
    transaction_hash?: string;
}

interface SubmitSignedTransactionInput {
    transactionId: string;
    signedTransaction: SignedTransactionData;
}

interface TransactionResult {
    hash?: string;
    [key: string]: any;
}

interface ToolResponse {
    content: Array<{
        type: string;
        text: string;
    }>;
    isError?: boolean;
}

export const submitSignedTransactionTool = {
    name: "submit-signed-transaction",
    description: "提交客户端已签名的交易",
    inputSchema: z.object({
        transactionId: z.string().describe("交易ID"),
        signedTransaction: z.object({
            signature: z.string().describe("十六进制格式的交易签名"),
            public_key: z.string().describe("签名者的公钥"),
            sender: z.string().describe("发送者地址"),
            transaction_hash: z.string().optional().describe("可选的交易哈希")
        }).describe("客户端签名后的交易数据")
    }),
    handler: async (args: SubmitSignedTransactionInput): Promise<ToolResponse> => {
        try {
            // 获取签名服务
            const signingService = getSigningService();

            // 增加调试日志
            console.log(`尝试提交交易ID: ${args.transactionId}`);
            console.log(`签名数据:`, args.signedTransaction);

            // 验证输入数据
            if (!args.signedTransaction.signature || !args.signedTransaction.public_key || !args.signedTransaction.sender) {
                throw new Error("签名数据缺失或格式不正确");
            }

            // 提交已签名的交易
            const result: TransactionResult = await signingService.submitSignedTransaction(
                args.transactionId,
                args.signedTransaction
            );

            // 返回结果
            return {
                content: [{
                    type: "text",
                    text: `交易已成功提交。哈希: ${result.hash || "未知"}`
                }]
            };
        } catch (error: any) {
            console.error("提交签名交易详细错误:", error);
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

// 定义查询待签名交易状态的工具
// Define interfaces for check pending transaction
interface CheckPendingTransactionInput {
    transactionId: string;
}

interface TransactionStatus {
    found: boolean;
    age?: number;
    transaction?: any;
    [key: string]: any;
}

export const checkPendingTransactionTool = {
    name: "check-pending-transaction",
    description: "检查需要客户端签名的待处理交易",
    inputSchema: z.object({
        transactionId: z.string().describe("待检查的交易ID")
    }),
    handler: async (args: CheckPendingTransactionInput): Promise<ToolResponse> => {
        try {
            // 获取签名服务
            const signingService = getSigningService();

            // 检查待处理交易状态
            const status: TransactionStatus = signingService.getPendingTransaction(args.transactionId);

            if (!status.found) {
                return {
                    content: [{
                        type: "text",
                        text: `未找到ID为 ${args.transactionId} 的交易或交易已过期`
                    }],
                    isError: true
                };
            }

            return {
                content: [{
                    type: "text",
                    text: `交易 ${args.transactionId} 等待签名中。已等待: ${Math.round((status.age || 0) / 1000)} 秒`
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `检查交易状态出错: ${error.message || "未知错误"}`
                }],
                isError: true
            };
        }
    }
};

// 单独导出每个工具，这样可以分别导入
export const submitSignedTransaction = submitSignedTransactionTool;
export const checkPendingTransaction = checkPendingTransactionTool;

// 导出所有交易相关工具的数组
export const transactionTools = [
    submitSignedTransactionTool,
    checkPendingTransactionTool
];
