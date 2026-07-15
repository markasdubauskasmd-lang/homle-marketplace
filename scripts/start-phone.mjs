process.env.LAN_PORT ||= "4174";
process.env.LAN_HOST ||= "0.0.0.0";

await import("../server.mjs");
