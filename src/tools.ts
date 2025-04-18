import { z } from "zod";
import { getStreamInstance, getSigningService, getSignerAccount } from "./aptos.js";
import { aptos } from "@moveflow/aptos-sdk";
import {
    CreateStreamParams,
    StreamOperateParams,
    BatchCreateParams,
    BatchWithdrawParams,
    OperateUser,
    StreamType,
    OperateType
} from "@moveflow/aptos-sdk";
import { canExecuteTransaction } from "./utils.js";
import { transactionTools } from "./tools/transactionTools.js";

// Helper function to format blockchain transaction responses in MCP format
function formatTransactionResponse(response: any): any {
    if (!response) return {
        content: [{ type: "text", text: "No response received" }],
        isError: true
    };

    // If this is just a transaction object (not executed), return a message
    if (response.clientSigningRequired) {
        return {
            content: [{
                type: "text",
                text: `Transaction created but not executed. Use the submit-signed-transaction tool with ID: ${response.transactionId}`
            }]
        };
    }

    // Return the transaction hash and relevant info for submitted transactions
    return {
        content: [{
            type: "text",
            text: JSON.stringify({
                hash: response.hash,
                success: response.success,
                vm_status: response.vm_status || "executed",
                gas_used: response.gas_used || "0",
                timestamp: response.timestamp || new Date().toISOString(),
            }, null, 2)
        }]
    };
}

// Helper function to convert error to MCP format
function formatErrorResponse(error: any): any {
    console.error("Error in tool handler:", error);
    return {
        content: [{
            type: "text",
            text: error.message || "Unknown error occurred"
        }],
        isError: true
    };
}

// Helper function to handle transaction submission based on execute flag
async function handleTransactionSubmission(transaction: any, execute: boolean): Promise<any> {
    // 获取签名服务和可能的签名账户
    const signingService = getSigningService();
    const signerAccount = getSignerAccount();

    // 如果设置了执行标志
    if (execute) {
        // 如果有直接签名账户可用，使用SDK内置的签名方法
        if (signerAccount) {
            const stream = getStreamInstance();
            const aptosClient = stream.getAptosClient();

            // 使用Aptos SDK的内置签名方法
            const pendingTxn = await aptosClient.signAndSubmitTransaction({
                signer: signerAccount,
                transaction: transaction
            });

            // 等待交易执行完成
            const result = await aptosClient.waitForTransaction({
                transactionHash: pendingTxn.hash
            });

            return {
                hash: result.hash,
                version: result.version || "0",
                success: result.success !== false, // 默认为true
                vm_status: result.vm_status || "executed",
                gas_used: result.gas_used || "0",
            };
        }
        // 否则使用客户端签名服务
        else if (signingService) {
            // 检查是否是ClientProvidedSigningService类型
            const isClientSigning = signingService.constructor.name === 'ClientProvidedSigningService';

            // 如果是客户端签名并且没有签名账户，返回特殊格式以便前端处理
            if (isClientSigning) {
                return await signingService.signAndSubmitTransaction(
                    transaction,
                    false, // 因为是客户端签名，这里设置为false，只准备交易不执行
                    undefined // 客户端会提供签名
                );
            } else {
                return await signingService.signAndSubmitTransaction(
                    transaction,
                    true, // 执行交易
                    undefined // 客户端会提供签名
                );
            }
        } else {
            throw new Error("无法执行交易：既没有配置签名账户，也没有可用的签名服务");
        }
    } else {
        // 如果不执行，只准备交易
        if (signingService) {
            return await signingService.signAndSubmitTransaction(
                transaction,
                false, // 不执行，只准备
                undefined
            );
        } else {
            // 如果没有签名服务，直接返回交易对象
            return transaction;
        }
    }
}

// Helper function to safely convert values to numbers
function safeToNumber(value: any): number {
    if (value === null || value === undefined) {
        return 0; // Return 0 for null/undefined
    }

    if (typeof value === 'string') {
        // Try to parse the string as a number
        const parsed = Number(value);
        if (isNaN(parsed)) {
            throw new Error(`Invalid number format: ${value}`);
        }
        return parsed;
    } else if (typeof value === 'number') {
        // Already a number, just check if it's valid
        if (isNaN(value)) {
            throw new Error('Invalid number: NaN');
        }
        return value;
    } else {
        throw new Error(`Value cannot be converted to a number: ${value}`);
    }
}

// Helper function to safely convert values to BigInt
function safeToBigInt(value: any): bigint {
    if (value === null || value === undefined) {
        return BigInt(0); // Return 0 for null/undefined
    }

    if (typeof value === 'string') {
        const cleanValue = value.trim();
        if (!cleanValue) {
            return BigInt(0); // Return 0 for empty strings
        }

        try {
            // If the string has a decimal point, take only the integer part
            if (cleanValue.includes('.')) {
                const integerPart = cleanValue.split('.')[0];
                return BigInt(integerPart || '0');
            }
            return BigInt(cleanValue);
        } catch (error) {
            console.warn(`Error converting string to BigInt: ${value}. Using 0 instead.`);
            return BigInt(0);
        }
    }

    if (typeof value === 'number') {
        if (isNaN(value) || !Number.isFinite(value)) {
            console.warn(`Invalid number for BigInt conversion: ${value}. Using 0 instead.`);
            return BigInt(0);
        }

        // Ensure we deal with whole numbers only (BigInt does not support floats)
        return BigInt(Math.floor(value));
    }

    if (typeof value === 'bigint') {
        return value;
    }

    // For all other types, attempt coercion (e.g., boolean), else default to 0
    try {
        return BigInt(value);
    } catch (error) {
        console.warn(`Value of type ${typeof value} cannot be converted to BigInt: ${value}. Using 0 instead.`);
        return BigInt(0);
    }
}

// Define schemas first, then use them in tool definitions
// Zod is used to define parameter schemas for validation and type inference
const createStreamInputSchema = z.object({
    name: z.string().describe("Name of the stream"),
    coinType: z.string().describe("Type of coin to transfer, e.g., '0x1::aptos_coin::AptosCoin'"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin (fungible asset)"),
    assetType: z.string().optional().describe("Asset type for FA coins"),
    streamType: z.enum(["TypeStream", "TypePayment"]).describe("Type of stream: TypeStream or TypePayment"),
    recipient: z.string().describe("Recipient address as a string"),
    depositAmount: z.string().describe("Amount to deposit (as a string)"),
    cliffAmount: z.string().default("0").describe("Cliff amount (as a string)"),
    cliffTime: z.union([z.number(), z.string()]).default(0).describe("Cliff time in seconds since epoch"),
    startTime: z.union([z.number(), z.string()]).describe("Start time in seconds since epoch"),
    stopTime: z.union([z.number(), z.string()]).describe("Stop time in seconds since epoch"),
    interval: z.union([z.number(), z.string()]).describe("Interval in seconds"),
    autoWithdraw: z.boolean().default(false).describe("Whether to auto withdraw"),
    autoWithdrawInterval: z.union([z.number(), z.string()]).optional().describe("Auto withdraw interval in seconds"),
    pauseable: z.enum(["Sender", "Recipient", "Both"]).describe("Who can pause: Sender, Recipient, or Both"),
    closeable: z.enum(["Sender", "Recipient", "Both"]).describe("Who can close: Sender, Recipient, or Both"),
    recipientModifiable: z.enum(["Sender", "Recipient", "Both"]).describe("Who can modify recipient: Sender, Recipient, or Both"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
    remark: z.string().default("").describe("Remark for the stream"),
});

const withdrawStreamInputSchema = z.object({
    streamId: z.string().describe("ID of the stream to withdraw from"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin stream"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
});

const closeStreamInputSchema = z.object({
    streamId: z.string().describe("ID of the stream to close"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin stream"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
});

const extendStreamInputSchema = z.object({
    streamId: z.string().describe("ID of the stream to extend"),
    extendTime: z.union([z.number(), z.string()]).describe("New stop time in seconds since epoch"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin stream"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
});

const pauseStreamInputSchema = z.object({
    streamId: z.string().describe("ID of the stream to pause"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin stream"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
});

const resumeStreamInputSchema = z.object({
    streamId: z.string().describe("ID of the stream to resume"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin stream"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
});

const getStreamInfoInputSchema = z.object({
    streamId: z.string().describe("ID of the stream to get information for"),
});

const batchCreateStreamInputSchema = z.object({
    names: z.array(z.string()).describe("Names of the streams"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether this is a FA coin stream"),
    assetType: z.string().optional().describe("Asset type for FA coins"),
    streamType: z.enum(["TypeStream", "TypePayment"]).describe("Type of stream: TypeStream or TypePayment"),
    recipients: z.array(z.string()).describe("Recipient addresses as strings"),
    depositAmounts: z.array(z.string()).describe("Amounts to deposit (as strings)"),
    cliffAmounts: z.array(z.string()).optional().describe("Cliff amounts (as strings)"),
    cliffTime: z.union([z.number(), z.string()]).default(0).describe("Cliff time in seconds since epoch"),
    startTime: z.union([z.number(), z.string()]).describe("Start time in seconds since epoch"),
    stopTime: z.union([z.number(), z.string()]).describe("Stop time in seconds since epoch"),
    interval: z.union([z.number(), z.string()]).describe("Interval in seconds"),
    autoWithdraw: z.boolean().default(false).describe("Whether to auto withdraw"),
    autoWithdrawInterval: z.union([z.number(), z.string()]).optional().describe("Auto withdraw interval in seconds"),
    pauseable: z.enum(["Sender", "Recipient", "Both"]).describe("Who can pause: Sender, Recipient, or Both"),
    closeable: z.enum(["Sender", "Recipient", "Both"]).describe("Who can close: Sender, Recipient, or Both"),
    recipientModifiable: z.enum(["Sender", "Recipient", "Both"]).describe("Who can modify recipient: Sender, Recipient, or Both"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
    remark: z.string().default("").describe("Remark for the streams"),
});

const batchWithdrawStreamInputSchema = z.object({
    streamIds: z.array(z.string()).describe("IDs of the streams to withdraw from"),
    coinType: z.string().optional().describe("Type of coin for non-FA streams"),
    isFa: z.boolean().default(false).describe("Whether these are FA coin streams"),
    assetType: z.string().optional().describe("Asset type for FA coins"),
    execute: z.boolean().default(false).describe("Whether to execute the transaction or just create it"),
});

// Tool to create a new stream
const createStreamTool = {
    name: "create-stream",
    description: "Create a new MoveFlow stream to transfer cryptocurrency over time",
    inputSchema: createStreamInputSchema,
    handler: async (args: z.infer<typeof createStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Map enum strings to actual enum values
            const streamTypeMap: Record<string, StreamType> = {
                "TypeStream": StreamType.TypeStream,
                "TypePayment": StreamType.TypePayment
            };

            const operateUserMap: Record<string, OperateUser> = {
                "Sender": OperateUser.Sender,
                "Recipient": OperateUser.Recipient,
                "Both": OperateUser.Both
            };

            // Create stream params using SDK best practices
            const params = new CreateStreamParams({
                // execute标志设置为false，因为我们将使用handleTransactionSubmission来控制执行
                execute: false,
                coin_type: args.isFa ? undefined : args.coinType,
                asset_type: args.isFa ? args.assetType : undefined,
                _remark: args.remark,
                name: args.name,
                is_fa: args.isFa,
                stream_type: streamTypeMap[args.streamType],
                recipient: aptos.AccountAddress.fromString(args.recipient),
                deposit_amount: safeToBigInt(args.depositAmount),
                cliff_amount: safeToBigInt(args.cliffAmount),
                cliff_time: safeToNumber(args.cliffTime), // 确保时间参数为数字类型
                start_time: safeToNumber(args.startTime), // 确保时间参数为数字类型
                stop_time: safeToNumber(args.stopTime),   // 确保时间参数为数字类型
                interval: safeToNumber(args.interval),    // 确保时间参数为数字类型
                auto_withdraw: Boolean(args.autoWithdraw), // 确保是布尔值类型
                auto_withdraw_interval: args.autoWithdrawInterval ? safeToNumber(args.autoWithdrawInterval) : 0,
                pauseable: operateUserMap[args.pauseable],
                closeable: operateUserMap[args.closeable],
                recipient_modifiable: operateUserMap[args.recipientModifiable],
            });

            // 创建流参数并获取交易对象
            const transaction = await stream.createStream(params);

            // 使用我们的辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to withdraw from a stream
const withdrawStreamTool = {
    name: "withdraw-stream",
    description: "Withdraw funds from a MoveFlow stream",
    inputSchema: withdrawStreamInputSchema,
    handler: async (args: z.infer<typeof withdrawStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Create withdraw params
            const params = new StreamOperateParams({
                stream_id: args.streamId,
                coin_type: args.isFa ? undefined : args.coinType,
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
                is_fa: args.isFa,
            });

            // Set the operate type to withdraw
            params.setOperateType(OperateType.Claim);

            // 获取交易对象
            const transaction = await stream.withdrawStream(params);

            // 使用我们的辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to close a stream
const closeStreamTool = {
    name: "close-stream",
    description: "Close a MoveFlow stream",
    inputSchema: closeStreamInputSchema,
    handler: async (args: z.infer<typeof closeStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Create close params
            const params = new StreamOperateParams({
                stream_id: args.streamId,
                coin_type: args.isFa ? undefined : args.coinType,
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
                is_fa: args.isFa,
            });

            // 获取交易对象
            const transaction = await stream.closeStream(params);

            // 使用我们的辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to extend a stream
const extendStreamTool = {
    name: "extend-stream",
    description: "Extend the duration of a MoveFlow stream",
    inputSchema: extendStreamInputSchema,
    handler: async (args: z.infer<typeof extendStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Create extend params
            const params = new StreamOperateParams({
                stream_id: args.streamId,
                coin_type: args.isFa ? undefined : args.coinType,
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
                is_fa: args.isFa,
                extend_time: safeToNumber(args.extendTime),
            });

            // Set the operate type to extend
            params.setOperateType(OperateType.Extend);

            // 获取交易对象
            const transaction = await stream.extendStream(params);

            // 使用辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to pause a stream
const pauseStreamTool = {
    name: "pause-stream",
    description: "Pause a MoveFlow stream",
    inputSchema: pauseStreamInputSchema,
    handler: async (args: z.infer<typeof pauseStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Create pause params
            const params = new StreamOperateParams({
                stream_id: args.streamId,
                coin_type: args.isFa ? undefined : args.coinType,
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
                is_fa: args.isFa,
            });

            // 获取交易对象
            const transaction = await stream.pauseStream(params);

            // 使用辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to resume a stream
const resumeStreamTool = {
    name: "resume-stream",
    description: "Resume a paused MoveFlow stream",
    inputSchema: resumeStreamInputSchema,
    handler: async (args: z.infer<typeof resumeStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Create resume params
            const params = new StreamOperateParams({
                stream_id: args.streamId,
                coin_type: args.isFa ? undefined : args.coinType,
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
                is_fa: args.isFa,
            });

            // 获取交易对象
            const transaction = await stream.resumeStream(params);

            // 使用辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to get stream information
const getStreamInfoTool = {
    name: "get-stream-info",
    description: "Get information about a specific MoveFlow stream",
    inputSchema: getStreamInfoInputSchema,
    handler: async (args: z.infer<typeof getStreamInfoInputSchema>) => {
        try {
            // Get stream instance
            const stream = getStreamInstance();

            // Fetch the stream info
            const streamInfo = await stream.fetchStream(args.streamId);

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(streamInfo, null, 2)
                }]
            };
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to batch create streams
const batchCreateStreamTool = {
    name: "batch-create-streams",
    description: "Create multiple MoveFlow streams at once",
    inputSchema: batchCreateStreamInputSchema,
    handler: async (args: z.infer<typeof batchCreateStreamInputSchema>) => {
        try {
            // Validate arrays have the same length
            const recipientCount = args.recipients.length;
            if (args.names.length !== recipientCount || args.depositAmounts.length !== recipientCount) {
                return formatErrorResponse({
                    message: "Names, recipients, and depositAmounts arrays must have the same length"
                });
            }

            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Map enum strings to actual enum values
            const streamTypeMap: Record<string, StreamType> = {
                "TypeStream": StreamType.TypeStream,
                "TypePayment": StreamType.TypePayment
            };

            const operateUserMap: Record<string, OperateUser> = {
                "Sender": OperateUser.Sender,
                "Recipient": OperateUser.Recipient,
                "Both": OperateUser.Both
            };

            // Handle cliff amounts properly
            const cliffAmounts = args.cliffAmounts || args.depositAmounts.map(() => "0");

            // Create batch params using SDK best practices
            const params = new BatchCreateParams({
                names: args.names,
                coin_type: args.isFa ? undefined : args.coinType,
                asset_type: args.isFa ? args.assetType : undefined,
                _remark: args.remark,
                is_fa: args.isFa,
                stream_type: streamTypeMap[args.streamType],
                recipients: args.recipients.map(recipient => aptos.AccountAddress.fromString(recipient)), // 转换字符串地址为AccountAddress对象
                deposit_amounts: args.depositAmounts.map(amount => safeToBigInt(amount)),
                cliff_amounts: cliffAmounts.map(amount => safeToBigInt(amount)),
                cliff_time: safeToNumber(args.cliffTime),
                start_time: safeToNumber(args.startTime),
                stop_time: safeToNumber(args.stopTime),
                interval: safeToNumber(args.interval),
                auto_withdraw: Boolean(args.autoWithdraw), // 确保是布尔值类型
                auto_withdraw_interval: args.autoWithdrawInterval ? safeToNumber(args.autoWithdrawInterval) : 0,
                pauseable: operateUserMap[args.pauseable],
                closeable: operateUserMap[args.closeable],
                recipient_modifiable: operateUserMap[args.recipientModifiable],
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
            });

            // 调用SDK批量创建流的方法获取交易对象
            // 注意：SDK中的方法名是batchCreateSteam（注意拼写），不是batchCreateStream
            const transaction = await stream.batchCreateSteam(params);

            // 使用辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Tool to batch withdraw from streams
const batchWithdrawStreamTool = {
    name: "batch-withdraw-streams",
    description: "Withdraw from multiple MoveFlow streams at once",
    inputSchema: batchWithdrawStreamInputSchema,
    handler: async (args: z.infer<typeof batchWithdrawStreamInputSchema>) => {
        try {
            // Check if we can execute transactions using the utility function
            const executionCheck = canExecuteTransaction(args.execute);
            if (!executionCheck.canExecute) {
                return formatErrorResponse({
                    message: executionCheck.errorMessage || "Cannot execute transactions."
                });
            }

            // Get stream instance
            const stream = getStreamInstance();

            // Create batch withdraw params
            const params = new BatchWithdrawParams({
                stream_ids: args.streamIds,
                coin_type: args.isFa ? undefined : args.coinType,
                asset_type: args.isFa ? args.assetType : undefined,
                execute: false, // 设置为false，让我们通过handleTransactionSubmission控制执行
                is_fa: args.isFa,
            });

            // 获取交易对象
            const transaction = await stream.batchWithdrawStream(params);

            // 使用辅助函数处理交易提交
            const response = await handleTransactionSubmission(transaction, args.execute);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// 从transactionTools中解构出需要的工具
const {
    submitSignedTransactionTool,
    checkPendingTransactionTool
} = transactionTools.reduce((acc: any, tool: any) => {
    acc[tool.name.replace(/-/g, '') + 'Tool'] = tool;
    return acc;
}, {});

// Combine all tools into an array
const allTools = [
    createStreamTool,
    withdrawStreamTool,
    closeStreamTool,
    extendStreamTool,
    pauseStreamTool,
    resumeStreamTool,
    getStreamInfoTool,
    batchCreateStreamTool,
    batchWithdrawStreamTool,
    ...transactionTools // 只包含一次，避免重复
];

// Export tools
export {
    createStreamTool,
    withdrawStreamTool,
    closeStreamTool,
    extendStreamTool,
    pauseStreamTool,
    resumeStreamTool,
    getStreamInfoTool,
    batchCreateStreamTool,
    batchWithdrawStreamTool,
    submitSignedTransactionTool,
    checkPendingTransactionTool,
    // Export tool array
    allTools as tools
};

// Default export all tools
export default allTools;
