import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initAptos, getStreamInstance } from "./aptos.js"; // 添加getStreamInstance导入
import { tools } from "./tools.js"; // 修正导入，使用正确的导出名称
import { adaptToolForServer } from "./adapters.js";
import { fetchActiveStreams, formatStreamData } from "./resources.js";

// 添加工具类型接口
interface Tool {
    name: string;
    description: string;
    inputSchema: any; // 将inputSchema从可选改为必需
    handler: (args: any) => Promise<any>;
    [key: string]: any; // 允许其他属性
}

// 初始化函数
async function init() {
    try {
        // 初始化Aptos连接
        await initAptos();
        console.error(`MoveFlow Aptos MCP服务器已启动，加载了 ${tools.length} 个工具`);

        // 输出所有工具名称以便调试
        console.error("可用工具:");
        tools.forEach((tool: Tool) => {
            console.error(`- ${tool.name}: ${tool.description}`);
        });
    } catch (error) {
        console.error("初始化失败:", error);
        process.exit(1);
    }
}

// 启动服务器
init().catch(console.error);

// 导出所有工具供MCP使用
export { tools };

async function main() {
    console.error("Starting MoveFlow Aptos MCP Server...");
    try {
        // Initialize the server with tools and resources capabilities
        const server = new McpServer({
            name: "moveflow-aptos",
            version: "1.0.0",
        });

        // Register each tool with the server
        for (const tool of tools as Tool[]) {
            const adaptedTool = adaptToolForServer(tool);

            // Use the correct overload - provide parameters schema instead of description
            server.tool(
                adaptedTool.name,
                adaptedTool.schema.parameters, // Use parameters schema, not description
                adaptedTool.handler
            );
        }

        // Register resources for active streams
        server.resource(
            "active-streams",
            "moveflow://streams/active",
            async (uri) => {
                try {
                    const activeStreams = await fetchActiveStreams();

                    // Format the streams list as text
                    const streamsList = activeStreams.map((stream: any, index: number) =>
                        `Stream #${index + 1}:\n${formatStreamData(stream)}`
                    ).join('\n\n');

                    return {
                        contents: [{
                            uri: uri.href,
                            text: streamsList || "No active streams found",
                            mimeType: "text/plain"
                        }]
                    };
                } catch (error) {
                    console.error("Error fetching resources:", error);
                    return {
                        contents: [{
                            uri: uri.href,
                            text: "Error fetching active streams",
                            mimeType: "text/plain"
                        }]
                    };
                }
            }
        );

        // Register individual stream resource template
        server.resource(
            "stream-details",
            new ResourceTemplate("moveflow://streams/{streamId}", { list: undefined }),
            async (uri, { streamId }) => {
                try {
                    // Get stream instance
                    const stream = getStreamInstance();
                    // Ensure streamId is a string
                    const streamIdString = Array.isArray(streamId) ? streamId[0] : streamId;
                    // Fetch the stream info
                    const streamInfo = await stream.fetchStream(streamIdString);

                    // Format the stream data
                    const formattedStream = formatStreamData(streamInfo);

                    return {
                        contents: [{
                            uri: uri.href,
                            text: formattedStream,
                            mimeType: "text/plain"
                        }]
                    };
                } catch (error) {
                    console.error(`Error fetching stream ${streamId}:`, error);
                    const errorMessage = error && typeof error === 'object' && 'message' in error
                        ? error.message
                        : "Unknown error";
                    return {
                        contents: [{
                            uri: uri.href,
                            text: `Error fetching stream ${streamId}: ${errorMessage}`,
                            mimeType: "text/plain"
                        }]
                    };
                }
            }
        );

        console.error("MoveFlow Aptos MCP Server tools and resources registered");

        // Start the server with stdio transport
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("MoveFlow Aptos MCP Server started");
    } catch (error) {
        console.error("Failed to start MoveFlow Aptos MCP Server:", error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});
