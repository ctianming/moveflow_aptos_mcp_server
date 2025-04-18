import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from process.env
// Note: We don't use .env file directly as configuration comes from the client's mcp_servers.json
try {
    // Only log environment variables in debug mode to avoid exposing sensitive information
    console.error("Using configuration from environment variables");
} catch (error) {
    console.error("Error with environment configuration:", error);
}

// Network configuration
interface AptosConfig {
    aptosNetwork: 'mainnet' | 'testnet' | 'devnet' | 'local';
    aptosNodeUrl: string;
    aptosFaucetUrl?: string;
}

// Transaction executor configuration - 基于客户端签名的安全架构
interface TransactionExecutorConfig {
    // 服务器是否处于"可执行"模式 - 这里"可执行"指的是服务器可以准备交易
    // 但实际签名会在客户端完成
    readOnlyMode: boolean;
    // 签名模式：'direct' = 服务器直接签名，'client' = 客户端签名
    signingMode: 'direct' | 'client';
    // 可选：服务器私钥用于直接签名模式（只在非只读模式下有效）
    privateKey?: string;
}

// Get the Aptos network configuration
export function getConfig(): AptosConfig {
    // Read from environment variables
    const aptosNetwork = process.env.APTOS_NETWORK || 'mainnet';
    const aptosNodeUrl = process.env.APTOS_NODE_URL || 'https://fullnode.mainnet.aptoslabs.com/v1';
    const aptosFaucetUrl = process.env.APTOS_FAUCET_URL;

    // Validate network
    if (!['mainnet', 'testnet', 'devnet', 'local'].includes(aptosNetwork)) {
        throw new Error(`Invalid APTOS_NETWORK: ${aptosNetwork}. Must be one of: mainnet, testnet, devnet, local`);
    }

    // Return the configuration
    return {
        aptosNetwork: aptosNetwork as 'mainnet' | 'testnet' | 'devnet' | 'local',
        aptosNodeUrl,
        aptosFaucetUrl
    };
}

// 获取交易执行配置
export function getTransactionExecutorConfig(): TransactionExecutorConfig {
    // 读取环境变量中的只读模式配置
    // 如果设置为 "true"，则服务器将运行在只读模式
    // 否则将允许准备交易
    const readOnlyMode = process.env.READ_ONLY_MODE === "true";

    // 读取签名模式配置
    // 'direct': 服务器使用提供的私钥直接签名
    // 'client': 客户端负责签名（默认）
    const configuredSigningMode = process.env.SIGNING_MODE?.toLowerCase();
    const signingMode = configuredSigningMode === 'direct' ? 'direct' : 'client';

    // 读取可选的服务器私钥，用于直接签名模式
    // 警告：这应该只在开发环境或安全的部署中使用
    const privateKey = process.env.APTOS_PRIVATE_KEY;

    if (privateKey && readOnlyMode) {
        console.warn("警告：私钥已配置但服务器处于只读模式，私钥将被忽略");
    }

    if (privateKey && !readOnlyMode) {
        if (signingMode === 'direct') {
            console.log("服务器将使用配置的私钥进行直接签名模式");
        } else {
            console.warn("警告：私钥已配置但签名模式为'client'，私钥将被忽略。如需服务器直接签名，请将SIGNING_MODE设置为'direct'");
        }
    }

    if (signingMode === 'direct' && !privateKey && !readOnlyMode) {
        console.warn("警告：签名模式设置为'direct'但未提供私钥，将回退到客户端签名模式");
        return {
            readOnlyMode,
            signingMode: 'client',
            privateKey
        };
    }

    return {
        readOnlyMode,
        signingMode: readOnlyMode ? 'client' : signingMode,
        privateKey
    };
}
