import { getStreamInstance } from "./aptos.js";
import { StreamDirection } from "@moveflow/aptos-sdk";

// Function to fetch active streams associated with the current account
export async function fetchActiveStreams() {
    try {
        const stream = getStreamInstance();

        // 添加警告日志，表明使用的是废弃 API
        console.warn("Warning: Using deprecated Stream.getStreams API. May be removed in future versions.");

        // 使用带有适当参数的 getStreams 方法
        const activeStreams = await stream.getStreams(
            StreamDirection.Both,
            { limit: 20, offset: 0 }
        );

        // 处理返回的结果
        if (!activeStreams || !Array.isArray(activeStreams)) {
            console.error("Unexpected response format from getStreams:", activeStreams);
            return [];
        }

        // 将表格条目转换为更易于使用的格式
        return activeStreams.map(entry => entry.decoded_value || entry);
    } catch (error) {
        console.error("Error fetching active streams:", error);
        return [];
    }
}

// Function to format stream data in a readable text format
export function formatStreamData(stream: any) {
    if (!stream) return "No stream data available";

    try {
        // Format the stream data based on the actual structure
        // Check if the stream data is in decoded_value (typical table entry format)
        const streamData = stream.decoded_value || stream;

        return `
Stream ID: ${streamData.id || streamData.stream_id || "Unknown"}
Name: ${streamData.name || "Unnamed"}
Type: ${streamData.stream_type || "Unknown"}
Status: ${streamData.status || "Unknown"}
Sender: ${streamData.sender || "Unknown"}
Recipient: ${streamData.recipient || "Unknown"}
Token: ${streamData.coin_type || streamData.asset_type || "Unknown"}
Amount: ${streamData.deposit_amount || streamData.amount || "Unknown"}
Start Time: ${streamData.start_time ? new Date(streamData.start_time * 1000).toLocaleString() : "Unknown"}
End Time: ${streamData.stop_time ? new Date(streamData.stop_time * 1000).toLocaleString() : "Unknown"}
Interval: ${streamData.interval ? streamData.interval + " seconds" : "Unknown"}
`.trim();
    } catch (error) {
        console.error("Error formatting stream data:", error);
        return "Error formatting stream data";
    }
}
