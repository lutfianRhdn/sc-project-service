import log from "./log";

export type Message = {
	messageId: string;
	status: "completed" | "failed" | "error" | "healthy";
	destination?: string[];
	reason?: "SERVER_BUSY" | "NO_TWEET_FOUND" | string;
	data?: any;
};
export  function sendMessage({ messageId, status, reason, destination = ['supervisor'], data }: Message): void {
  process.stdout.write(JSON.stringify({ messageId, status, reason, data }) + "\n");
  log(`Message ${messageId} sended to ${destination} with status: ${status}`, "info");
}
export function sendMessagetoSupervisor({
	messageId,
	status,
	reason,
	destination = ["supervisor"],
	data,
}: Message): void {
	process.send!({ status: status, messageId,destination, reason, data });
}