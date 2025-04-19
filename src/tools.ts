import { z } from "zod";
import { AccountAddress, AccountAddress as NewAccountAddress } from "@aptos-labs/ts-sdk";
import { getStreamInstance } from "./aptos.js";
import {
    CreateStreamParams,
    StreamOperateParams,
    BatchCreateParams,
    BatchWithdrawParams,
    OperateUser,
    StreamType,
    OperateType
} from "@moveflow/aptos-sdk";
import { aptos } from "@moveflow/aptos-sdk";
import { getConfig, getTransactionExecutorConfig } from "./config.js";
import { helper } from "@moveflow/aptos-sdk";
import { canExecuteTransaction } from "./utils.js";
import { serialize, deserialize } from "./utils.js";

// 增强版交易响应格式化函数
function formatTransactionResponse(response: any, params?: any): any {
    // 首先确保任何BigInt值都被转为字符串
    response = safeSerialize(response);

    const baseResponse = {
        success: !!response,
        timestamp: new Date().toISOString(),
        metadata: {
            network: getConfig().aptosNetwork,
            gasEstimate: response?.gasUsed || 0,
            transactionType: 'stream_create'
        }
    };

    if (!response) {
        return {
            ...baseResponse,
            content: [{
                type: "text",
                text: "❌ 交易创建失败：未收到有效响应",
                annotations: ["critical"]
            }],
            isError: true
        };
    }

    // 未执行的交易预览
    if (response.data && !response.hash) {
        const formattedPreview = formatPreviewTransaction(response, params, baseResponse);
        return formattedPreview;
    }

    // 已提交的交易详情
    if (response.hash) {
        // 添加交易状态检查的标志
        let statusText = "已提交";
        let statusIcon = "✅";

        // 如果有success字段（waitForTransaction的结果），检查交易是否真正成功
        if (response.success === false) {
            baseResponse.success = false;
            statusText = "已提交但执行失败";
            statusIcon = "❌";
        }

        // 如果有vm_status字段，并且不是"Executed successfully"
        if (response.vm_status && response.vm_status !== "Executed successfully") {
            baseResponse.success = false;
            statusText = `已提交但执行失败: ${response.vm_status}`;
            statusIcon = "❌";
        }

        const explorerLink = `https://${getConfig().aptosNetwork === 'mainnet' ? '' : getConfig().aptosNetwork + '.'}explorer.aptoslabs.com/txn/${response.hash}`;

        return {
            ...baseResponse,
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "submitted",
                    message: `${statusIcon} 交易${statusText}`,
                    transactionHash: response.hash,
                    explorerLink: explorerLink,
                    vmStatus: response.vm_status,
                    gasUsed: response.gas_used || baseResponse.metadata.gasEstimate
                }, null, 2)
            }]
        };
    }

    // 默认的响应
    return {
        ...baseResponse,
        content: [{
            type: "text",
            text: JSON.stringify(response, null, 2)
        }]
    };
}

// 格式化交易预览
function formatPreviewTransaction(response: any, params?: any, baseResponse?: any): any {
    if (!baseResponse) {
        baseResponse = {
            success: true,
            timestamp: new Date().toISOString(),
            metadata: {
                network: getConfig().aptosNetwork,
                gasEstimate: response?.gasUsed || 0,
                transactionType: 'stream_create'
            }
        };
    }

    // 计算流时长（天）
    let duration = "未知";
    if (params?.stop_time && params?.start_time) {
        const durationSeconds = Number(params.stop_time) - Number(params.start_time);
        const days = Math.floor(durationSeconds / 86400);
        const hours = Math.floor((durationSeconds % 86400) / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);

        if (days > 0) {
            duration = `${days}天`;
            if (hours > 0) duration += ` ${hours}小时`;
        } else if (hours > 0) {
            duration = `${hours}小时`;
            if (minutes > 0) duration += ` ${minutes}分钟`;
        } else {
            duration = `${minutes}分钟`;
        }
    }

    // 格式化金额
    let amount = "未知";
    if (params?.deposit_amount) {
        // 将数值转换为APT单位（除以100000000）
        try {
            const amountInApt = Number(params.deposit_amount) / 100000000;
            amount = `${amountInApt.toLocaleString()} APT`;
        } catch {
            amount = `${params.deposit_amount} octa`;
        }
    }

    // 格式化开始和结束时间
    let startTime = "未设置";
    let endTime = "未设置";
    if (params?.start_time) {
        startTime = new Date(Number(params.start_time) * 1000).toLocaleString();
    }
    if (params?.stop_time) {
        endTime = new Date(Number(params.stop_time) * 1000).toLocaleString();
    }

    return {
        ...baseResponse,
        content: [{
            type: "text",
            text: JSON.stringify({
                status: "pending",
                message: "✅ 交易已创建但未执行 (设置 execute: true 提交到链上)",
                preview: {
                    streamName: params?.name || "未命名",
                    recipient: params?.recipient ? params?.recipient.toString() : "未设置",
                    totalAmount: amount,
                    duration: duration,
                    startTime: startTime,
                    endTime: endTime,
                    autoWithdraw: params?.auto_withdraw ? '启用' : '禁用',
                    gasEstimate: `${baseResponse.metadata.gasEstimate} gas单位`
                }
            }, null, 2)
        }]
    };
}

// 安全序列化函数，处理BigInt和其他特殊值
function safeSerialize(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }

    // 如果是BigInt，转换为字符串
    if (typeof obj === 'bigint') {
        return obj.toString();
    }

    // 如果是数组，递归处理数组中的每个元素
    if (Array.isArray(obj)) {
        return obj.map(item => safeSerialize(item));
    }

    // 如果是对象，递归处理对象的每个属性
    if (typeof obj === 'object') {
        const result: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = safeSerialize(obj[key]);
            }
        }
        return result;
    }

    // 其他基本类型直接返回
    return obj;
}

// Helper function to convert error to MCP format
function formatErrorResponse(error: any): any {
    return {
        content: [{
            type: "text",
            text: error.message || "Unknown error occurred"
        }],
        isError: true
    };
}

// Helper function to handle the AccountAddress version mismatch
function convertRecipientAddress(address: string): aptos.AccountAddress {
    try {
        // 直接使用AccountAddress进行转换
        return aptos.AccountAddress.fromString(address);
    } catch (error: any) {
        console.error("Failed to convert address:", error);
        throw new Error(`Failed to convert address ${address}: ${error.message}`);
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
    recipient: z.string().describe("Recipient address as a string (will be converted to AccountAddress internally)"),
    depositAmount: z.string().transform(v => BigInt(v)).describe("Amount to deposit (as a string)"),
    cliffAmount: z.string().default("0").transform(v => BigInt(v)).describe("Cliff amount (as a string)"),
    cliffTime: z.union([z.string(), z.number()]).default(0).transform(v => typeof v === 'string' ? BigInt(v) : BigInt(v)).describe("Cliff time in seconds since epoch"),
    startTime: z.union([z.string(), z.number()]).transform(v => typeof v === 'string' ? BigInt(v) : BigInt(v)).describe("Start time in seconds since epoch"),
    stopTime: z.union([z.string(), z.number()]).transform(v => typeof v === 'string' ? BigInt(v) : BigInt(v)).describe("Stop time in seconds since epoch"),
    interval: z.union([z.string(), z.number()]).transform(v => typeof v === 'string' ? BigInt(v) : BigInt(v)).describe("Interval in seconds"),
    autoWithdraw: z.boolean().default(false).describe("Whether to auto withdraw"),
    autoWithdrawInterval: z.union([z.string(), z.number()]).default(0).transform(v => typeof v === 'string' ? BigInt(v) : BigInt(v)).describe("Auto withdraw interval in seconds"),
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
    extendTime: z.number().describe("New stop time in seconds since epoch"),
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
    recipients: z.array(z.string()).describe("Recipient addresses as strings (will be converted to AccountAddress internally)"),
    depositAmounts: z.array(z.number()).describe("Amounts to deposit"),
    cliffAmounts: z.array(z.number()).optional().describe("Cliff amounts"),
    cliffTime: z.number().default(0).describe("Cliff time in seconds since epoch"),
    startTime: z.number().describe("Start time in seconds since epoch"),
    stopTime: z.number().describe("Stop time in seconds since epoch"),
    interval: z.number().describe("Interval in seconds"),
    autoWithdraw: z.boolean().default(false).describe("Whether to auto withdraw"),
    autoWithdrawInterval: z.number().optional().describe("Auto withdraw interval in seconds"),
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

            // Use string address directly
            const recipientAddress = convertRecipientAddress(args.recipient);
            // Create stream params
            const params = new CreateStreamParams({
                execute: args.execute,
                coin_type: args.isFa ? undefined : args.coinType,
                asset_type: args.isFa ? args.assetType : undefined,
                _remark: args.remark,
                name: args.name,
                is_fa: args.isFa,
                stream_type: streamTypeMap[args.streamType],
                recipient: recipientAddress,
                deposit_amount: args.depositAmount ? Number(args.depositAmount.toString()) : 0,
                cliff_amount: args.cliffAmount ? Number(args.cliffAmount.toString()) : 0,
                start_time: args.startTime ? Number(args.startTime.toString()) : 0,
                stop_time: args.stopTime ? Number(args.stopTime.toString()) : 0,
                interval: args.interval ? Number(args.interval.toString()) : 0,
                cliff_time: args.cliffTime ? Number(args.cliffTime.toString()) : 0,
                auto_withdraw: args.autoWithdraw,
                auto_withdraw_interval: args.autoWithdrawInterval ? Number(args.autoWithdrawInterval.toString()) : 0,
                pauseable: operateUserMap[args.pauseable],
                closeable: operateUserMap[args.closeable],
                recipient_modifiable: operateUserMap[args.recipientModifiable],
            });

            // Create the stream
            const response = await stream.createStream(params);

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
                execute: args.execute,
                is_fa: args.isFa,
            });

            // Set the operate type to withdraw
            params.setOperateType(OperateType.Claim);

            // Withdraw from the stream
            const response = await stream.withdrawStream(params);

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
                execute: args.execute,
                is_fa: args.isFa,
            });

            // Close the stream
            const response = await stream.closeStream(params);

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
                execute: args.execute,
                is_fa: args.isFa,
                extend_time: args.extendTime,
            });

            // Set the operate type to extend
            params.setOperateType(OperateType.Extend);

            // Extend the stream
            const response = await stream.extendStream(params);

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
                execute: args.execute,
                is_fa: args.isFa,
            });

            // Pause the stream
            const response = await stream.pauseStream(params);

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
                execute: args.execute,
                is_fa: args.isFa,
            });

            // Resume the stream
            const response = await stream.resumeStream(params);

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

            // Simplified address handling - use string array directly
            // Use string addresses directly
            const recipientAddresses = args.recipients.map(address => convertRecipientAddress(address));
            // Convert cliffAmounts to BigInt[], ensuring it's compatible with AnyNumber[]
            const cliffAmounts = (args.cliffAmounts || args.depositAmounts.map(() => "0"))
                .map(amount => typeof amount === "string" ? BigInt(amount) : BigInt(amount));

            // Create batch params
            const params = new BatchCreateParams({
                names: args.names,
                coin_type: args.isFa ? undefined : args.coinType,
                asset_type: args.isFa ? args.assetType : undefined,
                _remark: args.remark,
                is_fa: args.isFa,
                stream_type: streamTypeMap[args.streamType],
                recipients: recipientAddresses,
                deposit_amounts: args.depositAmounts.map(amount => Number(amount)),
                cliff_amounts: cliffAmounts.map(amount => Number(amount)),
                cliff_time: args.cliffTime ? Number(args.cliffTime) : 0,
                start_time: args.startTime ? Number(args.startTime) : 0,
                stop_time: args.stopTime ? Number(args.stopTime) : 0,
                interval: args.interval ? Number(args.interval) : 0,
                auto_withdraw: args.autoWithdraw || false,
                auto_withdraw_interval: args.autoWithdrawInterval ? Number(args.autoWithdrawInterval) : (args.interval ? Number(args.interval) : 0),
                pauseable: operateUserMap[args.pauseable],
                closeable: operateUserMap[args.closeable],
                recipient_modifiable: operateUserMap[args.recipientModifiable],
                execute: args.execute,
            });

            // Create the batch of streams
            const response = await stream.batchCreateSteam(params);

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
                execute: args.execute,
                is_fa: args.isFa,
            });

            // Batch withdraw from the streams
            const response = await stream.batchWithdrawStream(params);

            return formatTransactionResponse(response);
        } catch (error: any) {
            return formatErrorResponse(error);
        }
    }
};

// Import transaction tools - use correct import syntax
import { submitSignedTransactionTool, checkPendingTransactionTool } from "./tools/transactionTools.js";

// 将所有工具放入一个数组
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
    submitSignedTransactionTool,
    checkPendingTransactionTool
];

// 统一导出工具
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
    // 导出工具数组
    allTools as tools
};

// 默认导出工具数组
export default allTools;
