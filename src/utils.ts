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

/**
 * 深度序列化一个对象，确保将所有BigInt值转换为字符串
 * 这样可以避免在JSON序列化时的"Do not know how to serialize a BigInt"错误
 * 
 * @param {any} obj - 要序列化的对象
 * @returns {any} - 序列化后的对象，所有BigInt都被转换为字符串
 */
export function serialize(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }

    // 如果是BigInt，转换为字符串
    if (typeof obj === 'bigint') {
        return obj.toString();
    }

    // 如果是数组，递归处理数组中的每个元素
    if (Array.isArray(obj)) {
        return obj.map(item => serialize(item));
    }

    // 如果是对象，递归处理对象的每个属性
    if (typeof obj === 'object') {
        const result: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = serialize(obj[key]);
            }
        }
        return result;
    }

    // 其他基本类型直接返回
    return obj;
}

/**
 * 反序列化一个对象，将可能是BigInt字符串的值转回BigInt
 * 
 * @param {any} obj - 要反序列化的对象
 * @returns {any} - 反序列化后的对象
 */
export function deserialize(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }

    // 如果是字符串且符合BigInt格式，尝试转换回BigInt
    if (typeof obj === 'string' && /^-?\d+$/.test(obj)) {
        try {
            return BigInt(obj);
        } catch {
            return obj; // 如果转换失败，保持原样
        }
    }

    // 如果是数组，递归处理数组中的每个元素
    if (Array.isArray(obj)) {
        return obj.map(item => deserialize(item));
    }

    // 如果是对象，递归处理对象的每个属性
    if (typeof obj === 'object') {
        const result: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = deserialize(obj[key]);
            }
        }
        return result;
    }

    // 其他基本类型直接返回
    return obj;
}
