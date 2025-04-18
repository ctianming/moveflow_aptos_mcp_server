import { aptos } from "@moveflow/aptos-sdk";

/**
 * Interface for transaction signing services
 */
export interface TransactionSigningService {
    /**
     * Sign and submit a transaction
     * @param transaction The transaction to sign
     * @param execute Whether to execute (submit) the transaction
     * @param signer Optional account to use for signing
     * @returns The transaction response
     */
    signAndSubmitTransaction(
        transaction: aptos.SimpleTransaction,
        execute: boolean,
        signer?: aptos.Account
    ): Promise<any>;
    
    /**
     * Submit a client-signed transaction
     * @param transactionId The ID of the transaction
     * @param signedData The signed transaction data
     * @returns The transaction response
     */
    submitSignedTransaction(
        transactionId: string,
        signedData: {
            signature: string;
            public_key: string;
            sender: string;
            transaction_hash?: string;
        }
    ): Promise<any>;

    /**
     * Get information about a pending transaction
     * @param transactionId The ID of the transaction
     * @returns Information about the pending transaction
     */
    getPendingTransaction(transactionId: string): {
        found: boolean;
        transaction?: aptos.SimpleTransaction;
        age?: number;
    };
}
