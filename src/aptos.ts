import { aptos } from "@moveflow/aptos-sdk";
import { Stream } from "@moveflow/aptos-sdk";
import { getConfig, getTransactionExecutorConfig } from "./config.js";
import { TransactionSigningService } from "./services/TransactionSigningService.js";
import { ClientProvidedSigningService } from "./services/ClientProvidedSigningService.js";

let aptosClient: InstanceType<typeof aptos.Aptos> | null = null;
let streamInstance: Stream | null = null;
let signingService: TransactionSigningService | null = null;
// 用于存储可能的签名账户
let signerAccount: aptos.Account | null = null;

/**
 * Initialize the Aptos client and Stream instance
 */
export async function initAptos(): Promise<void> {
    const config = getConfig();

    try {
        // 创建Aptos配置
        const aptosConfig = new aptos.AptosConfig({
            network: config.aptosNetwork as aptos.Network,
            fullnode: config.aptosNodeUrl
        });

        // 初始化Aptos客户端
        aptosClient = new aptos.Aptos(aptosConfig);

        const txConfig = getTransactionExecutorConfig();

        // 如果配置了私钥，创建一个签名账户
        if (txConfig.privateKey) {
            try {
                let rawKey = txConfig.privateKey.trim();

                // Remove known prefix and 0x if present
                if (rawKey.startsWith('ed25519-priv-')) {
                    rawKey = rawKey.replace('ed25519-priv-', '');
                }

                if (rawKey.startsWith('0x')) {
                    rawKey = rawKey.slice(2);
                }

                if (rawKey.length !== 64) {
                    throw new Error(`Private key must be 32 bytes (64 hex characters), got ${rawKey.length} characters`);
                }

                const privateKeyBytes = Uint8Array.from(Buffer.from(rawKey, 'hex'));
                const privateKeyObj = new aptos.Ed25519PrivateKey(privateKeyBytes);

                signerAccount = aptos.Account.fromPrivateKey({
                    privateKey: privateKeyObj
                });

                console.log("✅ Created signer account from private key");
            } catch (error) {
                console.error("❌ Failed to create signer account:", error);
            }
        }

        // 初始化客户端签名服务（用于客户端签名模式）
        signingService = new ClientProvidedSigningService(aptosClient, txConfig.readOnlyMode);

        // 根据配置选择适当的模式
        if (txConfig.readOnlyMode) {
            // 只读模式 - 使用默认地址初始化Stream
            const defaultAddress = aptos.AccountAddress.fromString("0x1");
            streamInstance = new Stream(
                defaultAddress,
                config.aptosNetwork as aptos.Network,
                config.aptosNodeUrl
            );
            console.log("Initialized Stream in read-only mode");
        } else if (txConfig.signingMode === 'direct' && signerAccount) {
            // 直接签名模式 - 使用签名账户初始化Stream
            streamInstance = new Stream(
                signerAccount,
                config.aptosNetwork as aptos.Network,
                config.aptosNodeUrl
            );
            console.log("Initialized Stream with direct signing capability");
        } else {
            // 客户端签名模式 - 使用默认地址初始化Stream
            const defaultAddress = aptos.AccountAddress.fromString("0x1");
            streamInstance = new Stream(
                defaultAddress,
                config.aptosNetwork as aptos.Network,
                config.aptosNodeUrl
            );
            console.log(`Initialized Stream in client-side signing mode`);
        }
    } catch (error) {
        console.error("Failed to initialize Aptos client:", error);
        throw new Error(`Aptos initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get the initialized Aptos client
 */
export function getAptosClient(): InstanceType<typeof aptos.Aptos> {
    if (!aptosClient) {
        throw new Error("Aptos client not initialized. Call initAptos first.");
    }
    return aptosClient;
}

/**
 * Get the initialized Stream instance
 */
export function getStreamInstance(): Stream {
    if (!streamInstance) {
        throw new Error("Stream instance not initialized. Call initAptos first.");
    }
    return streamInstance;
}

/**
 * Get the transaction signing service
 */
export function getSigningService(): TransactionSigningService {
    if (!signingService) {
        throw new Error("Signing service not initialized. Call initAptos first.");
    }
    return signingService;
}

/**
 * Get the signer account if available
 */
export function getSignerAccount(): aptos.Account | null {
    return signerAccount;
}