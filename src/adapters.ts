import { z } from "zod";
import { getSigningService } from "./aptos.js";
import { getTransactionExecutorConfig } from "./config.js";
import { canExecuteTransaction } from "./utils.js";
import { transactionProxyService } from "./services/TransactionProxyService.js";

// Tool interface definition
interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any, any>;
  handler: (params: any) => Promise<any>;
  execute?: boolean;
}

// The expected RequestHandlerExtra type by MCP
interface RequestHandlerExtra {
  // Add any properties that might be in RequestHandlerExtra
}

// Adapted tool interface matching MCP expectations
interface AdaptedTool {
  name: string;
  schema: {
    description: string;
    parameters: Record<string, any>;
  };
  handler: (args: any, extra: RequestHandlerExtra) => Promise<{
    content: Array<{
      type: "text";
      text: string;
    }>;
    isError?: boolean;
  }>;
}

export function adaptToolForServer(tool: Tool): AdaptedTool {
  const { name, description, inputSchema, handler, execute } = tool;

  if (!inputSchema) {
    throw new Error(`Tool ${name} is missing inputSchema`);
  }

  const config = getTransactionExecutorConfig();
  const parameters = inputSchema.shape;

  return {
    name,
    schema: {
      description,
      parameters
    },
    // Fix handler signature to match what MCP expects for tools with parameters
    handler: async (args, extra): Promise<{
      content: Array<{ type: "text", text: string }>;
      isError?: boolean;
    }> => {
      try {
        // Check execution permission using our utility
        const executionCheck = canExecuteTransaction(execute !== false);
        if (!executionCheck.canExecute) {
          return {
            content: [{
              type: "text",
              text: executionCheck.errorMessage || "Cannot execute transaction in current mode."
            }],
            isError: true
          };
        }

        // Call the original handler with the args
        const result = await handler(args);

        // If it is a transaction object, handle the signing process based on configuration
        if (result && typeof result === 'object' &&
          (result.submit || result.rawTransaction || result.payload)) {

          // Get the transaction executor configuration
          const txConfig = getTransactionExecutorConfig();

          // Direct signing mode: use the server's private key to sign and submit
          if (txConfig.signingMode === 'direct' && !txConfig.readOnlyMode) {
            try {
              // Get the signing service which has access to the signer account
              const signingService = getSigningService();
              const signer = await import('./aptos.js').then(m => m.getSignerAccount());

              if (!signer) {
                return {
                  content: [{
                    type: "text",
                    text: `直接签名模式失败: 未配置有效的私钥，无法执行交易`
                  }],
                  isError: true
                };
              }

              // Sign and submit the transaction
              const signedResult = await signingService.signAndSubmitTransaction(
                result,
                true,  // execute immediately
                signer
              );

              return {
                content: [{
                  type: "text",
                  text: `交易已成功签名并提交，哈希: ${signedResult.hash || "未知"}`
                }]
              };
            } catch (error: any) {
              return {
                content: [{
                  type: "text",
                  text: `使用服务器私钥签名交易失败: ${error.message || "未知错误"}`
                }],
                isError: true
              };
            }
          }
          // Client-side signing mode: prepare transaction for client to sign
          else {
            try {
              // Submit the transaction to the proxy service for client-side signing
              const proxyResult = await transactionProxyService.submitTransaction(result);

              // Return information on how to sign and submit the transaction
              return {
                content: [{
                  type: "text",
                  text: `请使用以下信息签名此交易:\n\n` +
                    `交易ID: ${proxyResult.transactionId}\n` +
                    `交易有效载荷: ${JSON.stringify(proxyResult.payload)}\n\n` +
                    `交易将在 ${new Date(proxyResult.expiresAt).toLocaleString()} 过期。\n\n` +
                    `签名后，使用 submit-signed-transaction 工具提交签名后的交易。`
                }]
              };
            } catch (error: any) {
              return {
                content: [{
                  type: "text",
                  text: `准备客户端签名交易失败: ${error.message || "未知错误"}`
                }],
                isError: true
              };
            }
          }
        }

        // Format the result
        if (result && typeof result === 'object') {
          // Handle transaction object
          if (result.submit || result.hash || result.payload) {
            return {
              content: [{
                type: "text",
                text: result.hash
                  ? `Transaction submitted with hash: ${result.hash}`
                  : "Transaction prepared but not executed. Client-side signing is required."
              }]
            };
          }

          // If it has a content array in expected format
          if (Array.isArray(result.content)) {
            return {
              content: result.content.map((item: { type?: string; text?: string;[key: string]: any }) => ({
                type: "text",
                text: item.text || JSON.stringify(item)
              })),
              isError: result.isError
            };
          }
        }

        // Default formatting
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result?.data || result, null, 2)
          }]
        };
      } catch (error: any) {
        console.error(`Error in tool ${name}:`, error);
        return {
          content: [{
            type: "text",
            text: error.message || "Unknown error occurred"
          }],
          isError: true
        };
      }
    }
  };
}
