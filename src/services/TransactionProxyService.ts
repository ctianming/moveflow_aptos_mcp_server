import { SimpleTransaction } from "@aptos-labs/ts-sdk";

/**
 * 交易代理服务 - 负责与客户端通信以处理签名请求
 * 这是一个中间层，接收交易请求，准备交易，然后等待客户端签名
 */
export class TransactionProxyService {
    // 存储待签名交易的队列
    private pendingTransactions: Map<string, {
        transaction: SimpleTransaction,
        resolver: Function,
        timestamp: number
    }> = new Map();

    // 生成唯一的交易ID
    private generateTransactionId(): string {
        return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }

    /**
     * 提交交易到代理服务，返回待签名的交易对象和ID
     * @param transaction 未签名的交易对象
     * @returns 包含交易ID的对象，客户端需要使用此ID提交签名后的交易
     */
    async submitTransaction(transaction: SimpleTransaction): Promise<{
        transactionId: string,
        payload: any,
        expiresAt: number
    }> {
        const transactionId = this.generateTransactionId();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5分钟过期

        // 创建一个Promise，将在客户端提交签名后resolve
        const transactionPromise = new Promise((resolve) => {
            this.pendingTransactions.set(transactionId, {
                transaction,
                resolver: resolve,
                timestamp: Date.now()
            });
        });

        // 启动过期清理计时器
        setTimeout(() => {
            if (this.pendingTransactions.has(transactionId)) {
                const pendingTx = this.pendingTransactions.get(transactionId);
                if (pendingTx) {
                    pendingTx.resolver({ success: false, error: "Transaction signing timed out" });
                    this.pendingTransactions.delete(transactionId);
                }
            }
        }, 5 * 60 * 1000);

        // 获取需要发送给客户端的交易有效负载
        const payload = transaction.rawTransaction;

        // 返回交易ID和负载，客户端需使用此信息签名
        return {
            transactionId,
            payload,
            expiresAt
        };
    }

    /**
     * 客户端调用此方法提交签名后的交易
     * @param transactionId 交易ID
     * @param signedTransaction 签名后的交易数据
     */
    async submitSignedTransaction(
        transactionId: string,
        signedTransaction: any
    ): Promise<{ success: boolean, hash?: string, error?: string }> {
        if (!this.pendingTransactions.has(transactionId)) {
            return { success: false, error: "Transaction not found or expired" };
        }

        const pendingTx = this.pendingTransactions.get(transactionId);
        if (!pendingTx) {
            return { success: false, error: "Transaction data not available" };
        }

        // 删除挂起的交易
        this.pendingTransactions.delete(transactionId);

        // 解析签名后的交易结果
        pendingTx.resolver({
            success: true,
            hash: signedTransaction.hash,
            data: signedTransaction
        });

        return { success: true, hash: signedTransaction.hash };
    }

    /**
     * 获取交易状态
     * @param transactionId 交易ID
     */
    getTransactionStatus(transactionId: string): {
        exists: boolean,
        pendingSignature: boolean,
        createdAt?: number
    } {
        const pendingTx = this.pendingTransactions.get(transactionId);
        if (!pendingTx) {
            return { exists: false, pendingSignature: false };
        }

        return {
            exists: true,
            pendingSignature: true,
            createdAt: pendingTx.timestamp
        };
    }

    /**
     * 定期清理过期的交易
     */
    startCleanupTask() {
        setInterval(() => {
            const now = Date.now();
            for (const [txId, tx] of this.pendingTransactions.entries()) {
                // 清理超过5分钟的交易
                if (now - tx.timestamp > 5 * 60 * 1000) {
                    tx.resolver({ success: false, error: "Transaction signing timed out" });
                    this.pendingTransactions.delete(txId);
                }
            }
        }, 60000); // 每分钟检查一次
    }
}

// 创建单例实例
export const transactionProxyService = new TransactionProxyService();
transactionProxyService.startCleanupTask();
