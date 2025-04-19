import { aptos } from "@moveflow/aptos-sdk";
import { TransactionSigningService } from "./TransactionSigningService.js";

/**
 * Implementation of TransactionSigningService that uses the Aptos client
 * for transaction signing and submission
 */
export class ClientProvidedSigningService implements TransactionSigningService {
    private aptosClient: aptos.Aptos;
    private readOnlyMode: boolean;

    // Store pending transactions for client-side signing
    private pendingTransactions = new Map<string, {
        transaction: aptos.SimpleTransaction,
        timestamp: number
    }>();

    constructor(aptosClient: aptos.Aptos, readOnlyMode: boolean = false) {
        this.aptosClient = aptosClient;
        this.readOnlyMode = readOnlyMode;

        // Start cleanup task to remove expired transactions
        this.startCleanupTask();
    }

    /**
     * Sign and optionally submit a transaction using the Aptos client
     * @param transaction The transaction to sign
     * @param execute Whether to execute (submit) the transaction
     * @returns The transaction response
     */
    async signAndSubmitTransaction(transaction: aptos.SimpleTransaction, execute: boolean, signer?: aptos.Account): Promise<any> {
        if (!execute) {
            // In this case, we store the transaction for potential future signing by the client
            const transactionId = this.generateTransactionId();
            this.pendingTransactions.set(transactionId, {
                transaction,
                timestamp: Date.now()
            });

            // Return the transaction with its ID for client reference
            return {
                transactionId,
                rawTxn: transaction,
                clientSigningRequired: true
            };
        }

        if (this.readOnlyMode) {
            throw new Error("Cannot execute transaction in read-only mode.");
        }

        if (!signer) {
            throw new Error("No signer account provided for transaction execution.");
        }

        // Notify the client to sign the transaction
        try {
            const pendingTxn = await this.aptosClient.signAndSubmitTransaction({
                signer: signer,
                transaction: transaction
            });
            return pendingTxn;
        } catch (error) {
            console.error("Error submitting transaction:", error);
            throw error;
        }
    }

    /**
     * Submit a client-signed transaction
     * @param transactionId The ID of the transaction
     * @param signedData The signed data containing signature, public key, and optional transaction hash
     * @returns The transaction response
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
        // Check if the transaction exists in our pending map
        const pendingTx = this.pendingTransactions.get(transactionId);
        if (!pendingTx) {
            throw new Error(`Transaction with ID ${transactionId} not found or expired`);
        }

        try {
            // Get the transaction
            const transaction = pendingTx.transaction;

            // Debug information
            console.log("Transaction type:", typeof transaction);

            // Create a temp account with just the address for submission
            const tempAccount = {
                accountAddress: signedData.sender,
                publicKey: () => ({ toUint8Array: () => Buffer.from(signedData.public_key.replace(/^0x/, ''), 'hex') }),
                sign: () => Buffer.from(signedData.signature.replace(/^0x/, ''), 'hex'),
            };

            // Use the main Aptos signAndSubmitTransaction method
            const response = await this.aptosClient.signAndSubmitTransaction({
                signer: tempAccount as any,
                transaction: transaction,
            });

            // Remove the transaction from pending transactions
            this.pendingTransactions.delete(transactionId);

            return response;
        } catch (error) {
            console.error(`Error submitting signed transaction ${transactionId}:`, error);
            console.error("Error details:", error instanceof Error ? error.message : String(error));

            // Last attempt - try creating an authenticator object directly for the API
            try {
                console.log("Trying final submission method...");

                // Based on the SDK signature from transaction.d.mts, we need to construct a proper authenticator
                // Import the AccountAuthenticator class if available
                const { AccountAuthenticator } = require('@aptos-labs/ts-sdk');

                // Create authenticator from the signature data
                const senderAuthenticator = new AccountAuthenticator(
                    'ed25519_signature',
                    Buffer.from(signedData.public_key.replace(/^0x/, ''), 'hex'),
                    Buffer.from(signedData.signature.replace(/^0x/, ''), 'hex')
                );

                // Use the correctly structured submit method with senderAuthenticator
                const response = await this.aptosClient.transaction.submit.simple({
                    transaction: pendingTx.transaction,
                    senderAuthenticator: senderAuthenticator
                });

                this.pendingTransactions.delete(transactionId);
                return response;
            } catch (finalError) {
                console.error("Final submission attempt failed:", finalError);

                // For debugging only - show available methods
                console.log("Available Aptos client methods:",
                    Object.getOwnPropertyNames(this.aptosClient));

                console.log("Available transaction methods:",
                    Object.getOwnPropertyNames(this.aptosClient.transaction));

                console.log("Available submit methods:",
                    this.aptosClient.transaction.submit ?
                        Object.getOwnPropertyNames(this.aptosClient.transaction.submit) :
                        "No submit methods available");

                // Throw the original error
                throw error;
            }
        }
    }

    /**
     * Get details about a pending transaction
     * @param transactionId The ID of the transaction
     * @returns Information about the pending transaction
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
     * Generate a unique transaction ID
     * @returns A unique transaction ID
     */
    private generateTransactionId(): string {
        const randomPart = Math.random().toString(36).substring(2, 10);
        return `tx_${Date.now()}_${randomPart}`;
    }

    /**
     * Start a periodic cleanup task to remove expired transactions
     * Transactions older than 10 minutes will be removed
     */
    private startCleanupTask(): void {
        const CLEANUP_INTERVAL = 60000; // 1 minute
        const MAX_TX_AGE = 600000; // 10 minutes

        setInterval(() => {
            const now = Date.now();
            let expiredCount = 0;

            // Check each transaction
            for (const [txId, txData] of this.pendingTransactions.entries()) {
                if (now - txData.timestamp > MAX_TX_AGE) {
                    this.pendingTransactions.delete(txId);
                    expiredCount++;
                }
            }

            if (expiredCount > 0) {
                console.log(`Cleaned up ${expiredCount} expired transaction(s)`);
            }
        }, CLEANUP_INTERVAL);
    }
}
