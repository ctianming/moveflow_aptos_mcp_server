import { getTransactionExecutorConfig } from "./config.js";

/**
 * 检查是否可以执行交易
 * @param executeFlag 用户请求的执行标志
 * @returns 包含检查结果的对象
 */
export function canExecuteTransaction(executeFlag: boolean): {
    canExecute: boolean;
    errorMessage?: string;
} {
    // 获取配置
    const config = getTransactionExecutorConfig();

    if (executeFlag && config.readOnlyMode) {
        return {
            canExecute: false,
            errorMessage: "Cannot execute transactions. Server is in read-only mode."
        };
    }

    return { canExecute: true };
}
