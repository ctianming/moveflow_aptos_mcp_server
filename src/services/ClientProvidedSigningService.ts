import { aptos } from "@moveflow/aptos-sdk";
import { TransactionSigningService } from "./TransactionSigningService.js";

/**
 * 客户端签名服务实现
 * 
 * 该服务支持以下工作流程：
 * 1. 服务器准备交易并生成交易ID
 * 2. 客户端使用私钥签名交易
 * 3. 服务器验证签名并提交交易
 */
export class ClientProvidedSigningService implements TransactionSigningService {
    private aptosClient: aptos.Aptos;
    private readOnlyMode: boolean;

    // 存储待签名交易
    private pendingTransactions = new Map<string, {
        transaction: aptos.SimpleTransaction,
        timestamp: number
    }>();

    /**
     * 创建客户端签名服务实例
     * 
     * @param aptosClient Aptos客户端实例
     * @param readOnlyMode 是否为只读模式
     */
    constructor(aptosClient: aptos.Aptos, readOnlyMode: boolean = false) {
        this.aptosClient = aptosClient;
        this.readOnlyMode = readOnlyMode;

        // 启动定期清理过期交易的任务
        this.startCleanupTask();
    }

    /**
     * 签名并提交交易，或者准备交易等待客户端签名
     * 
     * @param transaction 待处理的交易
     * @param execute 是否执行交易
     * @param signer 可选的签名账户
     * @returns 交易结果或待签名的交易信息
     */
    async signAndSubmitTransaction(
        transaction: aptos.SimpleTransaction,
        execute: boolean,
        signer?: aptos.Account
    ): Promise<any> {
        // 处理交易格式
        const txnToProcess = this.normalizeTransaction(transaction);

        // 如果不执行，则存储交易以供客户端稍后签名
        if (!execute) {
            const transactionId = this.generateTransactionId();
            this.pendingTransactions.set(transactionId, {
                transaction: txnToProcess,
                timestamp: Date.now()
            });

            // 返回交易ID和原始交易
            return {
                transactionId,
                rawTxn: txnToProcess,
                clientSigningRequired: true
            };
        }

        // 在只读模式下不允许执行交易
        if (this.readOnlyMode) {
            throw new Error("服务器处于只读模式，无法执行交易");
        }

        // 需要提供签名者
        if (!signer) {
            throw new Error("执行交易需要提供签名账户");
        }

        try {
            // 使用Aptos SDK的标准方法签名并提交交易
            const pendingTxn = await this.aptosClient.signAndSubmitTransaction({
                signer,
                transaction: txnToProcess
            });

            // 等待交易执行完成
            const result = await this.aptosClient.waitForTransaction({
                transactionHash: pendingTxn.hash
            });

            return this.standardizeTransactionResponse(result);
        } catch (error) {
            console.error("提交交易失败:", error);
            throw error;
        }
    }

    /**
     * 提交客户端已签名的交易
     * 
     * @param transactionId 交易ID
     * @param signedData 签名数据
     * @returns 交易结果
     */
    async submitSignedTransaction(
        transactionId: string,
        signedData: {
            signature: string,
            public_key: string,
            sender: string,
            transaction_hash?: string
        }
    ): Promise<any> {
        // 查找待处理的交易
        const pendingTx = this.pendingTransactions.get(transactionId);
        if (!pendingTx) {
            throw new Error(`未找到ID为 ${transactionId} 的交易或交易已过期`);
        }

        // 验证签名数据
        if (!signedData.signature || !signedData.public_key || !signedData.sender) {
            throw new Error("签名数据无效：缺少签名、公钥或发送者地址");
        }

        console.log(`提交已签名交易，ID: ${transactionId}`);

        try {
            // 获取原始交易
            const transaction = pendingTx.transaction;

            // 解析签名和公钥
            const publicKeyBytes = Buffer.from(signedData.public_key.replace(/^0x/, ''), 'hex');
            const signatureBytes = Buffer.from(signedData.signature.replace(/^0x/, ''), 'hex');

            // 创建公钥和签名对象
            const publicKey = new aptos.Ed25519PublicKey(publicKeyBytes);
            const signature = new aptos.Ed25519Signature(signatureBytes);

            // 使用AccountAuthenticator替代创建临时账户
            // 创建账户验证器
            const accountAuthenticator = new aptos.AccountAuthenticatorEd25519(
                publicKey,
                signature
            );

            // 如果SDK支持，使用transaction.submit方法
            if (this.aptosClient.transaction?.submit) {
                const response = await this.aptosClient.transaction.submit.simple({
                    transaction,
                    senderAuthenticator: accountAuthenticator
                });

                // 等待交易执行完成
                const result = await this.aptosClient.waitForTransaction({
                    transactionHash: response.hash
                });

                // 清理已处理的交易
                this.pendingTransactions.delete(transactionId);

                return this.standardizeTransactionResponse(result);
            }

            // 如果上面的方法不支持，尝试创建临时账户的替代方案
            // 使用Aptos SDK的fromPrivateKey方法创建账户而不是直接实例化
            const senderAddress = aptos.AccountAddress.fromString(signedData.sender);

            // 基于提供的签名，构建一个可以模拟签名的特殊对象
            const mockPrivateKey = {
                toString: () => "0x" + "0".repeat(64),  // 模拟的私钥
                signBuffer: async () => signatureBytes,  // 返回预先提供的签名
                publicKey: () => publicKey               // 返回提供的公钥
            };

            // 使用工厂方法创建账户
            const tempAccount = aptos.Account.fromPrivateKey({
                privateKey: mockPrivateKey as any,
                address: senderAddress
            });

            // 使用标准方法提交交易
            const pendingTxn = await this.aptosClient.signAndSubmitTransaction({
                signer: tempAccount,
                transaction: transaction
            });

            // 等待交易执行完成
            const result = await this.aptosClient.waitForTransaction({
                transactionHash: pendingTxn.hash
            });

            // 清理已处理的交易
            this.pendingTransactions.delete(transactionId);

            return this.standardizeTransactionResponse(result);
        } catch (error) {
            console.error(`提交已签名交易 ${transactionId} 失败:`, error);
            throw error;
        }
    }

    /**
     * 获取待处理交易的信息
     * 
     * @param transactionId 交易ID
     * @returns 交易信息
     */
    getPendingTransaction(transactionId: string): {
        found: boolean;
        transaction?: aptos.SimpleTransaction;
        age?: number;
    } {
        const pendingTx = this.pendingTransactions.get(transactionId);
        if (!pendingTx) {
            return { found: false };
        }

        return {
            found: true,
            transaction: pendingTx.transaction,
            age: Date.now() - pendingTx.timestamp
        };
    }

    /**
     * 规范化不同格式的交易
     */
    private normalizeTransaction(transaction: any): aptos.SimpleTransaction {
        // 如果有encode方法，假定它是SimpleTransaction
        if (transaction && typeof transaction === 'object' &&
            typeof transaction.encode === 'function') {
            return transaction;
        }

        // 处理MoveFlow SDK格式的交易
        if (transaction && transaction.payload) {
            return transaction.payload;
        }

        // 否则按原样返回
        return transaction;
    }

    /**
     * 标准化交易响应格式
     */
    private standardizeTransactionResponse(response: any): any {
        if (!response) return response;

        // 处理带有哈希的响应（标准交易响应）
        if (response.hash) {
            return {
                hash: response.hash,
                version: response.version,
                success: response.success,
                vm_status: response.vm_status || "executed",
                gas_used: response.gas_used || "0",
            };
        }

        return response;
    }

    /**
     * 生成唯一的交易ID
     */
    private generateTransactionId(): string {
        const randomPart = Math.random().toString(36).substring(2, 15);
        return `tx_${Date.now()}_${randomPart}`;
    }

    /**
     * 启动定期清理过期交易的任务
     */
    private startCleanupTask(): void {
        const CLEANUP_INTERVAL = 60000; // 1分钟
        const MAX_TX_AGE = 600000; // 10分钟

        setInterval(() => {
            const now = Date.now();
            let expiredCount = 0;

            for (const [txId, txData] of this.pendingTransactions.entries()) {
                if (now - txData.timestamp > MAX_TX_AGE) {
                    this.pendingTransactions.delete(txId);
                    expiredCount++;
                }
            }

            if (expiredCount > 0) {
                console.log(`已清理 ${expiredCount} 个过期交易`);
            }
        }, CLEANUP_INTERVAL);
    }
}
